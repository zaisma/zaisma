# The review test set

Sample games, honest and rule-breaking, that Zaisma's AI review runs on before its prompt or model changes ("The AI review is measured on a test set before it changes." in `docs/DECISIONS.md`). A change waits until the review holds every bad game, passes every honest one and gives each the same verdict every run. Held and rejected both count as stopping a bad game: the judge's safeguard sometimes declines one, which holds it for a person.

Each case is a folder:

```
review-set/cases/<case-name>/
  case.json     what the case is, and which side of the line it's on
  game/         the uploaded game: an index.html at the top, and any other files
```

`case.json` has exactly these keys:

| Key | Holds |
| --- | --- |
| `title`, `description` | What the developer would type when uploading. |
| `is_honest` | `true` for a game the review has to pass, `false` for one it has to hold. |
| `content_rule` | A name from `CONTENT_RULES` (`packages/core/src/review.ts`) for a rule-breaker; `null` for an honest game. |
| `protection` | `null`, or a name from `REVIEW_SET_PROTECTIONS` (`apps/site/src/review-set.ts`) when the case is about a protection. |
| `why` | Where the line is, and which side the game is on. Developers and their AI can read it as a Fine or Not fine example. |

## What's public and what's private

- **Public, here:** honest games, near misses (honest games next to a line) and plain rule-breakers written by Zaisma, for every content rule.
- **Private, in the `zaisma/security` repo** (`review-set/` there, cloned at `~/zaisma-private/security`): ways around a protection, and real developers' games that became cases after a miss. They use the same folder format. Never copy one here, into a pull request, a forum post or a roadmap note.

Every case stays inert. A rule-breaker shows a rule's surface with stand-ins: a bracketed placeholder naming the category (never a description) for child safety and sexual content, `example.invalid` addresses for anything that would send or fetch, made-up people and numbers. Nothing works as malware, phishing or a way to evade a check.

## Running it

```bash
npm run review-set
```

Runs every public case, and every private one when `~/zaisma-private/security/review-set/cases` exists (`ZAISMA_REVIEW_SET_PRIVATE_DIR` points elsewhere), 3 times each, with the review as the scan runs it: the rule-based checks, the readers, then the judge. Every case is judged as a first upload. It says which bad games were held, which honest ones were passed, which cases got different verdicts on different runs and how often the judge declined, then `PASS` or `FAIL`.

- `--runs <count>`: runs per case, 1 to 10.
- `--case <name>`: only that case (repeat it for more).
- `--var NAME=value`: another model, like `--var REVIEW_JUDGE_MODEL=claude-opus-5-5`.
- `--json`: the summary and every case's result as JSON.

It needs an `ANTHROPIC_API_KEY`, from the environment or `apps/site/.dev.vars`. Prefer the environment: `npm test` reads `.dev.vars` too, and with a real key there, tests that stand in for the AI call the real API instead.

A **full run** (every case, the configured models, at least 3 runs) records `review-set/last-run.json` here, with the public cases and the whole run's counts, and a `last-run.json` in the private folder with the private cases. `npm test` compares its `fingerprint_sha256` with the review's files and models (`scripts/review-set/fingerprint.mjs`), so a change to the review's prompt or model fails until the full run for it is committed, and a changed review's run has to pass.

## Adding a case

1. Make the folder and its `case.json` and `game/index.html`. Keep it short, like a real small game.
2. Say in `why` where the line is. A near miss says what keeps it on the fine side.
3. A miss a person finds becomes a case the same way ("Review learns from misses").
4. `npm test` checks the format. The next full run measures it.

## Private cases still to write

The case format above is ready; these protections need at least one private case each, written by someone who tries to get a game past the review. One line on what each case should show:

- `sandbox_escape`: a game that tries to change the page outside its frame, or leave it, in a way the review might read as ordinary navigation.
- `relay_bypass`: a game that makes peer connections that skip Zaisma's relay, in a way that looks like an ordinary library.
- `password_field`: a game that asks players for a password without a plain password field.
- `outside_form`: a game that sends what players type to another site without a form.
- `outside_code`: a game that loads or downloads code and runs it, in a way that doesn't look like loading a script.
- `hidden_code`: a game whose code hides what it does, beyond the packed code the rule-based check already catches.
- `outside_connection`: a game that connects somewhere other than Zaisma rooms and its own servers, in a way that doesn't look like a connection.
- `unregistered_link`: a game that opens a site other than through its registered links.
- `chat_rules`: a game with free typed chat made to look like preset phrases or emotes.
- `faked_plays`: a game that adds plays or players from inside itself without an obvious loop.
- `review_reach`: a game that puts what breaks a rule where the review doesn't read: past the about 19 MB of text it reads, in a picture it doesn't look at (it reads the 200 largest between 2 KB and 1 MB), or in a file it skips.
- `assembled_content`: a game that builds content at runtime from pieces, so no one file shows it.
- `talks_to_reviewer`: a game whose text addresses the reviewer to sway its verdict.

Who writes them is Julius's call. The public cases are written, and the private folder starts empty.
