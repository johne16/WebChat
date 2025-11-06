# GEMINI.md

## Project Overview

This project is a Chromium browser extension called "Web.Chat". It provides an AI-powered side panel to help users understand and explore web pages. The extension communicates with a local Node.js server that acts as a proxy to the OpenAI and Brave Search APIs.

The project is structured into two main parts:
- **`extension/`**: Contains the frontend code for the browser extension, including the side panel UI, background scripts, and content scripts.
- **`server/`**: Contains the backend Node.js server that handles API requests.

## Building and Running

### Prerequisites

- Install Node.js and npm.
- Use a Chromium-based browser (e.g., Chrome, Brave).

### Server Setup

1.  **Create Environment File**:
    In the `server/` directory, create a `.env` file with the following content:

    ```
    OPENAI_API_KEY=your_openai_api_key_here
    BRAVE_SEARCH_API_KEY=your_brave_search_api_key_here
    PORT=3000
    ```

2.  **Install Dependencies**:
    Navigate to the `server/` directory and install the required npm packages:

    ```bash
    cd server
    npm install
    ```

3.  **Run the Server**:
    Start the server from within the `server/` directory:

    ```bash
    npm start
    ```

    The server will run on the port specified in your `.env` file (default is 3000).

### Extension Setup

1.  **Load the Extension**:
    - Open your Chromium browser and navigate to `chrome://extensions`.
    - Enable "Developer mode".
    - Click "Load unpacked" and select the `extension/` directory.

2.  **Using the Extension**:
    - The Web.Chat extension should now be installed. You can toggle the side panel using the keyboard shortcut `Ctrl+Shift+Y` (or `Command+Shift+Y` on Mac).
    - The local server must be running for the extension to function correctly.

## Development Conventions

- The server is an ES module-based Node.js application using Express.js.
- The extension is built using standard HTML, CSS, and JavaScript, following the Chrome Extension Manifest V3 specifications.
- The `README.md` file provides a detailed explanation of the chat flow and project structure.
- The extension has a "Testing Mode" that can be enabled from the settings panel to test the UI without making live API calls.
- The AI mode has two sub-modes: "Simple Mode" and "Research Mode".
