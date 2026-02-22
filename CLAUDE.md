# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web.Chat is a Chromium extension that adds an AI-powered side panel for exploring and understanding web pages. It consists of a browser extension (`extension/`) that communicates with a local Express server (`server/`) which proxies requests to OpenAI, Brave Search, and Crawl4AI services.

**Project Structure:**
- **`extension/`**: Frontend browser extension code (panel UI, background scripts, runtime logic)
  - `panel.js`, `llmClient.js`, `react.js`, `searchClient.js`, `background.js`, `options.js`
  - `agentClient.js`, `crypto.js`, `profile.js` (agent mode components)
  - Assets in `extension/icons/`
- **`server/`**: Backend Express proxy server
  - `server.js` with isolated dependencies in `server/node_modules`
  - Environment secrets in `server/.env`

## Development Setup

### Prerequisites
- Node.js and npm installed
- Chromium-based browser (Chrome, Brave, Edge)
- Docker installed (for Crawl4AI)
- Python 3.10+ with WEB_AGENT project (for Agent Mode)

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

3. **Start All Services** (three terminals):
   ```bash
   # Terminal 1: Crawl4AI
   docker run -p 11235:11235 unclecode/crawl4ai

   # Terminal 2: WebChat server
   cd server && npm start

   # Terminal 3: Web Agent (for Agent Mode only)
   cd path/to/WEB_AGENT && python -m src.agent_service
   ```

### Extension Installation

1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select `./extension` directory
4. Keyboard shortcut: `Ctrl+Shift+Y` (Windows) / `Command+Shift+Y` (Mac)

**Critical**: Crawl4AI and the local server must be running for the extension to function. The web agent must also be running for Agent Mode.

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

**Agent Mode** (autonomous web automation):
1. User clicks agent mode button → password modal appears
2. User enters passphrase → `crypto.js` decrypts profile from `chrome.storage.local`
3. `agentClient.js::startAgentContainer()` calls server to check agent health on port 5001
4. If agent not running, server returns error instructing user to start it manually
5. User sends goal with URL (e.g., "Sign me up at https://example.com")
6. `agentClient.js::executeGoal()` sends goal + profile to agent via server proxy
7. Agent executes task in visible browser window, returns status:
   - `achieved`: Task completed → show success message
   - `needs_input`: Missing data → render inline form in chat log, user submits, save to `siteData`, call `continueSession()`
   - `awaiting_user_action`: Manual action needed → show sticky banner, user acts, clicks Continue

**Note**: URLs must include full protocol (e.g., `https://example.com` not just `example.com`).

### Key Components

**Extension Side**:
- `panel.js`: UI controller, message routing, mode switching, agent mode integration
- `llmClient.js`: OpenAI API client with ReAct LLM functions
- `react.js`: ReAct loop orchestrator with duplicate detection and early bailout
- `searchClient.js`: Brave Search client with 1 req/sec rate limiting
- `agentClient.js`: Web agent API client (check health, execute goal, continue session)
- `crypto.js`: AES-256-GCM encryption with PBKDF2 key derivation for user profile
- `profile.js`: Profile management page logic (create, unlock, save, change passphrase, delete)
- `background.js`: Extension lifecycle, tab tracking, panel state management
- `options.js`: Settings page for Testing/AI mode, model selection, ReAct toggle

**Server Side**:
- `server.js`: Express proxy (ES modules) with endpoints:
  - `POST /api/openai/chat`: OpenAI completions
  - `POST /api/search`: Brave Search web search
  - `POST /api/crawl`: Crawl4AI proxy (forwards to localhost:11235)
  - `POST /api/agent/start`: Check if agent is running on port 5001
  - `POST /api/agent/execute-goal`: Proxy goal execution to agent
  - `POST /api/agent/continue`: Proxy session continue to agent
  - `POST /api/agent/stop`: No-op (agent runs independently)
  - `GET /api/agent/health/:port`: Check agent health

**Deprecated**:
- `contentScript.js` and `extraction.js`: Old DOM extraction approach, replaced by Crawl4AI

### Mode System

**Testing Mode**: Echoes user input without API calls (toggle via settings ⚙️)

