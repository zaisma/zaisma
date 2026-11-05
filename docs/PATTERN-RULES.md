# Pattern rules

Scanners that fail a change on a risky pattern in Zaisma's own code, never a game's. They read `apps/` and `packages/` with the TypeScript compiler, page scripts inside their strings included, and only files git tracks. They catch the bugs that aren't a wrong person at a door; `docs/DOORS.md` and its grid hold those.

```
npm run patterns
```

prints every finding on this machine. `npm run check` and GitHub's check run `npm run patterns -- --compare <the commit a change left>`, which fails only on what the change adds and prints only that: anyone can read a check's log. A finding already on main is a security item, kept privately until it's fixed; a fix needs no change here. Where a new finding comes with one gone of the same rule in its file or function, it may be an old one edited, so the check prints a count and the local run says the rest.

This change's rules read both sides, so a new or changed rule's findings on old code pass and block from then on.

## The rules

| Rule | What goes wrong | What to do instead |
|---|---|---|
| `sql_text_from_a_value` | SQL built from a value runs what that value says. | Keep the text fixed and pass values through `bind()`. A column chosen in code comes from a constant, a literal or a parameter typed as literals. |
| `sql_without_where` | A `DELETE` or `UPDATE` with no `WHERE` changes every row. | Name the rows with `WHERE`. |
| `raw_takes_a_value` | `raw()` skips escaping, so a value in it can write markup and scripts into the page. | Put the value in `` html`…` ``, or through `esc()`, `shownAddress()` or `shownColor()`. |
| `secret_compared_plainly` | `===` stops at the first wrong character, so its timing tells a guesser how close they are. | `crypto.subtle.timingSafeEqual`, or `crypto.subtle.verify` for a signature. |
| `random_for_a_secret` | `Math.random` can be predicted, so an id, code or token made from it can be guessed. | `crypto.getRandomValues` or `crypto.randomUUID`. |
| `message_without_sender_check` | A game's page can post a message to any window it can reach, so a listener that doesn't ask who sent it obeys the game. | Check `event.source` or `event.origin` first. |
| `frame_without_sandbox` | A frame with no sandbox gives what's inside it the run of a page. | A `sandbox` attribute with only what it needs. |
| `body_read_without_cap` | Reading a whole body with no limit lets one request fill the Worker's memory, and takes every request sharing it down too. | `readBodyText` or `readBodyBytes` from `@zaisma/core`, which stop at a size. Behind a door's row, `cappedRequest` holds a read to the row's size: list it as a reviewed site. |
| `pattern_from_a_value` | A pattern built from a value can run for minutes on a short text, or match what it never meant to. | Keep the pattern fixed, or escape the value first. |
| `secret_in_a_log` | Logs are kept and read by more than the code, so a secret in one has leaked. | Log what happened and an id, never the value, the whole request, its headers or `env`. |
| `secret_in_a_page` | Anything in a page is read by everyone who opens it. | Keep the secret on the server, and send the page what it does. |
| `cookie_without_protection` | A cookie with no `Secure` goes over plain connections, with no `SameSite` goes along on other sites' requests, and with no `HttpOnly` can be read by a script. | Set all three. A cookie a page's script must read is a reviewed site. |
| `address_read_unchecked` | An address taken from a request and followed sends a signed-in person wherever a link says. | Pass it straight through a checker like `safeNext`, or compare it with what's allowed. |
| `cors_echoes_origin` | Answering with the caller's own origin lets any site read the answer, and credentials make that the signed-in person's. | `"*"` for what's public to everyone, and no credentials across sites. |
| `error_text_in_an_answer` | An error's own text can name tables, paths and keys, and a caller shouldn't read them. | A code and a message Zaisma wrote; log the error. |
| `money_from_the_request` | An amount a client sends is an amount the client chose. | Read the amount from the item or the sale on the server. |
| `code_from_text` | Text run as code does whatever the text says. | Write the code out. |

## What a rule accepts

A rule passes only what it can prove: literals, constants named in capitals, local values traced to those, a parameter typed as literals, a parameter every call in its file gives fixed text, what `esc`, `html` and the like render. Anything it can't follow is a finding, so rewriting a site to one of those forms is usually the fix.

## A site that's safe

When a site is safe and no rewrite would show it, add it to `REVIEWED_SITES` in `scripts/pattern-rules/reviewed-sites.mjs`: the rule, the file, the function, how many sites of that rule the function holds and why they're safe. A new site in that function changes the count, so it's read too, and the list is read each day. Never list a site that isn't safe: fix it.

## What these rules leave to others

- Values put into styles, addresses and HTML by page scripts, and stored values shown on pages: `test/node/stored-values.test.ts` and `test/site/stored-values.test.ts`.
- Who may call what: the contract test grid.
- An outbound `fetch` to a value: a scan can't tell where it came from, and `packages/core/src/reach.ts` holds game servers to their allowed hosts.
- A key written into the code: GitHub's secret scanning.

## Adding a rule

Add it to `PATTERN_RULES` in `scripts/pattern-rules/rules.mjs`, with what it must catch and let by in `test/node/pattern-rules.test.ts`, and its row above. Read each site it finds on today's code once: tighten the rule, list what's safe, and leave the rest to the private list.
