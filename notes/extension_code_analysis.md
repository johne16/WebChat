# Extension Code Analysis

Deep code analysis of the `extension/` directory covering 12 files: `panel.js`, `ui.js`, `agent.js`, `intent.js`, `agentClient.js`, `llmClient.js`, `react.js`, `searchClient.js`, `crypto.js`, `profile.js`, `background.js`, `options.js`.

---

## 1. Code Efficiency (Most Important)

### 1.1 Duplicate Crawl4AI Request Logic

**Files:** `llmClient.js:12-23` and `react.js:170-182`

Both `sendToBot()` in `llmClient.js` and `executeFetchURL()` in `react.js` construct nearly identical Crawl4AI requests with the same `crawler_config` object:

```js
// llmClient.js:12-23
const crawlRes = await fetch('http://localhost:8787/api/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        urls: [currentURL],
        crawler_config: {
            exclude_external_links: true,
            remove_overlay_elements: true,
            word_count_threshold: 10
        }
    })
});

// react.js:170-182
const response = await fetch('http://localhost:8787/api/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        urls: [url],
        crawler_config: {
            exclude_external_links: true,
            remove_overlay_elements: true,
            word_count_threshold: 10
        }
    })
});
```

**Suggestion:** Extract a shared `crawlPage(url)` function (likely in a new `crawlClient.js` or within `llmClient.js`) that both call sites can reuse. This eliminates the risk of the two copies drifting out of sync when crawler config changes.

---

### 1.2 Duplicate Domain Extraction Functions

**Files:** `agent.js:207-214` and `searchClient.js:88-96`

Two separate implementations of the exact same domain-extraction logic:

```js
// agent.js:207-214
function getDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

// searchClient.js:88-96
function extractRootDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        console.error('[SearchClient] Failed to extract domain from URL:', url, error);
        return null;
    }
}
```

The only differences are: (a) the name, (b) one logs an error while the other silently returns the raw URL, (c) one returns `null` on failure and the other returns the original string. These behavioral differences are likely unintentional and represent a latent bug -- the callers probably expect consistent fallback behavior.

**Suggestion:** Create a single shared utility, e.g., `extractDomain(url)` in a utility module, with a consistent failure contract (return `null`).

---

### 1.3 Duplicate `formatFieldLabel` Function

**Files:** `ui.js:61-67` and `profile.js:179-185`

Identical implementations:

```js
// ui.js:61-67
export function formatFieldLabel(fieldName) {
    return fieldName
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .replace(/_/g, ' ')
        .trim();
}

// profile.js:179-185
function formatFieldLabel(fieldName) {
    return fieldName
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .replace(/_/g, ' ')
        .trim();
}
```

**Suggestion:** `profile.js` should import `formatFieldLabel` from `ui.js` (it is already exported) or both should share a utility module. Having the same function defined twice is a maintenance hazard.

---

### 1.4 Repeated `chrome.storage.local.get('modelType')` Calls

**Files:** `llmClient.js:6`, `llmClient.js:69`, `llmClient.js:149`

Every LLM function (`sendToBot`, `askLLMToThink`, `askLLMToAnswer`) independently reads `modelType` from storage:

```js
// llmClient.js:6
const { modelType } = await chrome.storage.local.get('modelType');
const model = modelType || 'gpt-4o-mini';

// llmClient.js:69
const { modelType } = await chrome.storage.local.get('modelType');
const model = modelType || 'gpt-4o-mini';

// llmClient.js:149
const { modelType } = await chrome.storage.local.get('modelType');
const model = modelType || 'gpt-4o-mini';
```

During a single ReAct loop, `askLLMToThink` may be called up to 5 times and `askLLMToAnswer` once -- that is up to 6 redundant async storage reads for a value that will not change during the loop.

**Suggestion:** Either (a) cache the model at module level with a `chrome.storage.onChanged` listener (the same pattern `panel.js` uses for `isTestingMode`), or (b) read it once at the start of the ReAct loop and pass it as a parameter. The default value `'gpt-4o-mini'` is also inconsistent with `background.js:10` which sets the default to `'gpt-5-nano'`; only one of these defaults can be correct.

