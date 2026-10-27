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

Runs every public case, and every private one when `~/zaisma-private/security/review-set/cases` exists (`ZAISMA_REVIEW_SET_PRIVATE_DIR` points elsewhere), 3 times each, with the review as the scan runs it: the rule-based checks, the readers, then the judge. Every case is judged as a first upload. It says which bad games were stopped (and which of them were rejected by themselves, with no person: the goal is all of them but child safety, which a person always sees; a bad game only held still stops it but counts as a miss), which honest ones were passed, which cases got different verdicts on different runs and how often the judge declined, then `PASS` or `FAIL`.

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

## Review precedents

When a person finds the review wrong (a hold or rejection they release, a hold they uphold, or a game it passed that they reject or take down), the miss becomes a review precedent the judge reads and a stand-in case ("The AI review learns from its misses." in `docs/DECISIONS.md`). A new one is tried on the public cases in the Worker before the judge reads it. The private cases and the whole set are measured here, with the rulings in force:

```bash
# save the admin MCP's list_review_precedents answer as { "review_precedents": [...] }, then:
npm run review-set -- --precedents review-precedents.json
npm run review-set -- --precedents review-precedents.json --save-private-cases
```

`--precedents` runs the review with every active precedent in force and adds each one's stand-in case as a private case; `--save-private-cases` also writes those stand-ins into the private folder (`cases/review-precedent-<id>/`, never public, never a copy of a developer's game). A run with `--precedents` records nothing. After changing a public case, run `node scripts/review-set/bundle-public.mjs`: the Worker's copy (`apps/site/src/generated/review-set-public-cases.generated.ts`) is checked by `npm test`.

## The protections and their cases

Every protection in `REVIEW_SET_PROTECTIONS` has at least one private case, a game that gets around it, kept inert (a few lines showing the pattern, `example.invalid` addresses, never working abuse). `review_reach` has none: it isn't an AI call but the review handing over to a person when it can't read (`too_much_code`, the picture limits), tested with the limits lowered.

The review reads each protection as a closed yes/no subject, with one fixed outcome (the lines are written to be mechanical, so the same game gets the same verdict from any model):

- A game that only bumps into a protection (a plain `window.open`, a call to an address that isn't Zaisma rooms or its own servers) passes with a note (`unregistered_link`, `unlisted_address`), from the rule-based checks.
- A game that dodges one is rejected (`ai_protection_dodged`): `protection_attempt` with the subject `page_outside_frame`, `peer_outside_relay`, `link_without_tap`, `link_built_from_pieces` or `address_built_from_pieces`.
- Typed text another player reads as written is chat (`read_by_others`); typed answers the game checks (`checked_by_game`), text only the typer sees and whole phrases the developer wrote are fine.

Public near misses and plain breakers for these are in `cases/` (`typed-answers-word-race`, `guess-feed-drawing`, `composer-spells-anything`, `window-open-discord`); a developer or their AI can read their `why` as Fine and Not fine examples.

## The listing check's cases

The listing check ("No slop" in `docs/DECISIONS.md`, `apps/site/src/listing-judge.ts`) holds covers, screenshots and titles to five lines anyone can check against the picture. It's measured the same way as the review, on its own cases, before its prompt or model changes:

```
review-set/listing-cases/<case-name>/
  case.json     the title, the pictures, and the outcome each must get
  cover.webp    the pictures (PNG, JPEG or WebP)
```

`case.json` has exactly these keys: `title` and `description` (the game's words), `pictures` (a list of `{ "path", "kind" }`, `kind` one of `cover`, `square`, `share`, `screenshot`), `is_honest`, `expected` (each picture's path, and `title`, with `fine`, `person` or the code of the line it breaks: `extra_text_on_cover`, `overlay_on_cover`, `famous_name`, `cover_not_from_game`, `tag_in_title`, `fake_reward`, `screenshot_not_from_game`) and `why`.

Honest cases sit at the edges: screenshots full of the game's own interface and shop screens, a loud cover with only its title, names like "+1 Speed Run" and "Wrangler 2x". Every picture is drawn by Zaisma or captured from its demo games: never a real developer's cover, and never a real famous character (famous names are tested in titles).

```bash
npm run listing-set
```

Runs every case 3 times (`--runs`, `--case`, `--var LISTING_CHECK_MODEL=…` and `--json` work as above) and passes when every case gets its outcome on every run. A full run records `review-set/listing-last-run.json`, and `npm test` fails when the check's prompt or model changed without a new passing run (`listingFingerprint` in `scripts/review-set/fingerprint.mjs`).
