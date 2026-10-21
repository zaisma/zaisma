# Admin MCP

The report queue, precedents, chat reviews and the developer forum's queue in a Claude session: pull the latest reports and topics in, talk them through, and decide there. It's at `zaisma.com/admin/mcp`, behind the same Cloudflare Access login as the admin pages (`apps/site/src/admin-mcp.ts`).

Names, inputs, answers and errors follow [`docs/NAMING.md`](NAMING.md), like the developer MCP's: every tool has an output schema (`apps/site/src/schemas.ts`, its answer or the error), times are ISO 8601 in UTC, every ID says its kind (`report_…`, `precedent_…`, `topic_…`, `post_…`, `chat_review_…`), and arguments are closed: one a tool doesn't take is refused (`unknown_field`, naming the one it likely meant), and so is a value that isn't one it takes. A report group is named by its first report, so its ID is that report's (`report_group_id`). Calls that change something answer with `next_steps`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_report_groups` | Open reports grouped by problem, most serious first, with what triage found and recommends, the precedent it fits and what it did by itself; and the month's AI use. |
| `list_handled_reports` | What triage closed without a person in the last 7 days, to look over. |
| `get_report_group` | One group in full: what players sent and up to 3 pictures, the game, its reported versions and scans, re-checks, triage's view, the precedent or the drafted one, recent history, and `possible_decisions`. |
| `decide_report_group` | Dismiss, hide a reported room's name, pass to the developer, take down, or put back a paused game or update, exactly like the queue's buttons; optionally sets a precedent at the same time. A takedown names the `content_rule` it broke, and keeping an update off can; for both the developer reads `why` as the reason (never for child safety), as the game's or version's `review_reason`. |
| `list_precedents`, `set_precedent`, `approve_precedent`, `retire_precedent` | Read, set, change, approve and retire precedents. Only a dismissal can be applied by the AI alone (`can_ai_apply_alone`); asking for it on another decision is refused. |
| `list_review_precedents`, `approve_review_precedent`, `retire_review_precedent` | Read, test and retire the rulings the AI game review follows when it was wrong (the pages are at `zaisma.com/admin/review-precedents`). A release of a held version, or a rejection or takedown of a game the review passed, drafts one; the person saves it in the same click, it's tried on the test set and goes live only if that holds. `list_review_precedents` includes each one's stand-in test game, so `npm run review-set -- --precedents <file>` can run them (`review-set/README.md`). `approve_review_precedent` sends a drafted or failed one to the test as written. |
| `list_chat_reviews` | Sexual messages from adults to teens the chat filter stopped and kept (`apps/site/src/chat-review.ts`). By default (`chat_review_status` `waiting`) the ones that need the admin: the AI was unsure, they came from a developer's own server, the AI couldn't review them, or they're confirmed and not yet marked reported to NCMEC. Each with the game, the sender's username, its source, the AI's reason, the message and the sender's messages before it. |
| `decide_chat_review` | `false_alarm` deletes it and lifts the sender's pause; `remove_chat` confirms it, removes the sender's chat for good and keeps it a year; `reported` does the same and records that it was reported to NCMEC. The same as the buttons on `zaisma.com/admin/chat-reviews`. |
| `decide_notice` | A copyright (DMCA) or defamation notice that reached dmca@ or safety@zaisma.com: `hold` hides the game without judging the notice (`notice_kind` `copyright` or `defamation`), and the developer reads `why`, what the notice names, as its `review_reason`; `show_again` puts a held game back. Publishing a fixed version emails the admin to check it; a counter-notice brings it back after 10 working days unless the sender has gone to court. The same as the Notice form on a game's admin page. |
| `list_security_spikes` | Hours in the last 30 days when something across Zaisma reached its threshold, each emailed to the admin as it happened: wrong passwords (100) or sign-ins on new devices (50) from one network, API keys made (100), databases exported (500) or scripts blocked on zaisma.com (500). Each with the network (its `autonomous_system`, like `AS64500`, and name, or `null` across Zaisma), the hour and its count (`apps/site/src/security-alerts.ts`). |
| `list_blocked_scripts` | What zaisma.com's script policy blocked in the last 7 days, from the reports browsers send to `/csp-reports`, most reported first: the directive, the blocked source (`inline`, `eval`, or a script's origin, never its path) and the page's path. Browser extensions' reports are dropped. |
| `get_game` | A game as admin sees it, by its slug: versions and scans, open report groups, history. Each version has `replaced_by_version_id` (the newer version that replaced it while it waited, or `null`) and, when it's held, `changes_since`: the version it's compared with (`version_id`, the held one it answers or else the newest earlier scanned one) and the files `added_paths`, `changed_paths` and `removed_paths` since (at most 50 each, with `added_path_count`, `changed_path_count` and `removed_path_count`; empty for zip uploads). |
| `list_publishing_accounts` | The accounts that can make, upload and publish games before the beta, each with its username, player ID and how many games it has. |
| `set_can_publish` | Let an account make, upload and publish games before the beta, by its username, or stop it (`can_publish` false): new games, uploads and publishes stop, and its live games stay up. The same as the buttons on `zaisma.com/admin/publishing`. |
| `list_topics` | Forum topics from developers and their AI about Zaisma itself, most serious first: topics on their own and known issues, whether each is public, how many developers each affects, the latest post and what AI sorting found (`sorting`: a summary, why, a public topic it's the `same_as_topic_id`, and for a new problem a `known_issue_draft` to approve). By default the new ones, and always `topics_in_known_issues` (added to or reopened inside a known issue), `waiting_posts` (public posts the check held, with why, couldn't check yet, or developers reported) and `zaisma_mentions`. |
| `get_topic` | One topic in full: every post and who wrote it (the developer or their AI), what the AI attached (`debug_context`), up to 3 images, the developer's name, the game, and the topics merged into it. |
| `decide_topic` | Reply, set a `topic_status` or a known issue's phase (investigating, known (confirmed), planned, fixing, released (a fix is out, watching it hold), fixed (resolved), wont; on a known issue it reaches every topic in it, and developers can say it still happens while it's released, which takes it back to fixing and alerts you), merge a duplicate into a known issue, make a topic a known issue (a title, workaround and roadmap item every developer sees), mark a reply as a question's answer, and set severity and category. A private message made a known issue becomes a new public topic of Zaisma's own with the message under it; the reply goes to that developer alone. On a public topic, a reply is public. |
| `decide_post` | Show a public forum post the check held or developers reported (which clears its reports), or remove it. Removing a topic's first post makes the topic private to its developer again. |

Child-safety reports come first. Triage never sorts them with AI, but here the admin is the person looking, so Claude can help read and decide them. Their pictures are never sent (a report triage only later found to be about child safety can carry one, and it could be abuse material itself), and they can't be passed to the developer. Decisions are recorded in the audit log under the service token's name. Player, game and forum text is untrusted; the MCP's instructions tell Claude not to follow it and to ask before deciding anything. Known-issue titles and workarounds are seen by every developer, so they're written without names, games or anything one developer said in private.

Chat reviews are child-safety cases too. Every 5 minutes an AI (`AI_REVIEW_MODEL`) reviews each kept message, not a person: a false alarm is deleted at once and the sender's pause lifted; a confirmed one from Zaisma's rooms removes the sender's chat for good, is kept a year and emails you to report it to NCMEC. One the AI is unsure of, or one from a developer's own server (which could make a message up to frame a player), waits for you, and only you confirm those.

Every few minutes an AI sorts new topics (`apps/site/src/forum-sort.ts`), on the same run and monthly AI budget as report triage: it sets severity (never the category: whoever posts picks it, and AI moves a topic only when someone flags it as misplaced), merges a duplicate into the topic or known issue it repeats (a developer merged into a known issue is told an AI matched it, and gets the workaround), alerts on anything urgent, and drafts a known issue for a new problem. The draft stays private until the admin approves it with `decide_topic`.

Every public post in the developer forum is checked by AI before others see it (`apps/site/src/forum-check.ts`), as it's sent and again on the 5-minute run. One the check holds, or one it couldn't check (no AI key, or the month's budget used up), waits in `waiting_posts` for `decide_post`. Sorting never merges a public topic on its own: it says which one it's the `same_as_topic_id`, and the admin decides. Public posts that mention `@Zaisma` with no reply from Zaisma since come back in `list_topics` as `zaisma_mentions` (and under Asked for Zaisma on the admin pages); a reply in the topic answers them.

The same queue is on the admin pages at `zaisma.com/admin/feedback` (`apps/site/src/admin-feedback.ts`): the cards come from `list_topics`, each topic's page from `get_topic`, saving a card decides exactly what `decide_topic` would with only what the form changed, and the posts waiting for a check have Show it and Remove.

## Errors

A refused call answers `{ "error": { code, message, field, fix, retry_after_sec } }` as its `structuredContent`, with `isError: true` and its message, fix and code as its text, as in the developer MCP. It uses the developer API's codes where they mean the same (`unknown_field`, `missing_field`, `wrong_id_kind`, `no_topic`, `no_post`, `no_game`, `bad_topic_status`, `bad_category`, `bad_title`, `bad_maximum_topic_count`, `bad_answer_post_id`, `bad_slug`, `internal_error`; see [`docs/DEVELOPER-API.md`](DEVELOPER-API.md)), and these of its own. The list lives in `ADMIN_ERROR_CODES` (`packages/core/src/errors.ts`), and a test keeps this page in step with it.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_report_group` | 404 | There's no report group with that ID. |
| `report_group_closed` | 409 | Every report in the group is closed already. |
| `bad_maximum_group_count` | 400 | maximum_group_count isn't a whole number from 1 to 100. |
| `bad_decision` | 400 | decision isn't one of the choices the call takes. |
| `cant_decide` | 409 | It can't be decided that way now: get_report_group lists what a report group can, and decide_notice shows again only a held game and holds none that's taken down. |
| `decision_refused` | 409 | The decision didn't go through, like putting back an update that matched known abuse material. |
| `bad_why` | 400 | why is blank or over 500 characters. |
| `bad_notice_kind` | 400 | notice_kind isn't copyright or defamation. |
| `no_precedent` | 404 | There's no precedent with that ID. |
| `not_proposed` | 409 | Only a proposed precedent can be approved; one in force changes with set_precedent. |
| `bad_precedent` | 400 | precedent isn't { title, applies_when, why } and its optional fields within their lengths, or the decision sets none (hide_name). |
| `bad_applies_when` | 400 | applies_when is blank or over 500 characters. |
| `bad_can_ai_apply_alone` | 400 | can_ai_apply_alone isn't true or false, or is true for a precedent that isn't a dismissal. |
| `bad_precedent_status` | 400 | precedent_status isn't active, proposed, retired or all. |
| `no_review_precedent` | 404 | There's no review precedent with that ID. |
| `not_approvable` | 409 | Only a drafted or failed review precedent can be approved; one in force is retired and set again with a new decision. |
| `incomplete_review_precedent` | 409 | The review precedent has no name, no 'applies when', no test game, or (for a hold) no content rule, so it can't be tested yet. |
| `bad_review_precedent_status` | 400 | review_precedent_status isn't proposed, testing, active, failed, retired or all. |
| `bad_reply_text_markdown` | 400 | reply_text_markdown is blank or over 8,000 characters. |
| `bad_known_issue` | 400 | known_issue isn't { title, workaround, roadmap_item } with a title, or null. |
| `bad_severity` | 400 | severity isn't urgent, high, normal or low. |
| `cant_merge` | 409 | A topic can't be merged into itself. |
| `already_merged` | 409 | The topic is merged, or being merged, into another, so that one is the one to make a known issue. |
| `no_chat_review` | 404 | There's no kept chat message with that ID: it was a false alarm and deleted, or its year is up. |
| `bad_chat_review_status` | 400 | chat_review_status isn't pending, needs_person, confirmed, waiting or all. |
| `unknown_username` | 404 | No account has that username. |

