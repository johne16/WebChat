# Web Agent Code Analysis

**Date:** 2026-02-22
**Scope:** All source files in `web_agent/src/` (web_agent.py, action_executor.py, memory.py, llm.py, browser.py, execution_engine.py, agent_service.py, config.py)

---

## 1. Code Efficiency

Ordered from most impactful to least.

### 1.1 Dead Code: `inject_api_functions()` duplicates the direct DOM methods (execution_engine.py)

**Lines:** `execution_engine.py:236-314` vs `execution_engine.py:26-106`

The class has two complete implementations of the same five DOM operations:

- **Direct methods** (lines 26-106): `_fill_field`, `_click_button`, `_select_option`, `_check_checkbox`, `_select_radio`, `_wait_for_element` -- each calls `page.evaluate()` with inline JS.
- **`inject_api_functions()`** (lines 236-314): Defines identical operations as closures and exposes them via `page.expose_function()`.

The JavaScript is character-for-character the same between both sets (compare lines 28-37 with 248-257). `inject_api_functions()` is never called anywhere -- `execute()` dispatches to the direct methods via `_parse_operations()`. This is ~80 lines of dead code from a previous architecture.

**Suggestion:** Delete `inject_api_functions()` entirely.

### 1.2 Copy-pasted response conversion in both endpoints (agent_service.py)

**Lines:** `agent_service.py:174-219` and `agent_service.py:292-337`

Both `execute_goal()` and `continue_session()` contain identical blocks that:
1. Convert `actionHistory` dicts to `ActionHistoryItem` models
2. Convert `errors` dicts to `ErrorDetail` models
3. Build a `MemorySummary` from the result
4. Construct and return `ExecuteGoalResponse`

~45 lines duplicated verbatim.

**Suggestion:** Extract a helper `_build_response(result: dict) -> ExecuteGoalResponse` called from both endpoints.

### 1.3 Redundant `user_profile` parameter threading (web_agent.py, action_executor.py, llm.py)

**Lines:** `web_agent.py:214,304` | `action_executor.py:58-63,86-89,99-102`

The user profile is stored in `self.memory` (web_agent.py:148), but then pulled back out and passed explicitly as a parameter to both `llm.generate_plan()` (line 214) and `action_executor.execute_action()` (line 304). Both read from `self.memory.user_profile` at the call site.

`ActionExecutor` already has a reference to `self.memory` (line 43). Passing `user_profile` separately forces a special-case branch at lines 86-89 where `fill_form` gets an extra argument while all other action types do not.

**Suggestion:** Have `_execute_fill_form` read `self.memory.user_profile` directly. Remove `user_profile` from `execute_action()`. This eliminates the `if action_type == "fill_form"` dispatch branch and makes all handlers uniform.

### 1.4 `_execute_click_link` and `_execute_click_button` are structural clones (action_executor.py)

**Lines:** `action_executor.py:223-269` vs `action_executor.py:271-316`

These two methods follow an identical pattern:
1. Save `current_url`
2. Click via selector or via text with a pseudo-selector
3. Wait for load state
4. Compare URLs
5. Return `ActionResult`

The only differences: element selector prefix (`a:has-text` vs `button:has-text`), the text parameter name (`link_text` vs `button_text`), and the `action_type` string.

**Suggestion:** Extract a shared `_execute_click(params, action_type, text_key, selector_prefix)` helper.

### 1.5 Double truncation of page content (browser.py, web_agent.py)

**Lines:** `browser.py:404` and `web_agent.py:429`

`get_readable_content()` truncates to 3000 chars in the browser JS. `_build_page_context()` then truncates the result to 1500 chars. The browser-side truncation is wasted work.

**Suggestion:** Remove the 3000-char cut in browser.py, or parameterize `get_readable_content(max_length)` so the truncation happens once.

### 1.6 Five identical SQL INSERT statements in `save()` (memory.py)

**Lines:** `memory.py:133-157`

Five sequential `INSERT OR REPLACE INTO memory` statements differ only in the key name and data source.

