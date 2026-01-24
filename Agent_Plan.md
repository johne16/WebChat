# Agent Plan: Web Form-Filling Agent

## Project Overview

**Goal**: Build a standalone agent that can autonomously fill web forms using LLM-generated interaction plans.

**Success Criteria (MVP)**: Successfully fill a multi-page form on a local test page with minimal human intervention.

**Future Integration**: Agent will be called by Web.Chat extension; orchestration layer comes later.

---

## Perspective 1: Expert Software Engineer

### High-Level Architecture

**Core Components:**
1. **Browser Automation Driver** (Puppeteer)
   - Lightweight, Node.js native
   - Headless Chrome for testing, headful for debugging
   - ~50 LOC wrapper class

2. **LLM Client** (OpenAI API)
   - Single `generateFormFillingCode()` function
   - Returns executable JavaScript string
   - ~30 LOC

3. **Code Executor**
   - Sandboxed execution via Puppeteer's `page.evaluate()`
   - Built-in safety (runs in browser context, no Node.js access)
   - ~20 LOC

4. **Agent Controller** (Main orchestrator)
   - Coordinates: navigate → analyze → generate → execute
   - Error handling and retry logic
   - ~80 LOC

**Total estimated codebase: ~200 LOC for MVP**

### Implementation Steps

**Phase 1: Foundation (Days 1-2)**
1. Initialize Node.js project with ES modules
2. Install dependencies: `puppeteer`, `openai`, `dotenv`
3. Create basic file structure:
   ```
   /agent-project
   ├── src/
   │   ├── index.js           (entry point)
   │   ├── browser.js         (Puppeteer wrapper)
   │   ├── llm.js             (OpenAI client)
   │   └── executor.js        (code execution)
   ├── test/
   │   └── test-form.html     (local test page)
   ├── .env                   (API keys)
   └── package.json
   ```

**Phase 2: Core Agent Logic (Days 3-4)**
1. **browser.js**: Launch browser, navigate to URL, extract page HTML
2. **llm.js**: Send HTML + user profile → receive JavaScript code
3. **executor.js**: Run generated code via `page.evaluate()`
4. **index.js**: Wire up flow, add CLI interface for testing

**Phase 3: LLM Prompting (Day 5)**
1. Design system prompt for code generation
2. Provide user profile schema and available DOM APIs
3. Include few-shot examples (simple form → generated code)
4. Test prompt against local form

**Phase 4: Error Handling (Day 6)**
1. Catch execution errors, send back to LLM with error context
2. Implement single retry with updated prompt
3. Add timeout safety (30s max per execution)

**Phase 5: Multi-Page Support (Day 7)**
1. Detect navigation (wait for page load after button clicks)
2. Re-run analysis on new page
3. Chain generated code across pages

### Rationale for Key Decisions

**Why Puppeteer over Playwright?**
- Smaller dependency footprint (~150MB vs ~300MB)
- Node.js native (no external binaries)
- Sufficient for proof of concept

**Why executable JavaScript over JSON plans?**
- Simpler codebase (no custom interpreter needed)
- LLMs excel at code generation (proven by research)
- Handles edge cases naturally (conditionals, retries, dynamic selectors)

**Why single retry over complex error recovery?**
- Keeps MVP scope tight
- Most errors fixable with context (LLM sees error message)
- Can expand later if needed

### Estimated Timeline
- **7 days** for working MVP
- **200 LOC** core codebase
- **3 files** of actual logic (browser, llm, executor)

---

## Perspective 2: Expert Researcher (Critique)

### Strengths of Engineer's Plan
✅ Aligns with latest research (WebAgent, PAL, Code as Policies all use code generation)
✅ Leverages Puppeteer's built-in sandboxing (`page.evaluate()` runs in browser context)
✅ Pragmatic scope limitation (local test first, live sites later)

### Critical Gaps

**1. Observation Feedback Loop Missing**
- **Issue**: Engineer's plan is single-shot (analyze → generate → execute → done)
- **Research insight**: Inner Monologue (2207.05608) shows feedback loops critical for recovery
- **Fix**: After execution, send success/failure observation back to LLM for potential replanning

