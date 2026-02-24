# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebChat is a Chromium extension that adds an AI-powered side panel for exploring and understanding web pages. It consists of a browser extension (`extension/`), a local Express server (`server/`), and an autonomous web agent (`web_agent/`). The server proxies requests to OpenAI, Anthropic, Brave Search, and Crawl4AI, and spawns/manages agent processes. The extension handles UI only.

**Project Structure:**
- **`extension/`**: Frontend browser extension (panel UI, background scripts, runtime logic)
  - `panel.js`, `ui.js`, `agent.js`, `intent.js`, `agentClient.js`
  - `llmClient.js`, `react.js`, `searchClient.js`
  - `config.js`, `utils.js` (shared constants and utilities)
  - `background.js`, `options.js`
  - `profile.js`, `crypto.js` (profile management)
  - `test-progress.html` (header progress indicator test page)
  - Assets in `extension/icons/`
- **`server/`**: Backend Express proxy server (modular)
  - `server.js` — main Express app (imports route modules)
  - `config.js` — centralized configuration constants
  - `conversationHistory.js` — in-memory conversation history (4000 token rolling window)
  - `sseManager.js` — SSE state management
  - `agentManager.js` — agent process lifecycle
  - `database.js` — SQLite database module
  - `routes/proxy.js` — LLM, Crawl4AI, Brave Search proxy
  - `routes/agent.js` — agent management endpoints
  - `routes/database.js` — database CRUD endpoints
  - `providers/openai.js` — OpenAI chat adapter
  - `providers/anthropic.js` — Anthropic chat adapter
  - `data/webchat.db` — SQLite database
  - Environment secrets in `server/.env`
- **`web_agent/`**: Autonomous web agent (Python/FastAPI)
  - `src/` — agent modules (web_agent.py, llm.py, browser.py, metrics.py, config.py, etc.)
  - `prompts/` — LLM planning prompts
  - `logs/` — JSONL performance metrics and generated code
- **`notes/`**: Planning and analysis notes

## Development Setup

### Prerequisites
- Node.js and npm installed
- Chromium-based browser (Chrome, Brave, Edge)
- Docker installed (for Crawl4AI)
- Python 3.13+ with dependencies from `web_agent/requirements.txt`

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
   ANTHROPIC_API_KEY=your_key  # optional
   PORT=8787
   ```

3. **Start All Services** (three terminals):
   ```bash
   # Terminal 1: Crawl4AI
   docker run -p 11235:11235 unclecode/crawl4ai

   # Terminal 2: WebChat server
   cd server && npm start

   # Terminal 3: Web Agent (for Agent Mode)
   cd web_agent && python -m src.agent_service
   ```

### Extension Installation

1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select `./extension` directory
4. Keyboard shortcut: `Ctrl+Shift+Y` (Windows) / `Command+Shift+Y` (Mac)

**Critical**: Crawl4AI and the local server must be running for the extension to function. The web agent must also be running for agent tasks.

## Architecture

### How Messages Are Routed

There are no user-facing mode toggles (removed in Phase 4). The system uses LLM-driven intent detection:

1. User sends message via `panel.js`
2. `intent.js::detectIntent()` classifies intent using heuristics first, then LLM fallback:
   - **Simple**: Direct question about current page → `llmClient.js::sendToBot()`
   - **Research**: Needs web search → `react.js::runReActLoop()`
   - **Agent**: Needs browser automation → confirmation prompt, then agent spawning
3. Response displayed in panel

### Simple Chat Flow
1. `llmClient.js::sendToBot()` crawls current page via Crawl4AI
2. Page content + user query sent to LLM via server proxy
3. Response displayed in panel

### Research Flow (ReAct framework)
1. `react.js::runReActLoop()` orchestrates iterative Think→Act→Observe loop (max 5 iterations)
2. `llmClient.js::askLLMToThink()` decides next action:
   - `search`: Query Brave Search API
   - `fetch_current_page`: Crawl current tab's page
   - `fetch_url`: Crawl specific URL
   - `answer`: Return final answer
3. Execute action via `searchClient.js` or Crawl4AI
4. Add observation to context, repeat loop
5. Final answer via `llmClient.js::askLLMToAnswer()` if iteration limit hit

### Agent Flow (multi-agent, autonomous web automation)
1. Intent detected as agent task → user sees confirmation prompt (yes/no)
2. User confirms → password modal for passphrase
3. `agent.js::unlockProfile()` decrypts profile from `chrome.storage.local`
4. `agent.js::startAgentSession()` → server spawns Python agent process via `child_process` on available port (5001-5005)
5. `agent.js::executeAgentGoal()` sends goal + profile to agent via server proxy
6. Agent executes task in visible Playwright browser, reports status via webhooks to server
7. Server broadcasts status to extension via SSE
8. Terminal states:
   - `achieved`: Task completed → success message
   - `needs_input`: Missing data → inline form rendered, user submits, data saved to profile's siteData
   - `awaiting_user_action`: Manual action needed (captcha, etc.) → sticky banner, user acts, clicks Continue

**Note**: URLs in goals must include full protocol (e.g., `https://example.com` not just `example.com`).