## Connect Claude Code

1. In the Cloudflare dashboard: Zero Trust → Access → Service credentials → Service Tokens → Create a service token (for example "Claude admin MCP"). Copy the client ID and secret; the secret is shown once.
2. Access → Applications → the zaisma.com admin application → add a policy with the action **Service Auth** that includes that service token.
3. In a terminal, with the two values from step 1:

```bash
claude mcp add --scope user --transport http zaisma-admin https://zaisma.com/admin/mcp --header "CF-Access-Client-Id: <client id>" --header "CF-Access-Client-Secret: <client secret>"
```

To revoke it, delete the service token in Cloudflare.

## Connect claude.ai

claude.ai can't send the service token's headers, so it signs in through Cloudflare Access instead, with Access's Managed OAuth. Turn it on once:

1. In the Cloudflare dashboard: Zero Trust → Access controls → Applications → the zaisma.com admin application → Edit → Advanced settings → Managed OAuth on.
2. In claude.ai: Settings → Connectors → Add custom connector, with `https://zaisma.com/admin/mcp`, and sign in with the admin email.

No code changes: Access becomes the admin application's own OAuth server, and `adminIdentity` already checks the `cf-access-jwt-assertion` Access adds to every request. Managed OAuth only changes the admin application's own paths, so the developer MCP at `/mcp` keeps Zaisma's own sign-in (docs/DEVELOPER-API.md, "Connected apps (OAuth)").

## Try it on the preview

The local preview (`npm run preview`) needs no login:

```bash
claude mcp add --transport http zaisma-admin-preview http://localhost:8800/admin/mcp
```
