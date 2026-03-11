import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("openai", () => {
	class APIError extends Error {}
	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: mockCreate
				}
			};
		}
	}
	MockOpenAI.APIError = APIError;
	return { default: MockOpenAI };
});

import { chat } from "../../providers/openai.js";

describe("providers/openai", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns content and usage from a successful response", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: "Hello world" } }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
		});

		const result = await chat("gpt-5.2", [{ role: "user", content: "hi" }]);

		expect(result.content).toBe("Hello world");
		expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
	});

	it("passes model, messages, and max_completion_tokens to the API", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

		const msgs = [{ role: "system", content: "sys" }, { role: "user", content: "q" }];
		await chat("gpt-5-mini", msgs);

		expect(mockCreate).toHaveBeenCalledWith({
			model: "gpt-5-mini",
			messages: msgs,
			max_completion_tokens: 4096
		});
	});

	it("returns empty string when choices are missing", async () => {
		mockCreate.mockResolvedValueOnce({});

		const result = await chat("gpt-5.2", []);
		expect(result.content).toBe("");
		expect(result.usage).toBeNull();
	});

	it("throws when the API returns an error", async () => {
		mockCreate.mockRejectedValueOnce(new Error("rate limit exceeded"));

		await expect(chat("gpt-5.2", [])).rejects.toThrow("rate limit exceeded");
	});
});
