// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { spawn } from "child_process";
import {
    initDatabase,
    getDatabasePath,
    getProfile,
    upsertProfile,
    updateProfileExtraField,
    getSiteData,
    upsertSiteData,
    deleteSiteData,
    getConversations,
    addConversation,
    clearConversations,
    getLearnedContext,
    addLearnedContext,
    deleteLearnedContext,
    getFullUserData
} from "./database.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Initialize database
initDatabase();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// openai LLM endpoint
app.post("/api/openai/chat", async (req, res) => {
    try {
        const { model, messages } = req.body;
        console.log("[OpenAI] Request received - model:", model, "messages:", messages?.length);

        if (!model || !messages) {
            console.log("[OpenAI] Error: Missing model or messages");
            return res.status(400).json({ error: "Missing model or messages" });
        }

        console.log("[OpenAI] Calling OpenAI API...");
        const response = await openai.chat.completions.create({
            model,
            messages
        });

        console.log("[OpenAI] Response received - choices:", response?.choices?.length);
        res.json(response);
    } catch (err) {
        console.error("[OpenAI] Error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// crawl4ai endpoint
app.post("/api/crawl", async (req, res) => {
	try {
		console.log("Received crawl request:", req.body);
		const { urls, crawler_config } = req.body;
		if (!urls || !Array.isArray(urls)) {
			return res.status(400).json({ error: "Missing or invalid urls array" });
		}

		const response = await fetch("http://localhost:11235/crawl", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ 
				urls,
				crawler_config
			})
		});

		console.log("Response status: ", response.status);
		if (!response.ok) {
			throw new Error(`Crawl4AI responded with ${response.status}`);
		}

		const data = await response.json();
		console.log("Crawl successful");
		res.json(data);
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});


// Brave Search endpoint
app.post("/api/search", async (req, res) => {
	try {
		console.log("Received search request:", req.body);
		const { query, count = 5 } = req.body;
		
		if (!query) {
			return res.status(400).json({ error: "Missing query parameter" });
		}

		const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
		if (!braveApiKey) {
			return res.status(500).json({ error: "BRAVE_SEARCH_API_KEY not configured" });
		}

		// Call Brave Search API
		const searchUrl = new URL("https://api.search.brave.com/res/v1/web/search");
		searchUrl.searchParams.set("q", query);
		searchUrl.searchParams.set("count", count.toString());

		const response = await fetch(searchUrl.toString(), {
			method: "GET",
			headers: {
				"Accept": "application/json",
				"X-Subscription-Token": braveApiKey
			}
		});

		if (!response.ok) {
			throw new Error(`Brave Search API responded with ${response.status}`);
		}

		const data = await response.json();
		console.log("Search successful, found", data?.web?.results?.length || 0, "results");
		res.json(data);
	} catch (err) {
		console.error("Search error:", err);
		res.status(500).json({ error: String(err) });
	}
});


// =============================================================================
// Agent Process Management
// =============================================================================

// Configuration
const AGENT_CONFIG = {
    portPool: [5001, 5002, 5003, 5004, 5005],
    agentPath: process.env.WEB_AGENT_PATH || "C:\\Users\\John\\PycharmProjects\\WEB_AGENT",
    pythonPath: process.env.WEB_AGENT_PYTHON || "C:\\Users\\John\\PycharmProjects\\WEB_AGENT\\.venv\\Scripts\\python.exe",
    timeoutMs: 10 * 60 * 1000,  // 10 minutes
    healthCheckIntervalMs: 1000,
    healthCheckMaxAttempts: 30,
    callbackBaseUrl: `http://localhost:${process.env.PORT || 8787}`
};

// Track running agents: port -> { process, taskId, startedAt, timeoutHandle, restartCount }
const agentsByPort = new Map();

// =============================================================================
// SSE (Server-Sent Events) for Real-Time Updates
// =============================================================================

// Track connected SSE clients: Set of response objects
const sseClients = new Set();

// Queue for needs_input requests: array of { port, taskId, sessionId, missingFields, timestamp }
const needsInputQueue = [];

// Send event to all connected SSE clients
function broadcastSSE(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch (err) {
            console.error("[SSE] Error writing to client:", err);
            sseClients.delete(client);
        }
    }
    console.log(`[SSE] Broadcast '${event}' to ${sseClients.size} clients`);
}

// Get next available port
function getAvailablePort() {
    for (const port of AGENT_CONFIG.portPool) {
        if (!agentsByPort.has(port)) {
            return port;
        }
    }
    return null;
}

// Wait for agent to become healthy
async function waitForHealth(port, maxAttempts = AGENT_CONFIG.healthCheckMaxAttempts) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(`http://localhost:${port}/health`);
            if (response.ok) {
                return true;
            }
        } catch {
            // Agent not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, AGENT_CONFIG.healthCheckIntervalMs));
    }
    return false;
}

