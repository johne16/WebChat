
# Agentic Form-Filling Feature Exploration

## Overview

This document captures research and design exploration for adding agentic form-filling capabilities to the Web.Chat extension.

## User Requirement

End user wants the extension to have agentic abilities to fill out forms across various websites.

## Architecture Approaches Considered

### Approach A: Extension-Driven DOM Manipulation
- **Pro**: Full control over timing and validation
- **Pro**: Works with existing content script architecture
- **Pro**: Can preview changes before committing
- **Pro**: Single LLM API call
- **Con**: Complex shadow DOM and iframe handling
- **Con**: Must handle anti-bot protections
- **Con**: Fixed algorithm, struggles with novel form patterns

### Approach B: LLM-Generated Action Plan → Execution (ReAct-based)
- **Pro**: Leverages existing ReAct loop structure
- **Pro**: LLM decides field priorities and filling strategy
- **Pro**: Can adapt to unusual form patterns dynamically
- **Con**: Requires new action types (`fill_field`, `select_option`, `submit_form`)
- **Con**: 5-20+ API calls per form (slow, expensive)
- **Con**: High latency due to iterative loop

### Approach C: Hybrid (LLM Planning + Local Execution) ⭐ PREFERRED

**Combines best of both worlds:**
- Single API call efficiency (from A)
- LLM adaptability to form variations (from B)

**High-Level Concept:**
- LLM analyzes form and generates executable plan (JSON/code)
- Plan includes execution directives (order, dependencies, data mappings)
- Local runtime executes plan without additional API calls
- User reviews/approves plan before execution

**Comparison Table:**

| Aspect | A (Extension-Driven) | B (ReAct Loop) | C (Hybrid) |
|--------|---------------------|----------------|------------|
| API calls per form | 1 | 5-20+ | 1-2 (re-plan if error) |
| Handles unusual forms | ❌ Fixed logic | ✅ Reasons dynamically | ✅ Reasons once |
| Execution speed | Fast | Slow | Fast |
| Adapts to runtime changes | ❌ | ✅ | ⚠️ Limited (re-plan needed) |
| User control | Preview after fill | Approve each action | Approve plan upfront |

## Related Research: LLM Planning → Programmatic Execution

The hybrid approach aligns with recent research where LLMs generate executable plans/programs rather than making direct tool calls.

### Key Papers

#### 1. WebAgent (Google Research, July 2023)
- **Paper**: "A Real-World WebAgent with Planning, Long Context Understanding, and Program Synthesis"
- **Authors**: Izzeddin Gur, Hiroki Furuta, Austin Huang, et al.
- **arXiv**: 2307.12856
- **Presented**: ICLR 2024 (Oral)

**Key Concept**: Three-stage approach: instruction decomposition → HTML content summarization → Python program synthesis. The agent generates executable Python programs to interact with web pages.

**Methodology**:
- Decomposes instructions into canonical sub-instructions
- Summarizes HTML documents into task-relevant snippets
- Synthesizes Python scripts using sub-instructions as comments
- Combines HTML-T5 (planning/summarization) and Flan-U-PaLM (code generation)

**Results**: Over 50% improvement on real websites; state-of-the-art on Mind2Web; 18.7% improvement on MiniWoB

**Relevance**: Directly applicable to form-filling - shows how to convert high-level instructions into executable web interaction code

---

#### 2. ReWOO: Decoupling Reasoning from Observations (May 2023)
- **Paper**: "ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models"
- **Authors**: Binfeng Xu, Zhiyuan Peng, Bowen Lei, et al.
- **arXiv**: 2305.18323

**Key Concept**: Separates planning from execution by having the LLM create a complete plan upfront without waiting for intermediate observations. Three modules: Planner (generates plan), Worker (executes actions), Solver (generates final answer).

**Methodology**:
- Planner creates complete reasoning blueprint before execution
- Worker executes tool calls independently
- No interleaving of reasoning and observation

**Results**: 5x token efficiency improvement, 4% accuracy gain on HotpotQA, 64% average token reduction across benchmarks

**Relevance**: Demonstrates efficient separation of planning from execution phases

---

#### 3. PAL: Program-aided Language Models (November 2022)
- **Paper**: "PAL: Program-aided Language Models"
- **Authors**: Luyu Gao, Aman Madaan, Shuyan Zhou, et al.
- **arXiv**: 2211.10435

