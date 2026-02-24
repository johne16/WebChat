# Server Code Analysis

**Scope:** `server/server.js` (827 lines) and `server/database.js` (285 lines)
**Date:** 2026-02-22

---

## 1. Code Efficiency (Primary Metric)

### 1.1 Duplicated Agent Spawn Logic (HIGH)

**Files:** `server/server.js:218-265` and `server/server.js:281-303`

The `spawnAgent()` function and the restart block inside `handleAgentExit()` contain nearly identical process-spawning logic. Both:
- Call `spawn()` with the same arguments (`AGENT_CONFIG.pythonPath`, `-u`, `-m`, `src.agent_service`, `--port`, `--callback-url`, `--database-path`)
- Wire up identical `stdout.on("data")` and `stderr.on("data")` handlers
- Set up identical timeout handles

The restart block at lines 281-303 is a copy-paste of lines 218-246 with minor variations. This means any change to the spawn arguments, logging format, or stdio handling must be replicated in two places.

**Suggestion:** Extract a helper function like `createAgentProcess(port, taskId)` that returns the spawned process with its stdio listeners already wired. Both `spawnAgent()` and `handleAgentExit()` would call this helper.

### 1.2 Duplicate "Continue Session" Logic (MEDIUM)

**Files:** `server/server.js:406-433` (`/api/agent/continue`) and `server/server.js:572-612` (`/api/agent/provide-input`)

Both endpoints forward requests to the same Python agent endpoint:
```
http://localhost:${port}/api/session/${sessionId}/continue
```

The `/api/agent/provide-input` endpoint (line 589) and the `/api/agent/continue` endpoint (line 416) both construct nearly identical `fetch` calls. The only material difference is that `provide-input` also manages the `needsInputQueue` and broadcasts an SSE event. The core forwarding logic -- building the fetch, checking response, parsing JSON -- is duplicated.

**Suggestion:** Extract a `forwardContinueToAgent(port, sessionId, additionalData)` helper that both endpoints call. The `provide-input` endpoint would wrap it with its queue management and SSE broadcast.

### 1.3 Redundant `options.headless` Default Set Twice (LOW)

**Files:** `server/server.js:379` and `extension/agentClient.js:179`

The `{ headless: false, ...options }` default is applied in both the client (`agentClient.js:179`) and the server (`server.js:379`). When the client sends the request, it already sets `headless: false`. The server then overwrites `options` with `{ headless: false, ...options }` again. This is harmless but redundant -- one location should own the default.

**Suggestion:** Choose one location (ideally the server, since it is the authoritative executor) to set the default, and remove the duplication from the client.

### 1.4 `getProfile()` Called Twice in `upsertProfile()` (LOW)

**File:** `server/database.js:122-162`

`upsertProfile()` calls `getProfile(userId)` at line 123 to read the existing record, then at line 161 calls `getProfile(userId)` again to return the updated record. The first call is only needed to preserve existing `extra_fields` when the incoming data does not provide them (line 126-127). The SQL `ON CONFLICT ... DO UPDATE SET` with `COALESCE` already handles preservation of all other fields, so `extra_fields` could be handled in SQL as well, eliminating the first query.

**Suggestion:** Use `COALESCE(excluded.extra_fields, extra_fields)` in the SQL (which is already there at line 144), and pass `data.extra_fields ? JSON.stringify(data.extra_fields) : null` directly. The `COALESCE` in the ON CONFLICT clause already does the right thing. The first `getProfile()` call then becomes unnecessary.

### 1.5 `needsInputQueue` Removal Logic Duplicated (LOW)

**Files:** `server/server.js:554-560` (webhook handler) and `server/server.js:581-584` (provide-input handler)

Both the webhook handler and the provide-input handler search the `needsInputQueue` array by port/sessionId and splice out the matching entry. This is a small duplication, but the search predicates differ slightly (`item.port === port` vs. `item.port === port && item.sessionId === sessionId`), which could lead to subtle bugs if entries are not cleaned up consistently.

