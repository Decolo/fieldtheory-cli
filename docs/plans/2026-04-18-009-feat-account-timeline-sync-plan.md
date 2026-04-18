---
title: feat: Add single-account public timeline sync
type: feat
status: completed
date: 2026-04-18
deepened: 2026-04-18
---

# feat: Add single-account public timeline sync

## Overview

Add a new `accounts` archive family that syncs one public X account's recent timeline into a separate local archive, keeps it on a rolling retention window, and exposes a cron-friendly CLI for `sync`, `status`, `list`, and `show`.

## Problem Frame

The repo already supports three X-backed local archive families for the logged-in user: bookmarks, likes, and Home timeline. That covers "my saved things" and "my feed", but not a common monitoring workflow: "pull one public account's latest posts, keep them locally for a while, and check for new activity on cron." The user specifically wants a small first release for one explicitly named account such as `@elonmusk`, including replies to other accounts, with durable local storage and separate browsing.

This is a standard-risk external-integration change. The repo has strong local patterns for X browser-session GraphQL sync, but no current public-account timeline module. The plan therefore keeps the feature narrow, preserves archive separation, and treats the timeline contract plus username-to-user-id resolution as explicit implementation work rather than assumptions.

## Requirements Trace

- R1. Support syncing one explicitly named public X account timeline from the CLI, e.g. `ft accounts sync @elonmusk --limit 50`.
- R2. Store account timeline data in a separate local archive family rather than mixing it into bookmarks, likes, or feed.
- R3. Include the account's visible timeline posts in v1, including replies on other accounts.
- R4. Keep the archive durable across runs, but support rolling cleanup after a fixed retention period.
- R5. Keep the first release separate from `search-all`; browsing stays in an account-specific surface.
- R6. Make the sync flow cron-friendly: repeated runs should incrementally add new posts, avoid full re-imports, and print a compact "what changed" summary.
- R7. Preserve a clean extension path to future multi-account watchlists without requiring that product surface now.
- Success criterion: the user can sync a public account, browse its recent posts locally, and repeat the sync from cron without archive confusion.
- Success criterion: the user can tell from command output or status whether a target account has new posts since the previous run.

## Scope Boundaries

- No watchlist management in this iteration.
- No notifications, webhooks, desktop alerts, or push delivery in this iteration.
- No inclusion in `ft search-all`, the web UI, semantic indexing, or agent preference systems in this iteration.
- No remote write actions on tracked accounts.
- No attempt to generalize bookmarks, likes, feed, and account timelines into one generic archive abstraction in this iteration.
- No dependency on official X API credentials for the default path; the first release should follow the repo's browser-session default.

## Context & Research

### Relevant Code and Patterns

- `src/graphql-feed.ts` is the closest fetcher pattern for a tweet-only read archive using browser-session GraphQL plus retry and explicit contract parsing.
- `src/graphql-likes.ts` is the closest parser pattern for timeline data rooted at `data.user.result.timeline.timeline.instructions`, which is likely adjacent to a public account timeline response shape.
- `src/feed-db.ts`, `src/feed-service.ts`, and `tests/cli-feed.test.ts` are the strongest precedents for a separate read-only archive family with local paging and status output.
- `src/paths.ts` establishes the repo convention for archive-local JSONL/meta/state/db artifacts and is the right place for account-archive path helpers.
- `src/x-graphql.ts` already centralizes X session resolution, GraphQL URL/header construction, fallback transport handling, and request error normalization.
- `src/bookmarks.ts` shows the existing official X API style in this repo when an API-backed path exists, including `users/me` lookup and pagination-token handling.

### Institutional Learnings

- There is no `docs/solutions/` directory in this repo, so there are no stored institutional learnings to inherit.
- `docs/plans/2026-04-12-004-feat-x-feed-cli-viewer-plan.md` is the closest architectural precedent: add a distinct archive family first, keep the surface CLI-first, and defer larger unification.
- `docs/plans/2026-04-15-006-feat-feed-autonomous-actions-plan.md` reinforces the repo's preference for building on stable local archives rather than binding product behavior directly to live X responses.

### External References

