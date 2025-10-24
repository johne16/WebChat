// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
