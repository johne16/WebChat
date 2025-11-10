# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Documentation

**For comprehensive project documentation, see [CLAUDE.md](CLAUDE.md).**

CLAUDE.md contains the complete guide including:
- Project structure and architecture
- Development setup and workflow
- Coding style and naming conventions
- Testing guidelines
- Commit and PR guidelines
- Security best practices
- Technical reference

## Quick Reference

Web.Chat is a Chromium extension (`extension/`) + Express server (`server/`) that provides an AI-powered side panel for exploring web pages. The server proxies requests to OpenAI, Brave Search, and Crawl4AI services.

**Development workflow:**
- `cd server && npm start` to run the server on port 8787
- Load `extension/` as unpacked extension
- Test manually (no automated tests yet)
- Commit style: lowercase imperative (`added feature`, `fixed bug`)
- Never commit `.env` or API keys

See [CLAUDE.md](CLAUDE.md) for detailed instructions.
