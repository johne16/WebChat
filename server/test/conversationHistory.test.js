import { describe, it, expect, beforeEach } from "vitest";
import { addMessage, getHistory, clearHistory } from "../conversationHistory.js";

describe("conversationHistory", () => {
	// Use a unique userId per test to avoid cross-test pollution
	let uid;
	let counter = 0;
	beforeEach(() => {
		uid = ++counter;
	});

	it("returns empty array for unknown user", () => {
		expect(getHistory(uid)).toEqual([]);
	});

	it("stores and retrieves messages in order", () => {
		addMessage(uid, "user", "hello");
		addMessage(uid, "assistant", "hi there");
		expect(getHistory(uid)).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" }
		]);
	});

	it("clearHistory removes all messages for a user", () => {
		addMessage(uid, "user", "hello");
		clearHistory(uid);
		expect(getHistory(uid)).toEqual([]);
	});

	it("trims oldest messages when token limit is exceeded", () => {
		// Token limit is 4000, ~4 chars per token = ~16000 chars
		// Add a message that is close to the limit, then another that pushes over
		const bigContent = "x".repeat(15000); // ~3750 tokens
		addMessage(uid, "user", bigContent);
		addMessage(uid, "assistant", "y".repeat(2000)); // ~500 tokens, total ~4250 > 4000

		const history = getHistory(uid);
		// The first big message should have been trimmed
		expect(history.length).toBe(1);
		expect(history[0].role).toBe("assistant");
	});

	it("isolates history between different users", () => {
		const uid2 = uid + 100;
		addMessage(uid, "user", "msg for user A");
		addMessage(uid2, "user", "msg for user B");

		expect(getHistory(uid)).toEqual([{ role: "user", content: "msg for user A" }]);
		expect(getHistory(uid2)).toEqual([{ role: "user", content: "msg for user B" }]);
	});

	it("keeps messages that fit within the token limit", () => {
		addMessage(uid, "user", "short");
		addMessage(uid, "assistant", "also short");
		expect(getHistory(uid)).toHaveLength(2);
	});
});