**Suggestion:** Extract a `removeFromInputQueue(port, sessionId = null)` helper that handles both cases.

### 1.6 Unnecessary `searchUrl.toString()` (TRIVIAL)

**File:** `server/server.js:115`

`fetch(searchUrl.toString(), ...)` -- the `fetch` API accepts a `URL` object directly, so `.toString()` is unnecessary.

---

## 2. Readability

### 2.1 Inconsistent Indentation Within `server.js` (HIGH)

**File:** `server/server.js`

The file uses **mixed indentation styles** within the same file:
- Lines 39-61 (OpenAI endpoint): 4-space indentation
- Lines 64-92 (Crawl endpoint): tab indentation
- Lines 96-134 (Search endpoint): tab indentation
- Lines 166-177 (broadcastSSE): 4-space indentation
- Lines 334-350 (agent/start): 4-space indentation
- Lines 620-628 (DB endpoints): 4-space indentation

The CLAUDE.md project conventions say `extension/` uses tabs and server code uses 4 spaces, but `server.js` itself mixes both. The crawl and search endpoints appear to have been written (or pasted) with tabs while the rest uses spaces.

**Suggestion:** Standardize the entire file to 4-space indentation per the project convention. This is a one-time reformatting.

### 2.2 Inconsistent Console Log Prefixes (MEDIUM)

**File:** `server/server.js`

The log prefix convention is inconsistent across endpoints:
- Lines 42-55: `[OpenAI]` prefix
- Lines 66-87: No prefix -- bare `"Received crawl request:"`, `"Crawl successful"`
- Lines 98-132: No prefix for some (`"Received search request:"`), prefixed for the error (`"Search error:"`)
- Lines 212-264: `[Agent]` and `[Agent:${port}]` prefix (well done)
- Lines 491-517: `[SSE]` prefix (well done)
- Lines 620-790: `[DB]` prefix (well done)

The crawl and search endpoints stand out as having been written earlier, before the `[Prefix]` convention was established.

**Suggestion:** Add `[Crawl]` and `[Search]` prefixes to the crawl and search endpoints for consistency. For example, line 66 should read `console.log("[Crawl] Received request:", req.body);`.

### 2.3 Variable Shadowing of `port` (MEDIUM)

**File:** `server/server.js:797` and throughout

The Express server's listening port is declared as `const port = process.env.PORT || 8787;` at line 797. However, `port` is also used extensively as a function parameter and local variable throughout the agent management section (lines 207, 269, 312, 334, etc.) and in route parameter destructuring. While JavaScript scoping prevents actual collision, reading the file from top to bottom creates confusion about which `port` is which.

**Suggestion:** Rename the server listening port variable to `SERVER_PORT` or `listenPort` to distinguish it from agent port references.

### 2.4 Magic Numbers Without Named Constants (LOW)

**File:** `server/server.js`

- Line 31: `"2mb"` -- JSON body size limit. Not clear why 2MB was chosen or if this is tuned for Crawl4AI response forwarding.
- Line 276: `agent.restartCount < 1` -- the max restart count of 1 is embedded in a conditional. Should be a named constant like `MAX_AGENT_RESTARTS`.

**File:** `server/database.js`
- Line 219: `limit = 100` default for conversation retrieval. Not clear if this aligns with the extension's expectations.

**Suggestion:** Define named constants at the top of the file for these values (e.g., `MAX_BODY_SIZE`, `MAX_AGENT_RESTARTS`, `DEFAULT_CONVERSATION_LIMIT`).

### 2.5 The `getDatabase()` Function is Exported but Never Used (LOW)

**File:** `server/database.js:93-98`

`getDatabase()` is exported but not imported or used anywhere in the codebase. All database operations go through the specific exported functions (`getProfile`, `upsertProfile`, etc.) which access the module-level `db` variable directly.