**2. No Mention of Prompt Engineering Strategy**
- **Issue**: System prompt design is vague ("few-shot examples")
- **Research insight**: ProgPrompt (2209.11302) shows structured prompts with formal API definitions improve success
- **Fix**: Provide formal "API spec" in prompt:
  ```javascript
  // Available APIs:
  // - waitForElement(selector, timeout)
  // - fillField(selector, value)
  // - clickButton(selector)
  // - selectOption(selector, value)
  ```

**3. Missing HTML Summarization Step**
- **Issue**: Full page HTML sent to LLM is token-inefficient
- **Research insight**: WebAgent (2307.12856) uses HTML summarization to extract task-relevant snippets
- **Fix**: Pre-process HTML to extract only form elements, labels, and interactive components

**4. No Plan Validation Before Execution**
- **Issue**: Generated code runs immediately without inspection
- **Research insight**: SmartFlow (2405.12842) validates generated actions before execution
- **Fix**: Add syntax check + static analysis to catch obvious errors (undefined variables, missing await statements)

**5. Underestimating Multi-Page Complexity**
- **Issue**: "Chain generated code across pages" oversimplifies state management
- **Research insight**: ReWOO (2305.18323) separates planning from execution with explicit state passing
- **Fix**: Maintain execution context across pages:
  ```javascript
  const context = {
    completedSteps: [],
    currentPage: 1,
    userProfile: {...}
  };
  ```

### Recommended Additions

**A. HTML Preprocessing Module** (~40 LOC)
```javascript
// src/preprocessor.js
function extractFormElements(html) {
  // Parse HTML, filter to <form>, <input>, <button>, <select>
  // Include labels, aria-labels, placeholders
  // Return minimal HTML string (~80% token reduction)
}
```

**B. Plan Validator** (~30 LOC)
```javascript
// src/validator.js
function validateGeneratedCode(code) {
  // Check syntax (new Function(code))
  // Verify uses only allowed APIs
  // Return { valid: boolean, errors: [] }
}
```

**C. Execution Context Manager** (~50 LOC)
```javascript
// src/context.js
class ExecutionContext {
  constructor(userProfile) {
    this.profile = userProfile;
    this.steps = [];
    this.currentPageUrl = null;
  }

  addStep(page, code, result) {
    this.steps.push({ page, code, result, timestamp: Date.now() });
  }

  getHistory() {
    return this.steps.map(s => `Page ${s.page}: ${s.result}`).join('\n');
  }
}
```

### Revised Architecture

```
┌─────────────┐
│  Agent CLI  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│        Agent Controller (index.js)      │
│  - Manages execution context            │
│  - Coordinates multi-page flows         │
└──────┬──────────────────────────────────┘
       │
       ├──► Browser Driver ──► Puppeteer
       │
       ├──► HTML Preprocessor ──► Extract form elements
       │                           │
       ├──► LLM Client ────────────┴──► OpenAI API
       │                           │
       ├──► Validator ◄────────────┘
       │
       └──► Code Executor ──► page.evaluate()
                           │
                           └──► Feedback Loop ──┐
                                                 │
                           ┌─────────────────────┘
                           ▼
                    Re-plan if errors
```

### Updated Component Count
- **6 core files** instead of 3
- **~350 LOC** instead of 200 (still very manageable)
- **+50% code, +200% robustness**

---

## Final Collaborative Plan

### Agreed Architecture

**Core Modules:**
1. **browser.js** - Puppeteer wrapper (50 LOC)
2. **preprocessor.js** - HTML form extraction (40 LOC)
3. **llm.js** - OpenAI client with structured prompts (40 LOC)
4. **validator.js** - Code validation (30 LOC)
5. **executor.js** - Sandboxed execution with feedback (40 LOC)
6. **context.js** - Multi-page state management (50 LOC)
7. **index.js** - Agent controller with retry logic (100 LOC)

**Total: ~350 LOC**

### Implementation Roadmap

#### Week 1: Foundation + Single-Page Forms

**Day 1: Project Setup**
- Initialize Node.js project (`package.json`, `.env`, folder structure)
- Install dependencies: `puppeteer`, `openai`, `dotenv`
- Create simple test form (single page, 3-4 fields)
- Verify Puppeteer can navigate and screenshot the test page

**Day 2: HTML Preprocessing**
- Implement `preprocessor.js::extractFormElements()`
- Test HTML reduction (should cut tokens by 70-80%)
- Verify form fields, labels, and buttons preserved

