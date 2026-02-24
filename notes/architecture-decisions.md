# WebChat Architecture Decisions

## Summary

**Architecture in one sentence:** Server is the hub—spawns multiple autonomous agents via child_process, owns a SQLite database (agents read, server writes), communicates via webhooks/SSE, while the extension handles UI only.

**Key changes:**
1. Multi-agent support (up to 5 concurrent, ports 5001-5005, 10 min timeout)
2. SQLite database for profile, site data, conversation history, learned context
3. Webhooks for agent→server, SSE for server→extension
4. Remove modes—LLM detects intent, confirms before spawning agents
5. Modular LLM adapters (OpenAI + Claude, designed for future routing)
6. Split panel.js into focused modules

**Migration order:**
1. Multi-agent spawning
2. Database
3. Communication (webhooks + SSE)
4. Extension refactor

**IMPORTANT: Stop between phases.** Each phase is a testable milestone. Complete phase, stop, test, then continue. Do not plow through all phases at once.

---

## Phase Completion Checklists

### Phase 1: Multi-Agent Spawning ✅ COMPLETE

- [x] WEB_AGENT accepts `--port` CLI arg
- [x] WEB_AGENT accepts `--callback-url` CLI arg
- [x] WEB_AGENT accepts `--database-path` CLI arg
- [x] Server spawns agent processes via child_process
- [x] Server tracks agents in `agentsByPort` Map
- [x] Port pool management (5001-5005)
- [x] 10-minute timeout per agent
- [x] Crash handling with one restart attempt
- [x] Graceful shutdown kills all agents
- [x] `/api/agent/start` spawns new agent
- [x] `/api/agent/stop` kills agent process
- [x] `/api/agent/status` lists running agents
- [x] Tested via curl commands
- [x] README updated

### Phase 2: Database ✅ COMPLETE

- [x] SQLite database created at `server/data/webchat.db`
- [x] Schema for profile, site data, conversation history, learned context
- [x] Server reads/writes database via `database.js` module
- [x] Database API endpoints (`/api/db/*`)
- [x] `execute-goal` merges DB profile with request data
- [x] README updated with endpoints and test commands
- [x] Tested

### Phase 3: Communication (webhooks + SSE) ✅ COMPLETE

- [x] Agents POST status updates to server callback URL
- [x] Server receives webhook status updates
- [x] Server pushes updates to extension via SSE
- [x] Extension subscribes to SSE stream (agentClient.js)
- [x] `needs_input` queue working
- [x] Tested

### Phase 4: Extension Refactor ✅ COMPLETE

- [x] Split panel.js into modules (ui.js, agent.js, intent.js)
- [x] Remove mode toggles (simple/research/agent) from panel.html and options
- [x] LLM-driven intent detection with heuristic bypass
- [x] Confirmation before spawning agents (text prompt, voice-compatible)
- [x] Update agentClient.js for new server API (agent spawning)
- [x] Update panel.js to work with new agent flow
- [x] Connect to SSE on startup, handle `state` event to sync pending `needs_input` queue
- [x] Handle SSE reconnect: track last-seen timestamp locally, compare against queue item timestamps to avoid duplicate alerts
- [x] Tested

---

## 1. Multi-Agent Spawning

### 1.1 How does WEB_AGENT receive its port?

**Current behavior:** currently it's an env variable with a hardcoded fallback in the parameter

**Change needed (if any):** make it a command line parameter

### 1.2 WEB_AGENT changes required for Phase 1

WEB_AGENT needs modifications to support multi-agent spawning:
- Accept `--port` CLI arg (for dynamic port assignment)
- Accept `--callback-url` CLI arg (so agent knows where to POST status updates)
- Accept `--database-path` CLI arg (so agent can read profile/site data from SQLite)

---

### 1.3 Where does WEB_AGENT live?

**Path relative to WebChat server:** C:\Users\John\PycharmProjects\WEB_AGENT

---

### 1.4 Port pool

**Range:** 5001-5005

**Max concurrent agents:** 5

**Rationale:** mostly browser instances but memory constraints might be an issue

---

### 1.5 Agent timeout

**Max task duration:** 10 minutes

**On timeout:** kill process

---

### 1.6 Agent crash handling

**If agent process dies unexpectedly:**
- [ ] Free the port, notify user of failure
- [x] Attempt restart once
- [ ] Other: _[fill in]_

