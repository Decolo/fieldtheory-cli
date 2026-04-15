---
title: feat: Add scheduled autonomous feed actions
type: feat
status: completed
date: 2026-04-15
origin: docs/brainstorms/2026-04-12-x-feed-requirements.md
---

# feat: Add scheduled autonomous feed actions

## Overview

Add a scheduled-first autonomous feed agent that can refresh the local feed archive, score feed items against historical likes and bookmarks, automatically like and bookmark matching tweets on X, and persist durable local state/logs for inspection.

## Problem Frame

The repo already supports feed sync, feed browsing, cross-archive search, and a few remote write actions, but the user still has to manually monitor the feed and decide what to act on. The new requirement is to turn the feed archive into an autonomous action loop that can run on a schedule, re-evaluate local feed items over time, and directly like/bookmark tweets when they fit the user's tastes (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`).

This is a cross-cutting but bounded change. It touches external X mutation contracts, local archive reconciliation, idempotent execution state, and a new CLI surface. It does not need a hosted service, queueing system, or daemon in the first release.

## Requirements Trace

- R1. Preserve the current local-first feed archive model.
- R2. Reuse the current browser-session X auth model for feed access and remote actions.
- R4. Keep existing feed browse/search surfaces intact.
- R5. Support a recurring autonomous workflow.
- R6. First release supports scheduled execution.
- R8. Allow remote `like` and `bookmark` without per-item confirmation.
- R9. Allow like-only, bookmark-only, both, or neither.
- R10. Use historical likes/bookmarks as the primary preference signals.
- R11. Target a balanced operating point, not ultra-conservative gating.
- R13. Allow evaluation of any locally stored feed item.
- R14. Allow repeated re-evaluation over time.
- R15. Keep successful actions idempotent per action type.
- R16. Permit later addition of a missing action on a previously evaluated item.
- R20. Favor preference-driven action decisions over topic-only relevance.
- R21. Keep a durable local run/action record.
- R22. Make post-run inspection possible without watching live execution.

## Scope Boundaries

- No approval queue or human-in-the-loop review surface.
- No daemon in this delivery; the first release is one-shot execution suitable for external schedulers such as `cron`.
- No auto-undo of likes or bookmarks.
- No user-authored policy/rules engine in v1.
- No hosted worker, remote dashboard, or multi-device orchestration.
- No requirement to use an LLM for the first release; planning should prefer a deterministic local preference model unless optional model assistance is clearly low-risk.

## Context & Research

### Relevant Code and Patterns

- `src/graphql-feed.ts`, `src/feed.ts`, and `src/feed-db.ts` already provide the feed fetch/cache/index model to build on.
- `src/graphql-actions.ts` already contains the browser-session-backed remote write pattern for `unlike` and `unbookmark`.
- `src/archive-actions.ts` already shows the preferred archive reconciliation path after a remote mutation succeeds.
- `src/likes-trim.ts` shows the repo's preferred pattern for batched remote actions with resumable local state and progress callbacks.
- `src/hybrid-search.ts` already computes action-oriented signals from historical likes/bookmarks; its heuristics are the closest existing ranking precedent.
- `src/cli.ts` is the single CLI composition point and should remain the place where the agent commands are registered.
- `tests/cli-actions.test.ts`, `tests/graphql-actions.test.ts`, and `tests/cli-feed.test.ts` are the strongest current command/integration precedents.

### Institutional Learnings

- `tasks/todo.md` and recent plans show the current repo workflow: plan-backed work, targeted tests, build verification, docs sync, then review.
- The repo already treats feed, likes, and bookmarks as separate archive families that can be reconciled locally after remote mutations.

### External References

- Web mutation lineages for positive actions were found in public reverse-engineering artifacts:
  - `FavoriteTweet` query id: `lI07N6Otwv1PhnEgXILM7A`
  - `CreateBookmark` query id: `aoDbu3RHznuiSkQ9aNM67Q`
- These are not official contracts, so implementation must keep failures explicit and test the request/response handling through fixtures and mocked HTTP.

## Key Technical Decisions