**Day 3: LLM Integration**
- Implement `llm.js::generateFormFillingCode()`
- Design system prompt with API specifications (based on ProgPrompt research)
- Test with preprocessed HTML, verify syntactically valid JS returned

**Day 4: Code Validation + Execution**
- Implement `validator.js::validateGeneratedCode()`
- Implement `executor.js::runInBrowser()` using `page.evaluate()`
- Test end-to-end: HTML → LLM → validation → execution

**Day 5: Error Handling + Feedback Loop**
- Add try/catch in executor, capture errors
- Send error back to LLM with context (Inner Monologue approach)
- Implement single retry with updated prompt
- Test with intentionally broken form (missing ID, wrong selector)

#### Week 2: Multi-Page Support + Refinement

**Day 6: Execution Context**
- Implement `context.js::ExecutionContext` class
- Track completed steps across page transitions
- Test state persistence between pages

**Day 7: Multi-Page Navigation**
- Detect navigation triggers (button clicks that load new page)
- Wait for page load, re-run preprocessing on new page
- Chain execution contexts across pages
- Test with 2-page form (personal info → address)

**Day 8: Integration Testing**
- Create comprehensive test form with edge cases:
  - Required vs optional fields
  - Dropdowns, checkboxes, radio buttons
  - Multi-page wizard
- Run full agent flow, measure success rate

**Day 9: CLI Interface**
- Add command-line arguments (URL, profile JSON path, headless flag)
- Structured logging (step-by-step progress)
- Output report (success/failure, screenshots, execution time)

**Day 10: Documentation + Handoff**
- Document prompt engineering decisions
- Create integration guide for Web.Chat
- Performance metrics (token usage, execution time, success rate)

### LLM Prompt Design (Informed by Research)

**System Prompt Structure:**

```javascript
const systemPrompt = `
You are a web form-filling automation expert. Given an HTML form and user profile data, generate executable JavaScript code to fill the form.

AVAILABLE APIS:
- async waitForElement(selector, timeout=5000): Wait for element to appear
- async fillField(selector, value): Fill input/textarea with value
- async clickButton(selector): Click button or submit element
- async selectOption(selector, value): Select dropdown option by value or text

USER PROFILE SCHEMA:
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "phone": "string",
  "address": { "street": "string", "city": "string", "state": "string", "zip": "string" }
}

CONSTRAINTS:
- Use async/await for all API calls
- Include error handling with try/catch
- Add comments explaining each step
- Return success status at the end

EXAMPLE:

HTML:
<form>
  <input id="name" placeholder="Full Name">
  <input id="email" type="email">
  <button id="submit">Submit</button>
</form>

User Profile:
{ "firstName": "John", "lastName": "Doe", "email": "john@example.com" }

Generated Code:
try {
  // Fill name field
  await fillField('#name', userProfile.firstName + ' ' + userProfile.lastName);

  // Fill email field
  await fillField('#email', userProfile.email);

  // Submit form
  await clickButton('#submit');

  return { success: true };
} catch (error) {
  return { success: false, error: error.message };
}

Now generate code for the following form:
`;
```

### Key Design Decisions (Consensus)

| Decision | Engineer Rationale | Researcher Validation |
|----------|-------------------|----------------------|
| **Executable JS over JSON** | Simpler codebase, no interpreter | WebAgent, PAL, Code as Policies all use code generation |
| **HTML Preprocessing** | Initially resisted (complexity) | WebAgent paper shows 50%+ improvement; accepted |
| **Feedback Loop** | Agreed on single retry | Inner Monologue research validates; expanded to full loop |
| **Puppeteer over Playwright** | Smaller footprint | Sufficient for research validation; agreed |
| **Code Validation** | Initially skipped | SmartFlow + safety considerations; added |
| **Execution Context** | Initially ad-hoc | ReWOO decoupling principle; formalized |

### Success Metrics (MVP)

**Quantitative:**
- ✅ Successfully fill 3-field single-page form: 100% success rate
- ✅ Successfully fill 2-page form wizard: 80%+ success rate
- ⏱️ Execution time: <15 seconds per page
- 💰 Token usage: <2000 tokens per form (with preprocessing)

**Qualitative:**
- ✅ Generated code is human-readable
- ✅ Error messages help LLM recover on retry
- ✅ Codebase remains under 400 LOC
- ✅ Clear integration path with Web.Chat