**AI Mode** has two sub-modes:
- **Simple Mode**: Single-shot query with current page context
- **Research Mode**: ReAct framework with iterative web search (toggle via network icon 🌐 or settings)

**Agent Mode**: Autonomous web automation (toggle via robot icon 🤖 in panel header)
- Requires passphrase to unlock encrypted user profile
- Agent runs directly on host (port 5001), must be started manually
- Executes goals in visible Playwright browser
- Handles interactive states: `needs_input`, `awaiting_user_action`

### ReAct Loop Details

- **Max Iterations**: 5
- **Early Bailout**: Triggers if 2+ unhelpful observations in last 3 (errors, duplicates, or content < 100 chars)
- **Duplicate Prevention**: Tracks fetched URLs to prevent re-crawling
- **Rate Limiting**: Search enforces 1 req/sec via `searchClient.js`

### Profile Management

The profile page (`profile.html`) has two distinct views:

**Create Profile** (no existing profile):
- Passphrase + Confirm Passphrase fields
- "Create Profile" button
- Validates passwords match and minimum 4 characters

**Unlock Profile** (existing profile):
- Single passphrase field
- "Unlock" button
- Decrypts profile on success

**Once Unlocked**:
- Edit personal information (firstName, lastName, email, phone, address, etc.)
- View/manage site-specific data (organized by domain)
- Save changes
- Change passphrase (requires entering current passphrase first)
- Delete profile (in "Danger Zone" section, double confirmation required)
- Lock profile (returns to unlock view)

**Site-Specific Data**:
- Inline form submissions during agent tasks are saved to `profile.siteData[domain]`
- Data is displayed in expandable site items
- Sensitive fields (password, secret, token, key, pin, cvv, ssn) are masked in display
- Individual fields or entire sites can be deleted
- All site data is encrypted with the profile

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
1. Start Crawl4AI: `docker run -p 11235:11235 unclecode/crawl4ai`
2. Start server: `cd server && npm start`
3. Load the extension in browser
4. Verify Testing Mode echo works
5. Toggle AI/Research Modes and confirm:
   - Brave search calls appear in terminal logs
   - Crawl4AI requests succeed
   - OpenAI responses render correctly

**Agent Mode Smoke Test**:
1. Start agent: `cd path/to/WEB_AGENT && python -m src.agent_service`
2. Create user profile via Settings → Manage Profile (passphrase + confirm)
3. Click agent mode button (🤖) in panel, enter passphrase
4. Verify "Agent ready" message appears
5. Send: "Sign me up at http://localhost:5000/signup" (requires test server)
6. Verify agent browser window opens and executes

**Profile Management Test**:
1. Go to Settings → Manage Profile
2. Create new profile with passphrase + confirm
3. Fill in fields, save
4. Lock profile, then unlock with passphrase
5. Change passphrase (enter old, new, confirm new)
6. Delete profile (in Danger Zone)

**Site Data Test**:
1. Complete an agent task that requires inline form input
2. Go to Settings → Manage Profile → Unlock
3. Expand "Saved Site Data" section
4. Verify submitted data appears under the site domain
5. Test deleting individual fields and entire sites

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
- **Web Agent**: Runs on port 5001 (direct host mode)
- Extension code uses `http://localhost:8787` for server communication

### Storage Architecture

Extension uses `chrome.storage.local` for:
- `isTestingMode`: Boolean toggle
- `modelType`: OpenAI model selection (default: gpt-4o-mini)
- `useReActMode`: Research mode toggle
- `encryptedUserProfile`: Encrypted user profile for agent mode (AES-256-GCM)
  - Contains standard fields (firstName, lastName, email, etc.)
  - Contains `siteData` object: `{ [domain]: { [fieldName]: value } }`

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
cd path/to/WEB_AGENT && python -m src.agent_service
```

### Testing Mode
Toggle via settings ⚙️ to test UI without consuming API credits.

### Debugging
- Panel DevTools: Right-click panel → Inspect
- Background script: `chrome://extensions` → Web.Chat → Inspect views: background page
- Server logs: Terminal where `npm start` is running
- Agent logs: Terminal where `python -m src.agent_service` is running
