// extension/searchClient.js

// Rate limiting: Track last search time to enforce 1 request/second
let lastSearchTime = 0;
const MIN_SEARCH_INTERVAL = 1000; // 1 second in milliseconds

/**
 * Search the web using Brave Search API (via server proxy)
 * Enforces rate limit of 1 request per second
 * @param {string} query - Search query string
 * @param {number} count - Number of results to return (default 5)
 * @param {string} currentURL - Optional URL of current tab to restrict search to that domain
 * @returns {Promise<Array>} - Array of search results with title, url, description
 */
export async function searchBrave(query, count = 5, currentURL = null) {
    // If currentURL provided, prepend site: restriction to query
    let finalQuery = query;
    if (currentURL) {
        const domain = extractRootDomain(currentURL);
        if (domain) {
            finalQuery = `site:${domain} ${query}`;
            console.log(`[SearchClient] Restricting search to domain: ${domain}`);
        }
    }

    console.log(`[SearchClient] Searching for: "${finalQuery}"`);

    // Rate limiting: Wait if we searched too recently
    const now = Date.now();
    const timeSinceLastSearch = now - lastSearchTime;
    if (timeSinceLastSearch < MIN_SEARCH_INTERVAL) {
        const waitTime = MIN_SEARCH_INTERVAL - timeSinceLastSearch;
        console.log(`[SearchClient] Rate limiting: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
        const response = await fetch('http://localhost:8787/api/search', {
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

/**
 * Extract root domain from URL (e.g., "https://example.com/page" -> "example.com")
 * @param {string} url - Full URL
 * @returns {string|null} - Root domain or null if invalid
 */
function extractRootDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        console.error('[SearchClient] Failed to extract domain from URL:', url, error);
        return null;
    }
}