### Future Enhancements (Post-MVP)

**Phase 2 Features:**
- CAPTCHA detection and pause/resume (as designed in `agentic_feature_exploration.md`)
- Encrypted user profile storage
- Site-specific code caching (reduce API calls for known forms)
- Support for alternative LLM providers (Anthropic Claude, local models)

**Phase 3 Features:**
- Orchestration layer (multi-site workflows)
- Web.Chat extension integration
- Real-world website optimization (utility companies, government forms)

### Risk Mitigation

**Technical Risks:**
1. **LLM generates invalid selectors** → Preprocessor includes all IDs/classes/names in context
2. **Timing issues (element not ready)** → All APIs include wait logic with timeouts
3. **Multi-page state loss** → ExecutionContext persists across navigations
4. **Token limits exceeded** → HTML preprocessing reduces by 70-80%

**Research Risks:**
1. **Code generation approach fails** → JSON fallback path documented in `plan-representation-analysis.md`
2. **Single retry insufficient** → Can expand to Inner Monologue multi-turn loop

### Next Steps to Begin Implementation

1. **Create new project directory** (outside Web.Chat folder)
2. **Initialize package.json** with dependencies
3. **Create test form HTML** (simple 3-field form for Day 1 testing)
4. **Implement browser.js** (Puppeteer wrapper, ~50 LOC)
5. **Verify end-to-end browser automation** (launch → navigate → screenshot → close)

---

## Perspective 3: Academic Advisor (Professor Review)

### Overview Assessment

This is a solid **engineering-focused** plan with good research grounding, but it lacks the **experimental rigor** expected for a master's-level project. The plan conflates "building a working prototype" with "conducting rigorous research." Let me break down what I like and what needs significant improvement.

---

### What I Like ✓

**1. Research Integration**
- Excellent citation of relevant papers (WebAgent, PAL, Inner Monologue, etc.)
- Clear connection between research insights and design decisions
- The engineer-researcher dialogue format effectively shows trade-off reasoning

**2. Scope Management**
- Well-defined MVP with concrete deliverables
- Appropriate limitation to local testing before live deployment
- Realistic acknowledgment of future work (orchestration, CAPTCHA handling)

**3. Incremental Development**
- 10-day roadmap with daily milestones is pedagogically sound
- Builds complexity gradually (single-page → multi-page)
- Good separation of concerns across modules

**4. Documentation Quality**
- Clear architecture diagrams
- Concrete code examples (prompt structure, API specifications)
- Explicit rationale for design decisions

---

### Critical Deficiencies ⚠️

#### **1. No Testing Strategy (Major Gap)**

**Problem**: The plan mentions "manual end-to-end testing" but provides no systematic testing methodology.

**What's Missing:**
- **Unit tests**: How will you test individual components (preprocessor, validator, executor) in isolation?
- **Integration tests**: What's the test suite for the full pipeline?
- **Regression tests**: How do you ensure changes don't break existing functionality?

**Required Addition:**
```
Day 8.5: Testing Infrastructure
- Implement Jest/Mocha test framework
- Create unit tests for preprocessor (5+ test cases)
- Create integration tests (3+ end-to-end scenarios)
- Set up CI/CD pipeline (GitHub Actions)
- Target: 80%+ code coverage
```

**Academic Standard**: A master's project should include automated tests. "It works on my machine" is not sufficient validation.

---

#### **2. Inadequate Evaluation Methodology (Critical)**

**Problem**: Success metrics are too simplistic. "100% success on 3-field form" tells us nothing about generalizability or robustness.

**What's Missing:**
- **Diverse test set**: You need 20+ forms with varying characteristics:
  - Simple (3-5 fields, single page)
  - Medium (6-10 fields, dropdowns, checkboxes)
  - Complex (multi-page, conditional fields, dynamic elements)
  - Edge cases (hidden fields, JavaScript-heavy forms, unusual layouts)
- **Quantitative metrics beyond success rate**:
  - Field-level accuracy (did it fill the *correct* value?)
  - Partial completion rate (filled 8/10 fields correctly)
  - Token efficiency (tokens per field filled)
  - Time per form category
- **Failure analysis**: What types of forms cause failures? Why?

