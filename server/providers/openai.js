// providers/openai.js - OpenAI provider adapter
import OpenAI from "openai";
import { appConfig } from "../config.js";

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
	maxRetries: appConfig.server.openai.maxRetries
});

/**
 * Send a chat completion request to OpenAI
 * @param {string} model - Model name (e.g. "gpt-5.2")
 * @param {Array} messages - Messages array (system messages stay in-place)
 * @returns {Promise<{content: string}>} Normalized response
 */
export async function chat(model, messages) {
	try {
		const response = await openai.chat.completions.create({
			model,
			messages,
			max_completion_tokens: appConfig.server.openai.maxCompletionTokens
		});
		const content = response?.choices?.[0]?.message?.content || "";
		const usage = response?.usage || null;
		return { content, usage };
	} catch (err) {
		if (err instanceof OpenAI.APIError) {
			const wrapped = new Error(err.message);
			wrapped.status = err.status || 500;
			wrapped.retryAfter = err.headers?.get?.('retry-after') || null;
			throw wrapped;
		}
		throw err;
	}
}