- Scheduled-first operator surface: ship a one-shot command intended for `cron`/external schedulers, not an internal daemon loop.
  Rationale: this satisfies R5 and R6 with less carrying cost and lower failure-surface complexity.
- Positive remote actions should mirror the existing browser-session mutation pattern.
  Rationale: this preserves auth consistency with existing feed sync and destructive remote actions (R2).
- Successful auto-actions must reconcile the local likes/bookmarks archives immediately.
  Rationale: this keeps later preference scoring and archive browsing aligned with actual remote state.
- The first release should use a deterministic local preference model.
  Rationale: the repo already has enough local signals to ship a useful first loop without making engine availability a requirement for automation.
- Agent state should separate durable per-item action state from append-only run/action logs.
  Rationale: idempotency checks and human inspection are distinct needs and are easier to satisfy with separate artifacts.
- Expose inspection as CLI status/log commands under the feed command group.
  Rationale: inspection is required by R21 and R22, and the repo is CLI-first.

## Open Questions

### Resolved During Planning

- Scheduled or daemon first?
  Resolution: scheduled first via one-shot command; daemon remains a later extension.
- Manual confirmation queue or direct automation?
  Resolution: direct automation with no per-item approval surface.
- Rules engine now or later?
  Resolution: later. v1 relies on preference judgment without explicit operator-authored constraints.

### Deferred to Implementation

- Exact response success keys for positive X mutations may vary across reverse-engineered sources and should be handled conservatively in code.
- Exact score normalization for author/domain/text affinity should be tuned in tests after the first end-to-end pass is wired.
- The final balance between like and bookmark thresholds should be validated against fixture-based behavior tests before finalizing defaults.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft feed agent run
  -> sync a bounded amount of feed data
  -> load feed items + likes + bookmarks + prior agent state
  -> build a local preference profile from historical likes/bookmarks
  -> score candidate feed items
  -> skip already-completed actions per tweet/action type
  -> apply remote like/bookmark mutations for qualified items
  -> reconcile local likes/bookmarks archives
  -> persist run summary + action log + updated agent state

ft feed agent status
  -> read latest agent state
  -> print totals, last run time, action counts, and configured thresholds

ft feed agent log
  -> read append-only action log
  -> print recent runs/actions for human inspection
```

## Implementation Units

- [x] **Unit 1: Add positive X mutations and local archive append helpers**

**Goal:** Support remote `like` and `bookmark` actions through the existing browser-session request model, then reconcile successful actions into the local likes/bookmarks archives.

**Requirements:** R2, R8, R9, R15

**Dependencies:** None

**Files:**
- Modify: `src/graphql-actions.ts`
- Modify: `src/archive-actions.ts`
- Modify: `src/types.ts`
- Test: `tests/graphql-actions.test.ts`
- Test: `tests/archive-actions.test.ts`
- Test: `tests/cli-actions.test.ts`

**Approach:**
- Extend the existing mutation helper with positive action specs for `FavoriteTweet` and `CreateBookmark`.
- Keep the request/response contract explicit and fail loudly on auth or unexpected success payloads.
- Add archive append/upsert helpers for likes and bookmarks so successful auto-actions become immediately visible in local archives and indexes.
- Preserve idempotent local reconciliation: appending an already-present item should refresh or no-op rather than duplicate the record.

**Execution note:** Implement new remote-action behavior test-first.

**Patterns to follow:**
- `src/graphql-actions.ts`
- `src/archive-actions.ts`
- `tests/cli-actions.test.ts`

**Test scenarios:**
- Happy path: `likeTweet()` posts the expected authenticated mutation and accepts the current success payload.
- Happy path: `bookmarkTweet()` posts the expected authenticated mutation and accepts the current success payload.
- Error path: auth failures for positive mutations return the same re-login guidance as existing destructive actions.
- Happy path: local archive append/upsert adds a liked/bookmarked tweet to the correct JSONL cache, updates meta counts, and rebuilds the corresponding index.
- Edge case: appending an already-present archive record does not create duplicates.

**Verification:**
- Mocked mutation tests and archive reconciliation tests prove the positive action path is wired and deterministic.

- [x] **Unit 2: Build the autonomous feed agent service with durable state and logs**

**Goal:** Add one public service that can score feed items against local preference signals, decide actions, enforce per-action idempotency, execute remote mutations, and persist durable state/logs.

**Requirements:** R5, R9, R10, R11, R13, R14, R15, R16, R20, R21, R22

**Dependencies:** Unit 1

**Files:**
- Create: `src/feed-agent.ts`
- Modify: `src/paths.ts`
- Modify: `src/types.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Add dedicated paths and types for agent state and append-only logs.
- Build a deterministic preference profile from historical likes/bookmarks using lightweight local signals such as repeated authors, repeated linked domains, and token overlap with the user's saved corpus.
- Score feed items into separate like/bookmark decisions so one action can happen without the other.
- Track per-tweet action completion and last evaluation metadata to support repeated evaluation without replaying already-successful actions.
- Persist one run summary plus one log entry per attempted or skipped action decision.

