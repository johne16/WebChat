# Web Agent

An autonomous web agent that uses GPT-5 to execute natural language goals on websites. The agent analyzes pages, decides actions via LLM planning, executes them (form filling, clicking, navigation), and maintains session memory across steps.

## Features

- **Goal-Oriented Execution**: Accepts natural language goals (e.g., "Sign up then sign in")
- **Autonomous Planning**: LLM analyzes page context and decides next action
- **Session Memory**: SQLite-backed memory for credential reuse, user profile persistence, and session resume
- **Interactive Data Collection**: Agent can pause and request missing user data via `needs_input` status
- **User Action Support**: Agent pauses for captchas, selections, or verifications via `awaiting_user_action` status
- **Multi-Action Support**: fill_form, click_link, click_button, go_back, scroll, wait, read_content
- **Code Validation**: Security-focused validation prevents dangerous operations
- **REST API**: FastAPI server for easy integration as an LLM tool
- **Docker Support**: Runs as standalone container for use by other LLMs

## Architecture

**7-Module Design:**
- `web_agent.py` - Main orchestrator running the autonomous loop
- `action_executor.py` - Executes actions decided by planner
- `memory.py` - SQLite-backed session memory
- `llm.py` - OpenAI GPT-5 client
- `browser.py` - Playwright wrapper + HTML preprocessing
- `execution_engine.py` - JS validation + execution
- `agent_service.py` - FastAPI server (v2.0.0)

## Installation

### Prerequisites

- Python 3.13+
- OpenAI API key
- Git (optional)

### Setup

1. **Clone or navigate to the project:**
   ```bash
   cd web_agent
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Install Playwright browsers:**
   ```bash
   playwright install chromium
   ```

4. **Configure environment variables:**

   Edit `.env` file and add your OpenAI API key:
   ```env
   OPENAI_API_KEY=your-api-key-here
   PORT=5001
   DEBUG=true
   SAVE_GENERATED_CODE=true
   ```

## Usage

### Start the Server

```bash
python -m src.agent_service
```

The server will start on `http://localhost:5001`

### API Documentation

Interactive API docs available at: `http://localhost:5001/docs`

### Execute a Goal

**Endpoint:** `POST /api/execute-goal`

**Example Request:**

```bash
curl -X POST http://localhost:5001/api/execute-goal \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

**Example Response:**

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

### Handling Missing User Data

When the agent encounters a form requiring data not in the user profile, it returns `needsInput: true`:

**Response when data is missing:**
```json
{
  "success": true,
  "goalAchieved": false,
  "sessionId": "abc-123",
  "status": "needs_input",
  "needsInput": true,
  "missingFields": ["birthCity"],
  "message": "Form requires birth city for security question but user profile doesn't have it",
  ...
}
```

**Continue with additional data:**

```bash
curl -X POST http://localhost:5001/api/session/abc-123/continue \
  -H "Content-Type: application/json" \
  -d '{"additionalData": {"birthCity": "Austin"}}'
```

The agent merges the new data into the stored profile and continues execution.

### Handling User Actions (Captchas, Selections)

When the agent encounters a captcha, verification, or user selection it cannot automate, it returns `awaitingUserAction: true`:

**Response when user action needed:**
```json
{
  "success": true,
  "goalAchieved": false,
  "sessionId": "abc-123",
  "status": "awaiting_user_action",
  "awaitingUserAction": true,
  "message": "Page has a CAPTCHA that requires human interaction",
  ...
}
```

The user interacts with the visible browser window (default: `headless=false`), then continues:

```bash
curl -X POST http://localhost:5001/api/session/abc-123/continue \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Testing Against Web_Test_Bed

The agent is designed to work with the Flask test forms at `C:\Users\John\PycharmProjects\Web_Test_Bed`.

### Testing Workflow

1. **Start Web_Test_Bed (Terminal 1):**
   ```bash
   cd C:\Users\John\PycharmProjects\Web_Test_Bed
   python app.py
   ```
   (Runs on port 5000)

2. **Start Form-Filling Agent (Terminal 2):**
   ```bash
   cd web_agent
   python -m src.agent_service
   ```
   (Runs on port 5001)

