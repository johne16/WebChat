// extension/searchClient.js

import { SERVER_BASE, getConfig } from './config.js';
import { extractDomain } from './utils.js';

// Rate limiting: Track last search time
let lastSearchTime = 0;
// Read at call time (not module init) so loadConfig() has completed.
function getSearchConfig() {
	const s = getConfig()?.extension?.search || {};
	return { rateLimitMs: s.rateLimitMs || 1000, defaultCount: s.defaultCount || 5 };
}

/**
 * Search the web using Brave Search API (via server proxy)
 * Enforces rate limit of 1 request per second
 * @param {string} query - Search query string
 * @param {number} count - Number of results to return (default 5)
 * @param {string} currentURL - Optional URL of current tab to restrict search to that domain
 * @returns {Promise<Array>} - Array of search results with title, url, description
 */
export async function searchBrave(query, count = null, currentURL = null) {
	const sc = getSearchConfig();
	if (count === null) count = sc.defaultCount;
	// If currentURL provided, prepend site: restriction to query
	let finalQuery = query;
	if (currentURL) {
		const domain = extractDomain(currentURL);
		if (domain) {
			finalQuery = `site:${domain} ${query}`;
			console.log(`[SearchClient] Restricting search to domain: ${domain}`);
		}
	}

	console.log(`[SearchClient] Searching for: "${finalQuery}"`);

	// Rate limiting: Wait if we searched too recently
	const now = Date.now();
	const timeSinceLastSearch = now - lastSearchTime;
	if (timeSinceLastSearch < sc.rateLimitMs) {
		const waitTime = sc.rateLimitMs - timeSinceLastSearch;
		console.log(`[SearchClient] Rate limiting: waiting ${waitTime}ms`);
		await new Promise(resolve => setTimeout(resolve, waitTime));
	}

	try {
		const response = await fetch(`${SERVER_BASE}/api/search`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: finalQuery,
				count: count
			})
		});

		lastSearchTime = Date.now(); // Update last search time

		if (!response.ok) {
			throw new Error(`Search API returned status ${response.status}`);
		}

		const data = await response.json();

		// Extract and format the web results
		const results = formatSearchResults(data);

		console.log(`[SearchClient] Found ${results.length} results`);
		return results;

	} catch (error) {
		console.error('[SearchClient] Search failed:', error);
		throw new Error(`Search failed: ${error.message}`);
	}
}

// Format Brave Search API response into clean structure
function formatSearchResults(data) {
	// Brave Search API returns results in data.web.results
	const webResults = data?.web?.results || [];

	return webResults.map((result, index) => ({
		position: index + 1,
		title: result.title || 'No title',
		url: result.url || '',
		description: result.description || '',
		// Optional: include extra metadata if useful
		age: result.age || null,
		language: result.language || null
	}));
}