**Required Addition:**
```markdown
### Evaluation Plan

**Test Dataset:**
- 25 synthetic forms with controlled complexity
- Categorized: Simple (n=10), Medium (n=10), Complex (n=5)
- Published in repository for reproducibility

**Metrics:**
- Success rate per category
- Field-level accuracy (correct value / total fields)
- Average execution time per category
- Token usage per field filled
- Error type distribution (selector failures, timeout, validation errors)

**Baseline Comparison:**
- Manual filling time (human baseline)
- Fixed-script approach (no LLM, hardcoded selectors)
- JSON-plan approach (for ablation study)
```

**Academic Standard**: You need a **dataset**, **metrics**, and **baselines**. Otherwise, how do you claim your approach is effective?

---

#### **3. No Ablation Studies**

**Problem**: The plan adds 6+ components (preprocessor, validator, feedback loop, etc.) without testing whether they actually improve performance.

**What's Missing:**
- Which components matter most?
- Is HTML preprocessing worth the added complexity? (Measure success rate with/without)
- Does code validation improve reliability? (Measure with/without)
- How much does feedback loop help? (Compare single-shot vs. retry)

**Required Addition:**
```markdown
Day 11-12: Ablation Studies

Measure success rate with component variations:
1. Baseline: Full system
2. -Preprocessor: Send raw HTML to LLM
3. -Validator: Skip validation step
4. -Feedback: No retry on errors
5. -Context: No state tracking across pages

Document which components provide >5% improvement.
```

**Academic Standard**: Research requires isolating variables. You can't claim "feedback loops improve performance" without measuring it.

---

#### **4. Weak Baseline Comparisons**

**Problem**: No comparison to existing approaches or tools.

**What's Missing:**
- **Human baseline**: How long does manual form filling take? (You should time yourself on the test forms)
- **Selenium IDE baseline**: Record-and-replay tools exist—how does your LLM approach compare?
- **Alternative LLM approaches**: Compare executable code vs. JSON plans empirically (not just conceptually)

**Required Addition:**
```markdown
### Baseline Experiments

1. **Human Performance**: Time 3 people filling 10 test forms manually (avg time)
2. **Selenium IDE**: Record filling scripts, measure brittleness (how many break with minor HTML changes?)
3. **JSON Plan Approach**: Implement simple JSON interpreter, compare success rate to code generation

Report: "Our approach achieved 85% success vs. 60% for JSON plans and 95% for humans."
```

---

#### **5. No Discussion of Failure Modes**

**Problem**: What happens when the agent fails? The plan only discusses success cases.

**What's Missing:**
- **Graceful degradation**: Can the agent report *partial* progress? (Filled 7/10 fields before failing)
- **Error categorization**: Selector errors vs. timing errors vs. validation errors
- **Recovery strategies**: When should the agent give up vs. retry?

**Required Addition:**
- Day 9: Implement structured error reporting (error type, affected field, suggested fix)
- Document failure modes in evaluation (create a taxonomy: selector failures, timeout errors, etc.)

---

#### **6. Timeline Concerns**

**Problem**: 10 days for a novel research system is optimistic, especially for a master's student learning these technologies.

**Reality Check:**
- Debugging Puppeteer edge cases: +2 days
- Prompt engineering iteration: +2 days
- Evaluation and dataset creation: +3 days
- Writing up results: +2 days

**Realistic Timeline**: 3-4 weeks, not 10 days.

**Recommendation**: Add buffer time and explicitly schedule "debugging days" and "iteration days."

---

#### **7. Reproducibility Issues**

**Problem**: How can others replicate your results?

**What's Missing:**
- **Versioning**: Which OpenAI model? (gpt-4? gpt-4-turbo? gpt-3.5-turbo?) Model versions change over time
- **Random seed**: LLM outputs are non-deterministic. How do you ensure consistent results?
- **Dataset sharing**: Will test forms be published in a repository?
- **Dependency locking**: `package-lock.json` for exact dependency versions

**Required Addition:**
```markdown
### Reproducibility Checklist
- Lock OpenAI model version (e.g., gpt-4-0613)
- Set temperature=0 for deterministic outputs
- Publish test form dataset in GitHub repo
- Document exact dependency versions (Node 18.x, Puppeteer 21.x)
- Provide Docker container for environment consistency
```

---

#### **8. Limited Generalizability Discussion**