- X's official docs currently expose user lookup and user timeline endpoints under `docs.x.com`, including `/x-api/users/get-user-by-username` and `/x-api/users/get-timeline`. These confirm the product concept exists officially, but they do not remove the repo's main constraint: the current product defaults to browser-session sync, not API credential setup.
- `docs.x.com` also documents X API rate limits. Even though the default implementation will follow browser-session GraphQL patterns, this reinforces the need for bounded fetch limits, retry discipline, and compact cron-safe sync summaries.
- No official public docs are authoritative for the browser-session GraphQL contract this repo relies on. Planning therefore keeps contract validation fixture-backed and treats X response drift as a first-class risk.

## Key Technical Decisions

- Use a top-level `accounts` command group now, even though v1 only syncs one account per invocation. This gives a natural future path to `accounts watch` without renaming the surface later.
- Store each tracked account under a resolved user-id directory, not under the raw handle. Rationale: handles can change, but future watchlist support and incremental state become much cleaner when the archive key is stable. The user-facing handle remains an input and display field, not the storage identity.
- Persist a local account registry that maps known handles to resolved user ids during sync. Rationale: `status`, `list`, and `show` should keep working against local data without requiring another live X lookup or an active session.
- Reuse the browser-session GraphQL read model as the default sync path instead of introducing official X API credentials for v1. Rationale: it matches existing repo ergonomics, avoids a second auth surface, and keeps the feature aligned with current install/setup expectations.
- Keep a separate account-timeline record type rather than forcing feed records to serve double duty. Rationale: the archive needs account-specific metadata such as target handle, resolved user id, sync checkpoint state, and retention accounting, while still staying close to the existing tweet record shape.
- Apply retention during sync using age-based pruning, with a default of `90d` and CLI override via `--retain`. Rationale: the user wants durable but self-cleaning history, and age-based pruning is more predictable than count-based trimming for low-volume accounts.
- Keep account timelines out of `search-all` and semantic indexing in v1. Rationale: the user explicitly wants a separate surface first, and mixing the new corpus into shared retrieval would enlarge blast radius before the archive semantics are proven.
- Make the sync summary explicitly report `added`, `pruned`, `latest post`, and whether the newest stored post changed since the previous run. Rationale: this turns plain cron logs into a lightweight monitoring surface without building notifications yet.

## Open Questions

### Resolved During Planning

- Should v1 target one explicit account or a saved watchlist? One explicit account per invocation; watchlists are deferred.
- Should the archive be durable or fetch-only? Durable, with rolling cleanup.
- Should retention be count-based or time-based? Time-based retention with a sensible default and CLI override.
- Should tracked account posts be mixed into shared search now? No; keep a separate browse surface in v1.
- Should replies be included? Yes, because the user asked for the visible account timeline, not only original posts.

### Deferred to Implementation

- The exact GraphQL operation name, query id, and cursor rules for a public account timeline are intentionally deferred to the first implementation unit because they require validating the live X contract and capturing sanitized fixtures.
- Whether one small shared helper should be extracted from `src/graphql-feed.ts` and `src/graphql-likes.ts` for timeline cursor parsing is intentionally deferred until the account timeline response shape is in hand.
- The exact retention duration parser format (`90d`, `30d`, ISO duration, etc.) is intentionally deferred, as long as the CLI lands on one unambiguous operator-facing format.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft accounts sync @elonmusk --limit 50 --retain 90d
  -> normalize handle input
  -> resolve current account identity (handle -> user id)
  -> load archive paths for accounts/<user-id>/
  -> fetch account timeline pages via browser-session X request model
  -> keep tweet-like timeline entries, including replies
  -> normalize to AccountTimelineRecord[]
  -> merge against local cache by tweet id
  -> prune rows older than retention window
  -> write timeline.jsonl + timeline-meta.json + timeline-state.json
  -> rebuild timeline.db
  -> print compact sync summary:
       added / pruned / total / latest post / changed-since-last-sync

ft accounts list @elonmusk --limit 20 --offset 0
  -> resolve handle -> user id from local registry
  -> query accounts/<user-id>/timeline.db
  -> print compact rows from local cache

ft accounts status @elonmusk
  -> resolve handle -> user id from local registry
  -> read account-local meta/state
  -> print last sync, total stored, retention, latest post snapshot