**Key Concept**: LLMs generate Python programs as intermediate reasoning steps instead of trying to solve problems directly. The programs are then executed by a Python interpreter.

**Methodology**:
- LLM reads natural language problems and generates programs
- Solution step is offloaded to a programmatic runtime (Python interpreter)
- Division of labor: LLM handles decomposition, interpreter handles computation

**Results**: Achieved state-of-the-art on GSM8K math benchmark, surpassing much larger models by 15 percentage points

**Relevance**: Demonstrates separation of planning (LLM) from execution (runtime environment)

---

#### 4. SmartFlow: Robotic Process Automation using LLMs (May 2024)
- **Paper**: "SmartFlow: Robotic Process Automation using LLMs"
- **Authors**: Arushi Jain, Shubham Paliwal, Monika Sharma, et al.
- **arXiv**: 2405.12842

**Key Concept**: Uses computer vision and NLP to perceive GUI elements, converts them to textual representation, then uses LLMs to generate PyAutoGUI code for execution.

**Methodology**:
- Computer vision + NLP extract visible GUI elements
- Elements transformed into textual representation
- LLM generates sequence of PyAutoGUI actions
- Scripting engine executes the generated code

**Applications**: Form filling, customer service, invoice processing, back-office operations

**Relevance**: Shows end-to-end pipeline for converting visual forms into executable automation scripts

---

#### 5. Finetuning LLMs for Automatic Form Interaction (November 2024)
- **Paper**: "Finetuning LLMs for Automatic Form Interaction on Web-Browser in Selenium Testing Framework"
- **arXiv**: 2511.15168

**Key Concept**: Fine-tunes LLMs (specifically Qwen2.5 Coder Instruct) to generate syntactically correct, executable Selenium scripts for form interaction testing.

**Methodology**:
- Dataset-driven approach with 500 synthetic HTML forms
- 133 real-world web forms (login, registration, contact)
- Treats form interaction as code generation task
- Generates executable Selenium test scripts

**Results**: Demonstrates that LLMs can be effectively adapted to generate high-coverage Selenium scripts

**Relevance**: Most recent research (November 2024) specifically focused on form-filling automation

---

#### 6. Code as Policies (September 2022)
- **Paper**: "Code as Policies: Language Model Programs for Embodied Control"
- **Authors**: Jacky Liang, Wenlong Huang, Fei Xia, et al. (Google Robotics)
- **arXiv**: 2209.07753

**Key Concept**: Instead of generating natural language plans, the LLM generates executable Python code that serves as robot control policies.

**Methodology**:
- Hierarchical code generation through recursive function definition
- Integration with third-party libraries (NumPy, Shapely) for mathematical reasoning
- Policy composition where generated code chains control primitives

**Results**: Achieved 39.8% pass@1 on HumanEval benchmark; successfully deployed on physical robots

**Relevance**: Demonstrates the principle of converting LLM reasoning into executable code rather than natural language instructions

---

#### 7. ProgPrompt (September 2022)
- **Paper**: "ProgPrompt: Generating Situated Robot Task Plans using Large Language Models"
- **Authors**: Ishika Singh, Valts Blukis, Arsalan Mousavian, et al.
- **arXiv**: 2209.11302

**Key Concept**: Prompts LLMs with program-like specifications including available actions, objects, and example executable programs. The LLM generates Python-like code that represents task plans.

**Methodology**:
- Provides Pythonic program headers with import statements for available actions
- Includes formal action and object definitions for specific environments
- Uses constraints to ensure generated sequences are feasible

**Results**: State-of-the-art success rates on VirtualHome household tasks; deployed on physical robot arm

**Relevance**: Shows how to structure prompts as programming interfaces to generate executable plans

---

#### 8. LLM+P (April 2023)
- **Paper**: "LLM+P: Empowering Large Language Models with Optimal Planning Proficiency"
- **Authors**: Bo Liu, Yuqian Jiang, Xiaohan Zhang, et al.
- **arXiv**: 2304.11477

**Key Concept**: Converts natural language descriptions into Planning Domain Definition Language (PDDL) files, uses classical planners to find optimal solutions, then translates back to natural language.

**Methodology**:
1. Natural language → PDDL conversion
2. Classical planner executes search algorithms
3. PDDL plan → Natural language translation

