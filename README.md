# Web.Chat — Developer README

## Overview

Web.Chat is a Chromium extension that adds an AI-powered side panel to help users explore and understand web pages. It connects to a local server that relays requests to OpenAI, Brave Search, Crawl4AI, and can spawn autonomous web agents for form automation tasks.

## Prerequisites

* **Node.js** and **npm** installed
* Chromium-based browser (Chrome, Brave, Edge)
* **Docker** installed and running (required for Crawl4AI)
* **Python 3.10+** with the WEB_AGENT project set up (required for Agent Mode)

## Setup

1. Clone this repository.

2. Create an environment file at `./server/.env`:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   BRAVE_SEARCH_API_KEY=your_brave_search_api_key_here
   PORT=8787
   WEB_AGENT_PATH=C:\Users\John\PycharmProjects\WEB_AGENT
   ```

   **Notes:**
   - Get your Brave Search API key from [https://brave.com/search/api/](https://brave.com/search/api/)
   - `WEB_AGENT_PATH` should point to your WEB_AGENT project directory

3. Install server dependencies:
   ```bash
   cd server
   npm install
   ```

4. Install WEB_AGENT dependencies:
   ```bash
   cd path/to/WEB_AGENT
   pip install -r requirements.txt
   ```

## Running the Extension

The extension requires two services running. Start each in a separate terminal:

### Terminal 1: Crawl4AI

```bash
docker run -p 11235:11235 unclecode/crawl4ai
```

Crawl4AI must be running on port 11235 for page content extraction.

### Terminal 2: WebChat Server

```bash
cd server
npm start
```

The server listens on port 8787 (configurable via `.env`). It handles:
- OpenAI API proxying
- Brave Search proxying
- Crawl4AI proxying
- **Agent process spawning and management** (agents are now spawned on-demand, not manually)

## Installing the Extension

1. Open your browser and go to `chrome://extensions`
2. Enable **Developer mode** (toggle at top right)
3. Click **Load unpacked**
4. Select the `./extension` directory
5. The extension appears as **Web.Chat**

**Keyboard shortcut:** `Ctrl+Shift+Y` (Windows) / `Command+Shift+Y` (Mac)

## Architecture

### System Topology

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                        │
│  panel.js → llmClient / react / searchClient / agentClient  │
└─────────────────────────┬───────────────────────────────────┘
                          │ localhost:8787
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Express Server (Hub)                       │
│  Spawns & manages agent processes on ports 5001-5005        │
└───────┬─────────────────┬────────────┬─────────────┬────────┘
        │                 │            │             │
        ▼                 ▼            ▼             ▼
   OpenAI API       Crawl4AI      Brave Search   WEB_AGENT
   (cloud)          :11235        (cloud)        :5001-5005
                    (Docker)                     (spawned by server)
```

### Request Flow

Web.Chat uses **automatic intent detection** to route your message to the right handler. No mode toggles needed.

**Unified Flow:**
1. User sends message via panel
2. Intent detection (heuristic + LLM) classifies the request:
   - **Simple**: Questions about current page → crawl page, send to OpenAI
   - **Research**: Questions needing web search → ReAct loop with Brave Search
   - **Agent**: Action requests (sign up, fill forms) → spawn agent with confirmation
3. Response displayed (agent tasks show real-time status via SSE)

**Intent Detection:**
- Heuristic bypass for obvious cases (questions starting with "what/why/how", references to "this page")
- LLM classification for ambiguous cases (also resolves URLs like "ABC Power" → actual URL)
- Agent tasks require confirmation: "Should I proceed?"

**Agent Task Flow:**
1. User sends action request: "Sign me up on ABC Power's website"
2. Intent detected as agent task, URL resolved
3. If profile locked → prompt for passphrase
4. Confirmation prompt → user says "yes"
5. Server spawns agent on available port (5001-5005)
6. Agent executes in visible browser, status updates via SSE
7. If `needs_input` → inline form appears for missing data
8. Agent process killed on completion or timeout

## Settings

### Testing Mode
Echoes user input without API calls. Toggle via settings (⚙️).

### LLM Model
Select the OpenAI model to use. Configure via settings (⚙️).

### User Profile
Encrypted profile for agent automation. Manage via Settings → Manage Profile.

## Agent Tasks

### How It Works

Web.Chat automatically detects when you want to perform an action on a website and offers to spawn an agent.

1. Type a request: "Sign me up at https://example.com" or "Register me on ABC Power"
2. Web.Chat detects this as an agent task and asks for confirmation
3. If your profile is locked, you'll be prompted for your passphrase
4. Say "yes" to proceed
5. The server spawns an agent on an available port (5001-5005)
6. The agent opens a browser window and executes the task
7. Real-time status updates appear in the chat via SSE
8. When complete, the agent process is automatically killed

### Agent Configuration

| Setting | Value |
|---------|-------|
| Port pool | 5001-5005 |
| Max concurrent agents | 5 |
| Timeout | 10 minutes |
| Crash handling | Restart once |

### Agent States

- **achieved**: Task completed successfully
- **needs_input**: Agent needs additional information (inline form appears)
- **awaiting_user_action**: Manual action required (e.g., CAPTCHA)

### User Profile

Agent mode requires an encrypted user profile for form filling:

1. Open Settings (⚙️) → Manage Profile
2. Create profile with passphrase
3. Fill in personal information and save

Profile data is encrypted with AES-256-GCM (PBKDF2, 100k iterations). Passphrase is never stored.

## Project Structure

```
.
├── extension/
│   ├── agent.js               # Agent session management, profile handling
│   ├── agentClient.js         # Web agent API client + SSE
│   ├── background.js          # Extension lifecycle, tab tracking
│   ├── contentScript.js       # DEPRECATED
│   ├── crypto.js              # AES-256-GCM encryption
│   ├── extraction.js          # DEPRECATED
│   ├── icons/                 # Extension icons
│   ├── intent.js              # Intent detection (heuristic + LLM)
│   ├── llmClient.js           # OpenAI client + ReAct functions
│   ├── manifest.json          # Extension configuration
│   ├── options.html/css/js    # Settings page
│   ├── panel.html/css/js      # Side panel UI (main entry point)
│   ├── profile.html/css/js    # Profile management
│   ├── react.js               # ReAct loop orchestrator
│   ├── searchClient.js        # Brave Search client
│   └── ui.js                  # UI rendering (messages, forms, banners)
└── server/
    ├── .env                   # API keys, config
    ├── database.js            # SQLite database module
    ├── data/webchat.db        # SQLite database file
    ├── package.json
    └── server.js              # Express server + agent process manager + SSE
