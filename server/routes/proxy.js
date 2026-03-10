// routes/proxy.js - LLM, content extraction, and Brave Search proxy endpoints
import { Router } from "express";
import { appConfig, PROVIDER, getTldSet } from "../config.js";
import { getHistory, addMessage } from "../conversationHistory.js";
import { chat as openaiChat } from "../providers/openai.js";
import { chat as anthropicChat } from "../providers/anthropic.js";
import { logMetric } from "../metricsLogger.js";

const router = Router();

// Provider adapter lookup
const providers = {
	openai: openaiChat,
	anthropic: anthropicChat
};

// LLM chat endpoint (supports OpenAI and Anthropic via provider field)
router.post("/api/llm/chat", async (req, res) => {
	try {
		const { model, messages, provider, userId = 1, storeInHistory = false, flow } = req.body;
		const effectiveProvider = provider || PROVIDER;
		console.log("[LLM] Request received - provider:", effectiveProvider, "model:", model, "messages:", messages?.length);

		if (!model || !messages) {
			console.log("[LLM] Error: Missing model or messages");
			return res.status(400).json({ error: "Missing model or messages" });
		}

		const chatFn = providers[effectiveProvider];
		if (!chatFn) {
			return res.status(400).json({ error: `Unknown provider: ${effectiveProvider}` });
		}

		// Build augmented messages: insert history after system messages
		const history = getHistory(userId);
		let systemEnd = 0;
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].role === "system") {
				systemEnd = i + 1;
			} else {
				break;
			}
		}
		const augmented = [
			...messages.slice(0, systemEnd),
			...history,
			...messages.slice(systemEnd)
		];

		console.log("[LLM] Calling", effectiveProvider, "API... (history:", history.length, "messages injected)");
		const startTime = Date.now();
		const result = await chatFn(model, augmented);
		const turnaroundMs = Date.now() - startTime;

		// Log server-side metric
		logMetric({
			type: "llm_call",
			scope: "server",
			timestamp: new Date().toISOString(),
			flow: flow || "unknown",
			provider: effectiveProvider,
			model,
			turnaroundMs,
			tokens: result.usage
		});

		// Store conversation turn in history if requested
		if (storeInHistory) {
			const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
			if (lastUserMsg) addMessage(userId, "user", lastUserMsg.content);
			if (result.content) addMessage(userId, "assistant", result.content);
		}

		res.json({ content: result.content, usage: result.usage });
	} catch (err) {
		console.error("[LLM] Error:", err);
		const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
		const response = { error: err.message || String(err) };
		if (err.retryAfter) {
			res.setHeader('Retry-After', err.retryAfter);
			response.retryAfter = err.retryAfter;
		}
		res.status(status).json(response);
	}
});

// Manually add conversation turns to history (used by ReAct after completion)
router.post("/api/history/add", async (req, res) => {
	try {
		const { userId = 1, messages } = req.body;
		if (!Array.isArray(messages)) {
			return res.status(400).json({ error: "Missing or invalid messages array" });
		}
		for (const msg of messages) {
			addMessage(userId, msg.role, msg.content);
		}
		res.json({ success: true });
	} catch (err) {
		console.error("[History] Error:", err);
		res.status(500).json({ error: String(err) });
	}
});

// Content extraction endpoint (proxies to Crawl4AI)
router.post("/api/extract", async (req, res) => {
	try {
		console.log("[Extract] Received extract request:", req.body);
		const { urls, crawler_config } = req.body;
		if (!urls || !Array.isArray(urls)) {
			return res.status(400).json({ error: "Missing or invalid urls array" });
		}

		const response = await fetch(appConfig.server.crawl4ai.url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				urls,
				crawler_config
			})
		});

		console.log("[Extract] Response status:", response.status);
		if (!response.ok) {
			throw new Error(`Crawl4AI responded with ${response.status}`);
		}

		const data = await response.json();
		console.log("[Extract] Extraction successful");
		res.json(data);
	} catch (err) {
		console.error("[Extract] Error:", err);
		res.status(500).json({ error: String(err) });
	}
});

// Brave Search endpoint
router.post("/api/search", async (req, res) => {
	try {
		// Item 8: Add [Search] log prefix
		console.log("[Search] Received search request:", req.body);
		const { query, count = appConfig.server.braveSearch.defaultCount } = req.body;

		if (!query) {
			return res.status(400).json({ error: "Missing query parameter" });
		}

		const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
		if (!braveApiKey) {
			return res.status(500).json({ error: "BRAVE_SEARCH_API_KEY not configured" });
		}

		// Call Brave Search API with retry for transient errors
		const searchUrl = new URL(appConfig.server.braveSearch.url);
		searchUrl.searchParams.set("q", query);
		searchUrl.searchParams.set("count", count.toString());

		const maxRetries = appConfig.server.braveSearch.maxRetries;
		let lastStatus;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const response = await fetch(searchUrl, {
				method: "GET",
				headers: {
					"Accept": "application/json",
					"X-Subscription-Token": braveApiKey
				}
			});

			lastStatus = response.status;
			const retryable = attempt < maxRetries;
			const backoffMs = 1000 * Math.pow(2, attempt);

			if (response.status === 429) {
				const body = await response.json().catch(() => ({}));
				const code = body?.errors?.[0]?.code;
				if (code === 'QUOTA_LIMITED') {
					throw new Error('Brave Search monthly quota exhausted');
				}
				if (retryable) {
					const resetHeader = response.headers.get('X-RateLimit-Reset') || '0';
					const resetMs = parseInt(resetHeader.split(',')[0].trim()) * 1000 || 0;
					await new Promise(r => setTimeout(r, Math.max(backoffMs, resetMs)));
					continue;
				}
			}

			if (response.status >= 500 && retryable) {
				await new Promise(r => setTimeout(r, backoffMs));
				continue;
			}

			if (!response.ok) {
				throw new Error(`Brave Search API responded with ${response.status}`);
			}

			const data = await response.json();
			console.log("[Search] Search successful, found", data?.web?.results?.length || 0, "results");
			res.json(data);
			return;
		}

		throw new Error(`Brave Search API failed after retries (last status: ${lastStatus})`);
	} catch (err) {
		console.error("[Search] Error:", err);
		res.status(500).json({ error: String(err) });
	}
});

// Client-side metrics ingestion endpoint
router.post("/api/metrics", (req, res) => {
	const record = { ...req.body, scope: "client" };
	logMetric(record);
	res.json({ success: true });
});

// Config endpoint - expose providers + extension config to clients
router.get("/api/config", (req, res) => {
	res.json({
		providers: appConfig.providers,
		extension: appConfig.extension,
		agent: { maxSteps: appConfig.agent.maxSteps },
		tlds: Array.from(getTldSet())
	});
});

export default router;
