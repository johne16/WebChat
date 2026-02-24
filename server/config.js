// config.js - Centralized configuration constants
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Item 10: Named constants for magic numbers
export const MAX_BODY_SIZE = "2mb";
export const MAX_AGENT_RESTARTS = 1;

// Item 9: Renamed to SERVER_PORT to avoid shadowing
export const SERVER_PORT = process.env.PORT || 8787;

export const AGENT_CONFIG = {
	portPool: [5001, 5002, 5003, 5004, 5005],
	agentPath: process.env.WEB_AGENT_PATH || path.resolve(__dirname, "..", "web_agent"),
	pythonPath: process.env.WEB_AGENT_PYTHON || path.resolve(__dirname, "..", "web_agent", ".venv", "Scripts", "python.exe"),
	timeoutMs: 10 * 60 * 1000,  // 10 minutes
	healthCheckIntervalMs: 1000,
	healthCheckMaxAttempts: 30,
	callbackBaseUrl: `http://localhost:${SERVER_PORT}`
};
