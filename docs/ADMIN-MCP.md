# Admin MCP

The report queue, precedents and developers' feedback in a Claude session: pull the latest reports in, talk them through, and decide there. It's at `zaisma.com/admin/mcp`, behind the same Cloudflare Access login as the admin pages (`apps/site/src/admin-mcp.ts`).

## Tools

| Tool | What it does |
| --- | --- |
| `list_reports` | Open reports grouped by problem, most serious first, with what triage found and recommends. Optionally what triage handled without a person this week. |
| `get_report` | One group in full: what players sent and any picture, the game, its versions and scans, re-checks, the precedent or the drafted one, recent history, and what can be decided. |
| `decide_report` | Dismiss, hide a reported room's name, pass to the developer, take down, or put back a paused game or update, exactly like the queue's buttons; optionally sets a precedent at the same time. |
| `list_precedents`, `set_precedent`, `approve_precedent` | Read, set, change, approve and retire precedents. |
| `get_game` | A game as admin sees it: versions and scans, open reports, history. |
| `list_feedback` | Feedback from developers and their AI about Zaisma itself, most serious first: items on their own and known issues, how many developers each affects and the latest post. By default the new ones, plus items added to or reopened inside a known issue. |
| `get_feedback` | One item in full: every post and who wrote it (the developer or their AI), what the AI attached, up to 3 screenshots, the developer's name, the game, and the items merged into it. |
| `decide_feedback` | Reply, set a status (on a known issue it reaches every item in it), merge a duplicate into a known issue, make an item a known issue (a title, workaround and roadmap item every developer sees), and set severity and area. |

Child-safety reports come first. Triage never sorts them with AI, but here the admin is the person looking, so Claude can help read and decide them. Their pictures are never sent (a report triage only later found to be about child safety can carry one, and it could be abuse material itself), and they can't be passed to the developer. Decisions are recorded in the audit log under the service token's name. Player, game and feedback text is untrusted; the MCP's instructions tell Claude not to follow it and to ask before deciding anything. Known-issue titles and workarounds are seen by every developer, so they're written without names, games or anything one developer said in private.

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
