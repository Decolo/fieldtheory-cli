# 2026-04-15 feed semantic vector retrieval

## Plan

- [x] Unit 1: add an embedding provider abstraction plus local semantic store, with Aliyun Bailian `text-embedding-v4` as the default provider
- [x] Unit 2: build semantic indexing for feed, likes, bookmarks, and explicit topic preferences
- [x] Unit 3: replace feed consumer lexical scoring with vector retrieval and semantic reasons
- [x] Unit 4: wire daemon-time semantic upkeep, semantic rebuild/status commands, and fail-closed behavior
- [x] Unit 5: update README/docs and mark the lexical v2 plan as superseded where needed
- [x] Verification: run targeted tests, build, and perform a real semantic smoke flow
- [x] Review: validate semantic scoring, provider config, and daemon/operator behavior before shipping

## Review

- Added `src/embeddings.ts`, `src/semantic-store.ts`, `src/semantic-indexer.ts`, and `src/feed-semantic-scorer.ts` to move feed action scoring onto real embeddings plus LanceDB-backed nearest-neighbor retrieval.
- `src/feed-agent.ts` and `src/feed-daemon.ts` now sync semantic vectors before consumption, while `src/feed-consumer.ts` uses semantic scoring and now logs per-item semantic failures instead of aborting the whole run.
- Added `ft feed semantic status` and `ft feed semantic rebuild` in `src/cli.ts`, with status now performing a real health check for the local store and embedding provider.
- Hardened similarity handling in `src/semantic-store.ts` by normalizing vectors and querying LanceDB with explicit cosine distance before mapping distance to scores.
- Updated `README.md` plus stale plan docs to reflect the new embedding provider defaults, semantic operator commands, and the fact that feed automation is now vector-backed.
- Verification passed:
  - `./node_modules/.bin/tsx --test tests/embeddings.test.ts tests/semantic-store.test.ts tests/semantic-indexer.test.ts`
  - `./node_modules/.bin/tsx --test tests/feed-agent.test.ts`
  - `./node_modules/.bin/tsx --test tests/cli-feed-agent.test.ts`
  - `npm run build`
- Review findings fixed:
  - `feed semantic status` was previously just config echo; it now checks store accessibility and provider reachability.
  - one missing/corrupt semantic vector could previously abort the whole consumer run; errors are now isolated to the affected item and logged.
  - README had not documented all embedding env knobs; it now includes provider and batch-size overrides.

# 2026-04-15 feed daemon and preference model v2

## Plan

- [x] Unit 1: split the current feed agent into fetch-stage and consume-stage services
- [x] Unit 2: add a daemon manager command with one recurring timer
- [x] Unit 3: introduce a real preference model with explicit preferences plus learned history
- [x] Unit 4: add semantic topic matching without introducing LLM judging
- [x] Unit 5: add a user-facing feed preference command surface
- [x] Verification: run targeted tests, build, and perform a real daemon tick verification
- [x] Review: validate the new fetch/consume split, preference precedence, and daemon control surface before shipping

## Review

- Split the old monolithic flow into `src/feed-fetcher.ts` and `src/feed-consumer.ts`, then kept `src/feed-agent.ts` as the orchestration wrapper so one-shot runs still work while the daemon can call the two stages directly.
- Added `src/feed-daemon.ts` plus `ft feed daemon start|status|stop|log`, with one recurring timer per process and per-tick state persisted in `feed-daemon-state.json`.
- Added explicit action-specific preferences in `src/feed-preferences.ts` and surfaced them through `ft feed prefs show|like|dislike|bookmark|avoid-bookmark|remove`.
- Historical inference still stays local-first and non-LLM. Feed action scoring now uses embeddings plus LanceDB-backed nearest-neighbor retrieval over likes, bookmarks, feed items, and explicit topic preferences.
- Fixed one review-found parameterization bug: `feed daemon start --max-pages 0` was being coerced back to `1` by `||` defaults. The daemon and consumer now preserve explicit `0` values.
- Verification passed:
  - `./node_modules/.bin/tsx --test tests/feed-agent.test.ts tests/cli-feed-agent.test.ts tests/archive-actions.test.ts`
  - `npm run build`
  - Real daemon smoke: `FT_DATA_DIR=$(mktemp -d) node dist/cli.js feed daemon start --every 1s --max-pages 0 --candidate-limit 0 --dry-run`, followed by `feed daemon status`, `feed agent status`, and signal stop
- Review note:
  - attempted `ce:review` via subagent, but the platform returned a high-demand error, so the final review pass was completed in the main thread

# 2026-04-15 feed agent one-shot completion bug

## Plan

- [x] Reproduce the real `feed agent run` behavior against the local archive and confirm why runs were not completing
- [x] Remove per-action full-archive rebuild work from the hot path so one run can finish in bounded time
- [x] Add regression coverage for bulk archive upserts and rerun the relevant test/build steps
- [x] Re-run a real `feed agent run --candidate-limit 30 --max-pages 2` and confirm state/logs now finalize correctly

## Review

