// extension/react.js

import { askLLMToThink, askLLMToAnswer } from './llmClient.js';
import { searchBrave } from './searchClient.js';
import { crawlPage } from './utils.js';

// Named constants for bailout logic (item 19)
const MAX_ITERATIONS = 5;
const UNHELPFUL_THRESHOLD = 2;
const MIN_ITERATIONS_BEFORE_BAILOUT = 2;
const MIN_USEFUL_CONTENT_LENGTH = 100;

/**
 * Main ReAct orchestrator - runs Think->Act->Observe loop
 * @param {string} userQuery - The user's question
 * @param {string} currentURL - URL of the current tab
 * @param {Function} onStep - Optional callback called after each step with step info
 * @returns {Promise<{answer: string}>} - Final answer and reasoning trace
 */
export async function runReActLoop(userQuery, currentURL, onStep = null) {
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

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		console.log(`[ReAct] Iteration ${iteration + 1}/${MAX_ITERATIONS}`);

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
				observation = await executeSearch(decision.action_input, currentURL);
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
		if (iteration >= MIN_ITERATIONS_BEFORE_BAILOUT) {
			const recentObs = context.observations.slice(-3);
			const unhelpfulCount = recentObs.filter(obs =>
				obs.type === 'error' ||
				obs.type === 'duplicate_fetch' ||
				(obs.type === 'crawled_content' && (!obs.content || obs.content.length < MIN_USEFUL_CONTENT_LENGTH))
			).length;

			if (unhelpfulCount >= UNHELPFUL_THRESHOLD) {
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
	console.log(`[ReAct] Hit max iterations (${MAX_ITERATIONS})`);

	// Notify UI BEFORE asking LLM for final answer
	if (onStep) {
		onStep({
			iteration: MAX_ITERATIONS,
			action: 'max_depth_reached',
		});
	}

	// Ask LLM to formulate final answer based on what it learned
	const finalAnswer = await askLLMToAnswer(context);

	return {
		answer: finalAnswer,
		iterations: MAX_ITERATIONS,
		hitLimit: true
	};
}

// Execute a Brave search
async function executeSearch(query, currentURL = null) {
	const results = await searchBrave(query, 5, currentURL);
	return {
		type: 'search_results',
		query: query,
		results: results,
		count: results.length
	};
}


// Execute fetch of a specific URL via shared crawlPage
async function executeFetchURL(url) {
	const content = await crawlPage(url);

	if (!content) {
		throw new Error('No content extracted from URL');
	}

	// Flag if content is suspiciously short (likely a PDF or unhelpful page)
	const isLikelyUnhelpful = content.length < MIN_USEFUL_CONTENT_LENGTH;

	return {
		type: 'crawled_content',
		source: url,
		content: content,
		success: true,
		contentLength: content.length,
		warning: isLikelyUnhelpful ? 'Content is very short - may be a PDF, image, or page with minimal text. Consider providing the URL as a reference.' : null
	};
}
