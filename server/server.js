// server.js - Entry point
import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDatabase, getCachedTlds, setCachedTlds } from "./database.js";
import { SERVER_PORT, MAX_BODY_SIZE, DATABASE_ENCRYPTION_KEY, setTldSet } from "./config.js";
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

async function loadTlds() {
	try {
		const res = await fetch('https://data.iana.org/TLD/tlds-alpha-by-domain.txt');
		if (!res.ok) throw new Error(`IANA responded with ${res.status}`);
		const text = await res.text();
		const tlds = text.split('\n')
			.filter(line => line && !line.startsWith('#'))
			.map(line => line.trim().toLowerCase());
		setTldSet(new Set(tlds));
		setCachedTlds(tlds);
		console.log(`[TLD] Fetched ${tlds.length} TLDs from IANA`);
	} catch (err) {
		console.warn('[TLD] Fetch failed, loading from cache:', err.message);
		const cached = getCachedTlds();
		if (cached) {
			setTldSet(new Set(cached));
			console.log(`[TLD] Loaded ${cached.length} TLDs from cache`);
		} else {
			console.warn('[TLD] No cached TLDs available; bare domain detection disabled');
		}
	}
}

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

// Fetch TLD list then start listening
loadTlds().then(() => {
	app.listen(SERVER_PORT, () => console.log(`Proxy running on http://localhost:${SERVER_PORT}`));
});