**Suggestion:** Loop over a list of `(key, data)` tuples.

### 1.7 New `httpx.AsyncClient` per webhook call (web_agent.py)

**Line:** `web_agent.py:90`

`_send_webhook()` creates and tears down an `httpx.AsyncClient` on every call. During the main loop, this happens at minimum once per step (line 366), plus on every terminal state.

**Suggestion:** Create the client once in `__init__` or lazily, reuse it, and close it in the `finally` block.

### 1.8 Regex patterns recompiled every `execute()` call (execution_engine.py)

**Lines:** `execution_engine.py:121-128`

`_parse_operations` builds six regex patterns from raw strings on every invocation. These are constants.

**Suggestion:** Compile them once as class-level attributes using `re.compile()`.

### 1.9 Defensive `.copy()` on properties causes unnecessary allocation (memory.py)

**Lines:** `memory.py:332-355`

Properties `entered_data`, `visited_urls`, `action_history`, `user_profile`, `missing_fields` all return copies. But `get_context_for_llm()` (line 308) reads directly from the private attributes, bypassing the copies. Meanwhile, `web_agent.py:484` calls `self.memory.action_history` (triggering a full list copy) just to iterate once for response building.

**Suggestion:** Provide an iterator or a `format_action_history()` method for the response-building case. Be consistent about which access path is canonical.

### 1.10 Unused `options.headless` never propagated (agent_service.py, web_agent.py)

**Lines:** `agent_service.py:150-155` and `web_agent.py:43-46`

`ExecuteGoalOptions` has a `headless` field, and the `execute_goal` endpoint bundles it into the `options` dict (line 154). But `web_agent.py:execute_goal()` ignores `options["headless"]` entirely -- the browser is initialized in `__init__` using `config.HEADLESS` (line 44), before `execute_goal()` is called.

**Suggestion:** Either remove `headless` from `ExecuteGoalOptions` (since it cannot work), or restructure so the browser is launched lazily with the correct headless setting.

### 1.11 Unused import: `sys` (execution_engine.py)

**Line:** `execution_engine.py:3`

`import sys` is never used.

---

## 2. Readability

### 2.1 Magic strings for goal status across 4 files

**Files:** `web_agent.py:225-298`, `memory.py:43`, `llm.py:244`, `agent_service.py:104`

Goal status is checked via raw strings: `"achieved"`, `"blocked"`, `"needs_input"`, `"awaiting_user_action"`, `"in_progress"`, `"failed"`. A typo in any one location silently fails the match.

**Suggestion:** Define an enum or constants class:
```python
class GoalStatus:
    IN_PROGRESS = "in_progress"
    ACHIEVED = "achieved"
    BLOCKED = "blocked"
    NEEDS_INPUT = "needs_input"
    AWAITING_USER_ACTION = "awaiting_user_action"
    FAILED = "failed"
```

### 2.2 310-line `execute_goal()` method (web_agent.py)

**Lines:** `web_agent.py:98-408`

This single method handles: setup, webhook notifications, session resumption, the main loop, four separate goal-status branches (each building a response and returning), action execution, failure tracking, max-steps exhaustion, exception handling, and browser cleanup.

**Suggestion:** Extract at least:
- `_handle_terminal_status(plan, errors) -> Optional[Dict]` for the four status branches
- `_handle_action_failure(result, errors, consecutive_failures) -> Optional[Dict]` for the failure/bailout logic

### 2.3 Inconsistent error shapes across modules

Different modules return errors in different structures:
- `browser.py:execute_js()` (line 240): `{"success": bool, "result": any, "error": str | None}`
- `execution_engine.py:execute()` (line 343): `{"success": bool, "steps": list, "error": {"type": str, "message": str, "details": dict} | None}`
- `action_executor.py`: `ActionResult` dataclass
- `llm.py:generate_plan()` (line 174): returns a dict with `"goal_status": "blocked"` to encode errors

Four different shapes to memorize when tracing error propagation.

