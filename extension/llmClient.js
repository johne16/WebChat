// extension/llmClient.js

import { SERVER_BASE, getConfig } from './config.js';
import { crawlPage, parseJsonFromLLM } from './utils.js';

// Cache modelType and provider at module level (item 4)
// Defaults come from config pipeline via getConfig()
let cachedModel = null;
let cachedProvider = null;

// Initialize from storage
chrome.storage.local.get(['modelType', 'provider']).then(({ modelType, provider }) => {
	cachedModel = modelType || getConfig()?.providers?.defaultModel;
	cachedProvider = provider || getConfig()?.providers?.default;
});

// Keep in sync with storage changes
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local') {
		if ('modelType' in changes) {
			cachedModel = changes.modelType.newValue || getConfig()?.providers?.defaultModel;
		}
		if ('provider' in changes) {
			cachedProvider = changes.provider.newValue || getConfig()?.providers?.default;
		}
	}
});

/**
 * Internal helper: call the LLM via server proxy and return parsed response
 * @param {string} model - Model name
 * @param {Array} messages - Chat messages array
 * @param {string} errorLabel - Label for error messages
 * @param {Object} [options] - Optional parameters
 * @param {number} [options.userId=1] - User ID for conversation history
 * @param {boolean} [options.storeInHistory=false] - Whether to store this exchange in history
 * @param {string} [options.provider] - LLM provider ('openai' or 'anthropic')
 * @returns {Promise<Object>} Parsed response data
 */
async function callLLM(model, messages, errorLabel = 'LLM', { userId = 1, storeInHistory = false, provider, flow } = {}) {
	const res = await fetch(`${SERVER_BASE}/api/llm/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages, userId, storeInHistory, provider: provider || cachedProvider, flow })
	});

	if (!res.ok) throw new Error(`${errorLabel} error ${res.status}`);

	const data = await res.json();
	return data;
}

// Helper: Build context prompt for LLM from accumulated observations
function buildContextPrompt(context) {
	let prompt = `User's question: ${context.query}\n`;
	prompt += `Current page URL: ${context.currentURL}\n\n`;

	if (context.observations.length === 0) {
		prompt += `No observations yet. This is your first action.\n`;
	} else {
		prompt += `Previous observations:\n\n`;
		context.observations.forEach((obs, index) => {
			prompt += `Observation ${index + 1}:\n`;
			prompt += `Type: ${obs.type}\n`;

			if (obs.type === 'search_results') {
				prompt += `Search query: "${obs.query}"\n`;
				prompt += `Found ${obs.count} results:\n`;
				obs.results.forEach((result, i) => {
					prompt += `  ${i + 1}. ${result.title}\n`;
					prompt += `     URL: ${result.url}\n`;
					prompt += `     ${result.description}\n\n`;
				});
			} else if (obs.type === 'crawled_content') {
				prompt += `Source: ${obs.source}\n`;
				if (obs.warning) {
					prompt += `Warning: ${obs.warning}\n`;
				}
				prompt += `Content:\n${obs.content}\n`;
			} else if (obs.type === 'duplicate_fetch') {
				prompt += `${obs.content}\n`;
			} else if (obs.type === 'error') {
				prompt += `Error: ${obs.content}\n`;
			}

			prompt += `\n---\n\n`;
		});
	}

	prompt += `What should you do next?`;
	return prompt;
}

export async function sendToBot(userText, currentURL) {
	console.log('[llmClient] sendToBot called with:', { userText, currentURL });

	const model = cachedModel;
	console.log('[llmClient] Using model:', model);

	// Scrape current page via shared crawlPage
	console.log('[llmClient] Starting crawl request...');
	const pageContent = await crawlPage(currentURL);
	console.log('[llmClient] Crawl successful, content length:', pageContent.length);

	// Send to LLM with page content
	console.log('[llmClient] Sending to LLM API...');
	const data = await callLLM(model, [
		{
			role: 'system',
			content: 'Answer the user\'s question based on the provided webpage content.'
		},
		{
			role: 'user',
			content: `Page URL: ${currentURL}\n\nPage content:\n${pageContent}\n\nUser question: ${userText}`
		}
	], 'LLM', { storeInHistory: true, flow: 'simple' });

	const text = data?.content || '';
	console.log('[llmClient] LLM response received, text length:', text.length);
	return { text };
}

/**
 * Ask LLM to think and decide next action in ReAct loop
 * @param {Object} context - Current context with query, observations, etc.
 * @returns {Promise<Object>} - Decision object with thought, action, action_input
 */
export async function askLLMToThink(context) {
	const model = cachedModel;

	// Build the thinking prompt
	const systemPrompt = `You are a research assistant using ReAct. IMPORTANT: Keep all responses concise and focused.

**Output constraints (CRITICAL):**
- "thought" field: 1-2 sentences maximum
- "action_input" for answers: 3-4 sentences maximum
- Be direct, no unnecessary words

**Available actions:**
1. "search" - Search the web using Brave Search. Provide a search query as action_input.
2. "fetch_current_page" - Extract content from the current webpage the user is viewing. No action_input needed.
3. "fetch_url" - Fetch content from a specific URL. Provide the URL as action_input.
4. "answer" - Provide the final answer to the user. Provide your answer as action_input.

**Instructions:**
- Think step by step about what you know and what you need to find out
- Choose the most appropriate action
- If you have enough information, choose "answer"
- If you cannot find the answer after multiple attempts, choose "answer" and explain what you could not find

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "thought": "your reasoning about what to do next",
  "action": "search|fetch_current_page|fetch_url|answer",
  "action_input": "search query, URL, or your final answer"
}`;

	const userPrompt = buildContextPrompt(context);

	const data = await callLLM(model, [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt }
	], 'LLM Think', { flow: 'research' });

	const responseText = data?.content || '';

	// Parse the JSON response using shared utility
	try {
		const decision = parseJsonFromLLM(responseText);

		// Validate decision structure
		if (!decision.thought || !decision.action) {
			throw new Error('Invalid decision structure');
		}

		return decision;
	} catch (error) {
		console.error('[LLM Think] Failed to parse decision:', responseText);
		// Fallback: try to answer with what we have
		return {
			thought: 'Failed to parse decision, attempting to answer',
			action: 'answer',
			action_input: 'I encountered an error processing your request. Please try rephrasing your question.'
		};
	}
}

/**
 * Ask LLM to formulate final answer based on all observations
 * Used when iteration limit is hit
 * @param {Object} context - Full context with all observations
 * @returns {Promise<string>} - Final answer
 */
export async function askLLMToAnswer(context) {
	const model = cachedModel;

	const systemPrompt = `Based on the search results and web pages examined, provide the best possible answer to the user's question.

If you found sufficient information, provide a complete answer.
If you could not find enough information, clearly state what you searched for and what you could not find.
Be honest about limitations.`;

	const userPrompt = buildContextPrompt(context);

	const data = await callLLM(model, [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt }
	], 'LLM Answer', { flow: 'research' });

	return data?.content || 'I was unable to generate an answer.';
}

/**
 * Call the LLM for intent detection or other one-off requests
 * @param {string} model - Model name
 * @param {Array} messages - Chat messages array
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.provider] - Force a specific provider (e.g. 'openai' for intent detection)
 * @returns {Promise<string>} Raw response content text
 */
export async function callLLMForContent(model, messages, { provider } = {}) {
	const data = await callLLM(model, messages, 'LLM', { provider, flow: 'intent' });
	return data?.content || '';
}