**Suggestion:** Either remove the dead export or add a comment explaining it is part of the public API for future consumers (e.g., tests or new modules).

### 2.6 Unclear Error Conversion Pattern (LOW)

**File:** `server/server.js` -- lines 59, 90, 132, 401, 431, 454, 610, and many more

`String(err)` is used in all error responses. For `Error` objects this produces `"Error: message"`, but for non-Error values it could produce misleading output. More importantly, this discards the stack trace entirely, which is fine for the client response but the corresponding `console.error` calls on some routes include the full error while others do not:
- Line 58: `console.error("[OpenAI] Error:", err);` -- logs full error with stack
- Line 90: No console.error at all -- silent failure for crawl errors
- Line 131: `console.error("Search error:", err);` -- logs full error

**Suggestion:** Every `catch` block should include a `console.error` with the full error object for server-side debugging. The crawl endpoint (line 89-91) notably lacks this.

---

## 3. Code Organization

### 3.1 `server.js` is Doing Too Many Things (HIGH)

**File:** `server/server.js` -- 827 lines

The file currently contains five distinct responsibilities:
1. **External API proxies** (lines 38-134): OpenAI, Crawl4AI, Brave Search
2. **Agent process management** (lines 137-327): spawn, kill, restart, health checks
3. **Agent API endpoints** (lines 329-612): HTTP routes for agent lifecycle
4. **Database API endpoints** (lines 614-791): CRUD routes for all database tables
5. **Server lifecycle** (lines 793-827): startup, shutdown, signal handling

Each of these is a cohesive unit that could be its own module. The file is already 827 lines and growing -- the agent section alone (lines 137-612) is ~475 lines.

**Suggestion:** Extract into separate modules:
- `routes/proxy.js` -- OpenAI, Crawl4AI, and Brave Search proxy routes
- `routes/agent.js` -- Agent API endpoints (depends on agentManager)
- `routes/database.js` -- Database CRUD endpoints
- `agentManager.js` -- Agent process lifecycle (spawn, kill, restart, health, SSE broadcast)

Then `server.js` becomes a thin orchestrator:
```js
import { createProxyRoutes } from "./routes/proxy.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createDatabaseRoutes } from "./routes/database.js";
// ... mount routes, start server
```

### 3.2 SSE State Management Mixed Into `server.js` (MEDIUM)

**File:** `server/server.js:155-177` and `server/server.js:489-518`

The SSE client tracking (`sseClients` Set), `broadcastSSE()` function, `needsInputQueue` array, and the `/api/events` endpoint are all scattered through `server.js`. These form a cohesive "real-time notification" concern that is entangled with agent process management.

**Suggestion:** Group the SSE infrastructure into a dedicated module (e.g., `sse.js` or within the proposed `agentManager.js`) that exports `broadcastSSE`, `addClient`, `removeClient`, and `getNeedsInputQueue`.

### 3.3 Database Route Handlers Are Boilerplate-Heavy (MEDIUM)

**File:** `server/server.js:614-791`

The ~180 lines of database endpoints follow an identical pattern:
1. `try {`
2. Parse userId from `req.query` or `req.body`
3. Call the corresponding `database.js` function
4. Return JSON
5. `} catch (err) { console.error(...); res.status(500).json({ error: String(err) }); }`

Every single handler follows this pattern. The userId parsing (`parseInt(req.query.userId) || 1` or `parseInt(req.body.userId) || 1`) is repeated 11 times across GET and POST handlers.

**Suggestion:** Create a `withErrorHandler(fn)` wrapper and a `getUserId(req)` helper to eliminate the repetitive try/catch and userId parsing:

```js
function getUserId(req) {
    return parseInt(req.query.userId || req.body?.userId) || 1;
}

function withErrorHandler(label, fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            console.error(`[DB] ${label} error:`, err);
            res.status(500).json({ error: String(err) });
        }
    };
}
```

