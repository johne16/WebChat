// agentManager.js - Agent process spawning, health checks, lifecycle management
import { spawn } from "child_process";
import { AGENT_CONFIG, MAX_AGENT_RESTARTS } from "./config.js";
import { getDatabasePath } from "./database.js";

// Track running agents: port -> { process, taskId, startedAt, timeoutHandle, restartCount }
const agentsByPort = new Map();

// Get next available port
export function getAvailablePort() {
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

// Item 1: Shared helper for creating agent processes (used by spawnAgent and handleAgentExit)
function createAgentProcess(port) {
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

	return agentProcess;
}

// Handle agent process exit (crash handling)
function handleAgentExit(port, code, signal) {
	const agent = agentsByPort.get(port);
	if (!agent) return;

	clearTimeout(agent.timeoutHandle);

	// Item 10: Use MAX_AGENT_RESTARTS constant
	// If exit was unexpected and we haven't restarted yet, try once
	if (code !== 0 && agent.restartCount < MAX_AGENT_RESTARTS) {
		console.log(`[Agent:${port}] Unexpected exit, attempting restart...`);
		agent.restartCount++;

		// Item 1: Use shared helper
		const agentProcess = createAgentProcess(port);
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

// Spawn a new agent process
export async function spawnAgent(taskId) {
	const port = getAvailablePort();
	if (!port) {
		throw new Error("No available ports. Maximum concurrent agents reached.");
	}

	console.log(`[Agent] Spawning agent on port ${port} for task ${taskId}`);

	// Item 1: Use shared helper
	const agentProcess = createAgentProcess(port);

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

// Kill an agent process
export function killAgent(port) {
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

// Check if an agent is running on a given port
export function hasAgent(port) {
	return agentsByPort.has(port);
}

// Get agent info for a given port
export function getAgent(port) {
	return agentsByPort.get(port);
}

// Get all running agents as an array of { port, taskId, startedAt, ... }
export function getRunningAgents() {
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
	return agents;
}

// Get available ports list
export function getAvailablePorts() {
	return AGENT_CONFIG.portPool.filter(p => !agentsByPort.has(p));
}

// Item 17: Fix Map mutation during iteration — collect keys into array first
export function killAllAgents() {
	const ports = [...agentsByPort.keys()];
	for (const agentPort of ports) {
		console.log(`[Server] Killing agent on port ${agentPort}`);
		killAgent(agentPort);
	}
}

// Item 2: Shared helper for forwarding continue-session requests to an agent
export async function forwardContinueSession(port, sessionId, additionalData) {
	const response = await fetch(`http://localhost:${port}/api/session/${sessionId}/continue`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ additionalData: additionalData || {} })
	});

	if (!response.ok) {
		throw new Error(`Agent responded with ${response.status}`);
	}

	return await response.json();
}
