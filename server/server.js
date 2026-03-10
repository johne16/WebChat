// server.js - Entry point
import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDatabase } from "./database.js";
import { SERVER_PORT, MAX_BODY_SIZE, DATABASE_ENCRYPTION_KEY } from "./config.js";
import { killAllAgents } from "./agentManager.js";
import { closeAllSSEClients } from "./sseManager.js";
import proxyRoutes from "./routes/proxy.js";
import agentRoutes from "./routes/agent.js";
import databaseRoutes from "./routes/database.js";

// Refuse to start without encryption key
if (!DATABASE_ENCRYPTION_KEY) {
	console.error("[Server] DATABASE_ENCRYPTION_KEY is not set in .env. Generate one with: openssl rand -hex 32");
	process.exit(1);
}

const app = express();
app.use(cors({ origin: /^chrome-extension:\/\// }));
app.use(express.json({ limit: MAX_BODY_SIZE }));

// Initialize database
initDatabase();

// Mount route modules
app.use(proxyRoutes);
app.use(agentRoutes);
app.use(databaseRoutes);

// Graceful shutdown - kill all agent processes and close SSE connections
function gracefulShutdown(signal) {
	console.log(`\n[Server] Received ${signal}, shutting down...`);

	// Close all SSE connections
	closeAllSSEClients();
	console.log("[Server] Closed all SSE connections");

	// Item 17: killAllAgents collects keys into array first to avoid Map mutation during iteration
	killAllAgents();

	console.log("[Server] Goodbye!");
	process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

app.listen(SERVER_PORT, () => console.log(`Proxy running on http://localhost:${SERVER_PORT}`));
