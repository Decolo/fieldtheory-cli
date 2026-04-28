---
title: checklist: Phase 1 implementation for unified Twitter CLI surface
type: checklist
status: proposed
date: 2026-04-27
origin: docs/plans/2026-04-27-016-unified-twitter-cli-surface-plan.md
---

# checklist: Phase 1 implementation for unified Twitter CLI surface

## Purpose

Turn the unified CLI surface plan into an execution-ready Phase 1 checklist. This phase is intentionally narrow: expose a stable common contract across primary archive families before doing larger product or storage refactors.

Primary resources in scope:

```text
bookmarks
likes
feed
accounts
```

Phase 1 target:

```text
make the common contract real:
- sync
- list
- show
- search
- status
- index
- export
```

## Scope Boundaries

- No renaming of existing source-specific commands unless a mismatch blocks the common contract.
- No reintroduction of deleted wiki / ask / classify features.
- No broad internal storage refactor.
- No attempt to give every resource the same source-specific power features.
- No expansion of semantic or daemon behavior beyond what is needed to fit the contract cleanly.

## Phase 1 Deliverables

- `feed search` exposed as a first-class CLI command using existing underlying search primitives.
- `feed index` exposed as a first-class CLI command using existing underlying index primitives.
- `bookmarks export`, `likes export`, and `feed export` added.
- canonical export schema documented and used as the default export output.
- shared command/option/output rules applied consistently where already supported.
- `accounts` explicitly aligned to the common contract roadmap, even if `search` and `index` remain future work.

## Canonical Export Contract

Phase 1 must lock this down before adding multiple export commands.

Default rule:

```text
`ft <resource> export` outputs canonical archive-oriented JSON by default.
```

Minimum shape requirements:

```text
{
  "resource": "bookmarks" | "likes" | "feed" | "accounts",
  "items": [
    {
      "id": "...",
      "tweetId": "...",
      "url": "...",
      "text": "...",
      "authorHandle": "...",
      "authorName": "...",
      "postedAt": "...",
      "collectedAt": "...",
      "source": "...",
      "sourceDetails": { ... }
    }
  ],
  "meta": {
    "count": 0,
    "generatedAt": "...",
    "filters": { ... }
  }
}
```

Notes:

- `sourceDetails` is the extension area for source-specific fields.
- `collectedAt` may map from `bookmarkedAt`, `likedAt`, `syncedAt`, or archive attachment timestamps depending on resource type.
- raw source-native export is out of scope for Phase 1; if needed later, it should be an explicit opt-in mode.

## Implementation Units

- [ ] **Unit 1: Document and codify the common command contract**

**Goal:** Convert the Phase 1 contract into explicit repo-facing rules before adding new commands.

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-04-27-016-unified-twitter-cli-surface-plan.md`
- Optional create: `docs/brainstorms/` or `docs/plans/` follow-up notes if needed

**Tasks:**
- Add a concise common contract table for `bookmarks`, `likes`, `feed`, `accounts`.
- State that export defaults to canonical archive-oriented JSON.
- Clarify that `feed` already has underlying search/index support and Phase 1 is exposing it, not inventing a second path.
- Clarify which `accounts` capabilities are in-contract now versus later.

**Acceptance criteria:**
- README and docs stop implying that bookmarks is the only fully featured archive family.
- The default export contract is written down before implementation starts.

- [ ] **Unit 2: Expose `feed search` as a first-class CLI command**

**Goal:** Promote existing feed search primitives into the common resource contract.

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/feed-db.ts` only if small adapter changes are needed
- Test: `tests/cli-feed.test.ts`
- Test: `tests/feed-db.test.ts` only if behavior changes

**Tasks:**
- Add `ft feed search <query>`.
- Reuse existing `searchFeed` implementation rather than building a parallel query path.
- Support common search flags where meaningful in Phase 1.
- Match bookmarks/likes search output style as closely as practical.
- Add `--json`.

**Acceptance criteria:**
- `feed search` works without introducing a second feed search implementation.
- JSON and text outputs are structurally aligned with other resources.

- [ ] **Unit 3: Expose `feed index` as a first-class CLI command**

**Goal:** Make feed indexing visible and repairable through the same contract as bookmarks/likes.

**Files:**
- Modify: `src/cli.ts`
- Reuse: `src/feed-db.ts`
- Test: `tests/cli-feed.test.ts`

**Tasks:**
- Add `ft feed index`.
- Reuse `buildFeedIndex`.
- Support `--force`.
- Align console output with `bookmarks index` and `likes index`.

**Acceptance criteria:**
- Feed has an explicit rebuild path equivalent in operator semantics to bookmarks/likes.
- CLI docs no longer imply feed indexing is hidden or special.

- [ ] **Unit 4: Introduce a shared export abstraction**

**Goal:** Avoid implementing three unrelated export commands with three incompatible schemas.

**Files:**
- Create: `src/archive-export.ts` or equivalent shared module
- Modify: `src/types.ts`
- Modify: `src/archive-projections.ts` and/or `src/archive-store.ts` if needed for canonical export reads
- Test: `tests/archive-export.test.ts`