---

## 2. Tool Access

### 2.1 Crawl4AI access pattern

**Current:** Server calls Crawl4AI

**Options:**
- [ ] **A: Shared** — Both server and agents call same Crawl4AI instance (port 11235)
- [x] **B: Server-only** — Agents use playwright already
- [ ] **C: Agent-only** — Only agents use Crawl4AI, server uses something else for simple mode


---

### 2.2 LLM access

**Who calls OpenAI/Claude?**
- [ ] Server only (agents request LLM calls through server)
- [ ] Agents directly (agents have API key access)
- [x] Both (current model)

---

### 2.3 Search access

**Who calls Brave Search?**
- [x] Server only
- [ ] Agents directly
- [ ] Both


---

## 3. Communication

### 3.1 How do agents report status back?

**Options:**
- [x] **Webhooks** — Agent POSTs to server endpoint on state change
- [ ] **WebSocket** — Persistent bidirectional connection
- [ ] **Polling** — Server polls agent health/status endpoint
- [ ] **Current model** — Server waits for HTTP response (blocking)

**Rationale:** I want multiple agents able to operate simultaneously

---

### 3.2 How does UI track multiple tasks?

**Options:**
- [x] **Server-Sent Events (SSE)** — Server pushes updates to extension
- [ ] **WebSocket** — Bidirectional, extension subscribes to task updates
- [ ] **Polling** — Extension polls server for task statuses
- [ ] **Current model** — Single task, no tracking needed

---

### 3.3 Handling `needs_input` for multiple agents

**Scenario:** Agent 1 needs SSN, Agent 2 needs security question answer

**UI approach:**
- [x] Queue inputs, show one at a time
- [ ] Show all pending inputs simultaneously
- [ ] Per-task chat threads
- [ ] Other: _[fill in]_

---

## 4. User Profile

### 4.1 Where does encryption/decryption happen?

**Current:** Extension (crypto.js)

**Options:**
- [ ] **Keep in extension** — Server never sees plaintext profile
- [ ] **Move to server** — Server handles crypto, extension just stores blob
- [x] **Defer** — Server sees plaintext for now; address encryption before sharing with users

**Rationale:** we'll figure out something for encryption when the project is almost entirely done. For now, server has access to plaintext profile data in the database.

---

### 4.2 How do agents access profile data?

**Current:** Profile sent with each goal request

**Options:**
- [ ] **Per-request** — Include profile in goal payload (current)
- [x] **Session-based** — Server holds decrypted profile for session duration
- [ ] **Agent-stored** — Agent receives profile once, holds in memory


---

### 4.3 Site data persistence during multi-agent tasks

**Scenario:** Agent 1 learns user's SSN, Agent 2 needs it too

**Options:**
- [x] **Immediate sync** — Server handles writes to profile database, Agents only read from database
- [ ] **End-of-task sync** — Each agent saves at completion, merged later
- [ ] **Server-mediated** — Server holds session data, agents query server

**Rationale**: server is the only one that can write to the database. if agent asks for additional information, server requests the information in chat and then let's the agent know the data is available.

---

## 5. Shared Memory Database

### 5.1 Use a shared database?

**Current:** Profile sent with each request, agents are stateless

**Options:**
- [ ] **No database** — Keep current model (profile in request payload)
- [x] **SQLite** — File-based, no extra service, simple
- [ ] **Redis** — In-memory, fast, requires separate service
- [ ] **Server memory** — Server holds data in RAM, lost on restart


---

### 5.2 What data lives in the database?

Check all that apply:

- [x] User profile (name, email, phone, SSN, etc.)
- [x] Site-specific data (username, password, security answers, etc.)
- [x] Session/conversation history
- [ ] Task state (running tasks, status)
- [x] Learned context (facts the assistant has learned)

**Notes:** task state can be dropped once tasks are completed.

---

### 5.3 Who reads and writes?

| Component | Read | Write |
|-----------|------|-------|
| Server | [x]  | [x]   |
| Agents | [x]  | [ ]   |


**Notes:** agents read-only, server handles all writes

---

### 5.4 Encryption at rest?

**Options:**
- [ ] **No encryption** — Database file is plaintext (simpler)
- [ ] **Encrypt sensitive fields** — Only PII/credentials encrypted
- [ ] **Encrypt entire database** — SQLCipher or similar
- [x] **Defer decision** — Address before sharing with users

