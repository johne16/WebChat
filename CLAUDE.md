# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web.Chat is a Chromium extension that adds an AI-powered side panel for exploring and understanding web pages. It consists of a browser extension (`extension/`) that communicates with a local Express server (`server/`) which proxies requests to OpenAI, Brave Search, and Crawl4AI services.

## Development Setup

### Server Setup
```bash
cd server
npm install
npm start  # Starts on PORT from .env (default 3000)
```

Required `.env` file in `./server/`:
```
OPENAI_API_KEY=your_key
BRAVE_SEARCH_API_KEY=your_key
PORT=3000
```

### Extension Installation
1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `./extension` directory
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
- `server.js`: Express proxy with three endpoints:
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

## Common Development Commands

### Starting the Server
```bash
cd server
npm start
# or
node server.js
```

### Reloading the Extension
After code changes to extension files:
1. Go to `chrome://extensions`
2. Click reload button for Web.Chat extension

After changes to `manifest.json` or `options.html`: Full browser restart may be required.

## Testing

The extension has a built-in Testing Mode (toggle via settings ⚙️) that echoes user input without making API calls. Useful for UI/UX testing without consuming API credits.

## API Rate Limits

- **Brave Search**: Client enforces 1 request/second minimum interval
- **OpenAI**: No client-side limiting (relies on account limits)
- **Crawl4AI**: No client-side limiting

## Port Configuration

- **Server**: Port specified in `.env` (default 3000)
- **Crawl4AI**: Must run on port 11235
- All extension code hardcodes `http://localhost:8787` for server communication (note: mismatch with default .env PORT value)

## Storage Architecture

Extension uses `chrome.storage.local` for:
- `isTestingMode`: Boolean toggle
- `modelType`: OpenAI model selection (default: gpt-4o-mini)
- `useReActMode`: Research mode toggle

Changes are synchronized across extension contexts via `chrome.storage.onChanged` listeners.