---

### 1.5 Repeated Hardcoded Server URL

**Files:** `llmClient.js:12,48,109,168`, `react.js:170`, `searchClient.js:38`, `intent.js:4,95`

The string `'http://localhost:8787'` is hardcoded in 4+ different files:

- `llmClient.js` uses it in three places inline
- `react.js:170` has it inline
- `searchClient.js:38` has it inline
- `intent.js:4` defines `const SERVER_BASE = 'http://localhost:8787'`
- `agentClient.js:4` defines `const SERVER_BASE = 'http://localhost:8787'`

Only `agentClient.js` and `intent.js` define it as a constant, but they each define their own private copy. The rest embed it directly in fetch calls.

**Suggestion:** Define `SERVER_BASE` once in a shared config/constants module and import everywhere. If the port ever changes, currently you need to find and update 7+ locations across 4 files.

---

### 1.6 Repeated LLM API Call Pattern

**Files:** `llmClient.js:48-58`, `llmClient.js:109-117`, `llmClient.js:168-177`, `intent.js:95-109`

Every LLM call follows the same pattern: construct a body with `model` + `messages`, POST to `/api/openai/chat`, check `response.ok`, parse JSON, extract `choices[0].message.content`. This is repeated 4 times across 2 files:

```js
const res = await fetch('http://localhost:8787/api/openai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});
if (!res.ok) throw new Error(`LLM error ${res.status}`);
const data = await res.json();
const text = data?.choices?.[0]?.message?.content || '';
```

**Suggestion:** Create a helper like `callLLM(model, messages)` that encapsulates the fetch, error handling, and response extraction. Each caller then becomes a one-liner plus its prompt construction.

---

### 1.7 Repeated LLM JSON Parsing with Markdown Cleanup

**Files:** `llmClient.js:121-122` and `intent.js:114-121`

Both places parse LLM JSON responses that might be wrapped in markdown code blocks, but use slightly different approaches:

```js
// llmClient.js:122
const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const decision = JSON.parse(cleanedText);

// intent.js:114-121
let jsonStr = content;
const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
if (jsonMatch) {
    jsonStr = jsonMatch[1];
}
const result = JSON.parse(jsonStr.trim());
```

**Suggestion:** Create a shared `parseJsonFromLLM(text)` utility that handles markdown code block stripping consistently. The regex-match approach in `intent.js` is more robust than the replace approach in `llmClient.js`.

---

### 1.8 Redundant `headless: false` Option

**Files:** `agent.js:142` and `agentClient.js:179`

The `headless: false` option is spread into the options object in two separate places along the same call chain:

```js
// agent.js:142 (in executeAgentGoal)
const result = await executeGoal(
    agentSession.port, goal, startUrl, agentProfile,
    { headless: false, ...options }
);

// agentClient.js:179 (in executeGoal)
body: JSON.stringify({
    port, goal, startUrl, userProfile,
    options: { headless: false, ...options }
})
```

This means `headless: false` is applied twice. If a caller ever tried to pass `headless: true`, it would be overridden in both layers. Only one layer needs to apply the default.

**Suggestion:** Choose one layer to own the default. `agentClient.js` is the lower-level API client and is the better place for it. Remove the duplicate from `agent.js:142`.

---

### 1.9 Duplicate Action Verb Regex

**Files:** `intent.js:25` and `intent.js:167`

The same action verb pattern is defined twice with slightly different ordering and whitespace:

```js
// intent.js:25
const actionVerbPattern = /(sign up|signup|sign me up|register|fill out|fill in|apply|book|order|buy|purchase|create account|log in|login|submit|enroll|subscribe|checkout|check out)/;

// intent.js:167
const hasActionVerb = /(sign up|signup|register|fill out|fill in|apply|book|order|buy|purchase|create account|log in|login|submit|enroll|subscribe|checkout|check out)/.test(text.toLowerCase());
```

Note that line 25 includes `"sign me up"` which is absent from line 167. This inconsistency means the two code paths categorize some inputs differently.

**Suggestion:** Define the action verb pattern once as a module-level constant and reference it in both places.

---