**Tasks:**
- Define canonical exported item shape.
- Define export metadata shape.
- Provide shared helpers that map each resource family into that shape.
- Keep implementation local-first and side-effect free.

**Acceptance criteria:**
- There is one reusable export contract, not three unrelated command-local serializers.
- Canonical export output can represent bookmarks, likes, and feed without special-casing the top-level schema.

- [ ] **Unit 5: Add `bookmarks export`**

**Goal:** Give bookmarks a first-class export surface aligned with the new common contract.

**Files:**
- Modify: `src/cli.ts`
- Reuse/modify: shared export module from Unit 4
- Optional modify: `src/bookmarks-db.ts` or archive projection helpers
- Test: `tests/cli-bookmarks.test.ts` or the closest existing CLI/bookmarks test file

**Tasks:**
- Add `ft bookmarks export`.
- Support common filter semantics where practical:
  - `--query`
  - `--author`
  - `--after`
  - `--before`
  - `--limit`
- Output canonical export JSON.

**Acceptance criteria:**
- A downstream agent can export bookmark data without scraping `list` output.
- Export schema matches the shared contract.

- [ ] **Unit 6: Add `likes export`**

**Goal:** Put likes on the same automation surface as bookmarks.

**Files:**
- Modify: `src/cli.ts`
- Reuse/modify: shared export module from Unit 4
- Optional modify: `src/likes-db.ts` or archive projection helpers
- Test: `tests/cli-likes.test.ts` or the closest existing CLI/likes test file

**Tasks:**
- Add `ft likes export`.
- Support the same common filter semantics as bookmarks export where practical.
- Output canonical export JSON.

**Acceptance criteria:**
- Likes export is symmetric with bookmarks export from an automation perspective.
- Export schema matches the shared contract.

- [ ] **Unit 7: Add `feed export`**

**Goal:** Promote feed into a true first-class archive resource for downstream automation.

**Files:**
- Modify: `src/cli.ts`
- Reuse/modify: shared export module from Unit 4
- Optional modify: `src/feed-db.ts` or archive projection helpers
- Test: `tests/cli-feed.test.ts`

**Tasks:**
- Add `ft feed export`.
- Support at least baseline filtering:
  - `--query` if implementation can reuse a stable search path
  - `--author`
  - `--after`
  - `--before`
  - `--limit`
- Output canonical export JSON.

**Acceptance criteria:**
- Feed becomes exportable without bespoke code paths outside the CLI.
- Export schema matches bookmarks/likes export shape.

- [ ] **Unit 8: Normalize shared option names and text output**

**Goal:** Reduce product drift in already-existing shared commands.

**Files:**
- Modify: `src/cli.ts`
- Optional modify: service formatter modules
- Test: relevant CLI tests

**Tasks:**
- Audit `sync` flags across bookmarks/likes/feed and normalize names where possible.
- Audit `search`, `list`, `show`, `status`, and `index` outputs for similar structure.
- Normalize wording for repair/rebuild/recovery messages where they describe the same operator action.

**Acceptance criteria:**
- A user or agent switching between resources sees the same contract vocabulary.
- Existing commands do not feel like unrelated mini-products.

- [ ] **Unit 9: Put `accounts` on the same roadmap explicitly**

**Goal:** Prevent a fourth divergent archive model from lingering outside the unified contract.

**Files:**
- Modify: `README.md`
- Modify: `src/cli.ts` only for wording if helpful
- Optional create: follow-up plan document if `accounts search/index` becomes Phase 2

**Tasks:**
- Make the contract status of `accounts` explicit in docs.
- Confirm that `accounts export` is a contract-conforming export or mark the gap precisely.
- Decide whether `accounts search` and `accounts index` are deferred to Phase 2 or scheduled immediately after Phase 1.

**Acceptance criteria:**
- `accounts` is no longer described as a special unrelated research path.
- The roadmap clearly states how it converges into the same platform contract.

## Recommended Execution Order

```text
1. Unit 1  document the contract
2. Unit 4  build shared export abstraction
3. Unit 2  add feed search
4. Unit 3  add feed index
5. Unit 5  add bookmarks export
6. Unit 6  add likes export
7. Unit 7  add feed export
8. Unit 8  normalize shared options and outputs
9. Unit 9  lock accounts into the same roadmap
```

Rationale:

- The export schema must be defined before multiple resource exports are implemented.
- `feed search/index` are low-risk because the underlying primitives already exist.
- output and wording normalization should happen after the new common surfaces exist.

## Verification Checklist

- [ ] `bookmarks`, `likes`, and `feed` all expose `sync/list/show/search/status/index/export`
- [ ] `accounts` is documented as part of the same contract even if `search/index` remain deferred
- [ ] all new export commands default to canonical archive-oriented JSON
- [ ] no new command introduces a second parallel storage or retrieval path when an existing primitive exists
- [ ] text output across common commands is visibly aligned
- [ ] JSON output across common commands is automation-safe and schema-consistent

## Out of Scope for Phase 1

- likes-side `stats` / `viz`
- feed-side `stats` / `viz`
- account timeline `search` / `index` parity if that work proves too large
- raw source-native export mode
- broad canonical archive schema refactors
- deeper semantic retrieval redesign
