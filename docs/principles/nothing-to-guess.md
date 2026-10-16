# Nothing for an AI to guess

The principle "Nothing for an AI to guess" in [`DECISIONS.md`](../DECISIONS.md). This file is its casebook: what it means and how to test against it. The naming rules themselves, with their glossary and examples, are in [`NAMING.md`](../NAMING.md), and `test/node/naming.test.ts` checks the code and the migrations. Every case is a real Zaisma call. When a talk settles a new one, it's added here in the same change.

## The rule

**Every name and value in the API, MCP, SDK, game server and Zaisma's own code says what it holds, its kind and its unit; inputs are closed; errors give a stable code and the fix; every change answers with the next call.**

## Why it exists

An AI that has to guess makes wrong calls, retries and spends tokens. Every guess removed is a call made right the first time. And agents work in Zaisma's own code all day, so a vague column name inside leaks into the names developers see (Oct 14 and 15, 2026).

## The test

1. **Could an AI that has never seen this field tell its type and unit from its name alone?**
2. **Is the input closed?** A fixed list instead of free text, a template instead of a free-form object.
3. **Where is this call easy to get wrong?** Add good and bad examples there, as many as it takes.
4. **When it fails, does the answer say what to do?** A stable `code`, the `field` at fault, a `fix`, and `retry_after_sec` when waiting helps.
5. **Does one name mean one thing everywhere,** inside and out?

## Cases

### Passes

- `play_duration_min`, `file_count`, `size_bytes`, `published_at`, `version_…` IDs.
- Every hold, rejection and takedown has a `review_reason` with a code, the rule and a fix (Oct 16, 2026).
- Every SDK error has an `error.code` (Oct 16, 2026).
- The upload command has closed flags, `--json` output and exit codes (Oct 16, 2026).

### Fails

- `duration` (in what unit?), `count` (of what?), `data` (what kind?).
- A free-text input where a fixed list would do.
- An error that says what went wrong but not what to do next.