### 1.10 Redundant `addStepMessage` and `addAgentStepMessage`

**File:** `ui.js:30-53`

These two functions are identical except for the emoji prefix:

```js
export function addStepMessage(stepText) {
    // ... creates row with class 'row step', bubble with class 'msg step'
    bubble.textContent = `🔍 ${stepText}`;
    // ...
}

export function addAgentStepMessage(stepText) {
    // ... creates row with class 'row step', bubble with class 'msg step'
    bubble.textContent = `🤖 ${stepText}`;
    // ...
}
```

**Suggestion:** Merge into a single function with an optional emoji/prefix parameter: `addStepMessage(text, prefix = '🔍')`. Or at minimum, have `addAgentStepMessage` delegate to a shared implementation.

---

### 1.11 `useReActMode` Storage Key Is Set But Never Read

**File:** `background.js:11`

The `useReActMode` flag is initialized in `onInstalled`:

```js
chrome.storage.local.set({
    isTestingMode: false,
    modelType: 'gpt-5-nano',
    useReActMode: true,
});
```

But it is never read anywhere in the codebase. The intent detection system in `intent.js` replaced the old toggle-based Research Mode. This is dead configuration.

**Suggestion:** Remove `useReActMode` from the default settings, or if it is still intended for future use, document it clearly. Currently it misleads readers into thinking there is a toggle.

---

### 1.12 Unused Exports

**File:** `agentClient.js:248`

```js
export const stopAgentContainer = stopAgent;
```

The alias `stopAgentContainer` is exported for "backwards compatibility" but is not imported anywhere in the codebase.

**File:** `agentClient.js:122-124`

```js
export function isSSEConnected() {
    return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}
```

`isSSEConnected` is exported but never called.

**File:** `agentClient.js:97-101`

```js
export function removeSSEHandler(event, handler) { ... }
```

`removeSSEHandler` is exported but never called.

**File:** `agentClient.js:254-263`

```js
export async function getAgentStatus() { ... }
```

`getAgentStatus` is exported but never called.

**File:** `agentClient.js:295-304`

```js
export async function getNeedsInputQueue() { ... }
```

`getNeedsInputQueue` is exported but never called.

**File:** `agent.js:25-27`

```js
export function getProfile() { ... }
```

`getProfile` is exported but never called.

**File:** `agent.js:66-69`

```js
export function lockProfile() { ... }
```

`lockProfile` is exported but is only called internally by `cleanup()` in the same file. The export is unused externally.

**File:** `intent.js:21-51`, `intent.js:58-61`

`isObviouslyNotAgentTask` and `extractUrl` are exported but only used internally within `intent.js`. They do not need to be exported.

**Suggestion:** Remove unused exports and aliases. For functions only used internally, remove the `export` keyword. This reduces the public API surface and makes the module contracts clearer.

---

## 2. Readability

### 2.1 Inconsistent Default Model Value

**Files:** `background.js:10` vs `llmClient.js:7,70,150`

`background.js` sets the initial default model to `'gpt-5-nano'`, but every function in `llmClient.js` uses `'gpt-4o-mini'` as the fallback:

```js
// background.js:10
modelType: 'gpt-5-nano',

// llmClient.js:7
const model = modelType || 'gpt-4o-mini';
```

A reader cannot determine which model actually runs on first use. The `onInstalled` handler sets `'gpt-5-nano'` in storage, so the `|| 'gpt-4o-mini'` fallback in `llmClient.js` should only activate if storage is somehow empty. But `intent.js:99` hardcodes `'gpt-4o-mini'` without reading from storage at all. The inconsistency is confusing.

**Suggestion:** Define a single `DEFAULT_MODEL` constant and use it in all locations.

---

### 2.2 Intent Detection Model Is Hardcoded

**File:** `intent.js:99`

```js
model: 'gpt-4o-mini',  // Fast model for intent detection
```

The comment explains the intent, but this bypasses the user's model selection from settings. If a user selects a different model, intent detection still uses `gpt-4o-mini`. This may be intentional (cost/speed optimization), but it is not documented anywhere accessible to a developer modifying the system. A reader seeing the comment might wonder if this is a bug.

