// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// openai LLM endpoint
app.post("/api/openai/chat", async (req, res) => {
    try {
        const { model, messages } = req.body;
        if (!model || !messages) {
            return res.status(400).json({ error: "Missing model or messages" });
        }

        const response = await openai.chat.completions.create({
            model,
            messages
        });

        res.json(response);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

// crawl4ai endpoint
app.post("/api/crawl", async (req, res) => {
	try {
		console.log("Received crawl request:", req.body);
		const { urls, crawler_config } = req.body;
		if (!urls || !Array.isArray(urls)) {
			return res.status(400).json({ error: "Missing or invalid urls array" });
		}

		const response = await fetch("http://localhost:11235/crawl", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ 
				urls,
				crawler_config
			})
		});

		console.log("Response status: ", response.status);
		if (!response.ok) {
			throw new Error(`Crawl4AI responded with ${response.status}`);
		}

		const data = await response.json();
		console.log("Crawl successful");
		res.json(data);
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});


// Brave Search endpoint
app.post("/api/search", async (req, res) => {
	try {
		console.log("Received search request:", req.body);
		const { query, count = 5 } = req.body;
		
		if (!query) {
			return res.status(400).json({ error: "Missing query parameter" });
		}

		const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
		if (!braveApiKey) {
			return res.status(500).json({ error: "BRAVE_SEARCH_API_KEY not configured" });
		}

		// Call Brave Search API
		const searchUrl = new URL("https://api.search.brave.com/res/v1/web/search");
		searchUrl.searchParams.set("q", query);
		searchUrl.searchParams.set("count", count.toString());

		const response = await fetch(searchUrl.toString(), {
			method: "GET",
			headers: {
				"Accept": "application/json",
				"X-Subscription-Token": braveApiKey
			}
		});

		if (!response.ok) {
			throw new Error(`Brave Search API responded with ${response.status}`);
		}

		const data = await response.json();
		console.log("Search successful, found", data?.web?.results?.length || 0, "results");
		res.json(data);
	} catch (err) {
		console.error("Search error:", err);
		res.status(500).json({ error: String(err) });
	}
});


const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Proxy running on http://localhost:${port}`));


// --- For Dry Runs ---
// import "dotenv/config";
// import express from "express";
// import cors from "cors";
//
// const app = express();
// app.use(cors());
// app.use(express.json({limit: "2mb"}));
// app.use((req, _res, next) => {
// 	console.log(req.method, req.path);
// 	next();
// });
//
// app.get("/health", (_req, res) => res.json({ok: true}));
//
// app.post("/api/openai/chat", async (req, res) => {
// 	const {model, messages} = req.body || {};
// 	const dry = process.env.DRY_RUN === "1" || req.headers["x-dry-run"] === "1";
//
// 	if (!model || !messages) return res.status(400).json({error: "Missing model or messages"});
//
// 	if (dry) {
// 		return res.json({
// 			stub: true,
// 			choices: [{message: {content: `DRY-RUN OK model=${model} messages=${messages.length}`}}],
// 			received: {model, messages}
// 		});
// 	}
//
// 	return res.status(501).json({error: "Real OpenAI call not enabled"});
// });
//
// const port = process.env.PORT || 8787;
// app.listen(port, () => console.log(`Proxy on http://localhost:${port}`));