```

## Implementation Units

- [x] **Unit 1: Add account timeline fetch and normalization**

**Goal:** Add a dedicated sync module that resolves a target account, fetches its visible timeline through the existing X browser-session request model, normalizes posts into account-timeline records, and persists account-local cache/meta/state artifacts.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** Existing X session helpers in `src/x-graphql.ts`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Create: `src/account-registry.ts`
- Create: `src/graphql-account-timeline.ts`
- Test: `tests/account-registry.test.ts`
- Test: `tests/graphql-account-timeline.test.ts`

**Approach:**
- Introduce an `AccountTimelineRecord` plus per-account meta/state types in `src/types.ts`, keeping the tweet payload close to `FeedRecord` but adding account-target metadata such as `targetUserId`, `targetHandle`, and last-sync summary fields where needed.
- Add path helpers that derive a stable archive directory from resolved user id, with one JSONL cache, one meta file, one state file, and one SQLite db per tracked account.
- Persist a lightweight registry of synced accounts keyed by normalized handle and resolved user id so later local read commands do not need live network resolution.
- Implement one fetch module that performs:
  - handle normalization and user lookup,
  - public account timeline request construction,
  - response parsing for tweet-like timeline entries,
  - merge-by-tweet-id semantics,
  - account-local cache/meta/state writes.
- Keep fixture-backed parser tests as the contract source of truth. If live capture shows the account timeline shape differs materially from `feed` or `likes`, the implementation should codify the difference explicitly instead of forcing a shared parser too early.
- Record enough state to support cron-safe incrementality: last seen ids, latest stored tweet id, resolved user id, current known handle, last sync result counts, and cursor only if it materially improves resumed scans.
- Update the local registry whenever sync confirms the current known handle for a user id, so future handle changes can be reflected in metadata without rewriting the archive key.

**Execution note:** Start with failing parser and merge tests that cover account lookup, one timeline page with replies, one stale-page incremental stop, and one contract failure.

**Patterns to follow:**
- `src/graphql-feed.ts`
- `src/graphql-likes.ts`
- `src/x-graphql.ts`
- `tests/graphql-feed.test.ts`
- `tests/graphql-likes.test.ts`

**Test scenarios:**
- Happy path: resolving `@elonmusk` yields a stable user id and fetches timeline records with author metadata, tweet ids, URLs, timestamps, and reply metadata.
- Happy path: replies in the account's timeline are preserved as normal records rather than filtered out.
- Edge case: an input handle with a leading `@` and mixed casing normalizes to the same target archive identity as the bare lowercase handle.
- Edge case: duplicate tweet ids across pages merge into one cached row while refreshing the newest sync metadata.
- Error path: unknown or suspended usernames fail with a clear operator-facing error and do not create misleading cache files.
- Error path: unauthorized browser-session responses surface the same refresh-session guidance style used by existing X sync commands.
- Error path: a structurally unexpected timeline response fails explicitly as a contract error rather than silently writing an empty archive.
- Integration: a temp data dir sync writes account-local `timeline.jsonl`, `timeline-meta.json`, and `timeline-state.json` under the resolved user-id directory with counts matching the mocked response.

**Verification:**
- Fixture-driven tests prove the fetcher can resolve one public account, ingest timeline rows including replies, and persist account-local artifacts without touching other archive families.

- [x] **Unit 2: Add rolling retention, local index, and account status/read models**

**Goal:** Build the account-local SQLite index plus retention-aware status/list/show helpers so repeated syncs remain bounded and locally browsable.

**Requirements:** R2, R4, R5, R6, R7

**Dependencies:** Unit 1

**Files:**
- Create: `src/account-timeline-db.ts`
- Create: `src/account-timeline.ts`
- Create or modify: `src/account-timeline-service.ts`
- Modify: `src/account-registry.ts`
- Test: `tests/account-timeline-db.test.ts`
- Test: `tests/account-timeline-service.test.ts`
- Test: `tests/account-registry.test.ts`

**Approach:**
- Model the SQLite schema after `src/feed-db.ts`, but include account-target metadata where it materially improves status or display.
- Apply retention pruning during sync merge, before index rebuild. The prune rule should use `postedAt` when available, with `syncedAt` as a fallback so malformed timestamps do not become immortal rows.
- Expose helpers for:
  - reading the local account registry,
  - building/rebuilding one account timeline db,
  - counting stored rows,
  - listing rows with `limit` / `offset`,
  - fetching one row by id,
  - formatting one account status view with last sync, total stored rows, retention window, and latest stored post snapshot.
- Make the local ordering explicit and stable: newest visible post first, preferring `postedAt`, then tweet id fallback when needed. Unlike Home timeline ordering, this archive should present account chronology, not sync-batch order.
- Preserve enough sync-summary state to answer "did the latest post change?" cheaply from local metadata, so cron runs do not need to diff full archives externally.
- Make local read/status helpers depend on the local registry and account-local files only. Once an account has been synced at least once, browsing its archive should not require a live X request.

**Patterns to follow:**
- `src/feed-db.ts`
- `src/feed-service.ts`
- `src/feed.ts`
- `tests/feed-db.test.ts`
- `tests/feed-service.test.ts`

**Test scenarios:**
- Happy path: rebuilding the account timeline index from cached JSONL produces listable rows ordered by newest post chronology.
- Happy path: status output includes total posts, retention window, last sync timestamp, and latest stored tweet reference for one account archive.
- Edge case: retention pruning removes rows older than the configured window while preserving newer rows and rewriting counts correctly.
- Edge case: records without `postedAt` still participate in retention and ordering via `syncedAt` fallback instead of causing crashes or permanent retention leaks.
- Edge case: two different tracked accounts with separate user-id directories keep isolated counts, status, and db rows.
- Edge case: `status` and `list` still work from the local registry when the browser session is unavailable, as long as the account has been synced before.
- Error path: `list` and `show` behave predictably when an account archive has never been synced or the db has not yet been built.
- Integration: a temp-data rebuild after sync yields db row counts and latest-post metadata that match the pruned local cache.

**Verification:**
- Temp-data tests prove account archives remain isolated, bounded by retention, and browsable through the same local read model used elsewhere in the repo.

- [x] **Unit 3: Expose cron-friendly `accounts` CLI commands**

**Goal:** Add the first public CLI surface for syncing one target account and inspecting its local archive.

**Requirements:** R1, R4, R5, R6, R7

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-accounts.test.ts`