**Suggestion:** Add a brief comment explaining why this is intentionally decoupled from the user's model selection, or pull from a named constant like `INTENT_MODEL`.

---

### 2.3 Unclear Variable Name `lower` Used After Regex with `i` Flag

**File:** `panel.js:285-287`

```js
const lower = text.toLowerCase().trim();
const affirmative = /^(yes|yeah|...)$/i.test(lower);
```

The text is lowercased, then tested with a case-insensitive regex (`/i` flag). The `i` flag is redundant since `lower` is already lowercase. This is not a bug, but it signals uncertainty about what the code intends.

**Suggestion:** Remove the `/i` flag from the regex since the input is already lowercased, or remove the `.toLowerCase()` call and rely on the `/i` flag alone.

---

### 2.4 `isStopCommand` Also Redundantly Lowercases + Uses `/i`

**File:** `panel.js:431-433`

```js
function isStopCommand(text) {
    const lower = text.toLowerCase().trim();
    return /^(stop|cancel|abort|...)$/i.test(lower);
}
```

Same issue as 2.3 -- the input is lowercased and then tested with a case-insensitive regex.

---

### 2.5 Silent Module-Level Await in `panel.js` and `options.js`

**Files:** `panel.js:49` and `options.js:3`

```js
// panel.js:49
const stored = await chrome.storage.local.get(['isTestingMode']);

// options.js:3
let { isTestingMode, modelType } = await chrome.storage.local.get(['isTestingMode', 'modelType']);
```

Top-level `await` in ES modules is valid syntax but can be surprising to readers unfamiliar with it. More importantly, if the storage call fails, the entire module fails to load with no error handling. For `panel.js`, this means the entire panel UI becomes non-functional.

**Suggestion:** Wrap in try/catch with sensible defaults, or at minimum add a comment noting the top-level await dependency.

---

### 2.6 Magic Numbers and Strings

**File:** `react.js:14` -- `maxIterations = 5` is a local constant, which is good, but the bailout threshold at `react.js:106` uses magic number `2`:

```js
if (iteration >= 2) {
```

And the unhelpful count threshold at `react.js:114`:

```js
if (unhelpfulCount >= 2) {
```

**File:** `searchClient.js:5` -- `MIN_SEARCH_INTERVAL = 1000` is well-named, but the default count of `5` at `react.js:158` and `searchClient.js:15` is a bare number.

**Suggestion:** Extract `MIN_ITERATIONS_BEFORE_BAILOUT = 2` and `UNHELPFUL_THRESHOLD = 2` as named constants at the top of `react.js`.

---

### 2.7 `buildContextPrompt` is Hidden at the Bottom of `llmClient.js`

**File:** `llmClient.js:181-219`

This function is a key part of the ReAct system -- it constructs the entire context prompt that drives LLM reasoning. Its placement at the very end of the file, after the three exported functions, makes it easy to miss. Given its importance, it should be positioned more prominently.

**Suggestion:** Move `buildContextPrompt` closer to the top of the file (after imports), or at least above the first function that calls it (`askLLMToThink`).

---

### 2.8 Dense DOM Construction in `profile.js`

**File:** `profile.js:194-283` (the `renderSiteData` function)

This function is 90 lines of imperative DOM creation. While it is structurally correct, the nesting depth and volume of `createElement` / `appendChild` calls makes it hard to follow:

```js
const siteItem = document.createElement('div');
siteItem.className = 'site-item';
const siteHeader = document.createElement('div');
siteHeader.className = 'site-header';
const siteName = document.createElement('span');
siteName.className = 'site-name';
siteName.innerHTML = `<span class="chevron">▶</span> ${site}`;
// ... 70 more lines
```

**Suggestion:** Consider a small helper like `el(tag, className, textContent)` to reduce boilerplate:

```js
function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
}
```

This is optional but would halve the line count and improve scanability.

---

### 2.9 Inconsistent Error Object Handling in `agentClient.js`

**File:** `agentClient.js:148-151`, `agentClient.js:183-185`, etc.

All error handling follows this pattern:

