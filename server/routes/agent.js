// routes/agent.js - Agent API endpoints
import { Router } from "express";
import {
	spawnAgent,
	killAgent,
	hasAgent,
	getRunningAgents,
	getAvailablePorts,
	forwardContinueSession
} from "../agentManager.js";
import {
	broadcastSSE,
	addSSEClient,
	removeSSEClient,
	getNeedsInputQueue,
	removeFromNeedsInputQueue,
	addToNeedsInputQueue
} from "../sseManager.js";
import { getFullUserData } from "../database.js";

const router = Router();

// POST /api/agent/start - Spawn a new agent and return its port
router.post("/api/agent/start", async (req, res) => {
	try {
		const { taskId } = req.body;

		if (!taskId) {
			return res.status(400).json({ error: "Missing taskId" });
		}

		const port = await spawnAgent(taskId);

		console.log(`[Agent] Agent spawned successfully on port ${port}`);
		res.json({ success: true, port, taskId });
	} catch (err) {
		console.error("[Agent] Failed to spawn agent:", err.message);
		res.status(500).json({ error: err.message });
	}
});

// POST /api/agent/execute-goal - Proxy goal execution to agent
router.post("/api/agent/execute-goal", async (req, res) => {
	try {
		const { port, goal, startUrl, userProfile, options, userId = 1, provider, model } = req.body;

		if (!port || !goal) {
			return res.status(400).json({ error: "Missing port or goal" });
		}

		// Verify agent is running on this port
		if (!hasAgent(port)) {
			return res.status(400).json({ error: `No agent running on port ${port}` });
		}

		// Get user data from database and merge with provided profile
		const dbUserData = getFullUserData(userId);
		const mergedProfile = {
			...dbUserData.profile,
			...dbUserData.siteData,
			...userProfile  // Provided profile takes precedence
		};

		const requestBody = {
			goal,
			startUrl,
			userProfile: mergedProfile,
			sessionId: null,
			provider,
			model,
			options: { ...options }
		};

		console.log(`[Agent] Executing goal on port ${port}`);

		const response = await fetch(`http://localhost:${port}/api/execute-goal`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			const errorBody = await response.text();
			console.error(`[Agent:${port}] Error response:`, errorBody);
			throw new Error(`Agent responded with ${response.status}: ${errorBody}`);
		}

		const data = await response.json();
		console.log(`[Agent:${port}] Goal execution result:`, data.status);
		res.json(data);
	} catch (err) {
		console.error("[Agent] Execute goal error:", err);
		res.status(500).json({ error: String(err) });
	}
});


// POST /api/agent/stop - Kill an agent process
router.post("/api/agent/stop", async (req, res) => {
	try {
		const { port } = req.body;

		if (!port) {
			return res.status(400).json({ error: "Missing port" });
		}

		const killed = killAgent(port);

		if (killed) {
			console.log(`[Agent] Agent on port ${port} stopped`);
			res.json({ success: true });
		} else {
			res.status(404).json({ error: `No agent running on port ${port}` });
		}
	} catch (err) {
		console.error("[Agent] Stop error:", err);
		res.status(500).json({ error: String(err) });
	}
});

// GET /api/agent/health/:port - Check if agent is healthy
router.get("/api/agent/health/:port", async (req, res) => {
	try {
		const port = parseInt(req.params.port);
		const response = await fetch(`http://localhost:${port}/health`);

		if (response.ok) {
			res.json({ healthy: true, managed: hasAgent(port) });
		} else {
			res.json({ healthy: false, managed: hasAgent(port) });
		}
	} catch {
		res.json({ healthy: false, managed: hasAgent(parseInt(req.params.port)) });
	}
});

// GET /api/agent/status - List all running agents
router.get("/api/agent/status", (req, res) => {
	res.json({ agents: getRunningAgents(), availablePorts: getAvailablePorts() });
});

// GET /api/events - SSE endpoint for real-time updates
router.get("/api/events", (req, res) => {
	console.log("[SSE] Client connected");

	// Set headers for SSE
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.flushHeaders();

	// Send initial connection event
	res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

	// Send current state: running agents and pending inputs
	const agents = getRunningAgents().map(a => ({
		port: a.port,
		taskId: a.taskId,
		startedAt: a.startedAt
	}));
	res.write(`event: state\ndata: ${JSON.stringify({ agents, needsInputQueue: getNeedsInputQueue() })}\n\n`);

	// Add to clients set
	addSSEClient(res);

	// Handle client disconnect
	req.on("close", () => {
		console.log("[SSE] Client disconnected");
		removeSSEClient(res);
	});
});

// POST /api/agent/webhook - Webhook endpoint for agent status updates
router.post("/api/agent/webhook", (req, res) => {
	const { port, taskId, sessionId, status, message, missingFields, data } = req.body;
	console.log(`[Webhook] Agent:${port} status=${status}`, message || "");

	// Broadcast to all SSE clients
	broadcastSSE("agent-status", {
		port,
		taskId,
		sessionId,
		status,
		message,
		missingFields,
		data,
		timestamp: Date.now()
	});

	// Handle needs_input: add to queue
	if (status === "needs_input" && missingFields) {
		const inputRequest = {
			port,
			taskId,
			sessionId,
			missingFields,
			message,
			timestamp: Date.now()
		};
		addToNeedsInputQueue(inputRequest);
		console.log(`[Webhook] Added to needs_input queue`);

		// Also broadcast the queue update
		broadcastSSE("needs-input", inputRequest);
	}

	// Item 5: Use shared queue removal helper (port-only predicate for completion)
	if (status === "achieved" || status === "failed") {
		const removed = removeFromNeedsInputQueue(item => item.port === port);
		if (removed) {
			console.log(`[Webhook] Removed from needs_input queue`);
		}
	}

	res.json({ received: true });
});

// GET /api/agent/needs-input - Get current needs_input queue
router.get("/api/agent/needs-input", (req, res) => {
	res.json({ queue: getNeedsInputQueue() });
});

// POST /api/agent/provide-input - Provide input for a waiting agent
router.post("/api/agent/provide-input", async (req, res) => {
	try {
		const { port, sessionId, inputData, provider, model } = req.body;

		if (!port || !sessionId) {
			return res.status(400).json({ error: "Missing port or sessionId" });
		}

		// Item 5: Use shared queue removal helper (port+sessionId predicate for input)
		removeFromNeedsInputQueue(item => item.port === port && item.sessionId === sessionId);

		// Item 2: Use shared continue-session helper
		console.log(`[Agent:${port}] Providing input for session ${sessionId}`);
		const data = await forwardContinueSession(port, sessionId, inputData, provider, model);

		// Only broadcast input-provided if agent doesn't need more input
		if (data.status !== "needs_input") {
			broadcastSSE("input-provided", { port, sessionId, timestamp: Date.now() });
		}

		console.log(`[Agent:${port}] Input provided, result: ${data.status}`);
		res.json(data);
	} catch (err) {
		console.error("[Agent] Provide input error:", err);
		res.status(500).json({ error: String(err) });
	}
});

export default router;
