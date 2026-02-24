# Phase 5: Refinements

## Summary

Post-migration polish and optimization work. Phases 1-4 established the core architecture (multi-agent spawning, database, webhooks/SSE, extension refactor). This phase focuses on making it faster, more robust, and better to use.

---

## Categories

### A. Performance / Optimization
_Making things faster_

- **Add performance instrumentation to web agent**
  - Measure per-step: LLM call duration, token count (input/output), page extraction time, page context size, action execution time, navigation wait time, step cycle time
  - Measure per-task: total task time, steps taken, wasted steps (failures/retries/redundant)
  - Log to JSONL file (one JSON object per step, human-readable)
  - Use data to identify bottlenecks before making optimization decisions

### B. UI/UX Polish
_Making things look and feel better_

- **Progress in header** (not chat) - applies to both agent and research mode
  - Agent format: `[Agent 1: Filling form... (3/20)] [Stop]`
  - Research format: `[Searching: "query"...]` or `[Fetching: url...]`
  - Sequential agent number (Agent 1, 2, 3...) not port numbers
  - Shows current action + step count (for agent)
  - Appears next to stop button
  - Removes step messages from chat log for both modes

- **Suppress "Starting goal..." on resume**
  - Keep "Continuing with provided information..."
  - Don't show "Starting goal: ..." again when agent resumes after user action
  - Only show "Starting goal..." on initial start

- **Rename header title**
  - Change "Web.Chat" to "WebChat"

### C. Robustness
_Handling edge cases and failures gracefully_

- _TBD_

### D. Code Cleanup
_Technical debt, unused code, consistency_

- **Remove deprecated files**
  - `contentScript.js` and `extraction.js` — old DOM extraction, replaced by Crawl4AI
- **Remove dead alias**
  - `startAgentContainer` export in `agentClient.js` — leftover from Docker approach, nothing imports it

### E. Features
_New capabilities_

- **Chat history context for LLM**
  - Include recent conversation history in LLM calls (simple chat, intent detection)
  - Rolling window: 4000 token limit (user + assistant messages, system prompt excluded)
  - In-memory queue on the server (no database persistence)
  - Trim from front when total tokens exceed 4000
  - Enables natural follow-ups ("Fill it out" after discussing a page)
- **Add Claude API endpoint**
  - Add Anthropic API support alongside OpenAI
  - Modular adapter layer — each provider implements same interface (messages in, response out)
  - User selects provider in settings
- **Remove conversations table from database**
  - Table is no longer needed — conversation history will be in-memory only
  - Remove from `database.js` schema, functions, and server endpoints (`/api/db/conversations`)
- **Headless browser toggle in settings**
  - Add option to settings menu for running agent browser in headless mode
  - Default: `false` (visible browser so user can intervene for captchas, etc.)
  - Extension owns the default; server removes its own `headless: false` default

---

## Implementation Order

**IMPORTANT: Stop between each subphase.** Complete one, stop, test, then continue. Do not proceed to the next subphase without user instruction.

- [x] 1. **Code Cleanup** — remove deprecated files (`contentScript.js`, `extraction.js`), remove dead alias (`startAgentContainer`)
- [x] 2. **Code analysis and cleanup** — run a deep analysis on each subdirectory (`extension/`, `server/`, `web_agent/`) evaluating: (a) code efficiency — redundant parameters, duplicate logic, roundabout implementations that could be simplified; (b) readability — naming, structure, clarity; (c) code organization — module boundaries, file responsibility, misplaced logic. Output a `<directory>_code_analysis.md` file per subdirectory. Review findings and implement agreed-upon improvements.
- [x] 3. **Remove conversations table** — remove from `database.js` schema, functions, and server endpoints
- [x] 4. **Rename header** — change "Web.Chat" to "WebChat"
- [x] 5. **Performance instrumentation** — JSONL metrics logging in web agent
  - [x] 5a. **Define JSONL schema** — two record types:
    - Step record (one per agent step):
      ```json
      {
        "type": "step",
        "sessionId": "abc-123",
        "step": 3,
        "timestamp": "2026-02-23T14:30:01.123Z",
        "action": "fill_form",
        "success": true,
        "goalStatus": "in_progress",
        "timings": {
          "pageExtraction": 0.45,
          "llmPlanning": 1.82,
          "actionExecution": 0.31,
          "navigationWait": 2.10,
          "stepTotal": 4.68
        },
        "tokens": 2060,
        "pageContextSize": 4200,
        "url": "http://example.com/signup"
      }
      ```
    - Task summary record (one per task):
      ```json
      {
        "type": "task_summary",
        "sessionId": "abc-123",
        "timestamp": "2026-02-23T14:30:15.000Z",
        "goal": "Sign up then sign in",
        "finalStatus": "achieved",
        "totalSteps": 5,
        "wastedSteps": {
          "failures": 1,
          "retries": 0,
          "redundant": 0
        },
        "totalTime": 25.4,
        "totalTokens": 8200,
        "avgStepTime": 5.08,
        "avgLlmTime": 1.95
      }
      ```
  - [x] 5b. **Add timing instrumentation** — add timing wrappers in:
    - `browser.py`: time `build_page_context()`, return `pageContextSize` (char count)
    - `llm.py`: time `generate_plan()`
    - `action_executor.py`: time `execute_action()` as a whole, and also time the navigation wait (e.g. `wait_for_load_state`, `wait_for_url`) separately within it — this lets us distinguish slow actions from slow page loads
  - [x] 5c. **Collect metrics in agent loop** — in `web_agent.py`:
    - Time each step cycle (start to finish)
    - Count wasted steps (failed actions, retries, redundant navigations)
    - Accumulate per-step dicts for the logger
  - [x] 5d. **Write metrics logger module** — new `src/metrics.py`:
    - `MetricsLogger` class, initialized with session ID
    - `log_step(step_data: dict)` — appends one JSON line
    - `log_summary(summary_data: dict)` — appends summary line
    - Output file: `logs/{sessionId}.jsonl`
    - Creates `logs/` directory if needed
  - [x] 5e. **Wire into web_agent.py** — instantiate `MetricsLogger` at task start, call `log_step()` after each step, call `log_summary()` in `_build_response()`