### Key Components

**Extension Side**:
- `panel.js`: Main orchestrator — form submission, intent routing, SSE setup, agent control
- `ui.js`: Reusable UI rendering (messages, forms, banners, header progress)
- `agent.js`: Agent session management, profile encryption/decryption, site data storage
- `intent.js`: Intent detection (heuristic bypass + LLM classification via gpt-4o-mini)
- `agentClient.js`: Server communication — SSE subscription, agent API calls
- `llmClient.js`: LLM client (OpenAI + Anthropic) with ReAct functions
- `react.js`: ReAct loop orchestrator with duplicate detection and early bailout
- `searchClient.js`: Brave Search client with 1 req/sec rate limiting
- `config.js`: Shared constants (SERVER_BASE)
- `utils.js`: Shared utilities (crawlPage, parseJsonFromLLM)
- `crypto.js`: AES-256-GCM encryption with PBKDF2 key derivation for user profile
- `profile.js`: Profile management page (create, unlock, save, change passphrase, delete)
- `background.js`: Extension lifecycle, tab tracking, panel state management
- `options.js`: Settings page (testing toggle, provider/model grid)

**Server Side** (modular Express app):
- `server.js`: Main app — middleware setup, imports and mounts route modules
- `config.js`: Configuration constants (MAX_BODY_SIZE, MAX_AGENT_RESTARTS, SERVER_PORT, AGENT_CONFIG)
- `conversationHistory.js`: In-memory conversation history (4000 token rolling window)
- `sseManager.js`: SSE connection and event broadcasting
- `agentManager.js`: Agent process spawning, health checks, lifecycle
- `database.js`: SQLite module (users, profile, site_data, learned_context tables)
- `providers/openai.js`: OpenAI chat adapter (normalized `{ content }` response)
- `providers/anthropic.js`: Anthropic chat adapter (normalized `{ content }` response)
- `routes/proxy.js`: Endpoints:
  - `POST /api/openai/chat`: LLM chat (OpenAI or Anthropic via `provider` field)
  - `POST /api/search`: Brave Search web search
  - `POST /api/crawl`: Crawl4AI proxy (forwards to localhost:11235)
  - `POST /api/history/add`: Add conversation turns to in-memory history
- `routes/agent.js`: Endpoints:
  - `POST /api/agent/start`: Spawn new agent process
  - `POST /api/agent/execute-goal`: Proxy goal execution (merges DB profile)
  - `POST /api/agent/continue`: Continue paused agent session
  - `POST /api/agent/stop`: Kill agent process
  - `GET /api/agent/status`: List running agents and available ports
  - `GET /api/agent/health/:port`: Health check for specific agent
  - `POST /api/agent/webhook`: Receive status updates from agents
  - `GET /api/events`: SSE stream for real-time updates to extension
  - `GET /api/agent/needs-input`: Get pending input request queue
  - `POST /api/agent/provide-input`: Provide data to waiting agent