- Root cause: `runFeedAgent()` was calling single-record archive upserts after every successful remote action, and each upsert rewrote the whole JSONL archive and rebuilt the full SQLite index immediately. On a real archive this made one run so slow that it looked hung and often got interrupted before state was committed.
- Fix: added `upsertLikesInArchive()` and `upsertBookmarksInArchive()` in `src/archive-actions.ts`, then changed `src/feed-agent.ts` to accumulate successful remote actions and persist them in batches at the end of the run.
- Regression coverage added in `tests/archive-actions.test.ts` for mixed insert+update bulk upserts.
- Verification passed:
  - `npm test -- tests/archive-actions.test.ts tests/feed-agent.test.ts tests/cli-feed-agent.test.ts`
  - `npm run build`
  - Real run: `node dist/cli.js feed agent run --candidate-limit 30 --max-pages 2`
  - Real status after fix: `runs: 1`, `evaluated: 30`, `last run: 2026-04-15T03:31:13.270Z`

# 2026-04-15 feed agent interval flag

## Plan

- [x] Add a scheduler-friendly `--every <interval>` option to `ft feed agent run` while preserving one-shot behavior by default
- [x] Cover interval parsing and repeating-run CLI behavior with targeted tests
- [x] Update README usage so parameterized in-process scheduling is documented
- [x] Verification: run targeted tests and rebuild the CLI
- [ ] Operations: replace the existing hard-coded supervisor loop with the new parameterized CLI invocation

## Review

- Added `parseIntervalMs()` plus a small signal-aware wait helper in `src/cli.ts`, keeping `runFeedAgent()` itself one-shot and moving repeating behavior entirely into the CLI surface.
- Extended `ft feed agent run` with `--every <interval>`, supporting `s`, `m`, and `h` suffixes while preserving the existing one-shot default.
- Added CLI coverage in `tests/cli-feed-agent.test.ts` for interval parsing and help output, then verified with:
  - `npm test -- tests/cli-feed-agent.test.ts tests/feed-agent.test.ts`
  - `npm run build`
  - Manual built CLI loop validation via `env FT_DATA_DIR=/tmp/ft-feed-agent-manual node dist/cli.js feed agent run --every 1s --max-pages 0 --dry-run`
- Operational blocker:
  - replacing the live background process against the default Chrome-backed X session is currently blocked by macOS Keychain access for Chrome cookie decryption, so the new real scheduler command exists but could not be kept running unattended from this session without either approved Keychain access or explicit `--cookies`

# 2026-04-15 scheduled autonomous feed actions

## Plan

- [x] Unit 1: add positive X like/bookmark mutations and local archive append/upsert helpers
- [x] Unit 2: build the autonomous feed agent service with scoring, durable state, and append-only logs
- [x] Unit 3: expose `ft feed agent run|status|log` as the scheduled-first CLI surface
- [x] Unit 4: update README/docs index and record verification/review outcomes
- [x] Verification: run targeted tests plus `npm run build`, and manually validate one dry-run agent execution
- [x] Review: run `ce:review`, fix findings, and capture residual risks if any

## Review

- Added positive remote mutation helpers in `src/graphql-actions.ts` for browser-session-backed `FavoriteTweet` and `CreateBookmark`, with fixture-backed request/response coverage in `tests/graphql-actions.test.ts`.
- Added archive upsert helpers in `src/archive-actions.ts` so successful automatic likes/bookmarks immediately reconcile local JSONL caches, metadata, and SQLite indexes.
- Added `src/feed-agent.ts` with deterministic preference scoring from historical likes/bookmarks, per-action idempotency state, append-only log entries, and one-shot execution suitable for external schedulers.
- Added `ft feed agent run`, `ft feed agent status`, and `ft feed agent log` in `src/cli.ts`, with integration coverage in `tests/feed-agent.test.ts` and `tests/cli-feed-agent.test.ts`.
- Updated `README.md` and `docs/README.md` to document the scheduled-first agent flow, inspection commands, and new local artifacts.
- Verification passed:
  - `npm test -- tests/graphql-actions.test.ts tests/archive-actions.test.ts tests/feed-agent.test.ts tests/cli-feed-agent.test.ts`
  - `npm run build`
  - Manual built-CLI dry-run validation via `node dist/cli.js feed agent run --max-pages 0 --dry-run`, followed by `node dist/cli.js feed agent status` and `node dist/cli.js feed agent log --limit 5`
- Review findings fixed during implementation:
  - bookmark threshold was initially too strict for the strong-preference fixture, so strong matches could auto-like without auto-bookmarking
  - CLI help assertions initially targeted the wrong command depth and were corrected to inspect the `feed agent` subcommand surface directly
- Residual risk:
  - positive X mutation query ids are reverse-engineered web contracts, so a future X change could break live automation even though mocked tests pass

# 2026-04-15 plan status sync

## Plan

- [x] Verify implementation coverage for the `feed` and `hybrid search` plan documents against the current codebase and tests
- [x] Update stale plan statuses and remaining unit checkboxes so docs match reality
- [x] Review the doc-only diff to confirm the change is limited to status synchronization

