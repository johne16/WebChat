// extension/utils.js
// Shared utility functions

import { SERVER_BASE, getConfig } from './config.js';

/**
 * Crawl a page via Crawl4AI and return raw markdown
 * @param {string} url - URL to crawl
 * @returns {Promise<string>} Raw markdown content
 */
export async function crawlPage(url) {
	const response = await fetch(`${SERVER_BASE}/api/crawl`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			urls: [url],
			crawler_config: {
				exclude_external_links: getConfig()?.extension?.crawl4ai?.excludeExternalLinks ?? true,
				remove_overlay_elements: getConfig()?.extension?.crawl4ai?.removeOverlayElements ?? true,
				word_count_threshold: getConfig()?.extension?.crawl4ai?.wordCountThreshold ?? 10
			}
		})
	});

	if (!response.ok) {
		throw new Error(`Crawl error ${response.status}`);
	}

	const data = await response.json();
	return data.results?.[0]?.markdown?.raw_markdown || '';
}

/**
 * Extract hostname from URL, returning the input on failure
 * @param {string} url - Full URL
 * @returns {string} Hostname or original input
 */
export function extractDomain(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/**
 * Strip markdown code block wrappers from LLM JSON responses and parse
 * @param {string} text - Raw LLM response text
 * @returns {Object} Parsed JSON object
 */
export function parseJsonFromLLM(text) {
	let jsonStr = text;
	const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		jsonStr = codeBlockMatch[1];
	}
	return JSON.parse(jsonStr.trim());
}