**Results**: Provides optimal solutions for most problems where pure LLMs fail to generate feasible plans

**Relevance**: Shows how to convert LLM output into formal, executable specifications (PDDL) that specialized tools can process

---

#### 9. Inner Monologue (July 2022)
- **Paper**: "Inner Monologue: Embodied Reasoning through Planning with Language Models"
- **Authors**: Wenlong Huang, Fei Xia, Ted Xiao, et al. (Robotics at Google)
- **arXiv**: 2207.05608

**Key Concept**: LLM creates an "inner monologue" by continuously incorporating environment feedback into planning prompts. This enables closed-loop planning where execution results inform subsequent planning.

**Methodology**:
- Three types of feedback: passive scene description, active scene description, success detection
- Feedback continuously substituted into LLM prompts during execution
- Enables replanning when intermediate actions fail

**Results**: Significant improvements on long-horizon mobile manipulation tasks

**Relevance**: Shows how to create feedback loops between plan execution and plan generation

---

## Core Innovation Pattern

**Common Theme Across Research**:
LLM outputs executable code/programs/structured plans (Python/Selenium/PyAutoGUI/JSON/DSL) instead of natural language actions. A separate interpreter/runtime executes the output. This separates reasoning from execution.

**Application to Web.Chat Hybrid Approach**:
- LLM outputs structured JSON plan (declarative specification)
- Extension runtime (content script) executes the plan
- Could evolve to LLM generating actual JavaScript/Selenium code snippets for more complex scenarios

## Implementation Decisions

### User Profile & Data Storage
- **Encrypted user profile** stored in `chrome.storage.local`
- Profile contains all user data (name, email, address, SSN, etc.)
- Self-improving: LLM prompts for missing fields during form-fill and adds to profile
- Encryption applied to entire profile object using Web Crypto API
- User provides passphrase once per session to decrypt
- Decrypted profile kept in memory during active session, purged on idle/close

### Autonomy Level
- **Fully autonomous execution** from the start
- Required for multi-agent orchestration use case (single sign-on → multiple utility accounts)
- Step-by-step confirmation would break orchestrator workflow
- Testing strategy: Local test pages with various form styles before touching real utility sites
- Safety during development: Detailed logging and audit trails

### Multi-step Form Handling
- **Support multi-step forms/wizards** - encapsulate all complexity within form-filler agent
- Form-filler detects single-page vs. multi-step flows internally
- Handles navigation (Next/Previous buttons, step transitions) autonomously
- Orchestrator sees simple interface with three possible states:
  - `{ status: "completed", success: true }` - form fully filled
  - `{ status: "completed", success: false, reason: "..." }` - unrecoverable failure
  - `{ status: "awaiting_data", missingFields: [...] }` - needs additional user data
- Division of labor: Orchestrator dispatches high-level tasks; form-filler handles domain-specific flow complexity
- **Missing data handling**:
  - Form-filler pauses execution when encountering unknown fields
  - Returns structured request with field keys, prompts, and types
  - Orchestrator prompts user and updates encrypted profile
  - Orchestrator calls `formFiller.resume(updatedProfile)` to continue from paused state
  - Form-filler resumes where it left off (doesn't restart from scratch)
  - Profile becomes self-improving across all future form fills

### CAPTCHA Handling
- **User solves CAPTCHAs manually** - no third-party solving service integration
- Form-filler pauses execution when CAPTCHA detected, returns `{ status: "awaiting_captcha", captchaType: "...", message: "..." }`
- Orchestrator notifies user (browser notification or panel alert)
- User switches to the tab (already open), solves CAPTCHA manually, clicks "Resume" in panel
- Orchestrator calls `formFiller.resume()` to continue execution
- Form-filler verifies CAPTCHA solved state before proceeding
- **Tab management**: Orchestrator opens tabs programmatically at task dispatch
  - Uses `chrome.tabs.create({ url, active: false })` for each form-fill task
  - Each form-filler receives `tabId` parameter to know which tab to operate on
  - Tabs opened in background (don't steal focus) unless CAPTCHA requires user attention
- **Advantages**: Zero integration cost, works with all CAPTCHA types, no privacy concerns, no third-party API dependencies

### Open Questions

1. **Plan representation**: Stay with JSON or evolve to executable JavaScript code generation?

## Next Steps for Implementation

*To be filled in as design progresses*