- [x] 6. **Chat history context** — in-memory queue on server, 4000 token rolling window
- [x] 7. **Claude API endpoint** — adapter layer, Anthropic API support, settings integration
- [x] 8. **Suppress "Starting goal..." on resume**
- [x] 9. **Progress in header** — header-based progress display for agent and research modes

---

## Analysis-Driven Cleanup

### Server (`server/`)

- [x] **1.** Extract duplicated agent spawn logic into a shared `createAgentProcess()` helper
- [x] **2.** Extract duplicated "continue session" forwarding into a shared helper
- [x] **3.** Remove `headless: false` default from server — extension owns this default via `agentClient.js`
- [x] **4.** Eliminate double `getProfile()` call in `upsertProfile()` — rely on existing SQL `COALESCE`
- [x] **5.** Consolidate `needsInputQueue` removal logic into a shared helper (verify predicate differences first)
- [x] **6.** Remove unnecessary `searchUrl.toString()`
- [x] **7.** Standardize indentation to 4 spaces throughout `server.js`
- [x] **8.** Add `[Crawl]` and `[Search]` log prefixes for consistency
- [x] **9.** Rename server listening `port` variable to `SERVER_PORT` to avoid shadowing
- [x] **10.** Extract magic numbers into named constants (`MAX_BODY_SIZE`, `MAX_AGENT_RESTARTS`)
- [x] **11.** Document unused `getDatabase()` export in `database.js` with a comment explaining it's retained for future direct DB access
- [x] **12.** Add `console.error` to crawl endpoint catch block (currently silent)
- [x] **13.** Split `server.js` into modules: `routes/proxy.js`, `routes/agent.js`, `routes/database.js`, `agentManager.js`
- [x] **14.** Extract SSE state management into its own module
- [x] **15.** Create `withErrorHandler()` and `getUserId()` helpers for DB route boilerplate
- [x] **16.** Move configuration to a dedicated `config.js` module
- [x] **17.** Fix Map mutation during iteration in graceful shutdown — collect keys into array first

### Extension (`extension/`)

- [x] **1.** Extract shared `crawlPage(url)` function to eliminate duplicate Crawl4AI request logic in `llmClient.js` and `react.js`
- [x] **2.** Consolidate domain extraction into a single shared function — `agent.js` and `searchClient.js` have separate implementations with inconsistent error behavior
- [x] **3.** Have `profile.js` import `formatFieldLabel` from `ui.js` instead of defining its own copy
- [x] **4.** Cache `modelType` at module level with `chrome.storage.onChanged` listener instead of reading from storage on every LLM call
- [x] **5.** Define `SERVER_BASE` once in a shared config/constants module — currently hardcoded in 4+ files
- [x] **6.** Create a `callLLM()` helper in `llmClient.js` to encapsulate the repeated fetch/check/parse pattern
- [x] **7.** Create a shared `parseJsonFromLLM()` utility for markdown code block stripping — two different approaches exist in `llmClient.js` and `intent.js`
- [x] **8.** Remove redundant `headless: false` default from `agent.js` — keep it in `agentClient.js` only
- [x] **9.** Consolidate duplicate action verb regex in `intent.js` into a single module-level constant (one copy is missing "sign me up")
- [x] **10.** Merge `addStepMessage` and `addAgentStepMessage` in `ui.js` into one function with a prefix parameter
- [x] **11.** Remove `useReActMode` from `background.js` default settings — dead config, intent detection replaced it
- [x] **12.** Remove `getNeedsInputQueue` from `agentClient.js` — dead code, SSE `state` event already syncs the queue
- [x] **13.** Remove `stopAgentContainer` alias from `agentClient.js` — dead code
- [x] **14.** Remove `export` keyword from functions only used internally: `getProfile` and `lockProfile` in `agent.js`, `isObviouslyNotAgentTask` and `extractUrl` in `intent.js`
- [x] **15.** Change default model to `gpt-5` everywhere — remove stale `gpt-4o-mini` fallbacks in `llmClient.js`
- [x] **16.** Add a named constant or comment for intent detection model in `intent.js` explaining why it's decoupled from user selection
- [x] **17.** Remove redundant `.toLowerCase()` or `/i` flag in `panel.js` confirmation and stop command checks
- [x] **18.** Add error handling around top-level `await` in `panel.js` and `options.js`
- [x] **19.** Extract magic numbers in `react.js` into named constants (`UNHELPFUL_THRESHOLD`, `MIN_ITERATIONS_BEFORE_BAILOUT`)
- [x] **20.** Move `buildContextPrompt` higher in `llmClient.js` — above the functions that call it
- [x] **21.** Add safer error handling in `agentClient.js` — wrap `response.json()` in try/catch to avoid masking HTTP errors
- [x] **22.** Have `intent.js` call through `llmClient.js` instead of making direct LLM API calls
- [x] **23.** Move password modal and stop button DOM logic from `panel.js` to `ui.js`
- [x] **24.** Create a session-filtering guard function for SSE event handlers to eliminate duplication in `panel.js`
- [x] **25.** Fix `options.js` to pre-select the stored model radio button on page load (bug)
- [x] **26.** Merge `unload` and `beforeunload` handlers in `panel.js` into a single `beforeunload` handler
- [x] **27.** Add a small DOM helper (e.g., `el(tag, className, text)`) to reduce boilerplate in `profile.js` `renderSiteData`

