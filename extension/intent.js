// extension/intent.js
// Intent detection: heuristic bypass + LLM classification

import { callLLMForContent } from './llmClient.js';
import { parseJsonFromLLM } from './utils.js';
import { getConfig } from './config.js';

// Intent detection uses a small, cheap model regardless of user's model selection.
// Read from config at call time (not module init) so loadConfig() has completed.
function getIntentModel() { return getConfig()?.providers?.intentModel; }
function getIntentProvider() { return getConfig()?.providers?.intentProvider; }

// Action verbs that indicate agent tasks (single source of truth)
const ACTION_VERB_PATTERN = /(sign up|signup|sign me up|register|fill out|fill in|apply|book|order|buy|purchase|create account|log in|login|submit|enroll|subscribe|checkout|check out)/;

/**
 * Intent types
 */
export const INTENT = {
	SIMPLE: 'simple',      // Question about current page
	RESEARCH: 'research',  // Needs web search
	AGENT: 'agent'         // Needs web automation
};

/**
 * Check if message is obviously NOT an agent task
 * Returns true to bypass LLM intent detection
 * @param {string} text - User message
 * @returns {boolean}
 */
function isObviouslyNotAgentTask(text) {
	const lower = text.toLowerCase().trim();

	// If it has action verbs, it's potentially an agent task - don't bypass
	if (ACTION_VERB_PATTERN.test(lower)) {
		return false;
	}

	// "Can you" / "Could you" + action is a polite request, not a question
	// But we already checked for action verbs above, so if we're here it's likely a real question

	// Starts with question word (only if no action verbs)
	if (/^(what|why|how|where|who|when|is|are|does|do|can|could|would|should|tell me|explain|summarize)/.test(lower)) {
		return true;
	}

	// References current page
	if (/this (page|article|site|post|website)/.test(lower)) {
		return true;
	}

	// Ends with ? (already confirmed no action verbs above)
	if (lower.endsWith('?')) {
		return true;
	}

	return false;
}

/**
 * Check if message has explicit URL (with protocol) or bare domain
 * Bare domains are validated against the IANA TLD list from config.
 * @param {string} text - User message
 * @returns {string|null} URL if found (with https:// prepended for bare domains), null otherwise
 */
function extractUrl(text) {
	// Explicit protocol match first
	const protoMatch = text.match(/https?:\/\/[^\s]+/);
	if (protoMatch) return protoMatch[0];

	// Bare domain fallback: word chars/hyphens + dot + TLD, optional path
	const bareMatch = text.match(/(?:^|\s)([\w-]+(?:\.[\w-]+)*\.([\w]+)(?:\/[^\s]*)?)(?:\s|$)/);
	if (!bareMatch) return null;

	const candidate = bareMatch[1];
	const tld = bareMatch[2].toLowerCase();
	const tlds = getConfig()?.tlds;
	if (!tlds || tlds.length === 0) return null;

	// Validate TLD against IANA list (stored lowercase)
	if (!tlds.includes(tld)) return null;

	return `https://${candidate}`;
}

/**
 * Detect intent using LLM
 * @param {string} text - User message
 * @param {string} currentUrl - Current page URL for context
 * @returns {Promise<{intent: string, url?: string, confidence: string, reasoning: string}>}
 */
async function detectIntentWithLLM(text, currentUrl) {
	const systemPrompt = `You are an intent classifier for a web assistant. Classify user messages into one of three intents:

1. "simple" - Questions that can be fully answered using only the content visible on the current page. Summarization, explanation, or questions where the current page has the answer.

2. "research" - Questions that cannot be fully answered from the current page alone. This includes questions requiring web search, navigating to other pages, following links, or aggregating information from multiple pages -- even within the same website.

3. "agent" - Requests to perform actions on websites: sign up, register, fill forms, create accounts, make purchases, log in, submit applications, etc. These require browser automation.

If the intent is "agent", also provide the target URL if one is explicitly in the message. If no URL is provided, set url to null. Never infer or guess URLs.

Respond in JSON format:
{
  "intent": "simple" | "research" | "agent",
  "url": "https://..." (only for agent intent, null otherwise),
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation"
}`;

	const userPrompt = `Current page: ${currentUrl || 'unknown'}

User message: "${text}"

Classify this intent.`;

	try {
		const content = await callLLMForContent(getIntentModel(), [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		], { provider: getIntentProvider() });

		const result = parseJsonFromLLM(content);
		return {
			intent: result.intent || INTENT.SIMPLE,
			url: result.url || null,
			confidence: result.confidence || 'medium',
			reasoning: result.reasoning || ''
		};

	} catch (error) {
		console.error('[Intent] LLM detection failed:', error);
		// Default to simple on error
		return {
			intent: INTENT.SIMPLE,
			url: null,
			confidence: 'low',
			reasoning: 'Defaulting to simple due to detection error'
		};
	}
}

/**
 * Main intent detection function
 * Uses heuristic bypass for obvious cases, LLM for ambiguous ones
 * @param {string} text - User message
 * @param {string} currentUrl - Current page URL
 * @returns {Promise<{intent: string, url?: string, confidence: string, reasoning: string}>}
 */
export async function detectIntent(text, currentUrl) {
	// Check for explicit URL first
	const explicitUrl = extractUrl(text);

	// Heuristic bypass: obvious non-agent tasks go to LLM for simple vs research
	if (isObviouslyNotAgentTask(text)) {
		return await detectIntentWithLLM(text, currentUrl);
	}

	// Has explicit URL + action words = likely agent task
	if (explicitUrl && ACTION_VERB_PATTERN.test(text.toLowerCase())) {
		return {
			intent: INTENT.AGENT,
			url: explicitUrl,
			confidence: 'high',
			reasoning: 'Heuristic: explicit URL with action verb'
		};
	}

	// Ambiguous case: use LLM
	return await detectIntentWithLLM(text, currentUrl);
}