**Approach:**
- Add a top-level `accounts` group in `src/cli.ts` with a narrow initial command set:
  - `ft accounts sync <handle>`
  - `ft accounts status <handle>`
  - `ft accounts list <handle>`
  - `ft accounts show <handle> <tweet-id>`
- Resolve `status`, `list`, and `show` targets from the local account registry first. Only `sync` should need live account resolution when the target handle has never been seen before.
- Keep the first sync interface explicit and cron-friendly:
  - `--limit` bounds the amount fetched per run,
  - `--retain` controls rolling retention,
  - existing browser/session override flags stay aligned with the repo's current X sync ergonomics.
- Make sync stdout intentionally useful for cron logs: include target handle, added count, pruned count, total stored, and whether the latest stored tweet changed since the previous sync.
- Keep missing-data, unknown-account, and expired-auth paths brief and operator-readable. The CLI should fail loudly when the target account cannot be resolved rather than printing an empty success summary.

**Patterns to follow:**
- `src/cli.ts`
- `tests/cli-feed.test.ts`
- `tests/cli-feed-agent.test.ts`

**Test scenarios:**
- Happy path: CLI help includes the new `accounts` command group and its primary subcommands.
- Happy path: `ft accounts sync @alice --limit 50 --retain 90d` prints a compact summary with added, pruned, total, and latest-post-change fields.
- Happy path: `ft accounts status @alice` prints account-specific archive status without referencing personal bookmarks, likes, or feed caches.
- Happy path: `ft accounts list @alice --limit 1` prints a local timeline row from the tracked account archive.
- Happy path: `ft accounts show @alice <tweet-id>` prints detail for one stored account-timeline record.
- Edge case: handle normalization means `@Alice` and `alice` point to the same local archive after the first sync.
- Edge case: `status`, `list`, or `show` on an unsynced account exits non-zero with a clear "sync this account first" style message.
- Edge case: `status`, `list`, and `show` continue to work for previously synced accounts when the machine is offline or the X session has expired.
- Error path: sync failures caused by unresolved usernames or expired X sessions do not print misleading success summaries.
- Integration: a temp data dir flow can sync one mocked account archive, rebuild its db, and browse the result through the CLI commands.

