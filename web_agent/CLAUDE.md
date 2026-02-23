# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An autonomous web agent that uses GPT-5 to execute natural language goals on websites. The agent analyzes pages, decides actions via LLM planning, executes them (form filling, clicking, navigation), and maintains session memory across steps.

## Architecture

**7-Module Design:**

1. **web_agent.py** - Main orchestrator running the autonomous loop:
   - Accepts natural language goals (e.g., "Sign up then sign in")
   - Loops: analyze page → LLM plans action → execute → update memory → repeat
   - Tracks goal status: in_progress, achieved, blocked, failed
   - Handles consecutive failures (gives up after 3)

2. **action_executor.py** - Executes actions decided by planner:
   - Action registry: fill_form, click_link, click_button, go_back, scroll, wait, read_content
   - For `fill_form`: calls LLM to generate JS code, validates, executes
   - Stores entered data in memory for credential reuse

3. **memory.py** - SQLite-backed session memory:
   - Persists to `data/sessions.db`
   - Tracks: entered_data, visited_urls, action_history, extracted_info, user_profile, missing_fields
   - Enables session resume via sessionId
   - Stores full user profile for interactive data collection

4. **llm.py** - OpenAI GPT-5 client:
   - `generate_plan()` - Returns JSON with action, params, reasoning, goal_status, missing_fields
   - `generate_fill_code()` - Returns JavaScript for form filling
   - Loads prompts from `prompts/` directory

5. **browser.py** - Playwright wrapper:
   - HTML preprocessing via `get_form_elements()` (reduces tokens)
   - Page extraction: `get_page_links()`, `get_page_buttons()`, `get_readable_content()`
   - Navigation: `navigate()`, `go_back()`, `scroll()`

6. **execution_engine.py** - JavaScript validation and execution:
   - Security validation (blocks eval, fetch, innerHTML, etc.)
   - Injects helper functions via `page.expose_function()`
   - Extracts submit button for separate handling (avoids context destruction)
   - Helper functions: fillField, clickButton, selectOption, selectRadio, checkCheckbox, waitForElement

7. **agent_service.py** - FastAPI server (v2.0.0):
   - `POST /api/execute-goal` - Execute a goal
   - `POST /api/session/{sessionId}/continue` - Continue with additional data
   - `GET /health` - Health check

**Core Loop (web_agent.py):**
```
Navigate to startUrl
    ↓
┌─→ BUILD PAGE CONTEXT (forms, links, buttons, content)
│       ↓
│   LLM PLANS next action based on goal + page + memory
│       ↓
│   Goal achieved? → YES → RETURN SUCCESS
│       ↓ NO
│   EXECUTE action (fill_form, click_link, etc.)
│       ↓
│   Update memory, track URL changes
│       ↓
└───────┘
```

## Development Commands

### Setup
```bash
pip install -r requirements.txt
playwright install chromium
```

### Run Server
```bash
python -m src.agent_service
```
Server runs on port 5001. API docs at `http://localhost:5001/docs`.

### Testing
```bash
# Run all unit tests
pytest tests/

# Run specific test file
pytest tests/test_browser.py -v

# Run integration tests (requires Web_Test_Bed on localhost:5000)
pytest tests/test_integration.py -v
```

### Code Formatting
```bash
black src/ tests/
flake8 src/ tests/
```

## Configuration

All configuration in `.env` file:
- `OPENAI_API_KEY` - Required
- `PORT` - Server port (default: 5001)
- `DEBUG` - Enables debug logging (default: true)
- `HEADLESS` - Browser headless mode (default: false)
- `OPENAI_MODEL` - Model to use (default: gpt-5)
- `TEMPERATURE` - LLM temperature (default: 0.1)
- `MAX_AGENT_STEPS` - Max steps before giving up (default: 20)
- `MAX_RETRY_ATTEMPTS` - Max retries on error (default: 1)
- `SAVE_GENERATED_CODE` - Saves generated JS to logs/ (default: true)

## API

### POST /api/execute-goal