### Web Agent (`web_agent/`)

- [x] **1.** Delete dead `inject_api_functions()` in `execution_engine.py` — ~80 lines of unused code from previous architecture
- [x] **2.** Extract shared `_build_response()` helper in `agent_service.py` — ~45 lines of copy-pasted response conversion between `execute_goal` and `continue_session`
- [x] **3.** Remove redundant `user_profile` parameter from `execute_action()` — `ActionExecutor` already has access via `self.memory`
- [x] **4.** Merge `_execute_click_link` and `_execute_click_button` into a shared `_execute_click()` helper in `action_executor.py`
- [x] **5.** Remove double truncation of page content — browser.py truncates to 3000 chars, web_agent.py truncates again to 1500
- [x] **6.** Replace five identical SQL INSERT statements with a loop in `memory.py:save()`
- [x] **7.** Reuse `httpx.AsyncClient` across webhook calls instead of creating/tearing down per call
- [x] **8.** Compile regex patterns once as class-level attributes in `execution_engine.py` instead of per `execute()` call
- [x] **9.** Add `iter_action_history()` iterator and `format_action_history()` method to `memory.py` to avoid unnecessary `.copy()` on property access
- [x] **10.** Propagate `headless` option from `ExecuteGoalOptions` through to `BrowserManager` — add `headless` parameter to `BrowserManager.__init__()` and `launch()`, pass through from `WebAgent`
- [x] **11.** Remove unused `import sys` in `execution_engine.py`
- [x] **12.** Define a `GoalStatus` enum or constants class — magic strings for status spread across 4 files
- [x] **13.** Break up 310-line `execute_goal()` into smaller methods
- [x] **14.** Standardize error return shapes across modules — currently four different formats
- [x] **15.** Move `_should_close_browser` initialization to `__init__`
- [x] **16.** Replace sentinel strings in `browser.py` with structured return data — callers currently use fragile substring matching
- [x] **17.** Replace `print()` with `logging` module across all files
- [x] **18.** Move inline JS strings to constants at the top of `browser.py` and `execution_engine.py`
- [x] **19.** Move `_build_page_context()` from `web_agent.py` to `browser.py` as a `BrowserManager` method
- [x] **20.** Decouple `_build_planning_context()` in `llm.py` from `SessionMemory` internal structure
- [x] **21.** Remove hardcoded reusable field names in `action_executor.py` — store all non-empty profile fields instead
- [x] **22.** Add a code comment near webhook calls in `web_agent.py` noting that an event/observer pattern should be considered if additional notification channels are needed
- [x] **23.** Wrap `active_agents` dict in an `AgentManager` class with `asyncio.Lock` for concurrency safety
- [x] **24.** Move CLI arg state from module-level mutable namespace to a config dataclass on `app.state` via FastAPI dependency injection
- [x] **25.** Move `config.validate()` from import time to explicit application startup

---

## Discovered Issues During Testing

_Bugs and issues found during Phase 4 testing that we fixed:_

1. Unicode characters (✓/✗) causing encoding errors on Windows - replaced with OK/FAIL
2. Browser closing when `awaiting_user_action` - added `_should_close_browser` flag
3. Agent session not clearing on terminal states - added `clearAgentSession()`
4. LLM not recognizing user's radio button selection - updated planning prompt
5. `fill_form` generating bad code for already-selected radios - use `click_button` instead
6. `max_completion_tokens` too low (1000) - increased to 2000
7. `input-provided` broadcasting when agent still needs input - added status check

---

## Notes

_Design decisions and rationale as we go_

