---
title: feat: Add following review and confirm-before-unfollow workflow
type: feat
status: completed
date: 2026-04-19
origin: docs/brainstorms/2026-04-19-account-review-unfollow-requirements.md
---

# feat: Add following review and confirm-before-unfollow workflow

## Overview

Add a new CLI workflow that fetches the user's current X following list, runs a conservative two-stage review to identify low-value accounts, stores manual relevance labels locally, and supports confirm-before-unfollow actions using the repo's existing browser-session-first X integration.

## Problem Frame

The repo already supports local archives for bookmarks, likes, feed, and individual public account timelines, but it does not help the user clean up who they follow on X. The origin document defines a conservative maintenance workflow: review the full following list, use inactivity as the primary recommendation reason, strengthen the case with low engagement and manual relevance labels, and require explicit confirmation before any unfollow action (see origin: `docs/brainstorms/2026-04-19-account-review-unfollow-requirements.md`).

This is deep, cross-cutting work. It touches a new local archive family, review/scoring policy, new CLI contracts, and a destructive remote action on top of an unstable external web integration. The plan therefore keeps the product surface narrow, reuses existing repo patterns wherever possible, and isolates X-contract-specific work behind focused modules.

## Requirements Trace

- R1. Review accounts from the user's current X following list, not only accounts already synced locally.
- R2. Keep the workflow CLI-first and return a ranked review list of conservative unfollow candidates.
- R3. Show an explainable primary reason for each candidate, with `inactive` as the lead reason in v1.
- R4. Score candidates across inactivity, low engagement, and low relevance.
- R5. Make inactivity the strongest scoring dimension and base it on lack of recent posting over a configurable window.
- R6. Use available account and post metrics such as follower size, likes, replies, and views as supporting engagement evidence.
- R7. Base low relevance in v1 on manual labels, not only inferred topic similarity.
- R8. Tune recommendations conservatively by default.
- R9. Use a two-stage review: shallow scan all followed accounts, then deeper scan only suspicious or borderline accounts.
- R10. Show review evidence clearly, including inactivity window and supporting engagement or relevance signals.
- R11. Require explicit confirmation before unfollowing any account.
- R12. Report both remote unfollow status and local state outcome after a confirmed action.
- R13. Persist enough local state to avoid rebuilding review context from scratch on every run.
- R14. Store and reuse manual relevance labels locally.
- R15. Preserve a path to repeated account-maintenance workflows without building full automation yet.
- Success criterion: one CLI workflow can review the current following list and produce a conservative, explainable set of unfollow candidates.
- Success criterion: inactivity is visibly the lead explanation when it materially applies.
- Success criterion: the user can confirm an unfollow from the CLI and have the action execute on X without leaving the tool.
- Success criterion: later review runs reflect manual relevance feedback.

## Scope Boundaries

- No automatic unfollowing or unattended bulk pruning in this iteration.
- No requirement to infer relevance from embeddings, bookmarks, or feed preferences in v1.
- No requirement to deep-sync every followed account on every run.
- No web UI surface in this iteration.
- No background daemon, notifications, or scheduled automatic cleanup in this iteration.
- No switch to official X API credentials as the default implementation path; this feature should remain aligned with the repo's browser-session-first approach.

## Context & Research

### Relevant Code and Patterns

- `src/graphql-account-timeline.ts` already resolves a public account, fetches recent posts through X's web GraphQL surface, parses engagement and author metrics, and persists a per-account local archive. This is the closest read-side primitive for stage-2 deep scans.
- `src/account-registry.ts`, `src/account-timeline-db.ts`, and `src/account-timeline-service.ts` show the repo's current pattern for stable per-account storage keyed by user id and browsable through local SQLite state.
- `src/graphql-actions.ts` is the existing write-side pattern for remote X mutations with actionable error mapping and retry handling.
- `src/archive-actions.ts` shows how destructive remote actions currently reconcile local archive state after success.
- `src/cli.ts` centralizes command registration and already contains the current `accounts` family plus destructive flows under `likes`.
- `src/x-graphql.ts` remains the only correct place to reuse browser-session auth, header construction, and network fallback behavior.
- `tests/cli-accounts.test.ts`, `tests/graphql-account-timeline.test.ts`, and `tests/cli-likes.test.ts` are the most relevant test-style precedents for this feature.

