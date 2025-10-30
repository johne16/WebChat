// extension/llmClient.js

export async function sendToBot(userText, currentURL) {
    const { modelType } = await chrome.storage.local.get('modelType');
    const model = modelType || 'gpt-4o-mini';

    // Step 1: Ask LLM if webpage data is needed
    const classificationBody = {
        model,
        messages: [
            { 
                role: 'system', 
                content: 'Does this question require data from the current webpage? Answer only "yes" or "no".'
            },
            { 
                role: 'user', 
                content: JSON.stringify({ query: userText, url: currentURL })
            }
        ]
    };

    let res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classificationBody)
    });

    if (!res.ok) throw new Error(`Classification error ${res.status}`);

    const classificationData = await res.json();
    const needsWebData = classificationData?.choices?.[0]?.message?.content?.toLowerCase().trim() === 'yes';

    // Step 2A: If no web data needed, answer directly
    if (!needsWebData) {
        const directBody = {
            model,
            messages: [
                { role: 'system', content: 'Answer the user\'s question helpfully and concisely.' },
                { role: 'user', content: userText }
            ]
        };

        res = await fetch('http://localhost:8787/api/openai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(directBody)
        });

        if (!res.ok) throw new Error(`LLM error ${res.status}`);

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return { text, raw: data };
    }

    // Step 2B: If web data needed, crawl first
    const crawlBody = {
        urls: [currentURL],
        crawler_config: {
            type: "CrawlerRunConfig",
            params: {
                deep_crawl: {
                    type: "DeepCrawlConfig",
                    params: {
                        strategy: "bestfirst",
                        max_depth: 3,
                        max_pages: 10,
                        query: userText
                    }
                }
            }
        }
    };

    const crawlRes = await fetch('http://localhost:8787/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crawlBody)
    });

    if (!crawlRes.ok) throw new Error(`Crawl error ${crawlRes.status}`);

    const crawlData = await crawlRes.json();

    // Step 3: Send crawled data + query to LLM
    const llmBody = {
        model,
        messages: [
            { 
                role: 'system', 
                content: 'Use the provided crawled webpage data to answer the user\'s question accurately and concisely.'
            },
            { 
                role: 'user', 
                content: JSON.stringify({ 
                    user_query: userText, 
                    crawled_data: crawlData 
                })
            }
        ]
    };

    res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(llmBody)
    });

    if (!res.ok) throw new Error(`LLM error ${res.status}`);

    const finalData = await res.json();
    const text = finalData?.choices?.[0]?.message?.content || '';
    return { text, raw: finalData, crawlData };
}

