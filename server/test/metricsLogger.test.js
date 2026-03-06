import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
	appendFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined)
}));

import { logMetric } from "../metricsLogger.js";
import { appendFile, mkdir } from "fs/promises";

describe("metricsLogger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates the logs directory and appends a JSONL line", async () => {
		const record = { type: "test", value: 42 };
		logMetric(record);

		// logMetric is fire-and-forget; wait for the microtask chain
		await vi.waitFor(() => {
			expect(appendFile).toHaveBeenCalled();
		});

		expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("logs"), { recursive: true });

		const writtenLine = appendFile.mock.calls[0][1];
		expect(writtenLine).toBe(JSON.stringify(record) + "\n");

		// File path should include the date and be JSONL
		const filePath = appendFile.mock.calls[0][0];
		expect(filePath).toMatch(/chat-\d{4}-\d{2}-\d{2}\.jsonl$/);
	});

	it("swallows write errors without throwing", async () => {
		appendFile.mockRejectedValueOnce(new Error("disk full"));

		// Should not throw
		expect(() => logMetric({ bad: true })).not.toThrow();

		// Let the promise chain settle
		await vi.waitFor(() => {
			expect(appendFile).toHaveBeenCalled();
		});
	});
});