### Institutional Learnings

- No repo-local `docs/solutions/` directory exists, so there are no stored institutional learnings to inherit.
- `docs/plans/2026-04-18-009-feat-account-timeline-sync-plan.md` is the closest read-side architectural precedent: keep account-specific data in its own archive family and treat X-contract validation as explicit implementation work.
- `docs/plans/2026-04-08-002-feat-remote-unlike-unbookmark-plan.md` is the closest write-side precedent: isolate destructive X mutations, surface partial-success states clearly, and reconcile local archives only after confirmed remote success.

### External References

- Official X API docs expose follows endpoints for fetching following lists and performing unfollow actions. These confirm the product concept and pagination shape exist, but they do not replace the repo's default browser-session implementation choice (`docs.x.com`, follows introduction and unfollow endpoint).
- The official follows docs also reinforce that following-list retrieval is inherently paginated and that unfollow is a distinct destructive path. Planning should therefore treat pagination state, rate-limit handling, and partial-success reporting as first-class concerns even when the implementation uses the web client contract instead of OAuth-backed API credentials.
- No official public docs are authoritative for the internal X web GraphQL contracts this repo already relies on for browser-session sync and mutation work. Exact request shapes and ids for following-list fetches or web unfollow actions remain implementation-time contract validation work.

## Key Technical Decisions

- Add a separate `following` review archive family rather than overloading `accounts/`. Rationale: explicitly tracked public-account archives and "my current follows under review" have different lifecycle, caching, and UX semantics. Mixing them would make `ft accounts sync @handle` and `ft accounts review` step on each other's state.
- Reuse `graphql-account-timeline` parsing and account-resolution logic by extracting small shared primitives instead of duplicating timeline contract handling. Rationale: the stage-2 deep scan needs the same tweet normalization and engagement extraction already proven in account timeline sync.
- Make stage 1 explicitly cache-backed and profile-led, not a fake inactivity detector. Rationale: the primary recommendation reason is inactivity, but a following-list fetch alone may not include enough timestamp evidence. Stage 1 should narrow the field using following snapshots, local prior scans, and lightweight heuristics; stage 2 is where inactivity is confirmed before recommendation.
- Store manual relevance labels as their own durable local dataset keyed by followed account user id. Rationale: relevance feedback should survive handle changes and future rescans without forcing a broader preference-system redesign.
- Keep the destructive action as a dedicated `unfollow` primitive separate from review generation. Rationale: review generation and remote follow-state mutation have different failure modes and operator expectations; separating them keeps risk localized and CLI usage clearer.
- Require an explicit confirmation boundary inside the unfollow command, with `--yes` only as a deliberate override. Rationale: this matches the repo's existing bias toward explicit destructive operations while still allowing automation if the user chooses it later.
- Default to conservative thresholds and recommendation output that favors false negatives over false positives. Rationale: accidentally unfollowing a still-valuable account is costlier than leaving some weak accounts untouched.

## Open Questions

### Resolved During Planning

- Should v1 review only locally tracked accounts or the current following list? The current following list (see origin).
- Should relevance be model-inferred or manually labeled first? Manual labels first.
- Should unfollow happen automatically or only after review? Only after explicit review and confirmation.
- Should scanning be shallow-only or two-stage? Two-stage.
- Should candidate selection be conservative, balanced, or aggressive? Conservative.

### Deferred to Implementation

