// server/conversationHistory.js - In-memory conversation history for LLM context

const TOKEN_LIMIT = 4000;

/** @type {Map<number, Array<{role: string, content: string}>>} */
const history = new Map();

/**
 * Estimate token count for a message using ~4 chars per token
 * @param {string} content - Message content
 * @returns {number} Estimated token count
 */
function estimateTokens(content) {
	return Math.ceil(content.length / 4);
}

/**
 * Trim history from the front until total tokens is under the limit
 * @param {Array<{role: string, content: string}>} messages
 */
function trimToLimit(messages) {
	let total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
	while (total > TOKEN_LIMIT && messages.length > 0) {
		const removed = messages.shift();
		total -= estimateTokens(removed.content);
	}
}

/**
 * Append a message to the user's history and trim to token limit
 * @param {number} userId
 * @param {string} role - "user" or "assistant"
 * @param {string} content - Message content
 */
export function addMessage(userId, role, content) {
	if (!history.has(userId)) {
		history.set(userId, []);
	}
	const messages = history.get(userId);
	messages.push({ role, content });
	trimToLimit(messages);
}

/**
 * Get the user's conversation history
 * @param {number} userId
 * @returns {Array<{role: string, content: string}>}
 */
export function getHistory(userId) {
	return history.get(userId) || [];
}

/**
 * Clear the user's conversation history
 * @param {number} userId
 */
export function clearHistory(userId) {
	history.delete(userId);
}
