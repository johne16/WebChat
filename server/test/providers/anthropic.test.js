import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
	class APIError extends Error {}
	class MockAnthropic {
		constructor() {
			this.messages = {
				create: mockCreate
			};
		}
	}
	MockAnthropic.APIError = APIError;
	return { default: MockAnthropic };
});

import { chat } from "../../providers/anthropic.js";

describe("providers/anthropic", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns content and normalized usage from a successful response", async () => {
		mockCreate.mockResolvedValueOnce({
			content: [{ text: "Hello from Claude" }],
			usage: { input_tokens: 20, output_tokens: 10 }
		});

		const result = await chat("claude-sonnet-4-6", [{ role: "user", content: "hi" }]);

		expect(result.content).toBe("Hello from Claude");
		expect(result.usage).toEqual({
			prompt_tokens: 20,
			completion_tokens: 10,
			total_tokens: 30
		});
	});

	it("separates system messages into the system parameter", async () => {
		mockCreate.mockResolvedValueOnce({ content: [{ text: "" }] });

		await chat("claude-sonnet-4-6", [
			{ role: "system", content: "You are helpful" },
			{ role: "system", content: "Be concise" },
			{ role: "user", content: "hi" }
		]);

		const params = mockCreate.mock.calls[0][0];
		expect(params.system).toBe("You are helpful\nBe concise");
		expect(params.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("does not include system param when there are no system messages", async () => {
		mockCreate.mockResolvedValueOnce({ content: [{ text: "" }] });

		await chat("claude-sonnet-4-6", [{ role: "user", content: "hi" }]);

		const params = mockCreate.mock.calls[0][0];
		expect(params).not.toHaveProperty("system");
	});

	it("returns empty string when content array is missing", async () => {
		mockCreate.mockResolvedValueOnce({});

		const result = await chat("claude-sonnet-4-6", []);
		expect(result.content).toBe("");
		expect(result.usage).toBeNull();
	});

	it("throws when the API returns an error", async () => {
		mockCreate.mockRejectedValueOnce(new Error("auth failed"));

		await expect(chat("claude-sonnet-4-6", [])).rejects.toThrow("auth failed");
	});

	it("passes max_tokens from appConfig", async () => {
		mockCreate.mockResolvedValueOnce({ content: [{ text: "ok" }] });

		await chat("claude-sonnet-4-6", [{ role: "user", content: "test" }]);

		const params = mockCreate.mock.calls[0][0];
		expect(params.max_tokens).toBe(4096);
	});
});