```

## Server Endpoints

### AI & Agent Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/openai/chat` | POST | Proxy to OpenAI |
| `/api/crawl` | POST | Proxy to Crawl4AI |
| `/api/search` | POST | Proxy to Brave Search |
| `/api/agent/start` | POST | Spawn new agent process |
| `/api/agent/execute-goal` | POST | Execute goal on agent |
| `/api/agent/continue` | POST | Continue paused session |
| `/api/agent/stop` | POST | Kill agent process |
| `/api/agent/health/:port` | GET | Check agent health |
| `/api/agent/status` | GET | List all running agents |
| `/api/agent/webhook` | POST | Receive agent status webhooks |
| `/api/agent/needs-input` | GET | Get pending input requests |
| `/api/agent/provide-input` | POST | Provide input for waiting agent |
| `/api/events` | GET | SSE stream for real-time updates |

### Database Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/db/profile` | GET | Get user profile |
| `/api/db/profile` | POST | Update user profile |
| `/api/db/profile/extra` | POST | Update single extra field |
| `/api/db/site-data` | GET | Get site-specific data |
| `/api/db/site-data` | POST | Add/update site data |
| `/api/db/site-data` | DELETE | Delete site data |
| `/api/db/conversations` | GET | Get conversation history |
| `/api/db/conversations` | POST | Add conversation message |
| `/api/db/conversations` | DELETE | Clear conversations |
| `/api/db/learned` | GET | Get learned context |
| `/api/db/learned` | POST | Add learned fact |
| `/api/db/learned/:id` | DELETE | Delete learned fact |
| `/api/db/user-data` | GET | Get full user data (for agents) |

## Database Schema

SQLite database at `server/data/webchat.db`. Designed for multi-user (future) but currently single-user.

