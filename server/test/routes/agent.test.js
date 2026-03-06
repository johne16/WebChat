import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockReq, mockRes } from "../helpers.js";

vi.mock("../../agentManager.js", () => ({
	spawnAgent: vi.fn(),
	killAgent: vi.fn(),
	hasAgent: vi.fn(),
	getRunningAgents: vi.fn().mockReturnValue([]),
	getAvailablePorts: vi.fn().mockReturnValue([5001, 5002, 5003, 5004, 5005]),
	forwardContinueSession: vi.fn()
}));

vi.mock("../../sseManager.js", () => ({
	broadcastSSE: vi.fn(),
	addSSEClient: vi.fn(),
	removeSSEClient: vi.fn(),
	getNeedsInputQueue: vi.fn().mockReturnValue([]),
	removeFromNeedsInputQueue: vi.fn(),
	addToNeedsInputQueue: vi.fn()
}));

vi.mock("../../database.js", () => ({
	getFullUserData: vi.fn().mockReturnValue({ profile: {}, siteData: {} })
}));

import { spawnAgent, killAgent, hasAgent, getRunningAgents, getAvailablePorts, forwardContinueSession } from "../../agentManager.js";
import { broadcastSSE, addSSEClient, removeSSEClient, getNeedsInputQueue, addToNeedsInputQueue, removeFromNeedsInputQueue } from "../../sseManager.js";
import { getFullUserData } from "../../database.js";

import router from "../../routes/agent.js";

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

