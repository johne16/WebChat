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
	killAllAgents
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

			const spawnPromise = spawnAgent("task-2");

			// Advance through all health check attempts (30 * 1000ms)
			for (let i = 0; i < 31; i++) {
				await vi.advanceTimersByTimeAsync(1100);
			}

			await expect(spawnPromise).rejects.toThrow("health check timeout");
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
