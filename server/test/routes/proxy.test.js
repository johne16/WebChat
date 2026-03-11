import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockReq, mockRes } from "../helpers.js";

vi.mock("../../providers/openai.js", () => ({
	chat: vi.fn()
}));
vi.mock("../../providers/anthropic.js", () => ({
	chat: vi.fn()
}));
vi.mock("../../conversationHistory.js", () => ({
	getHistory: vi.fn().mockReturnValue([]),
	addMessage: vi.fn()
}));
vi.mock("../../metricsLogger.js", () => ({
	logMetric: vi.fn()
}));

import { chat as openaiChat } from "../../providers/openai.js";
import { chat as anthropicChat } from "../../providers/anthropic.js";
import { getHistory, addMessage } from "../../conversationHistory.js";

import router from "../../routes/proxy.js";

function getHandler(method, path) {
	for (const layer of router.stack) {
		if (layer.route && layer.route.path === path) {
			const routeMethod = method.toLowerCase();
			const handler = layer.route.methods[routeMethod] && layer.route.stack.find(s => s.method === routeMethod);
			if (handler) return handler.handle;
		}
	}
	throw new Error(`No handler found for ${method} ${path}`);
}

describe("routes/proxy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset global fetch mock
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("POST /api/llm/chat", () => {
		const handler = () => getHandler("POST", "/api/llm/chat");

		it("returns 400 if model or messages is missing", async () => {
			const req = mockReq({ body: { model: "gpt-5.2" } });
			const res = mockRes();

			await handler()(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("routes to anthropic provider by default", async () => {
			anthropicChat.mockResolvedValueOnce({ content: "hello", usage: {} });
			const req = mockReq({
				body: {
					model: "claude-haiku-4-5",
					messages: [{ role: "user", content: "hi" }]
				}
			});
			const res = mockRes();

			await handler()(req, res);

			expect(anthropicChat).toHaveBeenCalled();
			expect(openaiChat).not.toHaveBeenCalled();
			expect(res.json).toHaveBeenCalledWith({ content: "hello", usage: {} });
		});

		it("routes to anthropic provider when specified", async () => {
			anthropicChat.mockResolvedValueOnce({ content: "hey", usage: {} });
			const req = mockReq({
				body: {
					model: "claude-sonnet-4-6",
					messages: [{ role: "user", content: "hi" }],
					provider: "anthropic"
				}
			});
			const res = mockRes();

			await handler()(req, res);

			expect(anthropicChat).toHaveBeenCalled();
			expect(openaiChat).not.toHaveBeenCalled();
		});

		it("returns 400 for unknown provider", async () => {
			const req = mockReq({
				body: { model: "x", messages: [{ role: "user", content: "hi" }], provider: "gemini" }
			});
			const res = mockRes();

			await handler()(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "Unknown provider: gemini" });
		});

		it("injects history after system messages", async () => {
			getHistory.mockReturnValueOnce([{ role: "user", content: "prev" }]);
			openaiChat.mockResolvedValueOnce({ content: "ok", usage: null });

			const req = mockReq({
				body: {
					model: "gpt-5.2",
					provider: "openai",
					messages: [
						{ role: "system", content: "sys" },
						{ role: "user", content: "new" }
					]
				}
			});
			const res = mockRes();

			await handler()(req, res);

			// The augmented messages passed to the provider should be: system, history, user
			const passedMessages = openaiChat.mock.calls[0][1];
			expect(passedMessages[0]).toEqual({ role: "system", content: "sys" });
			expect(passedMessages[1]).toEqual({ role: "user", content: "prev" });
			expect(passedMessages[2]).toEqual({ role: "user", content: "new" });
		});

		it("returns 429 with Retry-After header when provider throws rate limit error", async () => {
			const err = new Error("Rate limit exceeded");
			err.status = 429;
			err.retryAfter = "30";
			anthropicChat.mockRejectedValueOnce(err);

			const req = mockReq({
				body: { model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] }
			});
			const res = mockRes();

			await handler()(req, res);

			expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "30");
			expect(res.status).toHaveBeenCalledWith(429);
			expect(res.json).toHaveBeenCalledWith({
				error: "Rate limit exceeded",
				retryAfter: "30"
			});
		});

		it("returns 401 when provider throws auth error", async () => {
			const err = new Error("Invalid API key");
			err.status = 401;
			anthropicChat.mockRejectedValueOnce(err);

			const req = mockReq({
				body: { model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] }
			});
			const res = mockRes();

			await handler()(req, res);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
		});

		it("returns 500 when provider throws plain Error without status", async () => {
			anthropicChat.mockRejectedValueOnce(new Error("Something broke"));

			const req = mockReq({
				body: { model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] }
			});
			const res = mockRes();

			await handler()(req, res);

			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({ error: "Something broke" });
		});

		it("stores conversation in history when storeInHistory is true", async () => {
			anthropicChat.mockResolvedValueOnce({ content: "reply", usage: null });
			const req = mockReq({
				body: {
					model: "claude-haiku-4-5",
					messages: [{ role: "user", content: "question" }],
					storeInHistory: true,
					userId: 1
				}
			});
			const res = mockRes();

			await handler()(req, res);

			expect(addMessage).toHaveBeenCalledWith(1, "user", "question");
			expect(addMessage).toHaveBeenCalledWith(1, "assistant", "reply");
		});
	});

	describe("POST /api/history/add", () => {
		it("adds each message to history", async () => {
			const handler = getHandler("POST", "/api/history/add");
			const req = mockReq({
				body: {
					userId: 2,
					messages: [
						{ role: "user", content: "q" },
						{ role: "assistant", content: "a" }
					]
				}
			});
			const res = mockRes();

			await handler(req, res);

			expect(addMessage).toHaveBeenCalledTimes(2);
			expect(addMessage).toHaveBeenCalledWith(2, "user", "q");
			expect(addMessage).toHaveBeenCalledWith(2, "assistant", "a");
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});
	});

	describe("POST /api/extract", () => {
		it("returns 400 if urls is missing or not an array", async () => {
			const handler = getHandler("POST", "/api/extract");
			const req = mockReq({ body: {} });
			const res = mockRes();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("proxies request to Crawl4AI and returns response", async () => {
			const handler = getHandler("POST", "/api/extract");
			const extractResult = { results: [{ markdown: "hello" }] };
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(extractResult)
			});

			const req = mockReq({ body: { urls: ["http://example.com"], crawler_config: {} } });
			const res = mockRes();

			await handler(req, res);

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"http://localhost:11235/extract",
				expect.objectContaining({
					method: "POST",
					body: expect.any(String)
				})
			);
			expect(res.json).toHaveBeenCalledWith(extractResult);
		});

		it("returns 500 when Crawl4AI responds with error", async () => {
			const handler = getHandler("POST", "/api/extract");
			globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 503 });

			const req = mockReq({ body: { urls: ["http://x.com"] } });
			const res = mockRes();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(500);
		});
	});

	describe("POST /api/search", () => {
		const originalKey = process.env.BRAVE_SEARCH_API_KEY;
		afterEach(() => {
			if (originalKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
			else process.env.BRAVE_SEARCH_API_KEY = originalKey;
		});

		it("returns 400 if query is missing", async () => {
			const handler = getHandler("POST", "/api/search");
			const req = mockReq({ body: {} });
			const res = mockRes();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("returns 500 if BRAVE_SEARCH_API_KEY is not set", async () => {
			const handler = getHandler("POST", "/api/search");
			delete process.env.BRAVE_SEARCH_API_KEY;

			const req = mockReq({ body: { query: "test" } });
			const res = mockRes();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({ error: "BRAVE_SEARCH_API_KEY not configured" });
		});

		it("calls Brave Search API with correct headers", async () => {
			const handler = getHandler("POST", "/api/search");
			process.env.BRAVE_SEARCH_API_KEY = "test-key-123";
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ web: { results: [] } })
			});

			const req = mockReq({ body: { query: "vitest", count: 3 } });
			const res = mockRes();

			await handler(req, res);

			const [url, opts] = globalThis.fetch.mock.calls[0];
			expect(url.toString()).toContain("q=vitest");
			expect(url.toString()).toContain("count=3");
			expect(opts.headers["X-Subscription-Token"]).toBe("test-key-123");
		});

		it("retries on 429 RATE_LIMITED and succeeds on second attempt", async () => {
			const handler = getHandler("POST", "/api/search");
			process.env.BRAVE_SEARCH_API_KEY = "key";

			// First call: 429 RATE_LIMITED
			globalThis.fetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				headers: { get: (h) => h === 'X-RateLimit-Reset' ? '1' : null },
				json: () => Promise.resolve({
					type: "ErrorResponse",
					errors: [{ status: 429, code: "RATE_LIMITED" }]
				})
			});
			// Second call: success
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ web: { results: [{ title: "ok" }] } })
			});

			const req = mockReq({ body: { query: "test" } });
			const res = mockRes();

			await handler(req, res);

			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
			expect(res.json).toHaveBeenCalledWith({ web: { results: [{ title: "ok" }] } });
		});

		it("fails immediately on 429 QUOTA_LIMITED without retry", async () => {
			const handler = getHandler("POST", "/api/search");
			process.env.BRAVE_SEARCH_API_KEY = "key";

			globalThis.fetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				headers: { get: () => null },
				json: () => Promise.resolve({
					type: "ErrorResponse",
					errors: [{ status: 429, code: "QUOTA_LIMITED" }]
				})
			});

			const req = mockReq({ body: { query: "test" } });
			const res = mockRes();

			await handler(req, res);

			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("quota exhausted") });
		});

		it("retries on 5xx and succeeds on second attempt", async () => {
			const handler = getHandler("POST", "/api/search");
			process.env.BRAVE_SEARCH_API_KEY = "key";

			// First call: 503
			globalThis.fetch.mockResolvedValueOnce({
				ok: false,
				status: 503
			});
			// Second call: success
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ web: { results: [] } })
			});

			const req = mockReq({ body: { query: "test" } });
			const res = mockRes();

			await handler(req, res);

			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
			expect(res.json).toHaveBeenCalledWith({ web: { results: [] } });
		});

		it("fails after exhausting retries on persistent 5xx", async () => {
			const handler = getHandler("POST", "/api/search");
			process.env.BRAVE_SEARCH_API_KEY = "key";

			// Both calls: 500
			globalThis.fetch.mockResolvedValue({
				ok: false,
				status: 500
			});

			const req = mockReq({ body: { query: "test" } });
			const res = mockRes();

			await handler(req, res);

			expect(globalThis.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
			expect(res.status).toHaveBeenCalledWith(500);
		});
	});

	describe("GET /api/config", () => {
		it("returns providers, extension, and agent config", async () => {
			const handler = getHandler("GET", "/api/config");
			const req = mockReq();
			const res = mockRes();

			await handler(req, res);

			const response = res.json.mock.calls[0][0];
			expect(response).toHaveProperty("providers");
			expect(response).toHaveProperty("extension");
			expect(response).toHaveProperty("agent");
			expect(response.agent).toEqual({ maxSteps: 20 });
		});
	});
});