### 3.4 Agent Configuration Could Live in a Separate Config Module (LOW)

**File:** `server/server.js:142-150`

`AGENT_CONFIG` is a top-level constant that mixes environment-driven values (`process.env.WEB_AGENT_PATH`, `process.env.WEB_AGENT_PYTHON`) with hardcoded defaults. As the application grows, having all configuration (ports, paths, timeouts) in one place would be cleaner.

**Suggestion:** Move to a `config.js` module that exports all configuration values, making it easier to find and modify settings.

### 3.5 Graceful Shutdown Calls `killAgent` Which Deletes From Map During Iteration (LOW)

**File:** `server/server.js:815-818`

```js
for (const [agentPort] of agentsByPort) {
    console.log(`[Server] Killing agent on port ${agentPort}`);
    killAgent(agentPort);
}
```

`killAgent()` at line 324 calls `agentsByPort.delete(port)`, which mutates the Map while iterating over it. In JavaScript, deleting a Map entry during `for...of` iteration is technically safe per spec (the entry is simply skipped if not yet visited, or ignored if already visited), but it is fragile and surprising. A reader has to verify the behavior is correct.

**Suggestion:** Collect ports into an array first (`[...agentsByPort.keys()]`), then iterate the array to kill each agent.

### 3.6 `database.js` Organization is Good

**File:** `server/database.js`

For completeness: `database.js` is well-organized. Functions are grouped by domain (Profile, Site Data, Conversations, Learned Context) with clear section dividers. Each function has a single responsibility. The module cleanly exports individual operations rather than exposing the raw `db` handle. No significant organizational issues.

---

## Summary

| Category | Issue | Severity | Location |
|---|---|---|---|
| **Efficiency** | Duplicated agent spawn logic | HIGH | server.js:218-265, 281-303 |
| **Efficiency** | Duplicate "continue session" forwarding | MEDIUM | server.js:406-433, 572-612 |
| **Efficiency** | Redundant `headless: false` default | LOW | server.js:379, agentClient.js:179 |
| **Efficiency** | Double `getProfile()` call in upsert | LOW | database.js:123, 161 |
| **Efficiency** | Duplicated queue removal logic | LOW | server.js:554-560, 581-584 |
| **Readability** | Mixed tabs/spaces in server.js | HIGH | server.js throughout |
| **Readability** | Inconsistent log prefixes | MEDIUM | server.js:66-87, 98-132 |
| **Readability** | `port` variable shadowing | MEDIUM | server.js:797 vs. agent functions |
| **Readability** | Magic numbers | LOW | server.js:31, 276 |
| **Readability** | Unused `getDatabase()` export | LOW | database.js:93-98 |
| **Readability** | Silent error in crawl endpoint | LOW | server.js:89-91 |
| **Organization** | server.js has 5 distinct responsibilities | HIGH | server.js (827 lines) |
| **Organization** | SSE state scattered through server.js | MEDIUM | server.js:155-177, 489-518 |
| **Organization** | Boilerplate-heavy DB route handlers | MEDIUM | server.js:614-791 |
| **Organization** | Config mixed into server.js | LOW | server.js:142-150 |
| **Organization** | Map mutation during iteration in shutdown | LOW | server.js:815-818 |

### Priority Recommendations (ordered by impact)

1. **Extract duplicated spawn logic** into a shared helper -- eliminates the highest-risk duplication in the codebase.
2. **Split server.js into modules** -- the file is 827 lines with five unrelated responsibilities. Extracting routes and agent management would make each piece independently readable and testable.
3. **Standardize indentation and log prefixes** -- low effort, high readability payoff across the entire file.
4. **Create error-handling and userId-parsing helpers** for the DB routes -- reduces ~180 lines of boilerplate to ~60.
5. **Extract "continue session" forwarding** to a shared helper to remove the second-largest duplication.
