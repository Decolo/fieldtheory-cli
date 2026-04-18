---
date: 2026-04-17
status: in_progress
topic: bookmarks-cli-real-validation-followup
origin: real-execution-validation
---

# Bookmarks CLI Real Validation Follow-up

## Context

This follow-up documents the state after the bookmark CLI refactor that moved bookmark functionality under `ft bookmarks ...`, removed the legacy top-level bookmark commands, and removed the old OAuth fallback path.

The refactor goal from the user was explicit:

1. Bookmark capabilities should align with likes under a real `bookmarks` namespace.
2. Old bookmark commands should be deleted, not hidden.
3. OAuth token / OAuth fallback for bookmarks should be removed.
4. Validation must include real command execution, not only tests with mocks.

## What Was Completed

### CLI Contract Changes

The bookmark CLI surface was moved under `ft bookmarks ...`.

Real current commands:

- `ft bookmarks sync`
- `ft bookmarks status`
- `ft bookmarks search`
- `ft bookmarks list`
- `ft bookmarks show`
- `ft bookmarks stats`
- `ft bookmarks viz`
- `ft bookmarks classify`
- `ft bookmarks classify-domains`
- `ft bookmarks model`
- `ft bookmarks categories`
- `ft bookmarks domains`
- `ft bookmarks index`
- `ft bookmarks add`
- `ft bookmarks unbookmark`
- `ft bookmarks repair`
- `ft bookmarks sample`
- `ft bookmarks fetch-media`

Deleted legacy top-level bookmark commands:

- `ft sync`
- `ft auth`
- `ft search`
- `ft list`
- `ft show`
- `ft stats`
- `ft viz`
- `ft classify`
- `ft classify-domains`
- `ft categories`
- `ft domains`
- `ft model`
- `ft index`
- `ft status`
- `ft unbookmark`
- `ft bookmark`
- `ft sample`
- `ft fetch-media`

### OAuth Removal

The old bookmark OAuth path was removed:

- `src/xauth.ts` deleted
- OAuth token path removed from `src/paths.ts`
- OAuth token type removed from `src/types.ts`
- OAuth config loader removed from `src/config.ts`
- OAuth fallback branches removed from bookmark sync service / CLI
- OAuth tests removed
- README updated away from OAuth instructions

## Automated Validation Completed

These passed after the refactor:

- `pnpm exec tsc -p tsconfig.json --noEmit`
- `pnpm test`
- `pnpm build`

## Real Command Execution Completed

These were run against the real local environment and real local bookmark archive.

### Help / Command Surface

Executed:

- `pnpm exec tsx src/cli.ts --help`
- `pnpm exec tsx src/cli.ts bookmarks --help`
- `pnpm exec tsx src/cli.ts bookmarks sync --help`

Observed:

- `bookmarks` is now the public bookmark namespace.
- Old top-level bookmark commands are not advertised.

### Old Command Removal

Executed:

- `pnpm exec tsx src/cli.ts sync`
- `pnpm exec tsx src/cli.ts auth`
- plus a loop over the old bookmark top-level commands:
  - `search`
  - `list`
  - `show`
  - `stats`
  - `viz`
  - `classify`
  - `classify-domains`
  - `categories`
  - `domains`
  - `model`
  - `index`
  - `status`
  - `unbookmark`
  - `bookmark`
  - `sample`
  - `fetch-media`

Observed:

- All of the above now fail as unknown commands.
- This part of the refactor is complete.

### Real Read / Local-Mutation Commands

Executed successfully:

- `pnpm exec tsx src/cli.ts bookmarks status`
- `pnpm exec tsx src/cli.ts bookmarks list --limit 3`
- `pnpm exec tsx src/cli.ts bookmarks search skill --limit 3`
- `pnpm exec tsx src/cli.ts bookmarks show 2045102579173269643`
- `pnpm exec tsx src/cli.ts bookmarks stats`
- `pnpm exec tsx src/cli.ts bookmarks viz`
- `pnpm exec tsx src/cli.ts bookmarks model`
- `pnpm exec tsx src/cli.ts bookmarks model codex`
- `pnpm exec tsx src/cli.ts bookmarks sync --max-pages 1 --target-adds 1 --max-minutes 1`
- `pnpm exec tsx src/cli.ts bookmarks repair`
- `pnpm exec tsx src/cli.ts bookmarks classify --regex`
- `pnpm exec tsx src/cli.ts bookmarks categories`
- `pnpm exec tsx src/cli.ts bookmarks sample tool --limit 2`
- `pnpm exec tsx src/cli.ts bookmarks fetch-media --limit 1`
- `pnpm exec tsx src/cli.ts bookmarks classify-domains`
- `pnpm exec tsx src/cli.ts bookmarks domains`
- `pnpm exec tsx src/cli.ts bookmarks classify`