## Review

- Confirmed the `feed` feature is implemented in `src/graphql-feed.ts`, `src/feed-db.ts`, `src/feed-service.ts`, and `src/cli.ts`, with coverage in `tests/graphql-feed.test.ts`, `tests/feed-db.test.ts`, `tests/feed-service.test.ts`, and `tests/cli-feed.test.ts`.
- Confirmed the hybrid cross-archive search feature is implemented in `src/hybrid-search.ts`, `src/search-types.ts`, `src/web-server.ts`, `web/src/App.tsx`, and `src/cli.ts`, with coverage in `tests/hybrid-search.test.ts`, `tests/cli-hybrid-search.test.ts`, and `tests/web-api.test.ts`.
- Updated both plan frontmatter statuses from `active` to `completed` and marked their implementation units complete so the planning docs no longer drift from the shipped code.

# fieldtheory-cli hybrid cross-archive search

## Plan

- [x] Unit 1: add feed FTS retrieval parity and shared search result types
- [x] Unit 2: build the hybrid cross-archive search service with topic and action modes plus optional summaries
- [x] Unit 3: expose hybrid search through CLI and Hono API contracts
- [x] Unit 4: add the web search experience and sync README/docs index
- [x] Verification: run targeted tests, build the app, and manually validate the search flow through `ft web`
- [x] Review: run structured review, fix findings, and record outcomes
- [ ] Ship: commit, push, and open a PR against `Decolo/fieldtheory-cli`

## 2026-04-14 web scroll regression

### Plan

- [x] Reproduce the current web scroll failure and confirm the CSS/layout root cause
- [x] Fix the height/overflow chain so the list pane matches viewport height and scrolls independently
- [x] Verify in a real browser that list scrolling, detail scrolling, tab switching, and search still work
- [x] Update relevant docs to reflect the corrected web layout behavior

### Review

- Root cause was the outer height chain being broken: `html/body/#root` used `min-height` instead of a fixed viewport-height chain, so the workspace expanded with content and the intended inner scroll containers never engaged reliably.
- Updated `web/src/styles.css` so desktop uses `height: 100%/100vh`, `body` and `.app-shell` stop page-level scrolling, `.workspace` becomes a bounded flex child, and both `.item-list` and `.detail-pane` own their own overflow.
- Preserved mobile behavior by restoring normal page overflow below `980px` so the stacked layout does not trap scrolling.
- Verification passed:
  - `npm run build`
  - `npm test -- tests/web-api.test.ts tests/cli-web.test.ts tests/cli-hybrid-search.test.ts`
  - Headless browser check on `http://127.0.0.1:3147`: in `likes`, `.item-list` reported `clientHeight=718`, `scrollHeight=14614`, and `scrollTop` changed from `0` to `600`
  - Headless browser regression flow `bookmarks -> likes -> search -> likes -> bookmarks` completed without page errors or crashes
- Updated `README.md` to remove stale hybrid-search summary/LLM wording and document the desktop split-pane scrolling behavior.

## Notes

- Origin requirements: `docs/brainstorms/2026-04-14-feed-hybrid-search-requirements.md`
- Origin plan: `docs/plans/2026-04-14-005-feat-hybrid-archive-search-plan.md`
- Scope boundary: local-first hybrid search across feed, likes, and bookmarks with CLI + web surfaces; no autonomous actions or external vector infra

## Review

- Added `src/hybrid-search.ts`, `src/hybrid-search-prompt.ts`, and `src/search-types.ts` for one shared hybrid retrieval layer across feed, likes, and bookmarks.
- Extended `src/feed-db.ts` with FTS search plus lazy `feed_fts` repair so older local `feed.db` files upgrade cleanly on first hybrid search.
- Added `ft search-all <query>` in `src/cli.ts` with `--mode`, `--scope`, `--limit`, `--summary`, and `--json`.
- Added Hono endpoints in `src/web-server.ts` for `/api/search` and `/api/search/summary`, and extended status output to include feed counts.
- Updated the React web app to default to a search-first mixed-source view while preserving bookmarks/likes archive browsing.
- Hardened the API and CLI contracts so invalid `mode` and `scope` inputs fail explicitly.
- Added `FT_DISABLE_LLM_ASSIST=1` support to `tryResolveEngine()` so tests do not accidentally invoke real local Claude/Codex CLIs.
- Verification passed:
  - `npm test -- tests/hybrid-search.test.ts tests/web-api.test.ts tests/feed-db.test.ts tests/cli-hybrid-search.test.ts`
  - `npm run build`
  - `node dist/cli.js search-all "claude code" --limit 5`
- Manual `ft web` socket bind validation was blocked by the sandbox (`listen EPERM`), but the web contract is covered by `tests/web-api.test.ts` and the production web bundle build succeeded.
- Final review findings fixed before ship:
  - older `feed.db` files missing `feed_fts` caused real-command failures
  - tests were initially coupling to whatever LLM CLI was installed locally, making them slow and non-deterministic
