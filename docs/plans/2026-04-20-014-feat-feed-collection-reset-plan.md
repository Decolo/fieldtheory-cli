---
title: feat: Reset feed from action agent to collection-only runtime
type: feat
status: completed
date: 2026-04-20
origin: docs/brainstorms/2026-04-19-x-feed-collection-reset-requirements.md
---

# feat: Reset feed from action agent to collection-only runtime

## Overview

Remove the autonomous-action feed layer and narrow the feed product back to deterministic local collection. `ft feed sync` and `ft feed daemon` should continue collecting Home timeline data and keeping local retrieval assets fresh, but `ft feed agent`, `ft feed prefs`, and all auto-like / auto-bookmark runtime behavior should disappear from the CLI and runtime.

## Problem Frame

The origin document resets the feed boundary: the CLI should collect local data, while skills should later handle intent, evaluation, and human-like action workflows (see origin: `docs/brainstorms/2026-04-19-x-feed-collection-reset-requirements.md`). The current implementation still exposes the opposite shape. `src/cli.ts` publishes `feed agent` and `feed prefs`; `src/feed-daemon.ts` runs a `fetch -> semantic -> consume` loop; `src/feed-consumer.ts` executes remote `like` / `bookmark` mutations and persists action-oriented state.

This is standard-to-deep refactor work because it changes exported CLI contracts, removes persisted runtime surfaces, and rewrites the daemon's meaning. The repo already has strong tests for the affected area, so the plan should use those tests to characterize the current contract while intentionally retiring the action-specific parts.

## Requirements Trace

- R1. Reposition feed as local collection, not an autonomous action agent.
- R2. Remove the `ft feed agent` command family outright.
- R3. Remove automatic `like` / `bookmark` behavior from feed sync and daemon flows.
- R4. Keep explicit low-level remote action primitives outside the feed collection product.
- R5. Preserve `ft feed sync` as the primary explicit collection command.
- R6. Narrow `ft feed daemon` to recurring collection only.
- R7. Remove or rewrite feed surfaces whose meaning depends on auto-like / auto-bookmark behavior.
- R8. Preserve existing feed archive value: sync, status, browse, and cross-archive search must still work.
- R13. Keep intent inference and workflow orchestration out of the feed runtime.
- R14. Preserve stable local-data capabilities that future skills can compose.

## Scope Boundaries

- No conversation/comment collection in this plan; that belongs to the follow-up context plan.
- No new skill work in this plan.
- No changes to explicit remote action primitives in `src/graphql-actions.ts` or their non-feed callers.
- No rewrite of feed archive storage, `feed.db`, or `archive.db` beyond what is needed to remove action-oriented observability.
- No daemon supervisor redesign; `tmux` / foreground invocation guidance remains as-is.

## Context & Research

### Relevant Code and Patterns

- `src/cli.ts` currently exposes `feed sync`, `feed status`, `feed list`, `feed show`, `feed agent`, `feed daemon`, `feed prefs`, and `feed semantic`. This file is the single exported CLI contract surface that must be reset.
- `src/feed-daemon.ts` currently defines the recurring runtime and persists `feed-daemon-state.json` / `feed-daemon.log` with action-centric fields such as `lastConsumed`, `lastLiked`, and `lastBookmarked`.
- `src/feed-agent.ts` wraps `fetchFeedItems()` plus `consumeFeedItems()` and owns `feed-agent-state.json` / `feed-agent-log.jsonl`.
- `src/feed-consumer.ts` is the main action pipeline: it reads semantic preferences, scores candidates, performs remote mutations through `src/graphql-actions.ts`, and backfills likes/bookmarks into local archives.
- `src/feed-fetcher.ts`, `src/graphql-feed.ts`, `src/feed-db.ts`, `src/feed-service.ts`, `src/archive-store.ts`, and `src/hybrid-search.ts` are the stable local-data surfaces that must survive the reset.
- `src/semantic-indexer.ts` and `src/semantic-store.ts` are still relevant after the reset because semantic indexing is part of deterministic local retrieval, not autonomous actioning.
- `tests/cli-feed.test.ts`, `tests/feed-daemon.test.ts`, `tests/graphql-feed.test.ts`, and `tests/feed-service.test.ts` cover the surviving feed surfaces.
- `tests/cli-feed-agent.test.ts` and `tests/feed-agent.test.ts` characterize the action surfaces that will be retired or rewritten.

### Institutional Learnings

- No `docs/solutions/` directory exists in this repo, so there are no stored implementation learnings to inherit.
- Recent plan style in `docs/plans/2026-04-19-013-feat-account-research-export-plan.md` shows the current expectation: keep CLI contracts deterministic, reference explicit test files, and record product-boundary decisions directly in the plan.

### External References