**Request:**
```json
{
  "goal": "Sign up for an account then sign in with the same credentials",
  "startUrl": "http://localhost:5000/signup",
  "userProfile": {
    "email": "john@example.com",
    "password": "TestPass123",
    "firstName": "John",
    "lastName": "Doe"
  },
  "sessionId": null,
  "options": {
    "maxSteps": 20,
    "headless": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "goalAchieved": true,
  "sessionId": "abc-123",
  "status": "achieved",
  "finalUrl": "http://localhost:5000/dashboard",
  "stepsTaken": 4,
  "executionTime": 12.5,
  "tokensUsed": 3200,
  "actionHistory": [...],
  "memory": {
    "enteredData": {"email": "john@example.com", "password": "***"},
    "visitedUrls": [...],
    "extractedInfo": {}
  },
  "errors": []
}
```

**Response when missing user data:**
```json
{
  "success": true,
  "goalAchieved": false,
  "sessionId": "abc-123",
  "status": "needs_input",
  "needsInput": true,
  "missingFields": ["birthCity"],
  "message": "Form requires birth city for security question"
}
```

### POST /api/session/{sessionId}/continue

Continue a paused session with additional data.

**Request:**
```json
{
  "additionalData": {"birthCity": "Austin"}
}
```

**Response:** Same as execute-goal response.

## Critical Implementation Details

### LLM Planning (llm.py)
- Uses `prompts/planning_prompt.txt` for action planning
- Returns JSON with: action, params, reasoning, goal_status, missing_fields
- Goal status: "in_progress", "achieved", "blocked", "needs_input", "awaiting_user_action"
- When status is "needs_input", missing_fields lists required data not in user profile
- When status is "awaiting_user_action", user must interact with the visible browser (captcha, selection)
- Available actions: fill_form, click_link, click_button, go_back, scroll, wait, read_content

### Form Filling (action_executor.py)
- Merges user_profile with memory.entered_data (for credential reuse)
- Calls `llm.generate_fill_code()` to get JavaScript
- Validates code, extracts submit button, executes fill, then clicks submit separately
- Stores entered data in memory for subsequent forms

### Session Memory (memory.py)
SQLite schema:
- `sessions` - session_id, goal, status, current_url, current_step
- `memory` - key/value store for entered_data, extracted_info
- `actions` - action history with step, type, params, result, success

### Navigation-Aware Submit Handling
Form submission destroys JS context. Solution:
1. Extract submit click from generated code
2. Execute form filling (no submit)
3. Click submit separately with `page.wait_for_url()` to detect navigation

### Security Validation (execution_engine.py)
Blocks: `eval()`, `Function()`, `fetch()`, `XMLHttpRequest`, `innerHTML`, `document.write()`

## Testing Against Web_Test_Bed

```bash
# Terminal 1: Start test forms
cd C:\Users\John\PycharmProjects\Web_Test_Bed
python app.py  # Runs on port 5000

# Terminal 2: Start agent
cd web_agent
python -m src.agent_service  # Runs on port 5001

# Terminal 3: Test
curl -X POST http://localhost:5001/api/execute-goal \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Sign up then sign in with the same credentials",
    "startUrl": "http://localhost:5000/signup",
    "userProfile": {
      "email": "john@example.com",
      "password": "TestPass123",
      "firstName": "John",
      "lastName": "Doe"
    }
  }'
```

Available test forms:
- `/signup` - 10 fields (email, password, name, address, phone, DOB)
- `/signin` - 2 fields (email, password)

## LLM Call Flow

For a "signup then signin" goal, expect ~6 LLM API calls:
1. Plan: analyze signup page → fill_form action
2. Code: generate JS for signup form
3. Plan: analyze success page → click_link to signin
4. Plan: analyze signin page → fill_form action
5. Code: generate JS for signin form (reuses credentials from memory)
6. Plan: analyze dashboard → goal achieved

## Docker

```bash
# Build
docker build -t web-agent .

# Run
docker run -p 5001:5001 -e OPENAI_API_KEY=sk-xxx web-agent

# Run with persistent session storage
docker run -p 5001:5001 -e OPENAI_API_KEY=sk-xxx -v ./data:/app/data web-agent
```

Container defaults: `HEADLESS=true`, `DEBUG=false`, `PORT=5001`

## Debugging

When `DEBUG=true`:
- Step-by-step logging: URL, LLM decision, action result
- Form preprocessing metrics
- Generated JavaScript code

When `headless=false`:
- Browser window visible for real-time observation