# fieldtheory-cli likes trim command

## Plan

- [x] Unit 1: stop the old ad hoc bulk unlike process and snapshot current likes state
- [x] Unit 2: add throttled bulk likes trim primitives and efficient per-batch local reconciliation
- [x] Unit 3: expose `ft likes trim`, update docs, and keep help text aligned
- [x] Verification: run targeted tests and build, then validate the real archive count before execution
- [x] Execution: run the formal trim command until only the latest 200 likes remain
- [x] Review: record implementation and live execution results

## Notes

- Target branch: `feat/likes-archive`
- Origin plan: `docs/plans/2026-04-09-003-feat-likes-trim-command-plan.md`
- Scope boundary: likes-only bulk trim, with batch throttling and resumable execution from current local state

## Review
- Added `src/likes-trim.ts` to formalize bulk likes trimming, including trim planning by recency, per-batch remote unlike execution, and one local archive/index reconciliation per batch.
- Added `removeLikesFromArchive()` in `src/archive-actions.ts` so bulk removals rewrite `likes.jsonl`, update `likes-meta.json`, and rebuild `likes.db` once per batch instead of once per item.
- Added `ft likes trim` in `src/cli.ts` with `--keep`, `--batch-size`, `--pause-seconds`, `--rate-limit-backoff-seconds`, and `--max-rate-limit-retries`.
- Added 429-aware retry handling by introducing `RemoteTweetActionError` in `src/graphql-actions.ts` and automatic backoff/retry inside `src/likes-trim.ts`.
- Updated `README.md` and `docs/README.md` for the new formal bulk-trim command and plan entry.
- Verification passed:
  - `npm test -- tests/archive-actions.test.ts`
  - `npm test -- tests/cli-actions.test.ts`
  - `npm run build`
- Live execution results:
  - Current likes before formal run: `530`
  - Real command executed: `node dist/cli.js likes trim --keep 200 --batch-size 20 --pause-seconds 30 --rate-limit-backoff-seconds 300 --max-rate-limit-retries 5`
  - Initial first attempt hit `429` immediately; command was enhanced with automatic rate-limit backoff and retry.
- Final live run removed `330` older likes successfully.
  - Final local verification:
    - `likes.jsonl` count: `200`
    - `node dist/cli.js likes status` reports `likes: 200`
    - oldest kept like id: `2020906224792027164`

# fieldtheory-cli X home timeline viewer

## Plan

- [x] Unit 1: capture and validate the Home timeline GraphQL contract, then add feed cache/meta/state primitives
- [x] Unit 2: add feed SQLite index, list/show/status read models, and local paging
- [x] Unit 3: expose `ft feed sync|status|list|show` as the CLI-first read-only viewer
- [x] Unit 4: update docs and record phase-1 operator boundaries
- [x] Verification: prove mocked-X sync, index build, and CLI browsing behavior with targeted tests
- [x] Review: record implementation and validation results

## Notes

- Origin requirements: `docs/brainstorms/2026-04-12-x-feed-requirements.md`
- Origin plan: `docs/plans/2026-04-12-004-feat-x-feed-cli-viewer-plan.md`
- Scope boundary: CLI-first, read-only, tweet-only Home timeline viewing with local cache and local paging; no web surface or feed actions in phase 1

## Review

- Added a dedicated feed archive path with `feed.jsonl`, `feed-meta.json`, `feed-state.json`, and `feed.db`, plus separate feed record typing and ordering metadata in `src/types.ts` and `src/paths.ts`.
- Added Home timeline GraphQL ingestion in `src/graphql-feed.ts`, including first-page and cursor-page request handling, tweet-only normalization, promoted/non-tweet entry skipping, and stable local ordering via `sortIndex`, `fetchPage`, and `fetchPosition`.
- Added feed read models in `src/feed-db.ts`, `src/feed-service.ts`, and `src/feed.ts` to support local paging, item lookup, and feed status formatting without coupling feed storage to likes or bookmarks.
- Exposed `ft feed sync`, `ft feed status`, `ft feed list`, and `ft feed show` in `src/cli.ts`.
- Updated `README.md` and `docs/README.md` for the new read-only feed viewer workflow and linked planning artifacts under `docs/`.
- Hardened X network access by extending `src/x-graphql.ts` with broader `curl` fallback coverage for Node fetch failures such as `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_CONNECT_ERROR`, and `ECONNRESET`, then routed feed, likes, bookmarks, and remote mutation GraphQL calls through the shared helper.
- Verification passed:
  - `npm test -- tests/graphql-feed.test.ts tests/feed-db.test.ts tests/feed-service.test.ts tests/cli-feed.test.ts`
  - `npm run build`
- Real validation passed against the live logged-in X session:
  - `node dist/cli.js feed sync --max-pages 2`
  - result: `56` new feed items synced, `16` skipped non-tweet entries
  - `node dist/cli.js feed status`
  - result: `items: 56`, `skipped entries: 16`, `last updated: 2026-04-12T14:51:04.458Z`
  - `node dist/cli.js feed list --limit 5`
  - result: returned live cached feed items, including `2043320548776681627 @mattpocockuk`
  - `node dist/cli.js feed show 2043320548776681627`
  - result: returned full tweet detail with author, text, URL, and ordering metadata
- Shared-network regression check also passed:
  - `node dist/cli.js likes sync --max-pages 1`
  - result: `15` new likes synced, `215` total
