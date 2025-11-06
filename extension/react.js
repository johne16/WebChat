// extension/react.js

import { askLLMToThink, askLLMToAnswer } from './llmClient.js';
import { searchBrave } from './searchClient.js';

/**
 * Main ReAct orchestrator - runs Think→Act→Observe loop
 * @param {string} userQuery - The user's question
 * @param {string} currentURL - URL of the current tab
 * @param {Function} onStep - Optional callback called after each step with step info
 * @returns {Promise<{answer: string}>} - Final answer and reasoning trace
 */
export async function runReActLoop(userQuery, currentURL, onStep = null) {
    const maxIterations = 5;

    const context = {
        query: userQuery,
        currentURL: currentURL,
        observations: []
    };

    const fetchedURLs = new Set(); // Track URLs we've already fetched to prevent duplicates

    if (currentURL) {
        try {
            const initialContent = await executeFetchURL(currentURL);
            context.observations.push(initialContent);
            fetchedURLs.add(currentURL);
        } catch (error) {
            console.log('[ReAct] Failed to fetch initial page:', error);
        }
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`[ReAct] Iteration ${iteration + 1}/${maxIterations}`);

        // THINK: Ask LLM what to do next
        const decision = await askLLMToThink(context);

        console.log(`[ReAct] Decision:`, decision);

        // Call callback to show step in real-time
        if (onStep) {
            onStep({
                iteration: iteration + 1,
                action: decision.action,
                action_input: decision.action_input
            });
        }

        // Check if LLM wants to answer
        if (decision.action === 'answer') {
            return {
                answer: decision.action_input,
                iterations: iteration + 1
            };
        }

        // ACT: Execute the chosen action
        let observation;
        try {
            if (decision.action === 'search') {
                observation = await executeSearch(decision.action_input);
            } else if (decision.action === 'fetch_current_page') {
                // Check if we already fetched the current page
                if (fetchedURLs.has(currentURL)) {
                    observation = {
                        type: 'duplicate_fetch',
                        content: `Already fetched ${currentURL} - no new information available. Consider answering with what you have or searching differently.`
                    };
                } else {
                    observation = await executeFetchURL(currentURL);
                    fetchedURLs.add(currentURL);
                }
            } else if (decision.action === 'fetch_url') {
                const targetURL = decision.action_input;
                // Check if we already fetched this URL
                if (fetchedURLs.has(targetURL)) {
                    observation = {
                        type: 'duplicate_fetch',
                        content: `Already fetched ${targetURL} - no new information available. Consider answering with what you have or searching differently.`
                    };
                } else {
                    observation = await executeFetchURL(targetURL);
                    fetchedURLs.add(targetURL);
                }
            } else {
                // Unknown action, record error
                observation = {
                    type: 'error',
                    content: `Unknown action: ${decision.action}`
                };
            }
        } catch (error) {
            observation = {
                type: 'error',
                content: `Error executing ${decision.action}: ${error.message}`
            };
        }

        // OBSERVE: Add results to context
        context.observations.push(observation);
        console.log(`[ReAct] Observation:`, observation);

        // Check if we should bail out early - last 2-3 observations were unhelpful
        if (iteration >= 2) {
            const recentObs = context.observations.slice(-3);
            const unhelpfulCount = recentObs.filter(obs => 
                obs.type === 'error' || 
                obs.type === 'duplicate_fetch' ||
                (obs.type === 'crawled_content' && (!obs.content || obs.content.length < 100))
            ).length;
            
            if (unhelpfulCount >= 2) {
                console.log(`[ReAct] Detected ${unhelpfulCount} unhelpful observations in last 3 - triggering early bailout`);
                
                // Notify UI that we're bailing out
                if (onStep) {
                    onStep({
                        iteration: iteration + 1,
                        action: 'bailout',
                    });
                }
                
                const finalAnswer = await askLLMToAnswer(context);
                return {
                    answer: finalAnswer,
                    iterations: iteration + 1,
                    bailedOut: true
                };
            }
        }
    }

    // Hit iteration limit without answering
    console.log(`[ReAct] Hit max iterations (${maxIterations})`);

    // Notify UI BEFORE asking LLM for final answer
    if (onStep) {
        onStep({
            iteration: maxIterations,
            action: 'max_depth_reached',
        });
    }

    // Ask LLM to formulate final answer based on what it learned
    const finalAnswer = await askLLMToAnswer(context);

    return {
        answer: finalAnswer,
        iterations: maxIterations,
        hitLimit: true
    };
}

// Execute a Brave search
async function executeSearch(query) {
    const results = await searchBrave(query);
    return {
        type: 'search_results',
        query: query,
        results: results,
        count: results.length
    };
}


// Execute fetch of a specific URL via Crawl4AI
async function executeFetchURL(url) {
    const response = await fetch('http://localhost:8787/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            urls: [url],
            crawler_config: {
                // Simple single-page crawl without deep crawling
                exclude_external_links: true,
                remove_overlay_elements: true,
                word_count_threshold: 10
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Crawl failed with status ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
        throw new Error('No content extracted from URL');
    }

    const result = data.results[0];
    const content = result.markdown?.raw_markdown || result.cleaned_html || '';

    // Flag if content is suspiciously short (likely a PDF or unhelpful page)
    const isLikelyUnhelpful = content.length < 100;

    return {
        type: 'crawled_content',
        source: url,
        content: content,
        success: result.success,
        contentLength: content.length,
        warning: isLikelyUnhelpful ? 'Content is very short - may be a PDF, image, or page with minimal text. Consider providing the URL as a reference.' : null
    };
}
