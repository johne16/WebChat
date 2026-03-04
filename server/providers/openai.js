// providers/openai.js - OpenAI provider adapter
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Send a chat completion request to OpenAI
 * @param {string} model - Model name (e.g. "gpt-5.2")
 * @param {Array} messages - Messages array (system messages stay in-place)
 * @returns {Promise<{content: string}>} Normalized response
 */
export async function chat(model, messages) {
	const response = await openai.chat.completions.create({ model, messages });
	const content = response?.choices?.[0]?.message?.content || "";
	const usage = response?.usage || null;
	return { content, usage };
}