---

### 5.5 Database location

**Options:**
- [x] `server/data/webchat.db`
- [ ] User's home directory (e.g., `~/.webchat/data.db`)
- [ ] Configurable via environment variable
- [ ] Other: _[fill in]_

**Choice:** # server/.env
  DATABASE_PATH=./data/webchat.db   # easy to change later

---

## 6. Server Architecture

### 6.1 Keep current endpoints or redesign?

**Current endpoints:**
- `/api/openai/chat`
- `/api/crawl`
- `/api/search`
- `/api/agent/start`
- `/api/agent/execute-goal`
- `/api/agent/continue`
- `/api/agent/stop`
- `/api/agent/health/:port`

**Options:**
- [ ] **Keep** — Add new endpoints alongside existing
- [x] **Redesign** — New unified API (e.g., `/api/message`, `/api/tasks`)
- [ ] **Phased** — Keep old, add new, deprecate old later

**Choice:** I'm specifically thinking we should rename the crawl api endpoint so that we can add more crawl4ai tools later, if needed. right now it only calls fetch on a single page so it's kinda misnamed currently anyway

---

### 6.2 Session management

**Current:** Extension tracks session state

**Options:**
- [ ] **Server-side sessions** — Server owns conversation/task state
- [ ] **Extension-side** — Keep current model
- [x] **Hybrid** — Extension owns UI state, server owns task state

**Rationale:** it's the cleaner option in case of future access point scaling

---

### 6.3 Process manager

**How does server spawn/track agent processes?**

**Options:**
- [x] **Node child_process** — `spawn('python', ['app.py', '--port', port])`
- [ ] **Docker containers** — `docker run -p ${port}:${port} web-agent`
- [ ] **PM2 or similar** — Process manager handles lifecycle
- [ ] **Systemd/launchd** — OS-level service management

---

## 7. Extension Refactoring

### 7.1 What happens to panel.js?

**Current:** 600-line god object handling UI, modes, crypto, agent lifecycle

**Options:**
- [x] **Split now** — Break into modules as part of this work
- [ ] **Split later** — Focus on server/agent architecture first
- [ ] **Minimal changes** — Only change what's necessary for multi-agent

---

### 7.2 Mode system

**Current:** Simple, Research, Agent modes with interleaved conditionals

**Options:**
- [ ] **Keep modes** — Just add multi-task tracking
- [ ] **Merge modes** — Server decides how to handle each message
- [x] **Remove modes** — Single unified experience

**Choice:** use LLM-driven intent detection with confirmation before agent actions

---

## 8. LLM Provider

### 8.1 Which LLM to use?

**Current:** OpenAI (gpt-4o-mini default)

**Options:**
- [ ] **Keep OpenAI** — No change
- [ ] **Switch to Claude** — Anthropic API
- [x] **Support both** — User selects in settings
- [ ] **Model routing** — Different models for different tasks

**Choice:** Support both, user selects in settings

**Rationale:** Design LLM integration as a modular adapter layer. Each provider (OpenAI, Anthropic, etc.) implements same interface (messages in, response out). This enables future model routing without rewrite—routing logic just sits in front of adapters and decides which to call based on task type.

---

## 9. Open Questions

1. We're going to tackle data encryption after the project is completely finished
2. Docker dependency for deployment — need to run Crawl4AI containers without Docker Desktop (options: Docker Engine in WSL2, Podman, remote Docker host)

## 9.1 Out of Scope

1. **Concurrent access points** — The extension assumes a single user with a single access point (one browser window). Multiple simultaneous clients connecting to the same server is explicitly not supported. This avoids distributed systems complexity (claim/lock systems, race conditions, state sync across clients) that's outside the spirit of the project.

---

## 10. Future Considerations

### 10.1 Multi-User Support

**Current state:** Database schema is multi-user ready (all tables have `user_id` foreign keys, all functions accept `userId` parameter). Currently hardcoded to user ID 1.

**Transition path:**
1. Add authentication layer (JWT, sessions, or OAuth)
2. Add auth middleware to extract user ID from token
3. Pass `req.userId` to database functions instead of default

**What doesn't change:**
- Database schema
- Database functions (already parameterized)
- Data isolation (already per-user)

**Estimated effort:** Medium. Auth is the main work, but it's a well-understood problem. Database layer is ready.