Notable real results:

- `bookmarks sync` completed and rebuilt the local bookmark index.
- `bookmarks classify --regex` classified part of the archive.
- `bookmarks classify-domains` completed `121/121`.
- `bookmarks classify` completed category classification with engine `codex`.
- `bookmarks fetch-media --limit 1` ran and produced a real JSON result:
  - one media URL was skipped for size
  - one media URL failed with `fetch failed`
  - command completed normally

## Real Write Command Results

### `bookmarks unbookmark`

Executed:

- `pnpm exec tsx src/cli.ts bookmarks unbookmark 2045102579173269643`

Observed:

- Remote unbookmark succeeded.
- Local archive reconciliation succeeded.
- Local bookmark count dropped from `121` to `120`.

### `bookmarks add`

Executed:

- `pnpm exec tsx src/cli.ts bookmarks add 2045102579173269643`

Observed before patch:

- The command could hang for minutes.

Root cause found:

- `bookmarkTweet` calls `resolveXClientTransactionId`.
- That path fetches the X home page to compute `x-client-transaction-id`.
- That fetch had no timeout, so the command could stall indefinitely.

Mitigation already applied:

- `src/x-client-transaction.ts` now has a hard timeout (`HOME_FETCH_TIMEOUT_MS = 10_000`) around home-page fetch for transaction-id generation.

Observed after patch:

- The command no longer hangs.
- It now fails fast with a real error:

```text
Failed to create bookmark (404).
X accepted the session but rejected the bookmark create route. This usually points to a web-client contract mismatch, such as missing client headers or a changed bookmark mutation path, not a temporary network issue.
```

## Current Remaining Problem

The only bookmark subcommand that is still broken under real execution is:

- `ft bookmarks add`

Everything else listed above was exercised successfully in real use.

## Investigation Notes for Next Session

### Findings Already Confirmed

- `CreateBookmark` still exists in the current public X web bundle.
- The current public `queryId` in the bundle still matches the code:
  - `aoDbu3RHznuiSkQ9aNM67Q`
- `DeleteBookmark` also still matches and works in real execution.
- The add failure is therefore less likely to be “query id changed” and more likely to be one of:
  - missing required request variables
  - missing required headers
  - stale / incomplete `x-client-transaction-id` behavior
  - changed bookmark-create response or routing expectations despite the exported operation name remaining present

### Useful Files

- `src/graphql-actions.ts`
- `src/x-client-transaction.ts`
- `src/x-graphql.ts`
- `tests/graphql-actions.test.ts`
- `tests/cli-actions.test.ts`

### Real Reproduction Command

Use this exact real repro:

```bash
pnpm exec tsx src/cli.ts bookmarks add 2045102579173269643
```

Current expected result:

- fast failure with `404`, not a hang

### Suggested Next Steps

1. Inspect the live X web request shape for `CreateBookmark`.
2. Compare the real browser request body and headers with `src/graphql-actions.ts`.
3. Verify whether `CreateBookmark` now requires:
   - extra variables
   - feature switches / field toggles
   - extra headers beyond current GraphQL defaults
   - a different referer shape
4. Once `bookmarks add` is fixed, re-run this real sequence:
   - `ft bookmarks unbookmark <existing-id>`
   - `ft bookmarks add <same-id>`
   - `ft bookmarks sync --max-pages 1 --target-adds 1`
   - `ft bookmarks show <same-id>`
5. If that passes, the bookmark CLI refactor can be considered fully real-validated end-to-end.

## Summary

Current state:

- bookmark namespace migration: done
- legacy top-level bookmark commands removed: done
- OAuth bookmark path removed: done
- tests / build / typecheck: passing
- real execution of almost all bookmark commands: done
- real bookmark write validation:
  - `unbookmark`: works
  - `add`: still failing with real `404`

This document should be the starting point for the next session.