**Suggestion:** Standardize on a common result pattern. `ActionResult` is the cleanest; consider adapting `ExecutionEngine` and `BrowserManager` to something similar.

### 2.4 `_should_close_browser` initialized mid-method, not in `__init__` (web_agent.py)

**Line:** `web_agent.py:133`

This instance attribute appears for the first time inside `execute_goal()`, not in `__init__` alongside the other tracking state. It is set in four different places within the method.

**Suggestion:** Initialize in `__init__` with a default of `True`.

### 2.5 Sentinel strings to signal empty data (browser.py)

**Lines:** `browser.py:192,327,373`

`get_form_elements()` returns `"<p>No forms found on page</p>"`, `get_page_links()` returns `"No links found on page"`, `get_page_buttons()` returns `"No standalone buttons found on page"`. Callers use substring matching to detect these:
- `web_agent.py:433`: `if "No forms found" not in forms`
- `action_executor.py:116`: `if "No forms found" in form_html`

Changing the wording breaks callers silently.

**Suggestion:** Return structured data (empty string, or a tuple with a count) so callers check `if forms:` or `if form_count > 0`.

### 2.6 `print()` instead of `logging` module (all files)

Debug output uses `print()` guarded by `if config.DEBUG:` throughout. No log levels, no per-module filtering, no file output without stdout capture.

**Suggestion:** Use `logging.getLogger(__name__)` per module. Map `config.DEBUG` to the log level at startup.

### 2.7 Large inline JavaScript strings (browser.py, execution_engine.py)

`browser.py` has four JS blocks of 15-30 lines each (lines 76-148, 302-319, 345-365, 391-409). `execution_engine.py` has six (lines 28-106). These are impossible to lint or test independently and clutter the Python logic.

**Suggestion:** Move JS scripts to separate `.js` files in a `scripts/` directory, loaded at class init (same pattern as `llm.py` loading prompts).

---

## 3. Code Organization

### 3.1 `_build_page_context()` belongs in browser.py or a PageAnalyzer module

**Lines:** `web_agent.py:410-454`

This method calls five `browser.*` methods and formats results for the LLM. It is page-analysis logic, not orchestration logic. The `generate_plan()` docstring even references "PageAnalyzer" as the expected source of this data.

**Suggestion:** Move to `browser.py` as `BrowserManager.get_page_context()`, or to a dedicated `page_analyzer.py`.

### 3.2 `_build_planning_context()` couples LLM to memory internals (llm.py)

**Lines:** `llm.py:183-225`

This method destructures `memory_context` by accessing keys like `entered_data`, `visited_urls`, `current_step`, `recent_actions`. This means `llm.py` knows the internal structure of `SessionMemory.get_context_for_llm()`.

**Suggestion:** Either have `SessionMemory.get_context_for_llm()` return a pre-formatted string, or have the caller pre-format the context so `llm.py` receives a string it does not need to parse.

### 3.3 Hardcoded "reusable fields" list (action_executor.py)

**Lines:** `action_executor.py:208-210`

```python
reusable_fields = [
    "email", "password", "firstName", "lastName", "phone",
    "username", "name"
]
```

If the agent encounters `company`, `ssn`, or `dateOfBirth`, those will not be remembered for reuse.

**Suggestion:** Store all non-empty profile fields. The selective filter adds no performance benefit.

### 3.4 Webhook calls spread across orchestration logic (web_agent.py)

**Lines:** `web_agent.py:140,233,253,271,290,352,366,381,398`

Nine `_send_webhook()` calls interspersed throughout the loop.

**Suggestion:** Use an event/observer pattern. The orchestrator emits events; a separate handler translates them to webhook calls.

### 3.5 Agent lifecycle managed inline with no concurrency safety (agent_service.py)

**Lines:** `agent_service.py:165-171,285-289`

The `active_agents` dict is a module-level global modified in both endpoint handlers with no locking. Concurrent requests for the same session create a race condition.

**Suggestion:** Wrap in an `AgentManager` class with an `asyncio.Lock`.