**Verification:**
- CLI tests prove the user can run one explicit account sync from the terminal or cron and then inspect the archive without touching other surfaces.

- [x] **Unit 4: Document the new archive family and cron posture**

**Goal:** Make the new `accounts` archive discoverable, explain its retention model, and record the intentional v1 limits.

**Requirements:** R1, R4, R5, R6, R7

**Dependencies:** Unit 3

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `tasks/todo.md`

**Approach:**
- Update install/usage docs to describe the `accounts` archive family as separate from bookmarks, likes, and feed.
- Add one cron example for repeated single-account sync and clarify that v1 is explicit-per-account, not a saved watchlist yet.
- Document the retention behavior and the fact that account timelines stay out of `search-all` in this phase.

**Patterns to follow:**
- `README.md`
- `docs/README.md`
- Existing archive-family documentation style in `README.md`

**Test scenarios:**
- Test expectation: none -- documentation-only unit.

**Verification:**
- The README and docs clearly show how to sync one public account, what gets stored, how retention works, and what is intentionally deferred.

## System-Wide Impact

- **Interaction graph:** `accounts sync` reuses `src/x-graphql.ts` request/session handling, while `accounts status/list/show` should stay local-first through the account registry and account-local artifacts.
- **Error propagation:** account lookup failures, auth failures, and contract failures should stop sync before cache/meta/db writes are treated as authoritative.
- **State lifecycle risks:** handle changes, duplicate tweet re-fetches, and retention pruning all touch persistent state. Using resolved user id as storage identity and merge-by-tweet-id semantics limits drift and accidental duplication.
- **API surface parity:** this plan adds a new CLI contract under `ft accounts ...`; it does not change `ft sync`, `ft likes`, `ft feed`, or shared search contracts.
- **Integration coverage:** fixture-backed parser tests plus temp-data CLI flows are the critical cross-layer proof because unit tests alone will not catch malformed cache/meta/state interactions.
- **Unchanged invariants:** bookmarks, likes, feed sync, feed agent behavior, web browsing, and `search-all` remain unchanged. The new archive family is intentionally separate in v1.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| X public account timeline GraphQL contract differs from `feed` / `likes` assumptions or drifts later | Treat contract validation and sanitized fixtures as Unit 1 deliverables; fail explicitly on mismatch rather than silently ingesting bad data |
| Handle changes orphan account archives if storage keys use usernames | Use resolved user id as the on-disk identity and keep current handle as mutable metadata |
| Local browsing accidentally depends on live X lookups and breaks offline | Write and consult a local account registry during sync so read commands can resolve known handles without network access |
| Retention pruning deletes useful recent history or behaves unpredictably | Use time-based retention with a clear default and CLI override; prune during sync with deterministic timestamp fallback rules |
| Cron output is too weak to answer "did this account post?" | Include latest-post-change fields in sync summary and status metadata from day one |
| Adding account timelines tempts premature shared-search or semantic coupling | Keep `search-all`, web UI, and semantic indexing explicitly out of scope in v1 |

## Documentation / Operational Notes

- README examples should show both an ad hoc read use case (`--limit 50`) and a cron-friendly recurring example.
- If the feature later expands to watchlists, the current `accounts` command group and user-id-keyed archive layout should remain compatible.
- This feature should continue honoring the repo's Chrome constraint: any future browser interaction beyond cookie reuse must go through Chrome DevTools MCP, not scripted Chrome automation.

## Sources & References

- Related code: `src/graphql-feed.ts`
- Related code: `src/graphql-likes.ts`
- Related code: `src/feed-db.ts`
- Related plan: `docs/plans/2026-04-12-004-feat-x-feed-cli-viewer-plan.md`
- External docs: https://docs.x.com/x-api/users/get-user-by-username
- External docs: https://docs.x.com/x-api/users/get-timeline
- External docs: https://docs.x.com/x-api/fundamentals/rate-limits
