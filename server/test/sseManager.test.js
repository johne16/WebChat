import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	addSSEClient,
	removeSSEClient,
	getSSEClientCount,
	broadcastSSE,
	closeAllSSEClients,
	addToNeedsInputQueue,
	getNeedsInputQueue,
	removeFromNeedsInputQueue
} from "../sseManager.js";

function makeFakeClient() {
	return { write: vi.fn(), end: vi.fn() };
}

describe("sseManager", () => {
	beforeEach(() => {
		// Clean up all clients between tests
		closeAllSSEClients();
		// Drain the needs-input queue
		while (getNeedsInputQueue().length > 0) {
			removeFromNeedsInputQueue(() => true);
		}
	});

	describe("SSE clients", () => {
		it("tracks added clients and reports count", () => {
			const c1 = makeFakeClient();
			const c2 = makeFakeClient();
			addSSEClient(c1);
			addSSEClient(c2);
			expect(getSSEClientCount()).toBe(2);
		});

		it("removes a specific client", () => {
			const c1 = makeFakeClient();
			const c2 = makeFakeClient();
			addSSEClient(c1);
			addSSEClient(c2);
			removeSSEClient(c1);
			expect(getSSEClientCount()).toBe(1);
		});

		it("broadcastSSE writes formatted SSE message to all clients", () => {
			const c1 = makeFakeClient();
			const c2 = makeFakeClient();
			addSSEClient(c1);
			addSSEClient(c2);

			broadcastSSE("test-event", { foo: "bar" });

			const expected = `event: test-event\ndata: ${JSON.stringify({ foo: "bar" })}\n\n`;
			expect(c1.write).toHaveBeenCalledWith(expected);
			expect(c2.write).toHaveBeenCalledWith(expected);
		});

		it("broadcastSSE removes clients that throw on write", () => {
			const good = makeFakeClient();
			const bad = makeFakeClient();
			bad.write.mockImplementation(() => { throw new Error("broken pipe"); });

			addSSEClient(good);
			addSSEClient(bad);

			broadcastSSE("evt", {});

			// bad client should have been removed
			expect(getSSEClientCount()).toBe(1);
			expect(good.write).toHaveBeenCalled();
		});

		it("closeAllSSEClients calls end on each client and clears the set", () => {
			const c1 = makeFakeClient();
			const c2 = makeFakeClient();
			addSSEClient(c1);
			addSSEClient(c2);

			closeAllSSEClients();

			expect(c1.end).toHaveBeenCalled();
			expect(c2.end).toHaveBeenCalled();
			expect(getSSEClientCount()).toBe(0);
		});
	});

	describe("needs-input queue", () => {
		it("adds and retrieves items from the queue", () => {
			const item = { port: 5001, sessionId: "s1", missingFields: ["email"] };
			addToNeedsInputQueue(item);

			const queue = getNeedsInputQueue();
			expect(queue).toHaveLength(1);
			expect(queue[0]).toBe(item);
		});

		it("removeFromNeedsInputQueue removes matching item and returns true", () => {
			addToNeedsInputQueue({ port: 5001, sessionId: "s1" });
			addToNeedsInputQueue({ port: 5002, sessionId: "s2" });

			const removed = removeFromNeedsInputQueue(item => item.port === 5001);
			expect(removed).toBe(true);
			expect(getNeedsInputQueue()).toHaveLength(1);
			expect(getNeedsInputQueue()[0].port).toBe(5002);
		});

		it("removeFromNeedsInputQueue returns false when nothing matches", () => {
			addToNeedsInputQueue({ port: 5001 });
			const removed = removeFromNeedsInputQueue(item => item.port === 9999);
			expect(removed).toBe(false);
			expect(getNeedsInputQueue()).toHaveLength(1);
		});
	});
});