```sql
-- Users (multi-user ready)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile (core fields + flexible JSON overflow)
CREATE TABLE profile (
    user_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    birth_date TEXT,
    street TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    extra_fields TEXT,  -- JSON for dynamic fields (SSN, etc.)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Site-specific data (credentials, security answers per domain)
CREATE TABLE site_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, domain, field_name),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Conversation history
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Learned context (facts the assistant remembers)
CREATE TABLE learned_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fact TEXT NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Design notes:**
- `profile.extra_fields` is JSON for flexibility—avoids schema changes when new fields are learned
- `site_data` is key-value per domain—handles arbitrary site-specific credentials
- `learned_context` stores facts for potential future optimization (e.g., reducing token usage by referencing stored facts)
- All tables have `user_id` foreign key for future multi-user support

## Testing

### Multi-Agent Spawning

1. **Start the server:**
   ```bash
   cd server
   npm start
   ```

2. **Check agent pool status (should be empty):**
   ```bash
   curl http://localhost:8787/api/agent/status
   ```
   Expected: `{"agents":[],"availablePorts":[5001,5002,5003,5004,5005]}`

3. **Spawn an agent:**
   ```bash
   curl -X POST http://localhost:8787/api/agent/start \
     -H "Content-Type: application/json" \
     -d '{"taskId": "test-1"}'
   ```
   Expected: `{"success":true,"port":5001,"taskId":"test-1"}`

4. **Check status (should show one running agent):**
   ```bash
   curl http://localhost:8787/api/agent/status
   ```

5. **Spawn a second agent:**
   ```bash
   curl -X POST http://localhost:8787/api/agent/start \
     -H "Content-Type: application/json" \
     -d '{"taskId": "test-2"}'
   ```

6. **Stop an agent:**
   ```bash
   curl -X POST http://localhost:8787/api/agent/stop \
     -H "Content-Type: application/json" \
     -d '{"port": 5001}'
   ```

7. **Graceful shutdown:** Press `Ctrl+C` on the server. All running agents are killed automatically.

### Database Operations

1. **Start the server:**
   ```bash
   cd server
   npm start
   ```

2. **Check database was created:**
   ```bash
   ls server/data/
   ```
   Expected: `webchat.db`

3. **Get profile (should be empty initially):**
   ```bash
   curl http://localhost:8787/api/db/profile
   ```

4. **Create/update profile:**
   ```bash
   curl -X POST http://localhost:8787/api/db/profile \
     -H "Content-Type: application/json" \
     -d '{"first_name": "John", "last_name": "Doe", "email": "john@example.com"}'
   ```

5. **Add extra field (e.g., SSN):**
   ```bash
   curl -X POST http://localhost:8787/api/db/profile/extra \
     -H "Content-Type: application/json" \
     -d '{"fieldName": "ssn", "fieldValue": "123-45-6789"}'
   ```

6. **Add site data:**
   ```bash
   curl -X POST http://localhost:8787/api/db/site-data \
     -H "Content-Type: application/json" \
     -d '{"domain": "example.com", "fieldName": "username", "fieldValue": "johndoe"}'
   ```

7. **Get full user data (what agents receive):**
   ```bash
   curl http://localhost:8787/api/db/user-data
   ```

### SSE and Webhooks (Real-Time Communication)

1. **Start the server:**
   ```bash
   cd server
   npm start
   ```

2. **Connect to SSE stream (in a separate terminal, keep running):**
   ```bash
   curl -N http://localhost:8787/api/events
   ```
   Expected: Initial `connected` and `state` events, then stream stays open.

3. **Spawn an agent (in another terminal):**
   ```bash
   curl -X POST http://localhost:8787/api/agent/start \
     -H "Content-Type: application/json" \
     -d '{"taskId": "test-sse"}'
   ```
   Expected: SSE terminal shows no new events yet (webhooks come during execution).

4. **Simulate a webhook (test the endpoint directly):**
   ```bash
   curl -X POST http://localhost:8787/api/agent/webhook \
     -H "Content-Type: application/json" \
     -d '{"port": 5001, "taskId": "test-sse", "sessionId": "sess-1", "status": "started", "message": "Test started"}'
   ```
   Expected: SSE terminal shows `agent-status` event with the data.

5. **Simulate needs_input webhook:**
   ```bash
   curl -X POST http://localhost:8787/api/agent/webhook \
     -H "Content-Type: application/json" \
     -d '{"port": 5001, "taskId": "test-sse", "sessionId": "sess-1", "status": "needs_input", "missingFields": ["ssn", "securityAnswer"]}'
   ```
   Expected: SSE terminal shows both `agent-status` and `needs-input` events.

6. **Check needs_input queue:**
   ```bash
   curl http://localhost:8787/api/agent/needs-input
   ```
   Expected: `{"queue":[{"port":5001,"taskId":"test-sse","sessionId":"sess-1","missingFields":["ssn","securityAnswer"],...}]}`

7. **Stop the agent:**
   ```bash
   curl -X POST http://localhost:8787/api/agent/stop \
     -H "Content-Type: application/json" \
     -d '{"port": 5001}'
   ```

8. **Close the SSE connection:** Press `Ctrl+C` in the SSE terminal.

### Smoke Test

1. Start Crawl4AI: `docker run -p 11235:11235 unclecode/crawl4ai`
2. Start server: `cd server && npm start`
3. Load extension in browser
4. Verify Testing Mode echo works
5. Toggle to AI Mode, verify OpenAI responses
6. Toggle Research Mode, verify Brave Search + iterative reasoning

**Note:** Agent Mode UI is temporarily broken (server API updated, extension not yet updated). Test agent spawning via curl commands above.

## Common Issues

* **`node_modules/` missing:** Run `npm install` in `./server`
* **Agent spawn fails:** Check `WEB_AGENT_PATH` in `.env` points to correct directory
* **Crawl4AI errors:** Ensure Docker container is running on port 11235
* **Extension not updating:** Reload extension at `chrome://extensions` after code changes