- `routes/database.js`: Endpoints:
  - `GET/POST /api/db/profile`: User profile CRUD
  - `POST /api/db/profile/extra`: Update single extra profile field
  - `GET/POST/DELETE /api/db/site-data`: Site-specific data CRUD
  - `GET/POST/DELETE /api/db/learned`: Learned context facts
  - `GET /api/db/user-data`: Full user data (profile + site data)

**Web Agent Side** (`web_agent/src/`):
- `web_agent.py`: Main orchestrator (autonomous loop)
- `action_executor.py`: Action execution (fill_form, click_link, click_button, etc.)
- `llm.py`: OpenAI GPT-5 client for planning and code generation
- `browser.py`: Playwright wrapper + HTML preprocessing
- `memory.py`: SQLite-backed session memory
- `execution_engine.py`: JS validation + execution in browser
- `metrics.py`: JSONL performance metrics logging
- `config.py`: Agent configuration constants
- `agent_service.py`: FastAPI server with webhook callbacks

### Multi-Agent Details

- **Port Pool**: 5001-5005 (max 5 concurrent agents)
- **Spawning**: Server uses `child_process.spawn()` with `--port`, `--callback-url`, `--database-path` args
- **Health Check**: Up to 30 attempts after spawn before declaring failure
- **Timeout**: 10 minutes per agent, killed if exceeded
- **Crash Handling**: One automatic restart attempt on unexpected exit
- **Graceful Shutdown**: Server kills all agents on SIGINT/SIGTERM

### Communication

- **Agent → Server**: Webhooks (agent POSTs status updates to server callback URL)
- **Server → Extension**: SSE (Server-Sent Events stream at `/api/events`)
- **Needs Input Queue**: Server maintains queue of pending input requests; extension renders inline forms one at a time
- **SSE Reconnect**: Extension tracks `lastSeenTimestamp` to avoid duplicate alerts on reconnect

### ReAct Loop Details

- **Max Iterations**: 5
- **Early Bailout**: Triggers if 2+ unhelpful observations in last 3 (errors, duplicates, or content < 100 chars)
- **Duplicate Prevention**: Tracks fetched URLs to prevent re-crawling
- **Rate Limiting**: Search enforces 1 req/sec via `searchClient.js`

### Database

- **Engine**: SQLite at `server/data/webchat.db`
- **Tables**: users, profile, site_data, learned_context
- **Access**: Server reads/writes; agents read only (via `--database-path` arg)
- **Multi-user Ready**: All tables have `user_id` foreign keys; currently hardcoded to user ID 1
- **Encryption at Rest**: Deferred — will be addressed before sharing with users

### Profile Management

The profile page (`profile.html`) has two distinct views:

**Create Profile** (no existing profile):
- Passphrase + Confirm Passphrase fields
- Validates passwords match and minimum 4 characters

**Unlock Profile** (existing profile):
- Single passphrase field → decrypts profile on success

**Once Unlocked**:
- Edit personal information (firstName, lastName, email, phone, address, etc.)
- View/manage site-specific data (organized by domain)
- Save changes, change passphrase, delete profile, lock profile

**Site-Specific Data**:
- Inline form submissions during agent tasks are saved to `profile.siteData[domain]`
- Sensitive fields (password, secret, token, key, pin, cvv, ssn) are masked in display
- Individual fields or entire sites can be deleted

## Development Workflow

### Reloading the Extension

After code changes to extension files:
1. Go to `chrome://extensions`
2. Click reload button for WebChat extension
3. For debugging, open DevTools: `⋮ > More tools > Developer tools` (while panel is open)

After changes to `manifest.json` or `options.html`: Full browser restart may be required.

### Coding Style & Conventions