// Spawn a new agent process
async function spawnAgent(taskId) {
    const port = getAvailablePort();
    if (!port) {
        throw new Error("No available ports. Maximum concurrent agents reached.");
    }

    console.log(`[Agent] Spawning agent on port ${port} for task ${taskId}`);

    const callbackUrl = `${AGENT_CONFIG.callbackBaseUrl}/api/agent/webhook`;
    const dbPath = getDatabasePath();

    // Spawn the Python agent process (-u for unbuffered output)
    const agentProcess = spawn(AGENT_CONFIG.pythonPath, [
        "-u", "-m", "src.agent_service",
        "--port", port.toString(),
        "--callback-url", callbackUrl,
        "--database-path", dbPath
    ], {
        cwd: AGENT_CONFIG.agentPath,
        stdio: ["ignore", "pipe", "pipe"]
    });

    // Log stdout/stderr
    agentProcess.stdout.on("data", (data) => {
        console.log(`[Agent:${port}] ${data.toString().trim()}`);
    });
    agentProcess.stderr.on("data", (data) => {
        console.error(`[Agent:${port}] ${data.toString().trim()}`);
    });

    // Handle process exit
    agentProcess.on("exit", (code, signal) => {
        console.log(`[Agent:${port}] Process exited with code ${code}, signal ${signal}`);
        handleAgentExit(port, code, signal);
    });

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
        console.log(`[Agent:${port}] Timeout reached, killing process`);
        killAgent(port);
    }, AGENT_CONFIG.timeoutMs);

    // Track the agent
    agentsByPort.set(port, {
        process: agentProcess,
        taskId,
        startedAt: Date.now(),
        timeoutHandle,
        restartCount: 0
    });

    // Wait for agent to become healthy
    const healthy = await waitForHealth(port);
    if (!healthy) {
        killAgent(port);
        throw new Error("Agent failed to start (health check timeout)");
    }

    console.log(`[Agent:${port}] Agent is healthy and ready`);
    return port;
}

// Handle agent process exit (crash handling)
function handleAgentExit(port, code, signal) {
    const agent = agentsByPort.get(port);
    if (!agent) return;

    clearTimeout(agent.timeoutHandle);

    // If exit was unexpected and we haven't restarted yet, try once
    if (code !== 0 && agent.restartCount < 1) {
        console.log(`[Agent:${port}] Unexpected exit, attempting restart...`);
        agent.restartCount++;

        // Re-spawn the agent (-u for unbuffered output)
        const agentProcess = spawn(AGENT_CONFIG.pythonPath, [
            "-u", "-m", "src.agent_service",
            "--port", port.toString(),
            "--callback-url", `${AGENT_CONFIG.callbackBaseUrl}/api/agent/webhook`,
            "--database-path", getDatabasePath()
        ], {
            cwd: AGENT_CONFIG.agentPath,
            stdio: ["ignore", "pipe", "pipe"]
        });

        agentProcess.stdout.on("data", (data) => {
            console.log(`[Agent:${port}] ${data.toString().trim()}`);
        });
        agentProcess.stderr.on("data", (data) => {
            console.error(`[Agent:${port}] ${data.toString().trim()}`);
        });
        agentProcess.on("exit", (c, s) => handleAgentExit(port, c, s));

        agent.process = agentProcess;
        agent.timeoutHandle = setTimeout(() => {
            console.log(`[Agent:${port}] Timeout reached after restart, killing process`);
            killAgent(port);
        }, AGENT_CONFIG.timeoutMs);
    } else {
        // Clean up
        agentsByPort.delete(port);
        console.log(`[Agent:${port}] Agent removed from pool`);
    }
}

// Kill an agent process
function killAgent(port) {
    const agent = agentsByPort.get(port);
    if (!agent) return false;

    clearTimeout(agent.timeoutHandle);

    try {
        agent.process.kill("SIGTERM");
    } catch (err) {
        console.error(`[Agent:${port}] Error killing process:`, err);
    }

    agentsByPort.delete(port);
    console.log(`[Agent:${port}] Agent killed and removed from pool`);
    return true;
}

// =============================================================================
// Agent API Endpoints
// =============================================================================

