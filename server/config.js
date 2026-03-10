// config.js - Centralized configuration constants
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load shared config from project root
const configPath = path.resolve(__dirname, "..", "webchat.config.json");
export const appConfig = Object.freeze(JSON.parse(fs.readFileSync(configPath, "utf-8")));

export const PROVIDER = appConfig.providers.default;
export const MAX_BODY_SIZE = appConfig.server.maxBodySize;
export const MAX_AGENT_RESTARTS = appConfig.agent.maxRestarts;

// Item 9: Renamed to SERVER_PORT to avoid shadowing
export const SERVER_PORT = process.env.PORT || appConfig.server.port;

export const DEFAULT_USER_ID = appConfig.extension.userId;

export const DATABASE_ENCRYPTION_KEY = process.env.DATABASE_ENCRYPTION_KEY;

// TLD state (populated by server.js at startup, read by proxy.js config endpoint)
let _tldSet = new Set();
export function getTldSet() { return _tldSet; }
export function setTldSet(set) { _tldSet = set; }

export const AGENT_CONFIG = {
	portPool: appConfig.agent.portPool,
	agentPath: process.env.WEB_AGENT_PATH || path.resolve(__dirname, "..", "web_agent"),
	pythonPath: process.env.WEB_AGENT_PYTHON || path.resolve(__dirname, "..", "web_agent", ".venv", "Scripts", "python.exe"),
	timeoutMs: appConfig.agent.timeoutMs,
	healthCheckIntervalMs: appConfig.agent.healthCheckIntervalMs,
	healthCheckMaxAttempts: appConfig.agent.healthCheckMaxAttempts,
	callbackBaseUrl: `http://localhost:${SERVER_PORT}`
};
