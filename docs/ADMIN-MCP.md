# Admin MCP

The report queue and precedents in a Claude session: pull the latest reports in, talk them through, and decide there. It's at `zaisma.com/admin/mcp`, behind the same Cloudflare Access login as the admin pages (`apps/site/src/admin-mcp.ts`).

## Tools

| Tool | What it does |
| --- | --- |
| `list_reports` | Open reports grouped by problem, most serious first, with what triage found and recommends. Optionally what triage handled without a person this week. |
| `get_report` | One group in full: what players sent and any picture, the game, its versions and scans, re-checks, the precedent or the drafted one, recent history, and what can be decided. |
| `decide_report` | Dismiss, pass to the developer, take down, or put back a paused game or update, exactly like the queue's buttons; optionally sets a precedent at the same time. |
| `list_precedents`, `set_precedent`, `approve_precedent` | Read, set, change, approve and retire precedents. |
| `get_game` | A game as admin sees it: versions and scans, open reports, history. |

Child-safety reports never reach any AI, this one included: they show only as a count, and are reviewed at zaisma.com/admin/reports. Decisions are recorded in the audit log under the service token's name. Player and game text is untrusted; the MCP's instructions tell Claude not to follow it and to ask before deciding anything.

## Connect Claude Code

1. In the Cloudflare dashboard: Zero Trust → Access → Service credentials → Service Tokens → Create a service token (for example "Claude admin MCP"). Copy the client ID and secret; the secret is shown once.
2. Access → Applications → the zaisma.com admin application → add a policy with the action **Service Auth** that includes that service token.
3. In a terminal, with the two values from step 1:

```bash
claude mcp add --scope user --transport http zaisma-admin https://zaisma.com/admin/mcp --header "CF-Access-Client-Id: <client id>" --header "CF-Access-Client-Secret: <client secret>"
```

To revoke it, delete the service token in Cloudflare.

## Try it on the preview

The local preview (`npm run preview`) needs no login:

```bash
claude mcp add --transport http zaisma-admin-preview http://localhost:8800/admin/mcp
```
