// providers/anthropic.js - Anthropic provider adapter
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Send a chat completion request to Anthropic
 * System messages are extracted and passed as the separate `system` parameter.
 * @param {string} model - Model name (e.g. "claude-sonnet-4-6")
 * @param {Array} messages - Messages array (may contain system-role messages)
 * @returns {Promise<{content: string}>} Normalized response
 */
export async function chat(model, messages) {
	// Separate system messages from the rest
	const systemParts = [];
	const nonSystemMessages = [];

	for (const msg of messages) {
		if (msg.role === "system") {
			systemParts.push(msg.content);
		} else {
			nonSystemMessages.push({ role: msg.role, content: msg.content });
		}
	}

	const params = {
		model,
		messages: nonSystemMessages,
		max_tokens: 4096
	};

	// Only include system param if there are system messages
	if (systemParts.length > 0) {
		params.system = systemParts.join("\n");
	}

	const response = await anthropic.messages.create(params);
	const content = response?.content?.[0]?.text || "";
	return { content };
}