### 3.6 Module-level mutable CLI state (agent_service.py)

**Lines:** `agent_service.py:14-18`

```python
cli_args = argparse.Namespace(port=None, callback_url=None, database_path=None)
```

Set in `__main__`, read in endpoint handlers. Invisible to tests; always `None` when imported as a module.

**Suggestion:** Use FastAPI dependency injection or store in the `config` singleton.

### 3.7 `config.validate()` runs at import time (config.py)

**Lines:** `config.py:73-74`

Raises `ValueError` if `OPENAI_API_KEY` is unset. Any test importing anything from `src` fails unless the env var is present.

**Suggestion:** Move `validate()` to explicit application startup (e.g., the `__main__` block in `agent_service.py`).

### 3.8 `_format_for_llm` uses `field['tag']` in radio/checkbox branch (browser.py)

**Lines:** `browser.py:221-223`

`field['tag']` will always be `"input"` for radio and checkbox, so the output is correct. But the generic `field['tag']` usage in the radio/checkbox branch is misleading -- a reader might wonder if non-input tags could appear here.

**Suggestion:** Minor -- use the literal `"input"` for clarity, or add a brief comment.

---

## Summary Table

| # | Category | Severity | File(s) | Description |
|---|----------|----------|---------|-------------|
| 1.1 | Efficiency | High | execution_engine.py | ~80 lines of dead code (`inject_api_functions`) |
| 1.2 | Efficiency | High | agent_service.py | ~45 lines of copy-pasted response conversion |
| 1.3 | Efficiency | Medium | web_agent.py, action_executor.py | Redundant `user_profile` parameter alongside memory |
| 1.4 | Efficiency | Medium | action_executor.py | `click_link` and `click_button` are structural clones |
| 1.5 | Efficiency | Low | browser.py, web_agent.py | Content truncated twice (3000 then 1500 chars) |
| 1.6 | Efficiency | Low | memory.py | Five identical SQL statements could be a loop |
| 1.7 | Efficiency | Low | web_agent.py | `httpx.AsyncClient` created per webhook call |
| 1.8 | Efficiency | Low | execution_engine.py | Regex patterns recompiled on every `execute()` call |
| 1.9 | Efficiency | Low | memory.py | Defensive `.copy()` in properties; unnecessary allocation |
| 1.10 | Efficiency | Low | agent_service.py, web_agent.py | `options.headless` accepted but never used |
| 1.11 | Efficiency | Low | execution_engine.py | Unused `import sys` |
| 2.1 | Readability | High | Multiple | Magic strings for goal status across 4 files |
| 2.2 | Readability | High | web_agent.py | 310-line `execute_goal()` method |
| 2.3 | Readability | Medium | Multiple | Four different error return shapes |
| 2.4 | Readability | Medium | web_agent.py | `_should_close_browser` not in `__init__`, set in 4 places |
| 2.5 | Readability | Medium | browser.py, callers | Sentinel strings to signal empty data |
| 2.6 | Readability | Low | All files | `print()` instead of `logging` module |
| 2.7 | Readability | Low | browser.py, execution_engine.py | Large inline JavaScript strings |
| 3.1 | Organization | Medium | web_agent.py | `_build_page_context` belongs in browser or PageAnalyzer |
| 3.2 | Organization | Medium | llm.py | Planning context formatting couples LLM to memory internals |
| 3.3 | Organization | Medium | action_executor.py | Hardcoded reusable field names |
| 3.4 | Organization | Medium | web_agent.py | 9 webhook calls interspersed in orchestration logic |
| 3.5 | Organization | Low | agent_service.py | Agent lifecycle managed inline, no concurrency safety |
| 3.6 | Organization | Low | agent_service.py | Module-level mutable CLI state |
| 3.7 | Organization | Low | config.py | `validate()` at import blocks test imports |
| 3.8 | Organization | Low | browser.py | `field['tag']` in radio/checkbox branch obscures that it is always `"input"` |