- None needed for Plan A. The repo already has enough local context to remove the action runtime without external API research.

## Key Technical Decisions

- Keep `feed daemon` as `fetch -> semantic index`, not `fetch` only. Rationale: semantic indexing is still deterministic local data maintenance and keeps feed retrieval surfaces current without reintroducing agent behavior.
- Remove `feed agent`, `feed consumer`, and `feed preferences` as feed-owned concepts rather than leaving dormant compatibility wrappers. Rationale: dormant shells would preserve the wrong product model and force future maintenance against deprecated artifacts.
- Narrow daemon observability to collection/indexing outcomes. Rationale: feed runtime status should answer "did collection succeed?" instead of exposing stale action counters that no longer map to product behavior.
- Leave explicit `like` / `bookmark` GraphQL primitives intact in `src/graphql-actions.ts`. Rationale: the requirements remove autonomous actioning from feed collection, not all explicit remote mutation capability in the repo.
- Treat old `feed-agent-*` and `feed-prefs.json` artifacts as abandoned local state rather than a data-migration target. Rationale: these files represent a retired product path and are not worth preserving with compatibility semantics.

## Open Questions

### Resolved During Planning

- Should `feed daemon` still maintain semantic retrieval state? Yes; semantic indexing remains collection-adjacent deterministic maintenance.
- Should `feed agent` be kept as a deprecated shell? No; remove it entirely.
- Should `feed prefs` be reinterpreted as collection filters? No; remove it with the action runtime.

### Deferred to Implementation

- Whether to delete action-runtime modules outright or leave a minimal internal compatibility shim until all imports are removed is an implementation sequencing choice, not a product decision.
- Whether `feed-daemon-state.json` should be schema-bumped in place or rewritten opportunistically when the daemon next starts is an implementation detail as long as stale action fields stop surfacing to users.
- Whether docs should mention retired `feed-agent-*` data files explicitly or simply stop referencing them can be finalized while updating operator-facing documentation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
current
  feed daemon tick
    -> fetch feed
    -> rebuild semantic data for new items
    -> score / consume / like / bookmark
    -> persist action metrics

target
  feed daemon tick
    -> fetch feed
    -> rebuild semantic data for new items
    -> persist collection/indexing metrics
    -> stop

removed surfaces
  ft feed agent *
  ft feed prefs *
  feed-agent-state.json
  feed-agent-log.jsonl
  feed-prefs.json
```

## Flow and Edge-Case Analysis

### Primary flows

1. `ft feed sync` continues fetching Home timeline items and rebuilding the feed index exactly as today.
2. `ft feed daemon start --every ...` runs recurring collection and semantic indexing, then records a collection-oriented tick summary.
3. `ft feed status`, `ft feed list`, `ft feed show`, and `search-all --scope feed` continue reading the local feed archive without caring that action runtime state is gone.

### Important edge cases

- Existing `feed-daemon-state.json` may still contain action-era fields; the new status formatter must not surface them as if they still mattered.
- Users with stale `feed-agent-*` files should not see CLI errors simply because those files remain on disk after upgrade.
- Semantic indexing failures must still be reported clearly in daemon status/log output even after action-specific error kinds disappear.
- Help output and test fixtures must stop advertising removed subcommands immediately so users do not infer hidden compatibility.

## Implementation Units

- [ ] **Unit 1: Remove action-runtime modules and feed-owned action state**

**Goal:** Retire the internal runtime pieces that make feed behave like an autonomous actor.

**Requirements:** R1, R2, R3, R7, R13

**Dependencies:** None

**Files:**
- Delete or retire: `src/feed-agent.ts`
- Delete or retire: `src/feed-consumer.ts`
- Delete or retire: `src/feed-preferences.ts`
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Modify: `tests/feed-agent.test.ts`
- Modify: `tests/cli-feed-agent.test.ts`

**Approach:**
- Remove the `FeedAgent*` and `FeedPreferences` type surface from `src/types.ts`.
- Remove feed-agent-specific path helpers from `src/paths.ts`; decide whether `twitterFeedPrefsPath()` should be deleted with the module or retained only if another non-feed caller still needs it.
- Delete action-oriented modules once all imports are removed, or temporarily stub them during the refactor if that simplifies sequencing.
- Rewrite or delete tests that currently assert the old agent contract so the suite becomes explicit about the new absence of these surfaces.

**Patterns to follow:**
- Dead-surface retirement style already used when older plan docs and compatibility flows were removed from this repo.
- Current CLI contract tests in `tests/cli-feed.test.ts` for how surviving feed surfaces should still be verified.

**Test scenarios:**
- Happy path: building the CLI no longer registers `feed agent` or `feed prefs`.
- Edge case: local data directories that still contain `feed-agent-state.json`, `feed-agent-log.jsonl`, or `feed-prefs.json` do not break surviving feed commands.
- Error path: invoking removed command names now fails as unknown commands rather than as hidden deprecated wrappers.

**Verification:**
- There is no runtime path left in the codebase that can automatically like or bookmark from feed collection flows.

- [ ] **Unit 2: Rewrite the CLI contract around collection-only feed behavior**

**Goal:** Make the exported `ft feed` contract reflect the new product boundary.

**Requirements:** R2, R3, R5, R6, R7, R8, R14

**Dependencies:** Unit 1

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli-feed.test.ts`
- Modify: `tests/cli-feed-agent.test.ts`