3. **Send test request:**
   ```bash
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

### Test Forms Available

- **Sign Up** (`/signup`) - 10 fields (email, password, name, address, phone, DOB)
- **Sign In** (`/signin`) - 2 fields (email, password)

## Configuration

All configuration is managed via `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-5` | OpenAI model to use |
| `PORT` | `5001` | Server port |
| `DEBUG` | `true` | Enable debug logging |
| `HEADLESS` | `false` | Run browser in headless mode |
| `TEMPERATURE` | `0.1` | LLM temperature (deterministic) |
| `MAX_AGENT_STEPS` | `20` | Max steps before giving up |
| `MAX_RETRY_ATTEMPTS` | `1` | Max retries on error |
| `SAVE_GENERATED_CODE` | `true` | Save generated JS to logs/ |

## Project Structure

```
web_agent/
├── src/
│   ├── web_agent.py          # Main orchestrator (autonomous loop)
│   ├── action_executor.py    # Action execution (fill_form, click, etc.)
│   ├── memory.py             # SQLite session memory
│   ├── llm.py                # OpenAI GPT-5 client
│   ├── browser.py            # Playwright wrapper + HTML preprocessing
│   ├── execution_engine.py   # JS validation + execution
│   └── agent_service.py      # FastAPI server
├── prompts/
│   └── planning_prompt.txt   # LLM planning prompt
├── data/
│   └── sessions.db           # SQLite session storage
├── tests/                    # Unit and integration tests
├── logs/                     # Generated code and logs
├── Dockerfile                # Container build
├── requirements.txt          # Python dependencies
├── .env                      # Environment variables
└── README.md                 # This file
```

## How It Works

1. **Navigate**: Browser navigates to startUrl
2. **Build Context**: Extract forms, links, buttons, readable content from page
3. **Plan**: LLM analyzes goal + page context + memory → decides next action
4. **Check**: If goal achieved → return success
5. **Execute**: Run action (fill_form, click_link, click_button, etc.)
6. **Update**: Store entered data in memory, track URL changes
7. **Loop**: Repeat steps 2-6 until goal achieved or max steps reached

## API Functions Available to LLM

The LLM generates code using these functions (injected into browser):

- `fillField(selector, value)` - Fill input/textarea fields
- `clickButton(selector)` - Click buttons
- `selectOption(selector, value)` - Select dropdown options
- `selectRadio(name, value)` - Select radio buttons by name and value
- `checkCheckbox(selector, checked)` - Toggle checkboxes
- `waitForElement(selector, timeout)` - Wait for elements


## Development

### Running Tests

The test suite includes unit tests and integration tests.

**Note:** Unit tests require `OPENAI_API_KEY` in `.env` (even though LLM calls are mocked). Set a dummy value if needed: `OPENAI_API_KEY=fake-key-for-tests`

**Run all unit tests:**
```bash
pytest tests/ --ignore=tests/test_integration.py -v
```

**Run all tests including integration** (requires Web_Test_Bed running):
```bash
pytest tests/ -v
```

### Recommended Testing Order

Start with foundational components, then build up to full system tests:

```bash
# 1. Memory - SQLite storage (no browser, no LLM)
pytest tests/test_memory.py -v

# 2. Execution engine - code validation and parsing
pytest tests/test_execution.py -v

# 3. Browser - navigation and HTML extraction (needs playwright)
pytest tests/test_browser.py -v

# 4. LLM client - prompt building, response parsing (mocked API)
pytest tests/test_llm.py -v

# 5. Action executor - all action types (mocked dependencies)
pytest tests/test_action_executor.py -v

# 6. Web agent - orchestrator and goal execution (mocked dependencies)
pytest tests/test_web_agent.py -v

# 7. API service - FastAPI endpoints (mocked agent)
pytest tests/test_agent_service.py -v