**Problem**: The plan optimizes for "a local test page" with future plans for "certain specific sites." This is fine for engineering, but weak for research.

**Academic Question**: What makes your approach generalizable beyond your test cases?

**What's Missing:**
- **Cross-domain testing**: Does the agent work on form libraries (React forms, Bootstrap forms, plain HTML)?
- **Adversarial testing**: What if the form deliberately uses misleading labels or unusual structure?
- **Transfer learning**: If the agent learns patterns from 20 forms, does it perform better on the 21st?

**Recommendation**: Add a section discussing **limits of generalizability** and **threats to validity**.

---

### What's Missing Entirely

**1. Literature Review Completeness**
- You cite 8 papers, but there's no discussion of:
  - Older web automation research (Selenium, iMacros, WebDriver)
  - Human-computer interaction literature on form design
  - Recent work on LLM agents for web tasks (GPT-4V, WebArena benchmark)

**2. Ethical Considerations**
- What if the agent is used maliciously? (Automated spam, fraud)
- No discussion of rate limiting to avoid DoS-ing websites
- No mention of respecting `robots.txt` or terms of service

**3. User Study**
- Eventually, you need to test this with real users. How will you measure:
  - User trust in the agent?
  - User ability to correct agent errors?
  - Perceived usefulness vs. manual filling?

---

### Recommendations for a Master's-Level Project

#### **Tier 1 (Must Have)**
1. ✅ Add automated testing infrastructure (unit + integration tests)
2. ✅ Create a diverse test dataset (20+ forms, publicly shared)
3. ✅ Define quantitative evaluation metrics (not just binary success/failure)
4. ✅ Include at least one baseline comparison (human or tool-based)
5. ✅ Document reproducibility steps (model versions, seeds, environment)

#### **Tier 2 (Strongly Recommended)**
6. ✅ Conduct ablation studies (test individual component contributions)
7. ✅ Analyze failure modes systematically (create error taxonomy)
8. ✅ Add buffer time to timeline (3-4 weeks instead of 10 days)
9. ✅ Discuss ethical considerations and limitations

#### **Tier 3 (Nice to Have / Future Work)**
10. Compare multiple LLM providers (OpenAI vs. Anthropic vs. local models)
11. Implement learning/caching mechanism (improve over time)
12. Conduct small user study (5-10 participants)

---

### Final Commentary

**Overall Grade: B+ (Good engineering plan, insufficient research rigor)**

**Strengths:**
- Clear, well-structured, and actionable
- Good integration of recent research papers
- Realistic scope for a proof-of-concept

**Weaknesses:**
- Treats this as a software sprint, not a research project
- No systematic evaluation methodology
- Missing ablation studies and baselines
- Timeline underestimates complexity

**Path Forward:**

If this is **purely an engineering project** (build a tool that works), the plan is excellent as-is. Ship it.

If this is a **master's thesis or research project**, you need to add:
1. A proper evaluation section (dataset, metrics, baselines)
2. Ablation studies to validate design choices
3. Discussion of limitations and threats to validity
4. Automated testing infrastructure

**My Recommendation**: Spend Week 1 building the MVP as planned, then allocate Week 2-3 for rigorous evaluation and experimentation. This gives you both a working prototype *and* research contributions.

**What Happens Next**:
- Come back to me after Day 5 with preliminary results from your first LLM prompts
- We'll discuss prompt iteration strategies based on failure cases
- After Day 10, we'll design the evaluation experiments together
- Budget time for writing up results (this becomes Chapter 3 of your thesis)

---

Good luck, and remember: **Research is not just about building something that works, but understanding *why* it works and *when* it fails.**

---

## Appendix: Research Citations

All design decisions validated against papers documented in `agentic_feature_exploration.md`:

- **WebAgent** (2307.12856): HTML summarization, program synthesis
- **ReWOO** (2305.18323): Decoupling planning from execution
- **PAL** (2211.10435): Program-aided reasoning
- **Code as Policies** (2209.07753): Executable code over natural language
- **SmartFlow** (2405.12842): GUI automation via code generation
- **Inner Monologue** (2207.05608): Feedback loops for error recovery
- **ProgPrompt** (2209.11302): Structured prompts with API specifications
- **LLM+P** (2304.11477): Formal plan specifications

---

**Document Version:** 1.0
**Last Updated:** 2025-12-21
**Status:** Ready for implementation
