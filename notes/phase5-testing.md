# Phase 5 Testing Notes

## Setup
- Web_Test_Bed: `C:\Users\john\PycharmProjects\Web_Test_Bed`
- Created fresh venv, installed requirements.txt
- Sites available: abc_power (L1), summit_power (L2), northlink_comm (L3)
- Test bed runs on port 5000

## Test Log

### Intent Detection
- BUG: "what page am i on?" routed to RESEARCH (showed "Researching..." in header). Should be SIMPLE — it's about the current page.

### Conversation History
- PASS: Working correctly.

### Agent Spawning
- BUG: Missing Playwright browsers triggers auto-download, which causes a UAC prompt. A headless agent spawned by the server shouldn't trigger UAC. Need to ensure `playwright install chromium` is part of setup, or handle the missing-browser case gracefully.
- BUG: Unhandled spawn error (ENOENT when .venv missing) crashes the entire server. Needs `.on('error')` handler in agentManager.js.
- BUG: `agentNumber` in panel.js increments on every attempt, even failures. Should only increment when multiple agents are running simultaneously.
- BUG: Web agent hardcodes OpenAI via its own `llm.py`. Should use the user's selected provider/model from extension settings, passed through the `execute-goal` request.

### Model Testing
- OpenAI gpt-5.2: Hit 429 rate limit errors repeatedly despite low usage on dashboard. gpt-5.2 not listed on rate limits page. Possible tier/rollout issue.
- Anthropic claude-haiku-4-5: Works. Noticeably faster than gpt-5.
- Anthropic claude-opus-4-6: Works. Also faster than gpt-5.

## TODO

1. ~~Handle agent spawn errors gracefully: add `.on('error')` handler in `agentManager.js` so missing venv doesn't crash the server~~
2. ~~Handle missing Playwright browsers: detect and fail gracefully instead of triggering UAC prompt~~
3. ~~Fix intent detection: "what page am i on?" misrouted to RESEARCH instead of SIMPLE~~
4. ~~Fix `agentNumber` counter: only increment when multiple agents are running simultaneously~~
5. ~~Pass provider/model to web agent: agent should use the user's selected provider/model, not hardcoded OpenAI~~
6. ~~Add turnaround time tracking for simple chat and research flows (agent sessions already have JSONL metrics via metrics.py)~~
