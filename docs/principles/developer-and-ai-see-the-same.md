# What a developer can see, their AI can see

The principle "What a developer can see, their AI can see" in [`DECISIONS.md`](../DECISIONS.md). This file is its casebook: what it means, how to test a feature against it, and the real calls made under it. Every case is a real Zaisma call. When a talk settles a new one, it's added here in the same change.

## The rule

**Everything the dashboard shows or does, and everything Zaisma makes public, goes through the developer API and MCP with the same data. A page is built on the API, never beside it.**

## Why it exists

Many of Zaisma's developers build with AI, and their AI works through the MCP, not a browser. A feature that lives on a page alone is a feature their AI can't use, and it means the developer has to stop and click. Building pages on the API also keeps them honest: no screen can show something the API can't (Oct 14, 2026).

## The test

1. **Could the developer's AI do this today, with the same data, without a browser?** If not, the API or MCP part is missing, and it ships first or together with the page.
2. **Does the page read the same API call the AI would make?** If the page has its own route, it's built beside the API.
3. **Is there a reason an AI shouldn't do this?** Then it's a named exception, written down here and in `DECISIONS.md`.

The other way round is fine: the API can give an AI more than a page shows a person, when it only matters at an AI's pace.

## Named exceptions

- **Making API keys stays on the account page,** so an AI can't give itself new keys.

## Cases

### Passes

- **Saves through the API** ship in the API and MCP first; a dashboard page can come later and reads the same calls (Julius, Oct 16, 2026).
- **The game database** has no dashboard-only screens: its import and export page (planned) is built on the same API as the MCP.
- **Webhooks** are set up through the API and MCP, with the same delivery list a page would show (Oct 16, 2026).
- **The forum** is fully in the API and MCP: ranked search, topics readable in part, so an AI searches instead of scraping (Oct 14, 2026).
- **The API tells an AI how many forum posts it has left today,** which no page shows a person: the more-for-AI direction (Oct 14, 2026).

### Fails

- A feature that ships on a page alone.
- A dashboard number the API doesn't return.
