// extension/llmClient.js

export async function sendToBot(userText, currentURL) {
    const { modelType } = await chrome.storage.local.get('modelType');
    const model = modelType || 'gpt-4o-mini';

    // Scrape current page only
    const crawlRes = await fetch('http://localhost:8787/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            urls: [currentURL],
            crawler_config: {
                exclude_external_links: true,
                remove_overlay_elements: true,
                word_count_threshold: 10
            }
        })
    });

    if (!crawlRes.ok) throw new Error(`Crawl error ${crawlRes.status}`);
    
    const crawlData = await crawlRes.json();
    const pageContent = crawlData.results?.[0]?.markdown?.raw_markdown || '';

    // Send to LLM with page content
    const llmBody = {
        model,
        messages: [
            { 
                role: 'system', 
                content: 'Answer the user\'s question based on the provided webpage content.'
            },
            { 
                role: 'user', 
                content: `Page URL: ${currentURL}\n\nPage content:\n${pageContent}\n\nUser question: ${userText}`
            }
        ]
    };

    const res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(llmBody)
    });

    if (!res.ok) throw new Error(`LLM error ${res.status}`);

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { text, raw: data };
}

/**
 * Ask LLM to think and decide next action in ReAct loop
 * @param {Object} context - Current context with query, observations, etc.
 * @returns {Promise<Object>} - Decision object with thought, action, action_input
 */
export async function askLLMToThink(context) {
    const { modelType } = await chrome.storage.local.get('modelType');
    const model = modelType || 'gpt-4o-mini';

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

    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    };

    const res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`LLM Think error ${res.status}`);

    const data = await res.json();
    const responseText = data?.choices?.[0]?.message?.content || '';

    // Parse the JSON response
    try {
        const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const decision = JSON.parse(cleanedText);
        
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
    const { modelType } = await chrome.storage.local.get('modelType');
    const model = modelType || 'gpt-4o-mini';

    const systemPrompt = `Based on the search results and web pages examined, provide the best possible answer to the user's question. 

If you found sufficient information, provide a complete answer.
If you could not find enough information, clearly state what you searched for and what you could not find.
Be honest about limitations.`;

    const userPrompt = buildContextPrompt(context);

    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    };

    const res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`LLM Answer error ${res.status}`);

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || 'I was unable to generate an answer.';
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