- The exact internal X web request path for following-list retrieval should be captured and fixture-backed during implementation.
- The exact internal X web mutation path for unfollow should be validated during implementation; the plan assumes it can be wrapped with the same error-handling model as existing destructive actions.
- Default inactivity and low-engagement thresholds should be finalized during implementation after inspecting what signals the web following-list and timeline responses reliably expose in practice.
- Whether local review-state reconciliation after unfollow should remove the account entirely from the current run cache or mark it as unfollowed-but-kept-for-history should be finalized during implementation; the product requirement only demands that the local outcome be reported clearly.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft accounts review
  -> resolve my authenticated X identity
  -> fetch paginated following list into local following snapshot cache
  -> load prior review state + manual relevance labels
  -> stage 1: score all followed accounts from following snapshot + any cached deep-scan evidence
  -> select suspicious/borderline accounts only
  -> stage 2: fetch deeper recent timeline evidence for selected accounts
  -> recompute final conservative recommendations
  -> write review results + evidence summaries
  -> print ranked candidates with primary reason and supporting signals

ft accounts label <handle> valuable|not-valuable|neutral
  -> resolve followed-account identity from local review cache
  -> persist label keyed by target user id
  -> reuse label in future review runs

ft accounts unfollow <handle>
  -> resolve followed-account identity from local review cache
  -> show confirmation prompt with latest review summary
  -> POST X web unfollow mutation
  -> on success: update local review/following state
  -> print remote outcome + local reconciliation outcome