- **Modules**: All JavaScript uses ES modules (`import ... from`)
- **Indentation**: All JS/HTML/CSS use tabs. Python uses 4 spaces.
- **Naming**:
  - camelCase for variables/functions: `runReActLoop`, `addStepMessage`
  - UPPER_SNAKE_CASE for env keys: `OPENAI_API_KEY`, `BRAVE_SEARCH_API_KEY`
- **Async**: Favor `async`/`await` over promise chains
- **Comments**: Document non-obvious orchestration with concise inline comments

### Testing Guidelines

Automated tests are not yet wired up for the extension/server; rely on manual end-to-end testing. The web agent has a full test suite (~120 tests) — see `web_agent/README.md`.

**Standard Smoke Test**:
1. Start Crawl4AI: `docker run -p 11235:11235 unclecode/crawl4ai`
2. Start server: `cd server && npm start`
3. Load the extension in browser
4. Verify Testing Mode echo works
5. Send a question and confirm intent detection routes correctly
6. Confirm Brave search, Crawl4AI, and LLM responses work

**Agent Smoke Test**:
1. Start agent: `cd web_agent && python -m src.agent_service`
2. Open panel, send an agent-style message (e.g., "Sign me up at http://localhost:5000/signup")
3. Confirm intent detection prompts for confirmation
4. Enter passphrase when prompted
5. Verify agent browser window opens and executes
6. Verify SSE status updates appear in header progress bar

**Profile Management Test**:
1. Go to Settings → Manage Profile
2. Create new profile with passphrase + confirm
3. Fill in fields, save
4. Lock profile, then unlock with passphrase
5. Change passphrase (enter old, new, confirm new)
6. Delete profile (in Danger Zone)

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
- **Anthropic**: No client-side limiting (relies on account limits)
- **Crawl4AI**: No client-side limiting

### Port Configuration

- **Server**: Port specified in `.env` (default 8787)
- **Crawl4AI**: Must run on port 11235
- **Web Agents**: Ports 5001-5005 (dynamically assigned by server)
- Extension code uses `http://localhost:8787` for server communication

### Storage Architecture

Extension uses `chrome.storage.local` for:
- `isTestingMode`: Boolean toggle
- `provider`: LLM provider (`'openai'` or `'anthropic'`, default: `'openai'`)
- `modelType`: LLM model selection (default: `'gpt-5'`)
- `encryptedUserProfile`: Encrypted user profile for agent mode (AES-256-GCM)
  - Contains standard fields (firstName, lastName, email, etc.)
  - Contains `siteData` object: `{ [domain]: { [fieldName]: value } }`

Server uses SQLite (`server/data/webchat.db`) for:
- User profile (plaintext, encryption deferred)
- Site-specific data
- Learned context facts

Conversation history is in-memory (4000 token rolling window in `conversationHistory.js`).

Changes are synchronized across extension contexts via `chrome.storage.onChanged` listeners.

### Agent Mode Security

- **Encryption**: AES-256-GCM with PBKDF2 key derivation (100,000 iterations)
- **Profile storage**: Encrypted blob in `chrome.storage.local` (ciphertext + salt + IV)
- **Passphrase**: Never stored; only used to derive decryption key at runtime
- **Profile deletion**: Can be permanently erased from profile management page

## Quick Reference

### Starting All Services
```bash
# Terminal 1: Crawl4AI
docker run -p 11235:11235 unclecode/crawl4ai

# Terminal 2: WebChat server
cd server && npm start

# Terminal 3: Web Agent (for Agent Mode)
cd web_agent && python -m src.agent_service
```

### Testing Mode
Toggle via settings ⚙️ to test UI without consuming API credits.

### Debugging
- Panel DevTools: Right-click panel → Inspect
- Background script: `chrome://extensions` → WebChat → Inspect views: background page
- Server logs: Terminal where `npm start` is running
- Agent logs: Terminal where `python -m src.agent_service` is running