describe("routes/agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("POST /api/agent/start", () => {
		it("returns 400 if taskId is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("POST", "/api/agent/start")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("spawns agent and returns port", async () => {
			spawnAgent.mockResolvedValueOnce(5001);
			const req = mockReq({ body: { taskId: "task-1" } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/start")(req, res);

			expect(spawnAgent).toHaveBeenCalledWith("task-1");
			expect(res.json).toHaveBeenCalledWith({ success: true, port: 5001, taskId: "task-1" });
		});

		it("returns 500 when spawn fails", async () => {
			spawnAgent.mockRejectedValueOnce(new Error("No available ports"));
			const req = mockReq({ body: { taskId: "task-1" } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/start")(req, res);

			expect(res.status).toHaveBeenCalledWith(500);
		});
	});

	describe("POST /api/agent/execute-goal", () => {
		it("returns 400 if port or goal is missing", async () => {
			const req = mockReq({ body: { port: 5001 } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/execute-goal")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("returns 400 if no agent on port", async () => {
			hasAgent.mockReturnValueOnce(false);
			const req = mockReq({ body: { port: 5001, goal: "do stuff" } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/execute-goal")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "No agent running on port 5001" });
		});

		it("merges DB profile with provided profile and proxies to agent", async () => {
			hasAgent.mockReturnValueOnce(true);
			getFullUserData.mockReturnValueOnce({
				profile: { first_name: "John" },
				siteData: { "x.com": { user: "j" } }
			});
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ status: "running" })
			});

			const req = mockReq({
				body: {
					port: 5001,
					goal: "sign up",
					startUrl: "http://x.com",
					userProfile: { email: "j@test.com" },
					provider: "openai",
					model: "gpt-5.2"
				}
			});
			const res = mockRes();

			await getHandler("POST", "/api/agent/execute-goal")(req, res);

			const fetchBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			// userProfile should merge: db profile + db siteData + provided profile
			expect(fetchBody.userProfile.first_name).toBe("John");
			expect(fetchBody.userProfile.email).toBe("j@test.com"); // provided takes precedence
			expect(fetchBody.goal).toBe("sign up");
			expect(res.json).toHaveBeenCalledWith({ status: "running" });
		});
	});

	describe("POST /api/agent/stop", () => {
		it("returns 400 if port is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("POST", "/api/agent/stop")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("kills agent and returns success", async () => {
			killAgent.mockReturnValueOnce(true);
			const req = mockReq({ body: { port: 5001 } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/stop")(req, res);

			expect(killAgent).toHaveBeenCalledWith(5001);
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});

		it("returns 404 if no agent on port", async () => {
			killAgent.mockReturnValueOnce(false);
			const req = mockReq({ body: { port: 9999 } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/stop")(req, res);

			expect(res.status).toHaveBeenCalledWith(404);
		});
	});

	describe("GET /api/agent/status", () => {
		it("returns running agents and available ports", async () => {
			getRunningAgents.mockReturnValueOnce([{ port: 5001, taskId: "t1" }]);
			getAvailablePorts.mockReturnValueOnce([5002, 5003, 5004, 5005]);
			const req = mockReq();
			const res = mockRes();

			getHandler("GET", "/api/agent/status")(req, res);

			expect(res.json).toHaveBeenCalledWith({
				agents: [{ port: 5001, taskId: "t1" }],
				availablePorts: [5002, 5003, 5004, 5005]
			});
		});
	});

	describe("GET /api/events", () => {
		it("sets SSE headers and adds client", () => {
			const req = mockReq();
			const res = mockRes();

			getHandler("GET", "/api/events")(req, res);

			expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
			expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
			expect(addSSEClient).toHaveBeenCalledWith(res);
			// Should write initial connected event
			expect(res.write).toHaveBeenCalledWith(expect.stringContaining("event: connected"));
		});

		it("registers close handler to remove client", () => {
			const req = mockReq();
			const res = mockRes();

			getHandler("GET", "/api/events")(req, res);

			expect(req.on).toHaveBeenCalledWith("close", expect.any(Function));

			// Simulate disconnect
			const closeHandler = req.on.mock.calls.find(c => c[0] === "close")[1];
			closeHandler();
			expect(removeSSEClient).toHaveBeenCalledWith(res);
		});
	});

	describe("POST /api/agent/webhook", () => {
		it("broadcasts agent-status to SSE clients", () => {
			const req = mockReq({
				body: { port: 5001, taskId: "t1", sessionId: "s1", status: "running", message: "Working" }
			});
			const res = mockRes();

			getHandler("POST", "/api/agent/webhook")(req, res);

			expect(broadcastSSE).toHaveBeenCalledWith("agent-status", expect.objectContaining({
				port: 5001,
				status: "running"
			}));
			expect(res.json).toHaveBeenCalledWith({ received: true });
		});

		it("adds to needs-input queue on needs_input status", () => {
			const req = mockReq({
				body: {
					port: 5001, taskId: "t1", sessionId: "s1",
					status: "needs_input", missingFields: ["email"], message: "Need email"
				}
			});
			const res = mockRes();

			getHandler("POST", "/api/agent/webhook")(req, res);

			expect(addToNeedsInputQueue).toHaveBeenCalledWith(expect.objectContaining({
				port: 5001,
				missingFields: ["email"]
			}));
			// Should also broadcast needs-input event
			expect(broadcastSSE).toHaveBeenCalledWith("needs-input", expect.objectContaining({ port: 5001 }));
		});

		it("removes from queue on achieved status", () => {
			const req = mockReq({
				body: { port: 5001, taskId: "t1", status: "achieved" }
			});
			const res = mockRes();

			getHandler("POST", "/api/agent/webhook")(req, res);

			expect(removeFromNeedsInputQueue).toHaveBeenCalledWith(expect.any(Function));
		});

		it("removes from queue on failed status", () => {
			const req = mockReq({
				body: { port: 5001, taskId: "t1", status: "failed" }
			});
			const res = mockRes();

			getHandler("POST", "/api/agent/webhook")(req, res);

			expect(removeFromNeedsInputQueue).toHaveBeenCalledWith(expect.any(Function));
		});
	});

	describe("GET /api/agent/health/:port", () => {
		it("returns healthy true when agent responds ok", async () => {
			hasAgent.mockReturnValueOnce(true);
			globalThis.fetch.mockResolvedValueOnce({ ok: true });
			const req = mockReq({ params: { port: "5001" } });
			const res = mockRes();

			await getHandler("GET", "/api/agent/health/:port")(req, res);

			expect(globalThis.fetch).toHaveBeenCalledWith("http://localhost:5001/health");
			expect(res.json).toHaveBeenCalledWith({ healthy: true, managed: true });
		});

		it("returns healthy false when agent responds not ok", async () => {
			hasAgent.mockReturnValueOnce(false);
			globalThis.fetch.mockResolvedValueOnce({ ok: false });
			const req = mockReq({ params: { port: "5002" } });
			const res = mockRes();

			await getHandler("GET", "/api/agent/health/:port")(req, res);

			expect(res.json).toHaveBeenCalledWith({ healthy: false, managed: false });
		});

		it("returns healthy false when fetch throws", async () => {
			hasAgent.mockReturnValueOnce(false);
			globalThis.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
			const req = mockReq({ params: { port: "5003" } });
			const res = mockRes();

			await getHandler("GET", "/api/agent/health/:port")(req, res);

			expect(res.json).toHaveBeenCalledWith({ healthy: false, managed: false });
		});
	});

	describe("GET /api/agent/needs-input", () => {
		it("returns the current needs-input queue", () => {
			const queueItems = [{ port: 5001, missingFields: ["email"], sessionId: "s1" }];
			getNeedsInputQueue.mockReturnValueOnce(queueItems);
			const req = mockReq();
			const res = mockRes();

			getHandler("GET", "/api/agent/needs-input")(req, res);

			expect(res.json).toHaveBeenCalledWith({ queue: queueItems });
		});

		it("returns empty queue when no pending inputs", () => {
			getNeedsInputQueue.mockReturnValueOnce([]);
			const req = mockReq();
			const res = mockRes();

			getHandler("GET", "/api/agent/needs-input")(req, res);

			expect(res.json).toHaveBeenCalledWith({ queue: [] });
		});
	});

	describe("POST /api/agent/provide-input", () => {
		it("returns 400 if port or sessionId is missing", async () => {
			const req = mockReq({ body: { port: 5001 } });
			const res = mockRes();

			await getHandler("POST", "/api/agent/provide-input")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("forwards input to agent and broadcasts input-provided", async () => {
			forwardContinueSession.mockResolvedValueOnce({ status: "running" });
			const req = mockReq({
				body: { port: 5001, sessionId: "s1", inputData: { email: "a@b.com" }, provider: "openai", model: "gpt-5.2" }
			});
			const res = mockRes();

			await getHandler("POST", "/api/agent/provide-input")(req, res);

			expect(forwardContinueSession).toHaveBeenCalledWith(5001, "s1", { email: "a@b.com" }, "openai", "gpt-5.2");
			expect(broadcastSSE).toHaveBeenCalledWith("input-provided", expect.objectContaining({ port: 5001 }));
			expect(res.json).toHaveBeenCalledWith({ status: "running" });
		});

		it("does not broadcast input-provided if agent still needs_input", async () => {
			forwardContinueSession.mockResolvedValueOnce({ status: "needs_input" });
			const req = mockReq({
				body: { port: 5001, sessionId: "s1", inputData: {} }
			});
			const res = mockRes();

			await getHandler("POST", "/api/agent/provide-input")(req, res);

			expect(broadcastSSE).not.toHaveBeenCalledWith("input-provided", expect.anything());
		});
	});
});