**Execution note:** Start with a failing integration-style service test that exercises scoring, idempotent re-runs, and state persistence.

**Patterns to follow:**
- `src/hybrid-search.ts`
- `src/likes-trim.ts`
- `src/feed.ts`

**Test scenarios:**
- Happy path: a feed item from a strongly preferred author/domain is auto-liked and auto-bookmarked, and the run summary reflects both actions.
- Happy path: a medium-confidence item receives only one action when it clears one threshold but not the other.
- Edge case: an already-liked item is re-evaluated but not re-liked again.
- Edge case: an item that was previously liked but not bookmarked can later receive the missing bookmark action.
- Edge case: items with weak preference signals are logged as evaluated/skipped without remote actions.
- Error path: one failed remote action is recorded clearly without corrupting the rest of the run state.
- Integration: the persisted state and log files are sufficient for a second run to avoid duplicate action replays.

**Verification:**
- Service-level tests prove autonomous scoring, action gating, and durable idempotency with fixture data.

- [x] **Unit 3: Expose the scheduled-first CLI surface**

**Goal:** Add a CLI-first operator surface for running the agent once and inspecting status/history.

**Requirements:** R4, R5, R6, R21, R22, R23

**Dependencies:** Unit 2

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-feed-agent.test.ts`

**Approach:**
- Add a `feed agent` command group under the existing `feed` family.
- Ship at least:
  - `ft feed agent run`
  - `ft feed agent status`
  - `ft feed agent log`
- Keep `run` suitable for schedulers: bounded work, stable exit codes, concise stdout, and no interactive prompts.
- Offer limited operator knobs only where they materially affect usefulness, such as feed page count, candidate limit, or dry-run mode.

**Patterns to follow:**
- `src/cli.ts`
- `tests/cli-feed.test.ts`
- `tests/cli-actions.test.ts`

**Test scenarios:**
- Happy path: CLI help includes the `feed agent` command surface.
- Happy path: `ft feed agent run` executes the service and prints a concise run summary.
- Happy path: `ft feed agent status` prints persisted totals and last-run metadata.
- Happy path: `ft feed agent log --limit 5` prints recent actions/skips in reverse chronological order.
- Edge case: running with no feed items exits cleanly and records a no-op run.
- Edge case: `--dry-run` performs scoring/logging without remote actions.

**Verification:**
- CLI tests prove the scheduler-facing one-shot command and post-run inspection commands work against temp-data fixtures.

- [x] **Unit 4: Document scheduled usage and review surfaces**

**Goal:** Update docs and checklists so users can understand what the autonomous agent does, how to schedule it, and how to inspect results.

**Requirements:** R6, R21, R22, R23

**Dependencies:** Unit 3

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `tasks/todo.md`

**Approach:**
- Document the new command surface and explicitly frame the first release as scheduler-driven, not daemon-driven.
- Add at least one concrete scheduling example and one inspection example.
- Record verification outcomes and review notes in `tasks/todo.md`.

**Patterns to follow:**
- `README.md`
- `docs/README.md`
- `tasks/todo.md`

**Test scenarios:**
- Happy path: docs mention the new command names and explain scheduled usage clearly.
- Happy path: docs explain how to inspect status/log output after autonomous runs.

**Verification:**
- The docs and working checklist match the shipped CLI surface and verification evidence.
