---
title: feat: Add CLI-first X home timeline viewer
type: feat
status: completed
date: 2026-04-12
origin: docs/brainstorms/2026-04-12-x-feed-requirements.md
---

# feat: Add CLI-first X home timeline viewer

## Overview

Add a new `feed` archive family that fetches tweet-only entries from the X Home timeline using the same browser-session-backed GraphQL approach as bookmarks and likes, caches fetched batches locally, indexes them for local paging, and exposes a CLI-first read-only viewer.

## Problem Frame

The repo already supports two X-backed local archives: bookmarks and likes. Both reuse the local logged-in browser session, fetch GraphQL timeline-shaped data, persist a JSONL cache plus SQLite index, and expose CLI commands for sync and read access. The new requirement is to extend that product model to the Home timeline without turning the tool into a full X client. Phase 1 is specifically a terminal-first viewer that fetches tweet entries, skips unsupported non-tweet modules, caches fetched results locally, and lets the user continue browsing multiple pages from the CLI (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`).

This is a standard-risk change with one high-uncertainty edge: the Home timeline GraphQL contract is not already implemented in the repo and is not backed by official public documentation. The plan therefore treats endpoint validation and response-shape capture as the first implementation unit and keeps the rest of the feature narrow.

## Requirements Trace

- R1. Support a read-only Home timeline workflow as the first phase.
- R2. Reuse the current logged-in X browser session and GraphQL fetch pattern.
- R3. Keep the first phase focused on viewing feed items rather than becoming a full X client.
- R4. Ship the feature as a CLI-first surface.
- R6. Support tweet entries only and skip unsupported non-tweet units.
- R8. Fetch Home timeline tweets and cache fetched batches locally.
- R9. Support paged browsing across fetched results.
- Success criterion: the feature is useful from the terminal before archive search, digesting, or actions exist.
- Success criterion: the user can fetch and continue browsing multiple pages of Home timeline tweets from the CLI without opening the web app.

## Scope Boundaries

- No web UI feed surface in this iteration.
- No full feed archive product semantics yet: no retention policy, no search UX, and no feed-specific markdown/wiki export.
- No feed-driven like or bookmark actions in this iteration.
- No rendering of promoted units, conversation modules, or other unsupported non-tweet timeline containers.
- No attempt to unify bookmarks, likes, and feed into a generic multi-source archive abstraction in this iteration.

## Context & Research

### Relevant Code and Patterns

- `src/graphql-bookmarks.ts` and `src/graphql-likes.ts` establish the existing X GraphQL archive pipeline: fetch -> normalize -> JSONL/meta/state -> rebuild SQLite index.
- `src/x-graphql.ts` already centralizes session resolution and request header construction and is the right shared seam for any additional timeline fetcher.
- `src/paths.ts` establishes the per-archive storage convention: one JSONL cache, one meta file, one state file when needed, and one SQLite index per archive family.
- `src/likes-db.ts` and `src/bookmarks-db.ts` show the preferred read path: build a dedicated timeline-oriented SQLite schema and expose `list*`, `get*ById`, and count helpers with `limit` / `offset`.
- `src/cli.ts` shows the desired operator surface: a top-level archive group with `sync`, `status`, `list`, and `show`, plus existing sync options for browser/session overrides and progress output.
- `tests/graphql-likes.test.ts` and `tests/graphql-bookmarks.test.ts` are the closest parser/merge/fixture precedents.
- `tests/cli-likes.test.ts`, `tests/likes-db.test.ts`, and `tests/likes-service.test.ts` are the closest CLI, list/show, and status behavior precedents.

### Institutional Learnings

- There is no `docs/solutions/` directory in this repo, so there are no recorded institutional learnings to inherit.
- `docs/plans/2026-04-08-001-feat-local-web-archive-plan.md` is the strongest precedent for adding a new read surface over existing local archives and favors thin surfaces over existing archive modules.
- `docs/plans/2026-04-08-002-feat-remote-unlike-unbookmark-plan.md` reinforces the separation between remote X interactions and local archive reconciliation.
- `docs/plans/2026-04-09-003-feat-likes-trim-command-plan.md` reinforces the repo's bias toward narrow first-class commands over speculative generalization.

### External References

- No external framework or API documentation is authoritative for the Home timeline GraphQL surface. Planning relies on repo-grounded X GraphQL patterns and treats Home timeline contract validation as an explicit implementation prerequisite rather than a settled assumption.

## Key Technical Decisions

- Introduce a separate `feed` archive family instead of extending bookmarks or likes in place. This preserves the repo's existing archive symmetry without forcing a generic abstraction before the third surface is understood.
- Split remote fetch pagination from local browse pagination. Remote GraphQL cursoring remains an implementation detail of `feed sync`, while the user-facing browse experience uses the existing local `limit` / `offset` pattern over a SQLite index.
- Treat Home timeline contract capture and validation as part of the productized implementation, not an untracked manual prerequisite. The first implementation unit should capture the query contract in sanitized fixtures and tests so the feature does not depend on tacit local knowledge.
- Keep phase 1 read-only and tweet-only. Unsupported timeline entries should be counted and skipped rather than partially rendered, because the requirement is a useful viewer, not X parity.
- Persist feed ordering explicitly. `FeedRecord` should carry the X timeline `sortIndex` when present plus a per-sync fetch position fallback so local browsing can preserve X-provided ordering within and across fetched batches without pretending the feed is chronological.
- Preserve future feed evolution by storing stable feed item ids and keeping fetch, local storage, and later remote actions separated. This satisfies the roadmap requirements without prematurely designing a full automation layer.

## Open Questions

### Resolved During Planning

- Should phase 1 be CLI, web, or both? CLI only for phase 1, with any web surface deferred by the origin requirements.
- Should phase 1 be stdout-only or locally cached? Locally cached, following the existing archive family storage model.
- Should paging be live-only or support continued browsing? Support continued local browsing from cached fetched results using `limit` / `offset`.
- Should phase 1 attempt to support all Home timeline entry types? No. Support tweet entries only and skip unsupported non-tweet modules.

### Deferred to Implementation

- The exact Home timeline GraphQL operation name, query id, field toggles, and cursor extraction rules are intentionally deferred to Unit 1 because they depend on validating the live X response shape and capturing a sanitized representative response fixture.
- The exact file-level boundary between shared helpers in `src/x-graphql.ts` and feed-specific fetch logic is intentionally deferred until the real Home response shape is in hand.
- Whether the local feed cache should later graduate into a durable archive with search, digesting, and web browsing remains intentionally deferred to later product work.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft feed sync --max-pages N
  -> resolve X session from browser cookies
  -> capture / codify Home timeline query contract in fixture-backed parser tests
  -> fetch Home timeline GraphQL pages
  -> keep TimelineTweet-style entries only
  -> normalize to FeedRecord[] with stable id + sortIndex + fetch position
  -> write feed.jsonl + feed-meta.json + feed-state.json
  -> rebuild feed.db

ft feed list --limit 30 --offset 30
  -> query feed.db ordered by persisted feed order
  -> print compact timeline rows from local cache

ft feed show <id>
  -> read one indexed feed item
  -> print detail from local cache
```

## Implementation Units

- [x] **Unit 1: Validate and normalize the Home timeline fetch contract**

**Goal:** Add a dedicated feed fetcher that can authenticate with the existing browser-session model, fetch Home timeline pages, normalize tweet entries into a feed-specific record shape, and persist cache/meta/state files.

**Requirements:** R1, R2, R6, R8

**Dependencies:** Existing X session helpers and JSONL/meta file conventions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Modify: `src/x-graphql.ts`
- Create: `src/graphql-feed.ts`
- Test: `tests/graphql-feed.test.ts`

**Approach:**
- Start by capturing the Home timeline request contract from the browser network surface and codifying it into sanitized test fixtures: operation name, query id, feature/field toggles, cursor placement, and one representative response body. If this capture fails, stop implementation and return to re-planning.
- Introduce a feed-specific raw record type in `src/types.ts` rather than overloading `LikeRecord` or `BookmarkRecord`.
- Add feed storage paths in `src/paths.ts` that match the existing per-archive naming convention.
- Reuse `resolveXSessionAuth()`, `buildGraphqlUrl()`, and `buildXGraphqlHeaders()` in `src/x-graphql.ts` where possible; only extract more shared logic if the feed fetcher would otherwise become a copy of likes/bookmarks.
- Implement the feed fetcher as a dedicated module that:
  - validates the Home timeline GraphQL contract,
  - filters for tweet entries only,
  - records skipped unsupported entries for operator visibility,
  - persists `sortIndex` and per-page fetch position so local browsing can preserve feed order,
  - writes JSONL/meta/state files,
  - preserves enough ordering and timestamp fields for later local browsing.
- Treat missing or invalid Home timeline contract details as a first-class failure with a clear operator-facing error instead of silently producing an empty cache.

**Execution note:** Start with a failing parser-level behavior test that captures one valid tweet page, one unsupported-entry page, and one contract-failure response.

**Patterns to follow:**
- `src/graphql-likes.ts`
- `src/graphql-bookmarks.ts`
- `src/x-graphql.ts`
- `tests/graphql-likes.test.ts`

**Test scenarios:**
- Happy path: a valid Home timeline response containing tweet entries produces normalized `FeedRecord` items with stable ids, author metadata, URLs, timestamps, `sortIndex`, and per-page fetch position.
- Happy path: multiple fetched pages merge into one cache result with a saved resume cursor or equivalent fetch state.
- Edge case: a response containing only unsupported non-tweet entries yields zero cached items but reports skipped-entry counts rather than failing silently.
- Edge case: duplicate tweet ids across fetched pages are merged without duplicating local records, while preserving the newest feed-order metadata for local browsing.
- Error path: an expired-session or unauthorized response raises a clear error instructing the user to refresh browser auth.
- Error path: a structurally unexpected Home timeline response fails with an explicit contract error instead of writing misleading cache files.
- Integration: a temp data dir sync writes `feed.jsonl`, `feed-meta.json`, and `feed-state.json` with counts and timestamps that match the fetched result.

**Verification:**
- Fixture-driven tests prove the fetcher accepts tweet entries, rejects unsupported contract shapes explicitly, and persists the expected cache artifacts in a temp data dir.

- [x] **Unit 2: Add a local feed index and read models for paging**

**Goal:** Build a feed-specific SQLite index and read API that support local paging and detailed item lookup over cached feed records.

**Requirements:** R1, R8, R9

**Dependencies:** Unit 1

**Files:**
- Create: `src/feed-db.ts`
- Create or modify: `src/feed-service.ts`
- Test: `tests/feed-db.test.ts`
- Test: `tests/feed-service.test.ts`

**Approach:**
- Create a feed-specific SQLite schema modeled after `likes-db` rather than trying to extend the likes or bookmarks tables.
- Expose the same local browsing surface the repo already uses for archive families:
  - build/rebuild index,
  - count feed items,
  - list feed items with `limit`, `offset`, and stable ordering,
  - get one feed item by id,
  - format a status view for CLI output.
- Keep local paging strictly database-backed. The user should browse cached rows with offset-based pagination, while remote cursoring stays private to the fetcher.
- Define the canonical local ordering explicitly: order by the most recent sync batch first, then by persisted X `sortIndex` descending when present, then by per-page fetch position, then by tweet id fallback. When the same tweet reappears in a later sync, update its stored order metadata so it bubbles to the newer fetched position.
- Include skipped-entry and last-sync information in the feed status view if the state/meta model captures it, so operators can tell the difference between an empty feed and a fully skipped page.

**Patterns to follow:**
- `src/likes-db.ts`
- `src/bookmarks-db.ts`
- `src/likes-service.ts`
- `tests/likes-db.test.ts`
- `tests/likes-service.test.ts`

**Test scenarios:**
- Happy path: rebuilding the feed index from cached JSONL creates listable rows ordered by the persisted feed-order model rather than tweet timestamps alone.
- Happy path: `getFeedById` returns the full indexed item for a known id.
- Edge case: list pagination with `limit` and `offset` returns the expected non-overlapping windows across one cached fetch.
- Edge case: a tweet refetched in a later sync moves to the newer local browse position rather than remaining stuck at its old slot.
- Edge case: records lacking one ordering field still sort predictably using the defined fallback chain.
- Error path: status and list helpers behave predictably when the cache exists but the index has not yet been built or is missing.
- Integration: rebuilding the feed index after a temp-data fetch produces counts that match the feed meta file and list output.

**Verification:**
- Temp-data index tests prove the feed archive can be rebuilt, paged, and queried using the same local model as existing archive families.

- [x] **Unit 3: Expose the CLI-first feed viewer**

**Goal:** Add a top-level `feed` command group that lets the user fetch, inspect status, list paged results, and show one cached feed item from the terminal.

**Requirements:** R1, R4, R8, R9

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-feed.test.ts`

**Approach:**
- Add a new `feed` command group to `src/cli.ts` alongside `likes` and `bookmarks`.
- Expose a narrow phase-1 command set:
  - `ft feed sync` for fetching and caching Home timeline pages
  - `ft feed status` for cache/index summary
  - `ft feed list` for paged local browsing
  - `ft feed show <id>` for one cached item
- Reuse the repo's existing sync ergonomics where they make sense: browser selection, direct cookie overrides, page limits, delays, and progress reporting.
- Keep phase-1 output text-first and consistent with `likes list` / `likes status`. Do not add search, web integration, or remote actions in this unit.
- Ensure missing-data and expired-auth paths remain operator-readable and aligned with existing archive guidance.

**Patterns to follow:**
- `src/cli.ts`
- `tests/cli-likes.test.ts`
- `tests/likes-status.test.ts`

**Test scenarios:**
- Happy path: CLI help includes the new `feed` command group and its primary subcommands.
- Happy path: `ft feed status` prints a feed-specific summary including local cache path and last sync information.
- Happy path: `ft feed list --limit 1 --offset 1` prints a paged local view of cached feed items.
- Happy path: `ft feed show <id>` prints detailed output for a known cached feed item.
- Edge case: `ft feed list` on an empty but initialized cache prints no rows without crashing.
- Edge case: `ft feed show <missing-id>` exits non-zero with a clear not-found message.
- Error path: `ft feed sync` surfaces expired-auth or contract-validation failures without building a misleading local index.
- Integration: a temp data dir flow can run sync against mocked X responses, build the index, and then browse the cached results through CLI commands.

**Verification:**
- CLI tests prove the command group is discoverable and the public read-only workflow works against temp cache/index fixtures.

- [x] **Unit 4: Document the new archive family and operator boundaries**

**Goal:** Update docs and working checklist artifacts so the new feed surface is discoverable and its intentional phase-1 limits are recorded.

**Requirements:** R3, R4, R6, R8, R9

**Dependencies:** Unit 3

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `tasks/todo.md`

**Approach:**
- Add the new CLI surface to the README command documentation with a clear explanation that phase 1 is read-only, tweet-only, and CLI-first.
- Add the plan entry to `docs/README.md`.
- Update `tasks/todo.md` to track implementation progress and review notes once work begins.
- Document the operator boundary explicitly so future work on search, web viewing, digesting, and feed-driven actions starts from the recorded roadmap rather than expanding phase 1 opportunistically.

**Patterns to follow:**
- `README.md`
- `docs/README.md`
- `tasks/todo.md`

**Test scenarios:**
- Test expectation: none -- this unit is documentation and task-tracking only.

**Verification:**
- The README and docs index make the new command set and phase-1 boundaries visible to a repo reader without requiring code inspection.

## System-Wide Impact

- **Interaction graph:** The new `feed` archive family adds another X GraphQL ingestion path and another local SQLite index, but should not alter bookmark or like behavior.
- **Error propagation:** Home timeline auth and contract failures should stop `feed sync` before cache/meta/index writes are treated as authoritative. Local read commands should keep the same missing-data behavior as other archive families.
- **State lifecycle risks:** The feed cache will be append/merge oriented like other archives, so duplicate handling and clear rebuild semantics matter. Remote cursor state and local browse pagination must remain separate to avoid confusing operators.
- **API surface parity:** The new archive family should feel symmetrical with `likes` and `bookmarks` at the CLI level, but symmetry should not force a generic shared schema or merged archive abstraction.
- **Integration coverage:** The highest-value integration proof is a mocked-X sync into a temp data dir followed by index build and CLI browsing from the cached feed.
- **Unchanged invariants:** Existing `bookmarks`, `likes`, web APIs, and remote action flows remain unchanged in this plan.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| X Home timeline GraphQL contract differs materially from likes/bookmarks or changes unexpectedly | Make contract validation and fixture capture the first implementation unit and fail explicitly on unsupported shapes |
| A third archive family creates code drift through copy-paste duplication | Reuse `src/x-graphql.ts`, `src/paths.ts`, and existing DB/CLI patterns, but limit abstraction to seams proven necessary by feed specifics |
| Skipping non-tweet entries makes some fetched pages appear sparse | Record skipped-entry counts in state/status so operators can distinguish sparse tweet output from a broken sync |
| Local paging semantics become confused with remote cursor paging | Keep remote cursor handling private to `feed sync` and expose only local `limit` / `offset` browse semantics in CLI commands |
| The feed cache is mistaken for a complete archive product | Document phase-1 boundaries clearly in README, docs index, and task notes |

## Documentation / Operational Notes

- Add the new plan entry to `docs/README.md`.
- Add CLI usage examples for the new `feed` command group to `README.md`.
- Record the working checklist in `tasks/todo.md` before implementation begins.
- If implementation proves Home timeline access is not viable, stop and return to `ce:brainstorm` rather than silently substituting another surface.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-12-x-feed-requirements.md`
- Related code: `src/graphql-likes.ts`
- Related code: `src/graphql-bookmarks.ts`
- Related code: `src/x-graphql.ts`
- Related code: `src/likes-db.ts`
- Related code: `src/cli.ts`
- Related plan: `docs/plans/2026-04-08-001-feat-local-web-archive-plan.md`
- Related plan: `docs/plans/2026-04-08-002-feat-remote-unlike-unbookmark-plan.md`
- Related plan: `docs/plans/2026-04-09-003-feat-likes-trim-command-plan.md`