```js
if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to start agent: ${response.status}`);
}
```

But if the response body is not valid JSON (e.g., a 502 gateway error returning HTML), `response.json()` will throw, and the original HTTP error context is lost. The user will see a JSON parse error instead of the actual HTTP failure.

**Suggestion:** Wrap the JSON parse in a try/catch, falling back to the raw status code:

```js
if (!response.ok) {
    let errorMsg = `Request failed: ${response.status}`;
    try {
        const body = await response.json();
        errorMsg = body.error || errorMsg;
    } catch {}
    throw new Error(errorMsg);
}
```

---

### 2.10 `panel.js` Has Two `unload` / `beforeunload` Listeners

**File:** `panel.js:65-70` and `panel.js:480-484`

```js
// Line 65
window.addEventListener('unload', () => {
    chrome.tabs.query(...)
    disconnectSSE();
});

// Line 480
window.addEventListener('beforeunload', () => {
    if (hasActiveSession()) {
        stopAgentSession().catch(() => {});
    }
});
```

Both fire on page close but do different things. A reader has to notice both to understand the full cleanup behavior. They are separated by 400+ lines of code.

**Suggestion:** Consolidate into a single cleanup handler, or at minimum co-locate them and add a comment noting that both exist.

---

## 3. Code Organization

### 3.1 `react.js` Contains Its Own Crawl4AI Client

**File:** `react.js:169-208`

The `executeFetchURL` function in `react.js` directly makes HTTP requests to the Crawl4AI endpoint. Meanwhile, `llmClient.js` does the same thing in `sendToBot`. The ReAct orchestrator (`react.js`) should not own HTTP-level crawling logic.

**Suggestion:** Move `executeFetchURL` to a shared module (e.g., `crawlClient.js`) and have both `react.js` and `llmClient.js` import from it. `react.js` should focus solely on the Think-Act-Observe loop orchestration.

---

### 3.2 `intent.js` Makes Direct LLM API Calls

**File:** `intent.js:94-109`

`intent.js` constructs its own fetch call to `/api/openai/chat` with its own model selection and JSON parsing, bypassing `llmClient.js` entirely. This means changes to the LLM calling convention (headers, error handling, response format) must be replicated in `intent.js`.

**Suggestion:** `intent.js` should call through `llmClient.js` for LLM interactions. Add a generic function like `callLLM(systemPrompt, userPrompt, model)` to `llmClient.js` and have `intent.js` use it.

---

### 3.3 `agent.js` and `profile.js` Both Manage Profile State

**Files:** `agent.js` and `profile.js`

These two files have overlapping concerns around user profiles:

- `agent.js` decrypts, transforms, locks/unlocks profiles and saves site data
- `profile.js` decrypts, edits, saves, changes passphrases, and deletes profiles

Both files maintain their own `currentPassphrase` variable. Both call `decryptProfile` and `encryptProfile` directly from `crypto.js`. Both have concepts of "locked" and "unlocked" state but do not share them.

This split exists because `agent.js` is loaded in the panel context and `profile.js` is loaded in the profile page context. However, there is no shared profile service layer; the encryption/decryption, storage read/write, and state management patterns are duplicated.

**Suggestion:** Extract a `profileService.js` module that handles storage read/write, encryption/decryption, and state. Both `agent.js` and `profile.js` can then import from it. This prevents the two from diverging in their treatment of the encrypted profile.

---

### 3.4 `panel.js` Contains UI Logic (Password Modal, Stop Button)

**File:** `panel.js:357-401` (password modal), `panel.js:449-455` (stop button show/hide)

`panel.js` directly manipulates DOM for the password modal and stop button, despite `ui.js` existing as the dedicated UI rendering module:

```js
// panel.js:357
function showPasswordModal() {
    passwordModal.classList.add('visible');
    modalPassphrase.value = '';
    modalPassphrase.focus();
}
```

Meanwhile, `ui.js` handles the sticky banner show/hide, message rendering, and form rendering. The password modal and stop button are left in `panel.js`.

**Suggestion:** Move `showPasswordModal`, `hidePasswordModal`, `showStopButton`, `hideStopButton` into `ui.js` for consistency. `panel.js` should be the orchestrator, not a partial UI manager.

---

### 3.5 SSE Event Handlers Have Scattered Session-Filtering Logic

**File:** `panel.js:116-171`

Both `handleAgentStatusEvent` and `handleNeedsInputEvent` independently filter events by session port:

```js
// panel.js:120-123
const session = getAgentSession();
if (session.port && data.port !== session.port) {
    return;
}

