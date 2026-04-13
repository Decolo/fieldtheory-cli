# fieldtheory-cli hybrid cross-archive search

## Plan

- [x] Unit 1: add feed FTS retrieval parity and shared search result types
- [x] Unit 2: build the hybrid cross-archive search service with topic and action modes plus optional summaries
- [x] Unit 3: expose hybrid search through CLI and Hono API contracts
- [x] Unit 4: add the web search experience and sync README/docs index
- [x] Verification: run targeted tests, build the app, and manually validate the search flow through `ft web`
- [x] Review: run structured review, fix findings, and record outcomes
- [ ] Ship: commit, push, and open a PR against `Decolo/fieldtheory-cli`

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
