import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
	spawn: (...args) => mockSpawn(...args)
}));

import {
	getAvailablePort,
	spawnAgent,
	killAgent,
	hasAgent,
	getAgent,
	getRunningAgents,
	getAvailablePorts,
	killAllAgents,
	forwardContinueSession
} from "../agentManager.js";

function createMockProcess() {
	const proc = new EventEmitter();
	proc.kill = vi.fn();
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	return proc;
}

describe("agentManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", vi.fn());
		// Clean up any agents from prior tests
		killAllAgents();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	describe("getAvailablePort", () => {
		it("returns the first port from the pool when none are in use", () => {
			const port = getAvailablePort();
			expect(port).toBe(5001);
		});
	});

	describe("getAvailablePorts", () => {
		it("returns all ports when none are in use", () => {
			expect(getAvailablePorts()).toEqual([5001, 5002, 5003, 5004, 5005]);
		});
	});

	describe("spawnAgent", () => {
		it("spawns a process with correct arguments and returns port on healthy response", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);

			// Health check succeeds on first attempt
			globalThis.fetch.mockResolvedValue({ ok: true });

			const spawnPromise = spawnAgent("task-1");

			// Advance past health check interval
			await vi.advanceTimersByTimeAsync(1100);

			const port = await spawnPromise;

			expect(port).toBe(5001);
			expect(mockSpawn).toHaveBeenCalledWith(
				expect.stringContaining("python"),
				expect.arrayContaining(["--port", "5001", "--callback-url", expect.stringContaining("/api/agent/webhook"), "--webhook-token", expect.any(String)]),
				expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] })
			);
			// Verify webhook token is stored on agent entry
			const agent = getAgent(5001);
			expect(agent.webhookToken).toBeDefined();
			expect(agent.webhookToken).toHaveLength(64); // 32 bytes hex
			expect(hasAgent(5001)).toBe(true);

			// Cleanup
			killAgent(5001);
		});

		it("throws when health check times out", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);

			// Health check always fails
			globalThis.fetch.mockRejectedValue(new Error("ECONNREFUSED"));

			// Catch rejection immediately to prevent unhandled rejection warning
			const spawnPromise = spawnAgent("task-2").catch(e => e);

			// Advance through all health check attempts (30 * 1000ms)
			for (let i = 0; i < 31; i++) {
				await vi.advanceTimersByTimeAsync(1100);
			}

			const error = await spawnPromise;
			expect(error).toBeInstanceOf(Error);
			expect(error.message).toContain("health check timeout");

			// Drain any remaining timers
			await vi.runAllTimersAsync();
		});

		it("throws when no ports are available", async () => {
			// Fill all ports
			const procs = [];
			for (let i = 0; i < 5; i++) {
				const proc = createMockProcess();
				mockSpawn.mockReturnValueOnce(proc);
				globalThis.fetch.mockResolvedValueOnce({ ok: true });

				const p = spawnAgent(`fill-${i}`);
				await vi.advanceTimersByTimeAsync(1100);
				await p;
				procs.push(proc);
			}

			await expect(spawnAgent("extra")).rejects.toThrow("No available ports");

			// Cleanup
			killAllAgents();
		});
	});

	describe("killAgent", () => {
		it("kills the process and removes from tracking", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);
			globalThis.fetch.mockResolvedValue({ ok: true });

			const p = spawnAgent("task-k");
			await vi.advanceTimersByTimeAsync(1100);
			await p;

			expect(killAgent(5001)).toBe(true);
			expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
			expect(hasAgent(5001)).toBe(false);
		});

		it("returns false for non-existent agent", () => {
			expect(killAgent(9999)).toBe(false);
		});
	});

	describe("getRunningAgents", () => {
		it("returns info about running agents", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);
			globalThis.fetch.mockResolvedValue({ ok: true });

			const p = spawnAgent("task-r");
			await vi.advanceTimersByTimeAsync(1100);
			await p;

			const agents = getRunningAgents();
			expect(agents).toHaveLength(1);
			expect(agents[0]).toMatchObject({
				port: 5001,
				taskId: "task-r",
				restartCount: 0
			});
			expect(agents[0]).toHaveProperty("startedAt");
			expect(agents[0]).toHaveProperty("runningMs");

			killAgent(5001);
		});
	});

	describe("forwardContinueSession", () => {
		it("sends POST to agent continue-session endpoint and returns JSON", async () => {
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ status: "running" })
			});

			const result = await forwardContinueSession(5001, "sess-1", { email: "a@b.com" }, "openai", "gpt-5.2");

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"http://localhost:5001/api/session/sess-1/continue",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" }
				})
			);
			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.additionalData).toEqual({ email: "a@b.com" });
			expect(body.provider).toBe("openai");
			expect(body.model).toBe("gpt-5.2");
			expect(result.status).toBe("running");
		});

		it("throws when agent responds with error status", async () => {
			globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

			await expect(forwardContinueSession(5001, "sess-1", {})).rejects.toThrow("Agent responded with 500");
		});

		it("defaults additionalData to empty object when null", async () => {
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ status: "running" })
			});

			await forwardContinueSession(5001, "sess-1", null, "anthropic", "claude-haiku-4-5");

			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.additionalData).toEqual({});
		});
	});

	describe("crash restart", () => {
		it("restarts agent once on unexpected exit", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);
			globalThis.fetch.mockResolvedValue({ ok: true });

			const p = spawnAgent("task-crash");
			await vi.advanceTimersByTimeAsync(1100);
			await p;

			// Spawn mock for restart
			const proc2 = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc2);

			// Simulate unexpected exit (code 1)
			proc.emit("exit", 1, null);
			await vi.advanceTimersByTimeAsync(1100);

			// Agent should still be tracked (restarted)
			expect(hasAgent(5001)).toBe(true);
			const agent = getAgent(5001);
			expect(agent.restartCount).toBe(1);

			killAgent(5001);
		});

		it("removes agent after exceeding max restarts", async () => {
			const proc = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc);
			globalThis.fetch.mockResolvedValue({ ok: true });

			const p = spawnAgent("task-noretry");
			await vi.advanceTimersByTimeAsync(1100);
			await p;

			// First restart
			const proc2 = createMockProcess();
			mockSpawn.mockReturnValueOnce(proc2);
			proc.emit("exit", 1, null);
			await vi.advanceTimersByTimeAsync(1100);

			// Second crash: should not restart (MAX_AGENT_RESTARTS = 1)
			proc2.emit("exit", 1, null);
			await vi.advanceTimersByTimeAsync(100);

			expect(hasAgent(5001)).toBe(false);
		});
	});

	describe("killAllAgents", () => {
		it("kills all agents and empties the pool", async () => {
			for (let i = 0; i < 2; i++) {
				const proc = createMockProcess();
				mockSpawn.mockReturnValueOnce(proc);
				globalThis.fetch.mockResolvedValueOnce({ ok: true });
				const p = spawnAgent(`task-all-${i}`);
				await vi.advanceTimersByTimeAsync(1100);
				await p;
			}

			expect(getRunningAgents()).toHaveLength(2);

			killAllAgents();

			expect(getRunningAgents()).toHaveLength(0);
			expect(getAvailablePorts()).toHaveLength(5);
		});
	});
});