```

## Flow and Edge-Case Analysis

### Primary flows

1. Review run from a warm cache: refresh following list, reuse prior labels and deep-scan evidence, rescan only suspicious accounts, then print candidates.
2. Review run from a cold cache: fetch following list, identify accounts lacking enough evidence, deep-scan enough of them to produce a conservative first recommendation set, then store that baseline.
3. Label feedback loop: user marks an account as valuable or not valuable, then future review runs incorporate that label without refetching everything.
4. Confirmed unfollow: user chooses one reviewed account, confirms the action, remote unfollow succeeds, and local review state reflects the change.

### Important edge cases to cover in implementation

- The following list changes while a review run is in progress.
- A followed account is protected, suspended, or returns no usable public timeline during stage 2.
- Stage 1 lacks enough evidence to call an account inactive; the system must avoid recommending based on guesswork.
- A manual label exists for an account whose handle has changed since the prior run.
- Remote unfollow succeeds but local review-state reconciliation fails.
- The user attempts to unfollow an account that is no longer present in the latest following snapshot.

## Implementation Units

- [x] **Unit 1: Add following-review data model and local storage primitives**

**Goal:** Create the local archive family that holds following snapshots, manual labels, review results, and per-account review metadata without colliding with the existing `accounts/` archive family.

**Requirements:** R1, R13, R14, R15

**Dependencies:** None

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Create: `src/following-review-state.ts`
- Create: `src/following-review-db.ts`
- Test: `tests/following-review-state.test.ts`
- Test: `tests/following-review-db.test.ts`

**Approach:**
- Introduce explicit types for:
  - one followed-account snapshot,
  - one manual relevance label,
  - one stage-1 or stage-2 review result,
  - one review-run summary/state record.
- Add path helpers for a separate review root, likely under a top-level `following/` directory, with JSON/JSONL artifacts for:
  - current following snapshot,
  - manual labels,
  - review-run state,
  - review results,
  - optional per-account deep-scan cache keyed by user id.
- Build a small SQLite read model for browsing latest review results and resolving handles to stable user ids from the review cache.
- Keep storage keyed by user id rather than handle so labels and review evidence survive handle changes.

**Patterns to follow:**
- `src/account-registry.ts`
- `src/account-timeline-db.ts`
- `src/paths.ts`

**Test scenarios:**
- Happy path: a fresh review-state write persists following snapshots, labels, and results to the expected local paths.
- Happy path: the SQLite read model returns candidates in ranked order with stable handle resolution.
- Edge case: a handle change updates the latest display handle without losing prior labels for the same user id.
- Edge case: missing optional review artifacts on first run return empty defaults rather than crashing.
- Error path: malformed persisted review JSON fails explicitly instead of silently producing empty recommendations.
- Integration: temp-data fixtures can rebuild the review DB and support list/read queries without any live X requests.

**Verification:**
- A temp-data review cache can be written, reloaded, and queried deterministically.

- [x] **Unit 2: Add browser-session following-list sync and reusable account primitives**

**Goal:** Fetch the authenticated user's current following list through the existing browser-session X integration and extract shared account/timeline fetch helpers that later units can reuse.

**Requirements:** R1, R9, R13

**Dependencies:** Unit 1

**Files:**
- Modify: `src/graphql-account-timeline.ts`
- Create: `src/graphql-following.ts`
- Modify: `src/account-registry.ts`
- Test: `tests/graphql-following.test.ts`
- Test: `tests/graphql-account-timeline.test.ts`

**Approach:**
- Add a focused module for:
  - resolving the authenticated user's own X user id,
  - fetching paginated following-list pages,
  - normalizing followed-account profile snapshots,
  - persisting the latest following snapshot and pagination state.
- Extract only the reusable account-resolution and timeline-normalization helpers from `graphql-account-timeline.ts`; keep command-oriented orchestration separate from shared fetch primitives.
- Capture enough following metadata to support stage-1 narrowing, such as handle, display name, follower/following counts, verification state, and any available "most recent post" or similar hints if the web contract provides them.
- Treat suspended, protected, or incomplete entries as explicit snapshot states rather than dropping them silently.

**Execution note:** Start with fixture-backed tests for authenticated-self lookup, paginated following fetch, and contract-failure handling before wiring the persistence layer.

**Patterns to follow:**
- `src/graphql-account-timeline.ts`
- `src/x-graphql.ts`
- `tests/graphql-account-timeline.test.ts`

**Test scenarios:**
- Happy path: a following-list sync fetches multiple pages, normalizes followed accounts, and persists a complete local snapshot.
- Happy path: the authenticated-self lookup resolves the source user id once and reuses it for following pagination.
- Edge case: duplicate accounts across pages collapse into one stable snapshot row keyed by user id.
- Edge case: protected or suspended accounts are preserved with explicit state markers instead of disappearing from the local view.
- Error path: auth failures return the same refresh-session guidance style used by existing sync commands.
- Error path: an unexpected following-list response shape fails explicitly as a contract error.
- Integration: a temp-data following sync writes current snapshot and state artifacts without touching unrelated archive families.

**Verification:**
- Following-list sync works against fixtures with deterministic pagination and state writes.

- [x] **Unit 3: Build the two-stage review engine and manual relevance loop**

**Goal:** Turn following snapshots, cached deep-scan evidence, and manual labels into conservative review recommendations with inactivity as the primary explanation.

**Requirements:** R2, R3, R4, R5, R6, R7, R8, R9, R10, R14, R15

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `src/account-review.ts`
- Create: `src/account-review-service.ts`
- Modify: `src/graphql-account-timeline.ts`
- Modify: `src/following-review-state.ts`
- Test: `tests/account-review.test.ts`
- Test: `tests/account-review-service.test.ts`

**Approach:**
- Implement a stage-1 scoring pass that uses following snapshots plus any existing deep-scan cache to classify accounts as:
  - clearly healthy,
  - clearly too uncertain,
  - suspicious/borderline and worth stage-2 fetch.
- Implement a stage-2 pass that fetches deeper recent timeline evidence only for suspicious or uncertain accounts, then recomputes a final score with:
  - inactivity as the primary reason,
  - engagement as supporting evidence,
  - manual relevance labels as supporting or overriding evidence where appropriate.
- Ensure the engine never recommends an account as inactive unless it has enough evidence to support that claim; uncertainty should suppress or defer recommendations rather than bluff.
- Persist the final ranked candidates plus a review-run summary that the CLI can print or browse later.
- Add label helpers that store `valuable`, `not-valuable`, or `neutral` judgments by target user id and feed them into later runs.

**Patterns to follow:**
- `src/account-timeline-service.ts`
- `src/feed-service.ts`
- `src/graphql-account-timeline.ts`

**Test scenarios:**
- Happy path: an account with no recent posts and weak supporting engagement is recommended with `inactive` as the primary reason.
- Happy path: a manually labeled `not-valuable` account with weak engagement is promoted into the review list when inactivity evidence is also present.
- Edge case: a manually labeled `valuable` account is suppressed from recommendation unless the evidence is overwhelming enough for the documented conservative policy.
- Edge case: an account with weak profile metrics but insufficient timeline evidence is not recommended and is marked as uncertain or deferred.
- Edge case: cached deep-scan evidence is reused on a later run without refetching unchanged accounts unnecessarily.
- Error path: a failed stage-2 timeline fetch for one account does not abort the entire review run; that account is marked with a fetch-status outcome and excluded from recommendation if evidence is incomplete.
- Integration: one end-to-end review run can combine following snapshots, deep-scan timeline fixtures, and manual labels into stable ranked output.

**Verification:**
- Review-engine tests prove candidate selection is conservative, explainable, and label-aware.

- [x] **Unit 4: Add remote unfollow primitive and local review-state reconciliation**

**Goal:** Introduce one focused unfollow action that uses the repo's browser-session-first X integration and reconciles local review state after confirmed remote success.

**Requirements:** R11, R12, R13, R15

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Modify: `src/graphql-actions.ts`
- Create: `src/following-actions.ts`
- Modify: `src/following-review-state.ts`
- Test: `tests/graphql-actions.test.ts`
- Test: `tests/following-actions.test.ts`

**Approach:**
- Extend the existing remote-action layer with one new `unfollow` primitive instead of inventing a parallel mutation stack.
- Keep unfollow-specific request metadata isolated so future X contract drift is localized.
- Reconcile local review state only after confirmed remote success:
  - remove or mark the account as no longer followed in the latest following snapshot,
  - update latest review results so the unfollowed account no longer appears as an active candidate,
  - preserve enough historical context to explain the local outcome in command output.
- Return structured partial-success results when remote success is followed by local reconciliation failure so the CLI can tell the operator exactly what happened.

**Patterns to follow:**
- `src/graphql-actions.ts`
- `src/archive-actions.ts`
- `docs/plans/2026-04-08-002-feat-remote-unlike-unbookmark-plan.md`

**Test scenarios:**
- Happy path: unfollow sends the expected authenticated request and returns success metadata for the unfollowed account id.
- Happy path: successful unfollow updates the local following snapshot so the account no longer appears in later review results.
- Edge case: remote success with no matching local snapshot row returns a clear partial-success result instead of corrupting files.
- Edge case: attempting to unfollow an account already absent from the latest following snapshot still reports the remote/local state clearly.
- Error path: auth failures return actionable re-login guidance and prevent local mutation.
- Error path: non-auth upstream failures surface status code and truncated response body without crashing.
- Integration: temp-data reconciliation removes or marks one followed account cleanly and later review queries reflect the change.

**Verification:**
- Unfollow helper tests prove remote mutation and local reconciliation behavior are deterministic and explicit about partial success.

- [x] **Unit 5: Expose the review, label, and unfollow CLI surface**

**Goal:** Add the user-facing command workflow for review generation, manual relevance labels, candidate browsing, and confirm-before-unfollow actions.

**Requirements:** R1, R2, R3, R8, R9, R10, R11, R12, R14, R15

**Dependencies:** Unit 1, Unit 2, Unit 3, Unit 4

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `docs/README.md`
- Test: `tests/cli-accounts-review.test.ts`
- Modify: `tests/cli-accounts.test.ts`

**Approach:**
- Extend the existing `accounts` command family with a narrow first surface, for example:
  - `ft accounts review`
  - `ft accounts review list`
  - `ft accounts label <handle> <value>`
  - `ft accounts unfollow <handle>`
- Keep `review` as the command that refreshes following data, runs the two-stage engine, writes local results, and prints ranked candidates.
- Keep label management explicit and cheap so the user can correct relevance judgments without rerunning the entire flow first.
- Require confirmation inside `accounts unfollow`, with `--yes` only as a deliberate override.
- Keep operator output terse but specific: what was reviewed, why an account was flagged, what confirmation is being asked, and what remote/local outcome followed an unfollow.

**Patterns to follow:**
- `src/cli.ts`
- `tests/cli-accounts.test.ts`
- `tests/cli-likes.test.ts`

**Test scenarios:**
- Happy path: CLI help includes the new review, label, and unfollow surfaces.
- Happy path: `ft accounts review` prints ranked conservative candidates with `inactive` as the lead reason when applicable.
- Happy path: `ft accounts label @alice not-valuable` persists a label and subsequent review output reflects it.
- Happy path: `ft accounts unfollow @alice` shows a confirmation prompt and, after acceptance, reports remote success plus local reconciliation status.
- Edge case: `review` prints an empty-but-clear summary when no accounts meet the conservative threshold.
- Edge case: `review` handles accounts with uncertain evidence without recommending them.
- Error path: attempting to label or unfollow an account absent from the local review cache exits with clear guidance to run `ft accounts review` first.
- Error path: declining the unfollow confirmation leaves both remote and local state unchanged.
- Integration: real CLI execution against temp local fixtures can run review, label, and unfollow flows without reaching live X.

**Verification:**
- CLI integration tests prove the end-user workflow is coherent, conservative, and explicit about destructive actions.

## System-Wide Impact

- **New archive family:** this feature introduces a second account-oriented local dataset alongside `accounts/`, so path naming and state boundaries must stay crisp.
- **Shared X primitives:** account-resolution and timeline-fetch helpers should become reusable without turning `graphql-account-timeline.ts` into a god module.
- **Destructive action risk:** the main failure window is remote unfollow success followed by local review-state reconcile failure; the CLI must call this out explicitly and keep recovery obvious.
- **Scoring credibility:** the review engine must prefer uncertainty over bluffing, especially because inactivity is the lead recommendation reason and requires real evidence.
- **Cross-run efficiency:** cold-start review runs may be expensive; local snapshots, per-account deep-scan caches, and label reuse are what make the workflow practical after the first run.
- **CLI contract surface:** this plan adds multiple new commands under `accounts`, so output format and error guidance should remain consistent with existing command families.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| X's internal following-list or unfollow contract drifts | Isolate request metadata in focused modules and back parser behavior with sanitized fixtures |
| Stage 1 cannot support inactivity claims from following snapshots alone | Make stage 1 narrowing-only and confirm inactivity only after stage-2 evidence |
| First review run is too slow for large following lists | Persist following snapshots and deep-scan caches; deep-fetch only suspicious or uncertain accounts |
| Conservative scoring still produces false positives | Keep inactivity primary, require explicit confirmation, and allow manual `valuable` labels to suppress later recommendations |
| Remote unfollow succeeds but local state update fails | Return partial-success results and keep rerunnable local reconciliation paths |

## Documentation / Operational Notes

- Update `README.md` to document the review workflow, the manual-label loop, and the fact that unfollow still relies on the user's browser-authenticated X session.
- Update `docs/README.md` so the plan and resulting feature area are discoverable.
- No daemon or launchd/tmux operational work is required in this iteration.

## Sources & References

- Origin requirements: `docs/brainstorms/2026-04-19-account-review-unfollow-requirements.md`
- Related code: `src/graphql-account-timeline.ts`
- Related code: `src/graphql-actions.ts`
- Related code: `src/account-registry.ts`
- Related code: `src/account-timeline-db.ts`
- Related code: `src/archive-actions.ts`
- Related code: `src/cli.ts`
- Related tests: `tests/cli-accounts.test.ts`
- Related tests: `tests/graphql-account-timeline.test.ts`
- Related tests: `tests/cli-likes.test.ts`
