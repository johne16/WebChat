// extension/llmClient.js

// Single entry point for sending to the model
export async function sendToBot(userText, cleanHTML) {
    const { modelType } = await chrome.storage.local.get('modelType');
	console.log("modelType", modelType);

    const payload = { user_query: userText, html: cleanHTML || '' };
    const body = {
        model: modelType || 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'Use the provided JSON for questions about the web page. ' +
					'If the question is not about the page, interact normally. Answer concisely.' },
            { role: 'user', content: JSON.stringify(payload) }
        ]
    };

    const res = await fetch('http://localhost:8787/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

	// const res = await fetch("http://localhost:8787/api/openai/chat", {
	// 	method: "POST",
	// 	headers: {"Content-Type": "application/json", "x-dry-run": "1"},
	// 	body: JSON.stringify(body)
	// });
    if (!res.ok) throw new Error(`Proxy error ${res.status}`);

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { text, raw: data, payload };
}

