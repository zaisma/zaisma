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
| `list_feedback` | Feedback from developers and their AI about Zaisma itself (topics in the developer forum), most serious first: items on their own and known issues, whether each is public, how many developers each affects, the latest post and what AI sorting found (`sorted`: a summary, why, a public topic it `looks_like`, and for a new problem a drafted known issue to approve). By default the new ones, plus items added to or reopened inside a known issue, and `posts_to_check`: public posts the check held (with why) or couldn't check yet. |
| `get_feedback` | One item in full: every post and who wrote it (the developer or their AI), what the AI attached, up to 3 screenshots, the developer's name, the game, and the items merged into it. |
| `decide_feedback` | Reply, set a status or a known issue's phase (investigating, known (confirmed), planned, fixing, released (a fix is out, watching it hold), fixed (resolved), wont; on a known issue it reaches every item in it, and developers can say it still happens while it's released, which takes it back to fixing and alerts you), merge a duplicate into a known issue, make an item a known issue (a title, workaround and roadmap item every developer sees), mark a reply as a question's `answer`, and set severity and area. A private report made a known issue becomes a new public topic of Zaisma's own with the report under it; the reply goes to that developer alone. On a public topic, a reply is public. |
| `check_post` | Show a public forum post the check held or developers reported (which clears its reports), or remove it. Removing a topic's first post makes the topic private to its developer again. |

Child-safety reports come first. Triage never sorts them with AI, but here the admin is the person looking, so Claude can help read and decide them. Their pictures are never sent (a report triage only later found to be about child safety can carry one, and it could be abuse material itself), and they can't be passed to the developer. Decisions are recorded in the audit log under the service token's name. Player, game and feedback text is untrusted; the MCP's instructions tell Claude not to follow it and to ask before deciding anything. Known-issue titles and workarounds are seen by every developer, so they're written without names, games or anything one developer said in private.

Every few minutes an AI sorts new feedback (`apps/site/src/feedback-sort.ts`), on the same run and monthly AI budget as report triage: it sets severity (never the category: whoever posts picks it, and AI moves a topic only when someone flags it as misplaced), merges a duplicate into the item or known issue it repeats (a developer merged into a known issue is told an AI matched it, and gets the workaround), alerts on anything urgent, and drafts a known issue for a new problem. The draft stays private until the admin approves it with `decide_feedback`.

Every public post in the developer forum is checked by AI before others see it (`apps/site/src/forum-check.ts`), as it's sent and again on the 5-minute run. One the check holds, or one it couldn't check (no AI key, or the month's budget used up), waits in `posts_to_check` for `check_post`. Sorting never merges a public topic on its own: it says which one it `looks_like`, and the admin decides. Public posts that mention `@Zaisma` with no reply from Zaisma since come back in `list_feedback` as `zaisma_mentioned` (and under Asked for Zaisma on the admin pages); a reply in the topic answers them.

The same queue is on the admin pages at `zaisma.com/admin/feedback` (`apps/site/src/admin-feedback.ts`): the cards come from `list_feedback`, each item's page from `get_feedback`, saving a card calls `decide_feedback` with only what the form changed, and the posts waiting for a check have Show it and Remove.

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