**Approach:**
- Remove the `feed agent` and `feed prefs` command groups from `buildCli()`.
- Rewrite `feed daemon` descriptions, option help, and operator-facing output so the command speaks only about recurring collection/indexing.
- Preserve `feed sync`, `feed status`, `feed list`, `feed show`, and `feed semantic` with minimal behavioral change.
- Keep `parseIntervalMs()` and other generic CLI helpers where still used by the daemon.

**Patterns to follow:**
- Existing command-group organization in `src/cli.ts`
- Concise CLI messaging patterns already used by `accounts` and `bookmarks`

**Test scenarios:**
- Happy path: `buildCli()` still exposes `feed sync`, `feed status`, `feed list`, `feed show`, `feed daemon`, and `feed semantic`.
- Happy path: daemon help no longer mentions consume, scoring, dry-run actioning, like thresholds, bookmark thresholds, or feed preferences.
- Edge case: `ft feed status`, `ft feed list`, and `ft feed show` remain unchanged for a local-only user with no daemon state file.
- Error path: old `feed agent` examples in tests or docs are rejected and removed.

**Verification:**
- The CLI help itself communicates the reset correctly without relying on documentation to explain away stale commands.

- [ ] **Unit 3: Narrow daemon runtime and observability to collection/indexing**

**Goal:** Keep recurring feed collection while rewriting daemon state, stages, and logs around non-action behavior.

**Requirements:** R3, R5, R6, R7, R8, R14

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/feed-daemon.ts`
- Modify: `src/feed-fetcher.ts`
- Modify: `src/types.ts`
- Modify: `tests/feed-daemon.test.ts`

**Approach:**
- Remove `consumeFeedItems()` from the daemon tick; the runtime should stop after fetch plus semantic indexing.
- Replace action-specific state fields and summary text with collection-oriented metrics, such as fetched/new items and indexed items.
- Simplify error classification by removing action-specific branches while retaining network/auth/upstream/semantic/config categories that still apply.
- Ensure status and log output remain useful for operators running the daemon via `tmux`, consistent with repo guidance in `AGENTS.md`.

**Patterns to follow:**
- `src/feed-fetcher.ts`
- `src/semantic-indexer.ts`
- Existing `formatFeedDaemonStatus()` structure in `src/feed-daemon.ts`

**Test scenarios:**
- Happy path: a successful daemon tick records fetch and semantic-index summaries without any consumed / liked / bookmarked counters.
- Happy path: status formatting continues to redact sensitive error text.
- Edge case: a daemon state file written by the previous schema still formats safely and does not crash on missing new fields or extra retired fields.
- Error path: semantic indexing failure still produces a clear daemon summary and error-kind classification.

**Verification:**
- Running the daemon can only change local collection/indexing state, never remote social state.

- [ ] **Unit 4: Update docs and internal references to the new feed boundary**

**Goal:** Make the collection-only reset discoverable and remove stale references to feed as an action agent.

**Requirements:** R1, R2, R6, R8, R13, R14

**Dependencies:** Unit 2, Unit 3

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/brainstorms/2026-04-12-x-feed-requirements.md`

**Approach:**
- Remove or clearly supersede stale documentation that still describes autonomous feed likes/bookmarks as the current product.
- Update command references and examples so the feed surface is described as local collection plus retrieval.
- Keep the old brainstorm as historical context, but ensure current docs point readers at the superseding requirements and this plan.

**Patterns to follow:**
- Documentation update style in `README.md`
- Existing superseding pattern in brainstorm docs

**Test scenarios:**
- Test expectation: none; documentation-only unit.

**Verification:**
- A new contributor reading docs no longer infers that feed collection performs autonomous likes or bookmarks.

## System-Wide Impact

- **CLI contract:** `ft feed` becomes smaller and cleaner, with fewer commands but clearer responsibility boundaries.
- **Local state:** stale action-runtime artifacts may remain on disk, but they stop mattering to active product behavior.
- **Search and archive surfaces:** unaffected except that they stop receiving new auto-like / auto-bookmark side effects from feed runtime.
- **Future skill work:** easier, because skills can assume feed is a stable local collection substrate instead of a competing autonomous actor.
