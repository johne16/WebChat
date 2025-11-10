# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web.Chat is a Chromium extension that adds an AI-powered side panel for exploring and understanding web pages. It consists of a browser extension (`extension/`) that communicates with a local Express server (`server/`) which proxies requests to OpenAI, Brave Search, and Crawl4AI services.

**Project Structure:**
- **`extension/`**: Frontend browser extension code (panel UI, background scripts, runtime logic)
  - `panel.js`, `llmClient.js`, `react.js`, `searchClient.js`, `background.js`, `options.js`
  - Assets in `extension/icons/`
- **`server/`**: Backend Express proxy server
  - `server.js` with isolated dependencies in `server/node_modules`
  - Environment secrets in `server/.env`

## Development Setup

### Prerequisites
- Node.js and npm installed
- Chromium-based browser (Chrome, Brave, Edge)

### Server Setup

1. **Install Dependencies**:
   ```bash
   cd server
   npm install
   ```

2. **Create Environment File**:
   Create `server/.env` with the following content:
   ```
   OPENAI_API_KEY=your_key
   BRAVE_SEARCH_API_KEY=your_key
   PORT=8787
   ```

3. **Start Server**:
   ```bash
   npm start  # Starts on PORT from .env (default 8787)
   # or
   node server.js
   ```

### Extension Installation

1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select `./extension` directory
4. Keyboard shortcut: `Ctrl+Shift+Y` (Windows) / `Command+Shift+Y` (Mac)

**Critical**: The local server must be running for the extension to function.

### External Service: Crawl4AI

The extension relies on a Crawl4AI service running on `http://localhost:11235/crawl`. This must be started separately (not part of this repository).

## Architecture

### Request Flow

**Simple Mode** (default):
1. User sends message via `panel.js`
2. `llmClient.js::sendToBot()` crawls current page via Crawl4AI
3. Page content + user query sent to OpenAI via server proxy
4. Response displayed in panel

**Research Mode** (ReAct framework):
1. User sends message via `panel.js`
2. `react.js::runReActLoop()` orchestrates iterative Think→Act→Observe loop (max 5 iterations)
3. `llmClient.js::askLLMToThink()` gets LLM to decide next action:
   - `search`: Query Brave Search API
   - `fetch_current_page`: Crawl current tab's page
   - `fetch_url`: Crawl specific URL
   - `answer`: Return final answer
4. Execute action via `searchClient.js` or Crawl4AI
5. Add observation to context, repeat loop
6. Final answer via `llmClient.js::askLLMToAnswer()` if iteration limit hit

### Key Components

**Extension Side**:
- `panel.js`: UI controller, message routing, mode switching
- `llmClient.js`: OpenAI API client with ReAct LLM functions
- `react.js`: ReAct loop orchestrator with duplicate detection and early bailout
- `searchClient.js`: Brave Search client with 1 req/sec rate limiting
- `background.js`: Extension lifecycle, tab tracking, panel state management
- `options.js`: Settings page for Testing/AI mode, model selection, ReAct toggle

**Server Side**:
- `server.js`: Express proxy (ES modules) with three endpoints:
  - `POST /api/openai/chat`: OpenAI completions
  - `POST /api/search`: Brave Search web search
  - `POST /api/crawl`: Crawl4AI proxy (forwards to localhost:11235)

**Deprecated**:
- `contentScript.js` and `extraction.js`: Old DOM extraction approach, replaced by Crawl4AI

### Mode System

**Testing Mode**: Echoes user input without API calls (toggle via settings ⚙️)

**AI Mode** has two sub-modes:
- **Simple Mode**: Single-shot query with current page context
- **Research Mode**: ReAct framework with iterative web search (toggle via network icon 🌐 or settings)

### ReAct Loop Details

- **Max Iterations**: 5
- **Early Bailout**: Triggers if 2+ unhelpful observations in last 3 (errors, duplicates, or content < 100 chars)
- **Duplicate Prevention**: Tracks fetched URLs to prevent re-crawling
- **Rate Limiting**: Search enforces 1 req/sec via `searchClient.js`

## Development Workflow

### Reloading the Extension

After code changes to extension files:
1. Go to `chrome://extensions`
2. Click reload button for Web.Chat extension
3. For debugging, open DevTools: `⋮ > More tools > Developer tools` (while panel is open)

After changes to `manifest.json` or `options.html`: Full browser restart may be required.

### Coding Style & Conventions

- **Modules**: All JavaScript uses ES modules (`import ... from`)
- **Indentation**: DOM-facing scripts in `extension/` use tabs; server code uses 4 spaces (avoid bulk reformatting)
- **Naming**:
  - camelCase for variables/functions: `runReActLoop`, `addStepMessage`
  - UPPER_SNAKE_CASE for env keys: `OPENAI_API_KEY`, `BRAVE_SEARCH_API_KEY`
- **Async**: Favor `async`/`await` over promise chains
- **Comments**: Document non-obvious orchestration with concise inline comments

### Testing Guidelines

Automated tests are not yet wired up; rely on manual end-to-end testing.

**Standard Smoke Test**:
1. `npm start` inside `server/`
2. Load the extension in browser
3. Verify Testing Mode echo works
4. Toggle AI/Research Modes and confirm:
   - Brave search calls appear in terminal logs
   - Crawl4AI requests succeed
   - OpenAI responses render correctly

**Browser Testing**: Test on both Chromium Stable and Brave when touching permissions or storage APIs.

When adding tests in the future, colocate them beside the module (e.g., `extension/panel.test.js`) and name files `<feature>.test.js`.

### Commit & Pull Request Guidelines

**Commit Style**:
- Recent history favors concise, lowercase summaries
- Use imperative tone: `added ReAct feature for better LLM search`, `fixed rate limiting bug`
- Group related changes per commit

**Pull Requests Should Include**:
- Intent summary (what and why)
- Manual test notes (browser + mode combinations tested)
- Screenshots or GIFs for UI modifications
- Links to any tracked issues
- Mention configuration impacts (new env vars, permissions changes)

### Security & Configuration

- **Never commit** `.env` or API keys
- Validate that `BRAVE_SEARCH_API_KEY`, `OPENAI_API_KEY`, and Crawl4AI endpoint are present before pushing
- When sharing logs, redact URLs and model responses that may contain private data
- Review OWASP top 10 when handling user input or constructing requests

## Technical Reference

### API Rate Limits

- **Brave Search**: Client enforces 1 request/second minimum interval
- **OpenAI**: No client-side limiting (relies on account limits)
- **Crawl4AI**: No client-side limiting

### Port Configuration

- **Server**: Port specified in `.env` (default 8787)
- **Crawl4AI**: Must run on port 11235
- Extension code uses `http://localhost:8787` for server communication

### Storage Architecture

Extension uses `chrome.storage.local` for:
- `isTestingMode`: Boolean toggle
- `modelType`: OpenAI model selection (default: gpt-4o-mini)
- `useReActMode`: Research mode toggle

Changes are synchronized across extension contexts via `chrome.storage.onChanged` listeners.

## Quick Reference

### Starting the Server
```bash
cd server
npm start
```

### Testing Mode
Toggle via settings ⚙️ to test UI without consuming API credits.

### Debugging
- Panel DevTools: Right-click panel → Inspect
- Background script: `chrome://extensions` → Web.Chat → Inspect views: background page
- Server logs: Terminal where `npm start` is running