# 8. Integration - full system against real pages
#    First start Web_Test_Bed:
#      cd C:\Users\John\PycharmProjects\Web_Test_Bed
#      python app.py
pytest tests/test_integration.py -v
```

If steps 1-7 pass, components work in isolation. If step 8 passes, the whole system works end-to-end.

### Test Coverage (~120 tests)

**Unit tests** (mocked, no services required):

| Test File | Description |
|-----------|-------------|
| `test_memory.py` | SQLite session memory, CRUD operations, user profile, missing fields |
| `test_execution.py` | JavaScript validation, parsing, execution, selectRadio |
| `test_browser.py` | Browser navigation and HTML preprocessing |
| `test_llm.py` | LLM client, plan generation, code extraction, needs_input/awaiting_user_action parsing |
| `test_action_executor.py` | All action types (fill_form, click, scroll, etc.) |
| `test_web_agent.py` | Orchestrator, goal execution, failure handling |
| `test_agent_service.py` | FastAPI endpoints, request validation, continue endpoint, needs_input/awaiting_user_action responses |

**Integration tests:**

| Test File | Description | Requirements |
|-----------|-------------|--------------|
| `test_integration.py` | Full agent flow against real pages (signup, signin) | Web_Test_Bed on port 5000 |
| `test_integration.py::TestAPIIntegration` | API endpoint tests via HTTP | Web_Test_Bed on port 5000 AND agent on port 5001 |

### Docker and Local Testing

**Important:** For `TestAPIIntegration` tests, run the agent directly—not in Docker:

```bash
python -m src.agent_service
```

**Why?** Docker containers have their own network namespace. When the agent runs inside Docker and tries to navigate to `localhost:5000`, that `localhost` refers to the container itself—not your host machine where Web_Test_Bed is running. The container can't see services on the host's localhost.

- **Host machine:** `localhost:5000` → Web_Test_Bed ✓
- **Inside Docker:** `localhost:5000` → nothing (container is isolated) ✗

**Workaround options:**
1. Run the agent directly for local testing (recommended for development)
2. Use `host.docker.internal` instead of `localhost` in startUrl when calling a Dockerized agent
3. Run Docker with `--add-host=host.docker.internal:host-gateway` flag

For production, this isn't an issue—target websites won't be on `localhost`.

### Useful Pytest Flags

| Flag | Description |
|------|-------------|
| `-v` | Verbose output - show individual test names |
| `-rs` | Show reasons for skipped tests |
| `-ra` | Show summary for all non-passed tests (failed, skipped, errors) |
| `-rf` | Show summary for failed tests only |
| `--lf` | Rerun only tests that failed last time |
| `--ff` | Run failed tests first, then the rest |
| `-x` | Stop on first failure |
| `-s` | Show print statements (don't capture stdout) |
| `--tb=short` | Shorter traceback on failures |

**Examples:**
```bash
# Verbose with skip reasons (good for integration tests)
pytest tests/test_integration.py -v -rs

# Stop on first failure with short traceback
pytest tests/ -x --tb=short

# Rerun only previously failed tests
pytest tests/ --lf -v

# Show print statements for debugging
pytest tests/test_memory.py -v -s
```

### Code Formatting

Optional code quality tools (installed via requirements.txt):

**black** - Auto-formats Python code to consistent style:
```bash
black src/ tests/
```
Automatically fixes indentation, line length, quotes, etc.

**flake8** - Checks code for style violations and errors:
```bash
flake8 src/ tests/
```
Reports issues like unused imports, undefined variables, PEP 8 violations (doesn't modify files).

### Watching Browser Automation

Set `headless=false` in request options or `.env` to watch the browser work.

### Viewing Generated Code

- Console logs (when `DEBUG=true`)
- Saved files in `logs/generated_code/` (when `SAVE_GENERATED_CODE=true`)

## Docker

Build and run as a standalone container (for use as an LLM tool):

```bash
# Build
docker build -t web-agent .

# Run with API key
docker run -p 5001:5001 -e OPENAI_API_KEY=sk-xxx web-agent

# Run with persistent session storage
docker run -p 5001:5001 -e OPENAI_API_KEY=sk-xxx -v ./data:/app/data web-agent

# Run with env file
docker run -p 5001:5001 --env-file .env web-agent
```

Container defaults: `HEADLESS=true`, `DEBUG=false`, `PORT=5001`

Another LLM can call `POST http://<container-host>:5001/api/execute-goal` as a tool.

## Troubleshooting

### "OPENAI_API_KEY not set"
- Edit `.env` file and add your API key

### "Module not found" errors
- Run `pip install -r requirements.txt`
- Ensure virtual environment is activated

### Browser won't launch
- Run `playwright install chromium`
- Check Windows Defender/firewall settings

### Form filling fails
- Check browser console (set `headless=false`)
- Review generated code in logs
- Verify form selectors in Web_Test_Bed

## Future Enhancements

- CAPTCHA handling
- Encrypted profile storage
- Site-specific caching
- Advanced multi-turn error recovery
- Visual feedback (screenshot analysis)

## License

MIT

## Contributing

This is a research/development project. Feel free to extend and modify for your use case.

## Credits

Built with:
- [Playwright](https://playwright.dev/) - Browser automation
- [FastAPI](https://fastapi.tiangolo.com/) - Web framework
- [OpenAI](https://openai.com/) - GPT-5 API
- [Pydantic](https://pydantic-docs.helpmanual.io/) - Data validation