// panel.js:153-156
const session = getAgentSession();
if (session.port && data.port !== session.port) {
    return;
}
```

This filtering logic is duplicated and mixed with UI rendering.

**Suggestion:** Create a single guard function like `isOurSession(data)` or push the filtering into `agentClient.js` so that handlers in `panel.js` only receive relevant events.

---

### 3.6 `agentClient.js` Mixes Transport (SSE) and API Client Concerns

**File:** `agentClient.js`

This file contains two distinct concerns: (a) SSE connection management (lines 10-124) and (b) REST API functions for agent CRUD (lines 130-304). These are different communication patterns serving different purposes.

**Suggestion:** Consider splitting into `agentSSE.js` (or keeping SSE in `agentClient.js`) and moving the REST API functions into an `agentAPI.js` module. Alternatively, accept the coupling and add clear section comments (which already partially exist).

---

### 3.7 `options.js` Does Not Handle the Model Form Pre-Selection

**File:** `options.js:3,36-39`

```js
let { isTestingMode, modelType } = await chrome.storage.local.get(['isTestingMode', 'modelType']);
// ...
modelForm.addEventListener('change', (e) => {
    modelType = e.target.value;
    chrome.storage.local.set({ modelType });
});
```

The stored `modelType` is read but never applied to pre-select the correct radio button in the form. On page load, the form shows whatever the HTML default is, not the user's actual selection. This is a functional gap, but from an organization standpoint, the options page should fully own its settings state.

**Suggestion:** After reading `modelType`, find and check the matching radio button:

```js
const selectedRadio = modelForm.querySelector(`input[value="${modelType}"]`);
if (selectedRadio) selectedRadio.checked = true;
```

---

## Summary of Priority Items

| Priority | Issue | Files | Category |
|----------|-------|-------|----------|
| High | Duplicate Crawl4AI request logic | `llmClient.js`, `react.js` | Efficiency |
| High | Hardcoded server URL in 4+ files | `llmClient.js`, `react.js`, `searchClient.js`, `intent.js` | Efficiency |
| High | Repeated LLM call boilerplate | `llmClient.js`, `intent.js` | Efficiency |
| High | `intent.js` bypasses `llmClient.js` for LLM calls | `intent.js` | Organization |
| High | Inconsistent default model (`gpt-5-nano` vs `gpt-4o-mini`) | `background.js`, `llmClient.js` | Readability |
| Medium | Duplicate domain extraction functions | `agent.js`, `searchClient.js` | Efficiency |
| Medium | Duplicate `formatFieldLabel` | `ui.js`, `profile.js` | Efficiency |
| Medium | Duplicate action verb regex in `intent.js` | `intent.js` | Efficiency |
| Medium | Redundant `modelType` storage reads per request | `llmClient.js` | Efficiency |
| Medium | Profile state split across `agent.js` and `profile.js` | `agent.js`, `profile.js` | Organization |
| Medium | UI logic in `panel.js` instead of `ui.js` | `panel.js` | Organization |
| Low | `addStepMessage` and `addAgentStepMessage` nearly identical | `ui.js` | Efficiency |
| Low | Redundant `headless: false` in two layers | `agent.js`, `agentClient.js` | Efficiency |
| Low | Multiple unused exports | `agentClient.js`, `agent.js`, `intent.js` | Efficiency |
| Low | Dual `unload`/`beforeunload` handlers 400 lines apart | `panel.js` | Readability |
| Low | Dense imperative DOM construction | `profile.js` | Readability |
| Low | `options.js` does not pre-select stored model | `options.js` | Organization |

---

*Analysis generated 2026-02-22. Covers files: panel.js, ui.js, agent.js, intent.js, agentClient.js, llmClient.js, react.js, searchClient.js, crypto.js, profile.js, background.js, options.js.*