// POST /api/agent/start - Spawn a new agent and return its port
app.post("/api/agent/start", async (req, res) => {
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
app.post("/api/agent/execute-goal", async (req, res) => {
    try {
        const { port, goal, startUrl, userProfile, options, userId = 1 } = req.body;

        if (!port || !goal) {
            return res.status(400).json({ error: "Missing port or goal" });
        }

        // Verify agent is running on this port
        if (!agentsByPort.has(port)) {
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
            options: { headless: false, ...options }
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

// POST /api/agent/continue - Continue a paused agent session
app.post("/api/agent/continue", async (req, res) => {
    try {
        const { port, sessionId, additionalData } = req.body;

        if (!port || !sessionId) {
            return res.status(400).json({ error: "Missing port or sessionId" });
        }

        console.log(`[Agent:${port}] Continuing session ${sessionId}`);

        const response = await fetch(`http://localhost:${port}/api/session/${sessionId}/continue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ additionalData: additionalData || {} })
        });

        if (!response.ok) {
            throw new Error(`Agent responded with ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Agent:${port}] Continue result:`, data.status);
        res.json(data);
    } catch (err) {
        console.error("[Agent] Continue error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/agent/stop - Kill an agent process
app.post("/api/agent/stop", async (req, res) => {
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
app.get("/api/agent/health/:port", async (req, res) => {
    try {
        const port = parseInt(req.params.port);
        const response = await fetch(`http://localhost:${port}/health`);

        if (response.ok) {
            res.json({ healthy: true, managed: agentsByPort.has(port) });
        } else {
            res.json({ healthy: false, managed: agentsByPort.has(port) });
        }
    } catch {
        res.json({ healthy: false, managed: agentsByPort.has(parseInt(req.params.port)) });
    }
});

// GET /api/agent/status - List all running agents
app.get("/api/agent/status", (req, res) => {
    const agents = [];
    for (const [port, agent] of agentsByPort) {
        agents.push({
            port,
            taskId: agent.taskId,
            startedAt: agent.startedAt,
            runningMs: Date.now() - agent.startedAt,
            restartCount: agent.restartCount
        });
    }
    res.json({ agents, availablePorts: AGENT_CONFIG.portPool.filter(p => !agentsByPort.has(p)) });
});

// GET /api/events - SSE endpoint for real-time updates
app.get("/api/events", (req, res) => {
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
    const agents = [];
    for (const [port, agent] of agentsByPort) {
        agents.push({ port, taskId: agent.taskId, startedAt: agent.startedAt });
    }
    res.write(`event: state\ndata: ${JSON.stringify({ agents, needsInputQueue })}\n\n`);

    // Add to clients set
    sseClients.add(res);

    // Handle client disconnect
    req.on("close", () => {
        console.log("[SSE] Client disconnected");
        sseClients.delete(res);
    });
});

// POST /api/agent/webhook - Webhook endpoint for agent status updates
app.post("/api/agent/webhook", (req, res) => {
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
        needsInputQueue.push(inputRequest);
        console.log(`[Webhook] Added to needs_input queue (${needsInputQueue.length} pending)`);

        // Also broadcast the queue update
        broadcastSSE("needs-input", inputRequest);
    }

    // Handle completion: remove from needs_input queue if present
    if (status === "achieved" || status === "failed") {
        const idx = needsInputQueue.findIndex(item => item.port === port);
        if (idx !== -1) {
            needsInputQueue.splice(idx, 1);
            console.log(`[Webhook] Removed from needs_input queue (${needsInputQueue.length} pending)`);
        }
    }

    res.json({ received: true });
});

// GET /api/agent/needs-input - Get current needs_input queue
app.get("/api/agent/needs-input", (req, res) => {
    res.json({ queue: needsInputQueue });
});

// POST /api/agent/provide-input - Provide input for a waiting agent
app.post("/api/agent/provide-input", async (req, res) => {
    try {
        const { port, sessionId, inputData } = req.body;

        if (!port || !sessionId) {
            return res.status(400).json({ error: "Missing port or sessionId" });
        }

        // Remove from queue
        const idx = needsInputQueue.findIndex(item => item.port === port && item.sessionId === sessionId);
        if (idx !== -1) {
            needsInputQueue.splice(idx, 1);
        }

        // Forward to agent continue endpoint
        console.log(`[Agent:${port}] Providing input for session ${sessionId}`);

        const response = await fetch(`http://localhost:${port}/api/session/${sessionId}/continue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ additionalData: inputData || {} })
        });

        if (!response.ok) {
            throw new Error(`Agent responded with ${response.status}`);
        }

        const data = await response.json();

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


// =============================================================================
// Database API Endpoints
// =============================================================================

// GET /api/db/profile - Get user profile
app.get("/api/db/profile", (req, res) => {
    try {
        const userId = parseInt(req.query.userId) || 1;
        const profile = getProfile(userId);
        res.json({ profile });
    } catch (err) {
        console.error("[DB] Get profile error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/db/profile - Update user profile
app.post("/api/db/profile", (req, res) => {
    try {
        const userId = parseInt(req.body.userId) || 1;
        const profile = upsertProfile(userId, req.body);
        res.json({ profile });
    } catch (err) {
        console.error("[DB] Update profile error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/db/profile/extra - Update a single extra field
app.post("/api/db/profile/extra", (req, res) => {
    try {
        const { userId = 1, fieldName, fieldValue } = req.body;
        if (!fieldName) {
            return res.status(400).json({ error: "Missing fieldName" });
        }
        const profile = updateProfileExtraField(userId, fieldName, fieldValue);
        res.json({ profile });
    } catch (err) {
        console.error("[DB] Update extra field error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// GET /api/db/site-data - Get site data
app.get("/api/db/site-data", (req, res) => {
    try {
        const userId = parseInt(req.query.userId) || 1;
        const domain = req.query.domain || null;
        const data = getSiteData(userId, domain);
        res.json({ siteData: data });
    } catch (err) {
        console.error("[DB] Get site data error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/db/site-data - Add/update site data
app.post("/api/db/site-data", (req, res) => {
    try {
        const { userId = 1, domain, fieldName, fieldValue } = req.body;
        if (!domain || !fieldName) {
            return res.status(400).json({ error: "Missing domain or fieldName" });
        }
        const data = upsertSiteData(userId, domain, fieldName, fieldValue);
        res.json({ siteData: data });
    } catch (err) {
        console.error("[DB] Update site data error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// DELETE /api/db/site-data - Delete site data
app.delete("/api/db/site-data", (req, res) => {
    try {
        const { userId = 1, domain, fieldName } = req.body;
        if (!domain) {
            return res.status(400).json({ error: "Missing domain" });
        }
        deleteSiteData(userId, domain, fieldName);
        res.json({ success: true });
    } catch (err) {
        console.error("[DB] Delete site data error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// GET /api/db/conversations - Get conversation history
app.get("/api/db/conversations", (req, res) => {
    try {
        const userId = parseInt(req.query.userId) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const conversations = getConversations(userId, limit);
        res.json({ conversations });
    } catch (err) {
        console.error("[DB] Get conversations error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/db/conversations - Add conversation message
app.post("/api/db/conversations", (req, res) => {
    try {
        const { userId = 1, role, content, url } = req.body;
        if (!role || !content) {
            return res.status(400).json({ error: "Missing role or content" });
        }
        const id = addConversation(userId, role, content, url);
        res.json({ id });
    } catch (err) {
        console.error("[DB] Add conversation error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// DELETE /api/db/conversations - Clear conversation history
app.delete("/api/db/conversations", (req, res) => {
    try {
        const userId = parseInt(req.body.userId) || 1;
        clearConversations(userId);
        res.json({ success: true });
    } catch (err) {
        console.error("[DB] Clear conversations error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// GET /api/db/learned - Get learned context
app.get("/api/db/learned", (req, res) => {
    try {
        const userId = parseInt(req.query.userId) || 1;
        const context = getLearnedContext(userId);
        res.json({ learnedContext: context });
    } catch (err) {
        console.error("[DB] Get learned context error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// POST /api/db/learned - Add learned context
app.post("/api/db/learned", (req, res) => {
    try {
        const { userId = 1, fact, source } = req.body;
        if (!fact) {
            return res.status(400).json({ error: "Missing fact" });
        }
        const id = addLearnedContext(userId, fact, source);
        res.json({ id });
    } catch (err) {
        console.error("[DB] Add learned context error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// DELETE /api/db/learned/:id - Delete learned context
app.delete("/api/db/learned/:id", (req, res) => {
    try {
        const id = parseInt(req.params.id);
        deleteLearnedContext(id);
        res.json({ success: true });
    } catch (err) {
        console.error("[DB] Delete learned context error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// GET /api/db/user-data - Get full user data (for agents)
app.get("/api/db/user-data", (req, res) => {
    try {
        const userId = parseInt(req.query.userId) || 1;
        const data = getFullUserData(userId);
        res.json(data);
    } catch (err) {
        console.error("[DB] Get full user data error:", err);
        res.status(500).json({ error: String(err) });
    }
});


// =============================================================================
// Server Startup & Shutdown
// =============================================================================

const port = process.env.PORT || 8787;

// Graceful shutdown - kill all agent processes and close SSE connections
function gracefulShutdown(signal) {
    console.log(`\n[Server] Received ${signal}, shutting down...`);

    // Close all SSE connections
    for (const client of sseClients) {
        try {
            client.end();
        } catch (err) {
            // Ignore errors on close
        }
    }
    sseClients.clear();
    console.log("[Server] Closed all SSE connections");

    // Kill all running agents
    for (const [agentPort] of agentsByPort) {
        console.log(`[Server] Killing agent on port ${agentPort}`);
        killAgent(agentPort);
    }

    console.log("[Server] Goodbye!");
    process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

app.listen(port, () => console.log(`Proxy running on http://localhost:${port}`));