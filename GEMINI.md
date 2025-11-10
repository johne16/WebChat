# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

## Documentation

**For comprehensive project documentation, see [CLAUDE.md](CLAUDE.md).**

CLAUDE.md contains the complete guide including:
- Project overview and architecture
- Development setup (server + extension)
- Request flow and key components
- Coding style and conventions
- Testing and debugging guidelines
- Commit and PR guidelines
- Technical reference (ports, storage, rate limits)

## Quick Start

Web.Chat is a Chromium extension with an AI-powered side panel that communicates with a local Express server proxying requests to OpenAI, Brave Search, and Crawl4AI.

**Setup in 3 steps:**
1. `cd server && npm install` then create `.env` with API keys and `PORT=8787`
2. `npm start` in `server/` directory
3. Load `extension/` directory as unpacked extension at `chrome://extensions`

See [CLAUDE.md](CLAUDE.md) for detailed instructions.
