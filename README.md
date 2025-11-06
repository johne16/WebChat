# Web.Chat — Developer README

## Overview

Web.Chat is a Chromium extension that adds an AI-powered side panel to help users explore and understand web pages. It
connects to a local server that relays chat messages to the OpenAI API.

## Prerequisites

* Install **Node.js** and **npm**.
* Use a Chromium-based browser (Chrome, Brave, etc.).

## Setup

1. Clone this repository.
2. Create an environment file in `./server/.env`:

   ```
   OPENAI_API_KEY=your_openai_api_key_here
   BRAVE_SEARCH_API_KEY=your_brave_search_api_key_here
   PORT=3000
   ```

   **Note**: Get your Brave Search API key from [https://brave.com/search/api/](https://brave.com/search/api/)

3. Install dependencies so that `node_modules` lives under `./server`:

   ```bash
   cd server
   npm install
   ```
4. Start the local server:

   ```bash
   npm start
   # or
   node server.js
   ```

   The server listens on the `PORT` value from `.env`.

## What `manifest.json` Does

The manifest defines the extension’s configuration, permissions, and entry points.
Key components in this project:

* `manifest_version`: must be `3`
* `name`, `version`, `description`, `icons`: identify and brand the extension
* `host_permissions`: grants access to all URLs
* `permissions`: `sidePanel`, `tabs`, `activeTab`, `storage`, `scripting`
* `background.service_worker`: runs `background.js` as a module
* `commands`: defines the toggle shortcut (`Ctrl+Shift+Y` / `Command+Shift+Y`)
* `options_ui`: opens the options page for user settings

Full documentation: [Chrome Manifest Reference](https://developer.chrome.com/docs/extensions/reference/manifest)

## Chat Flow (Request → Response)

1. User types a message in **panel.html**.
2. **panel.js** captures input and sends it to **llmClient.js**.
3. **llmClient.js** formats JSON and sends it to **server.js**.
4. **server.js** reads `OPENAI_API_KEY` from `.env`, calls the OpenAI API, and returns the model’s reply.
5. The response travels back through **llmClient.js** → **panel.js** → displayed in **panel.html**.
6. Optional: **contentScript.js** and **extraction.js** can extract visible DOM content for context.
7. **background.js** manages tab context, scripting, and command events.

## Project Structure

```
.
├── extension
│   ├── background.js          # Manages extension lifecycle, tab tracking
│   ├── contentScript.js       # DEPRECATED: Use Crawl4AI instead
│   ├── extraction.js          # DEPRECATED: Use Crawl4AI instead  
│   ├── icons/                 # Extension icons
│   ├── llmClient.js           # OpenAI API client + ReAct LLM functions
│   ├── react.js               # ReAct loop orchestrator
│   ├── searchClient.js        # Brave Search API client
│   ├── manifest.json          # Extension configuration
│   ├── options.css            # Settings page styles
│   ├── options.html           # Settings page UI
│   ├── options.js             # Settings page logic
│   ├── panel.css              # Side panel styles
│   ├── panel.html             # Side panel UI
│   └── panel.js               # Side panel logic, message routing
└── server
    ├── package-lock.json
    ├── package.json
    └── server.js              # Express proxy for OpenAI, Brave Search, Crawl4AI
```

## Common Checks

* `./server/node_modules/` must exist — if missing, run `npm install` inside `./server`.
* `.env` must reside inside `./server`.
* Restart the extension after modifying `options.html` or `manifest.json`.

## Installing the Extension in Chrome or Brave

1. Open your browser and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle at top right).
3. Click **Load unpacked**.
4. Select the `./extension` directory.
5. The extension will appear in the extensions list as **Web.Chat**.

**Important:** The **local server must be running** while using the extension.
When you open the side panel or send a chat, the extension communicates with `server.js`. If the server is not active,
chat requests will fail.

To keep the workflow stable:

```bash
cd server
node npm start
```

Then interact with the extension as normal in your browser.

**NOTE:** The extension has two modes:

1. **Testing Mode** (default): Echoes user input back. Good for UI testing without API calls.
2. **AI Mode**: Connects to OpenAI and web services.

To switch modes, click the settings icon (⚙️) in the side panel.

Additionally, AI Mode has two sub-modes:
- **Simple Mode**: Classifies query, crawls current site if needed, answers with LLM
- **Research Mode**: Uses ReAct framework for iterative web search and reasoning (up to 5 steps)

Toggle Research Mode via:
- Settings page toggle switch
- Network icon button in side panel header (glows blue when active)
