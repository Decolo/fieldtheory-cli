---
title: feat: Add feed daemon and preference model v2
type: feat
status: completed
date: 2026-04-15
---

# feat: Add feed daemon and preference model v2

## Overview

Replace the current single-shot `feed agent` shape with a daemon-oriented flow that separates feed fetching from feed consumption, while keeping one simple operator entry point. Each timer tick should refresh the local feed archive, immediately hand newly discovered items to a consumer stage, and let that consumer decide whether to auto-like or auto-bookmark based on explicit user preferences plus history learned from existing likes and bookmarks.

## Problem Frame

The current `feed agent` command mixes three concerns into one path:

- refresh feed data
- infer preferences
- execute remote actions

That creates two product problems and one operational problem:

- The preference system is weak because it relies on hard-coded lexical heuristics instead of a clearer user-controlled model.
- The user cannot meaningfully express "I like this author", "don't bookmark this domain", or "bookmark this kind of topic but only like that kind of topic".
- A single monolithic command is harder to reason about, debug, and evolve than a fetch/consume split.

The new plan should preserve the user's desired simplicity: one command starts the recurring workflow, each tick fetches feed items and immediately consumes them, and the consumer uses a better preference model driven by explicit preferences plus historical behavior. This plan intentionally avoids a second independent consumer timer and avoids introducing LLM judgment in the first version.

## Requirements Trace

- R1. One operator command must start the recurring workflow.
- R2. Each timer tick must refresh feed data and immediately hand new feed items to the consumer stage.
- R3. Feed fetching and feed consumption must be separated into distinct internal responsibilities so failures and logs are easier to reason about.
- R4. The consumer must use explicit user preferences plus historical likes/bookmarks to decide whether to auto-like or auto-bookmark.
- R5. Explicit user preferences must take priority over history-inferred preferences.
- R6. Preference decisions must be split by action type, so `like` and `bookmark` can behave differently.
- R7. The explicit preference model must support authors, domains, and topics.
- R8. The first version must remain local-first and must not require LLM judging.
- R9. The product must remain inspectable after the fact through status and logs.
- R10. Existing feed sync, feed archive browsing, and archive reconciliation invariants must remain intact.

## Scope Boundaries

- No separate `consume-every` scheduler. Fetch and consume run in one recurring tick.
- No requirement to expose two OS-level processes to the operator. A manager plus two internal worker responsibilities is sufficient.
- No LLM-based action decision layer in this version.
- No tweet-by-tweet manual approval queue.
- No tweet-level feedback system in this version.
- No new hosted service, remote queue, or external vector database in this version.

## Context & Research

### Relevant Code and Patterns

- `src/cli.ts` already owns the `feed` command family and is the correct place to add a daemon-oriented operator surface.
- `src/feed-agent.ts` already centralizes scoring, idempotency, logging, and remote action execution; it is the nearest starting point for extracting a consumer responsibility.
- `src/graphql-feed.ts` already owns feed refresh and local cache/index updates, and should remain the fetch-stage authority.
- `src/graphql-actions.ts` already provides the X web mutation pattern for `like` and `bookmark`.
- `src/archive-actions.ts` already provides local archive reconciliation after successful remote actions.
- `src/paths.ts`, `src/types.ts`, and the feed agent state/log files already establish the repo's pattern for durable local automation artifacts.
- `src/preferences.ts` and `src/paths.ts` already provide a lightweight local preferences storage pattern that can be extended instead of inventing a new persistence mechanism.
- `tests/feed-agent.test.ts`, `tests/cli-feed-agent.test.ts`, `tests/graphql-actions.test.ts`, and `tests/archive-actions.test.ts` are the key integration-style test precedents for this work.

### Institutional Learnings

- `tasks/todo.md` shows the current repo workflow: plan-backed work, targeted tests, docs sync, and explicit review notes.
- Recent feed-agent bug fixing showed that long-running automation paths need clear stage boundaries and bounded local write amplification; keeping fetch and consume responsibilities isolated will reduce similar regressions.

### External References

- None required for planning. The main change is product/control-surface design on top of already-established local archive and X-web-session patterns.

## Key Technical Decisions

- One timer, two responsibilities: each daemon tick fetches first, then immediately consumes newly discovered items.
  Rationale: this matches the user's desired mental model and removes the need for a second scheduler concept.
- One manager command is enough for v1.
  Rationale: the operator wants one simple entry point; internal separation matters more than exposing multiple daemons.
- Fetch and consume should be distinct services even if they run in one process initially.
  Rationale: this keeps the execution model simple now while preserving a future path to true multi-process separation if needed.
- Explicit preferences win over inferred preferences.
  Rationale: the user wants control, and the system must not silently learn its way past an explicit instruction.
- `like` and `bookmark` should have separate preference evaluation paths.
  Rationale: these actions express different intent and should not collapse into one generic "engagement" score.
- The first semantic layer should use embeddings or other local similarity primitives, not LLM judging.
  Rationale: this adds meaning-aware matching without introducing model instability, latency, or a hosted dependency.
- Topics in explicit preferences should be stored as user-authored text descriptions rather than as low-level token rules.
  Rationale: that keeps the operator surface understandable while still allowing semantic matching behind the scenes.

## Open Questions

### Resolved During Planning

- Should fetch and consume have separate timers?
  Resolution: no. One recurring tick fetches and then immediately consumes.
- Does the operator need to manage two separate daemon commands?
  Resolution: no. Start with one manager command that runs the two responsibilities in order.
- Should explicit preferences or learned history win on conflict?
  Resolution: explicit preferences win.
- Should the first semantic version use LLM judging?
  Resolution: no. Use local similarity/inference without LLM judging.

### Deferred to Implementation

- Exact embedding provider and storage format.
  Why deferred: the repo needs a concrete local implementation choice, but the planning decision is only that semantic matching must be local-first and non-LLM.
- Exact queue handoff representation between fetch and consume.
  Why deferred: this may be a file-backed pending set, a state-file watermark, or an in-memory handoff plus persisted pending records, and the cleanest form depends on code-level integration.
- Exact CLI naming for preference editing commands.
  Why deferred: the plan fixes the capability shape, but final command ergonomics should be chosen while editing `src/cli.ts`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft feed daemon start --every 30m
  |
  v
+-----------------------------+
| daemon manager              |
| recurring timer loop        |
+-------------+---------------+
              |
              v
   every tick: fetch -> consume -> persist summary
              |
              v
+-----------------------------+        handoff        +-----------------------------+
| feed fetch stage            | ------------------>  | feed consume stage          |
|                             |                      |                             |
| - refresh local feed        |                      | - load explicit prefs       |
| - detect newly seen items   |                      | - load historical likes     |
| - write feed cache/index    |                      | - load historical bookmarks |
| - emit "new items" set      |                      | - score like decision       |
|                             |                      | - score bookmark decision   |
+-----------------------------+                      | - execute remote actions    |
                                                     | - reconcile local archives  |
                                                     | - append logs/state         |
                                                     +-----------------------------+
```

## Implementation Units

- [x] **Unit 1: Split the current feed agent into fetch-stage and consume-stage services**

**Goal:** Refactor the current monolithic agent flow so feed refresh and feed consumption are distinct internal services with a clear handoff contract.

**Requirements:** R2, R3, R9, R10

**Dependencies:** None

**Files:**
- Create: `src/feed-fetcher.ts`
- Create: `src/feed-consumer.ts`
- Modify: `src/feed-agent.ts`
- Modify: `src/types.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Extract the current feed refresh responsibility out of `src/feed-agent.ts` into a fetch-stage service that returns a concrete "newly discovered items" result.
- Extract the decision/action path into a consumer service that accepts a bounded set of feed items and performs scoring, remote actions, archive reconciliation, and durable state/log updates.
- Keep `src/feed-agent.ts` as the orchestration layer or compatibility wrapper so the existing surface can be migrated without forcing all downstream code to know about the split immediately.
- Define one explicit handoff shape between stages, including the list of new item ids or records plus enough metadata for logging and future retries.

**Execution note:** Start with a failing service-level test that proves one fetch result can be handed to one consume result without re-reading unrelated feed items.

**Patterns to follow:**
- `src/graphql-feed.ts`
- `src/feed-agent.ts`
- `tests/feed-agent.test.ts`

**Test scenarios:**
- Happy path: fetch returns a non-empty "new items" result and consumer processes only those items.
- Edge case: fetch returns zero new items and consumer becomes a no-op without error.
- Error path: fetch-stage failure does not produce a partial consumer run.
- Integration: consumer still persists logs and state in the same durable files after the split.

**Verification:**
- The fetch and consume stages can be invoked separately in tests, and the orchestrated path still produces the same durable outputs as before.

- [x] **Unit 2: Add a daemon manager command with one recurring timer**

**Goal:** Provide one operator command that runs a recurring loop where each tick fetches feed data and then immediately consumes newly discovered items.

**Requirements:** R1, R2, R3, R9

**Dependencies:** Unit 1

**Files:**
- Modify: `src/cli.ts`
- Create: `src/feed-daemon.ts`
- Modify: `src/paths.ts`
- Modify: `src/types.ts`
- Test: `tests/cli-feed-agent.test.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Add a daemon-manager service responsible for the recurring timer loop and graceful shutdown handling.
- Expose a new CLI surface under `feed`, with `start`, `stop`, `status`, and `logs` semantics for the daemon manager.
- Keep the operator-facing scheduling model simple: one `--every <interval>` flag controls the recurring tick.
- Persist enough daemon metadata to report whether the loop is running, when it last ticked, and where logs live.
- Preserve the existing one-shot path where useful, but make the daemon path the primary scheduled model.

**Patterns to follow:**
- `src/cli.ts`
- `src/feed-agent.ts`
- existing status/log formatting helpers in `src/feed-agent.ts`

**Test scenarios:**
- Happy path: starting the daemon with `--every 30m` produces a manager loop configuration that schedules one recurring fetch-then-consume tick.
- Happy path: daemon status reports running metadata and last tick information.
- Edge case: a tick with zero new feed items still completes cleanly and schedules the next tick.
- Error path: a consumer-stage failure is logged and does not prevent future ticks.
- Integration: interrupting the daemon stops future ticks cleanly without corrupting state/log files.

**Verification:**
- CLI and service tests prove that one recurring timer drives the fetch/consume cycle and that shutdown/status behavior remains inspectable.

- [x] **Unit 3: Introduce a real preference model with explicit preferences plus learned history**

**Goal:** Replace the current hard-coded lexical heuristic with a preference pipeline that combines user-declared preferences and learned historical signals, while keeping explicit preferences authoritative.

**Requirements:** R4, R5, R6, R7, R8

**Dependencies:** Unit 1

**Files:**
- Create: `src/feed-preferences.ts`
- Create: `src/feed-preference-inference.ts`
- Modify: `src/preferences.ts`
- Modify: `src/types.ts`
- Modify: `src/feed-consumer.ts`
- Test: `tests/feed-agent.test.ts`
- Test: `tests/cli-feed-agent.test.ts`

**Approach:**
- Add a dedicated feed-preference model that stores explicit operator preferences separately from generic app preferences.
- The explicit model must support three object kinds:
  - authors
  - domains
  - topics
- The explicit model must support action-specific intent:
  - prefer for like
  - avoid for like
  - prefer for bookmark
  - avoid for bookmark
- Add a learned-history layer that builds separate inferred profiles from existing likes and bookmarks.
- In consumer scoring, evaluate explicit preferences first, then blend in learned history for anything not explicitly directed.
- Ensure "avoid" semantics are strong enough that the system does not auto-act against an explicit operator preference.

**Patterns to follow:**
- `src/preferences.ts`
- `src/feed-agent.ts`
- archive-reading patterns in `src/bookmarks-db.ts` and `src/likes-db.ts`

**Test scenarios:**
- Happy path: a preferred author boosts auto-like decisions even when historical evidence is weak.
- Happy path: a preferred bookmark topic boosts bookmark decisions independently from like decisions.
- Edge case: an avoided domain suppresses auto-bookmark even when historical signals would otherwise qualify it.
- Edge case: history-inferred bookmark affinity does not automatically imply like affinity.
- Integration: explicit preferences override conflicting learned-history signals.

**Verification:**
- Consumer scoring tests show action-specific behavior, explicit-preference overrides, and separate like/bookmark preference paths.

- [x] **Unit 4: Add semantic topic matching without introducing LLM judging**

**Goal:** Upgrade topic handling from lexical overlap to meaning-aware matching so the consumer can recognize similar content even when the wording differs.

**Requirements:** R4, R6, R7, R8

**Dependencies:** Unit 3

**Files:**
- Create: `src/feed-topic-similarity.ts`
- Modify: `src/feed-preference-inference.ts`
- Modify: `src/feed-consumer.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Add a local semantic matching layer that can compare:
  - new feed items to historically liked items
  - new feed items to historically bookmarked items
  - new feed items to explicit preferred/avoided topics
- Keep this layer deterministic and local-first; do not introduce LLM request/response judging into the action path.
- Preserve explainability by keeping semantic matches visible as one scoring ingredient, not as an opaque final answer.
- Make sure the scoring output remains split by action type so `like` and `bookmark` can respond to different semantic signals.

**Patterns to follow:**
- reranking service patterns in `src/hybrid-search.ts`
- existing feed-agent scoring/result formatting in `src/feed-agent.ts`

**Test scenarios:**
- Happy path: a semantically similar item is treated as relevant even when token overlap is weak.
- Happy path: a bookmark-oriented topic match raises bookmark likelihood without necessarily raising like likelihood equally.
- Edge case: an avoided topic suppresses action even when author/domain matches are strong.
- Error path: if semantic matching resources are unavailable, consumer behavior fails closed for auto-actions and logs the semantic error instead of crashing the daemon.

**Verification:**
- Service tests demonstrate that meaning-similar content can trigger the same preference path even when wording differs materially.

- [x] **Unit 5: Add a user-facing feed preference command surface**

**Goal:** Let the operator express explicit preferences in simple commands instead of editing raw files or relying entirely on learned behavior.

**Requirements:** R4, R5, R6, R7, R9

**Dependencies:** Unit 3

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/feed-preferences.ts`
- Test: `tests/cli-feed-agent.test.ts`
- Modify: `README.md`
- Modify: `docs/README.md`

**Approach:**
- Add a `feed prefs` command family that exposes simple, human-readable preference management flows.
- Keep the first version focused on explicit long-lived preferences rather than tweet-level feedback.
- Support the three content targets:
  - author
  - domain
  - topic
- Support separate intent for `like` and `bookmark`.
- Add `show` or equivalent inspection output so the operator can audit the currently active preference set.

**Patterns to follow:**
- `src/cli.ts`
- preference read/write style in `src/preferences.ts`

**Test scenarios:**
- Happy path: adding a preferred author for like persists and appears in `feed prefs show`.
- Happy path: adding an avoided domain for bookmark persists and affects consumer scoring.
- Edge case: duplicate preference entries do not create duplicate stored rules.
- Edge case: removing or replacing a preference updates the stored model cleanly.
- Integration: consumer behavior changes after the preference command modifies stored preferences.

**Verification:**
- CLI tests prove preferences can be added, listed, and applied to consumer decisions through the public command surface.

## System-Wide Impact

- **Interaction graph:** the daemon manager becomes the new top-level recurring entry point; fetch-stage code still depends on `src/graphql-feed.ts`, and consume-stage code still depends on remote X mutations plus archive reconciliation.
- **Error propagation:** fetch failures should abort the current tick before consumption; consume failures should be logged per item and per tick without poisoning the daemon manager state.
- **State lifecycle risks:** pending/new-item handoff must not lose items or reprocess them indefinitely; daemon status must not imply success when only fetch completed; explicit preference writes must remain atomic.
- **API surface parity:** existing one-shot agent/status/log commands may need to remain as compatibility aliases or clearly transition to daemon-oriented commands to avoid operator confusion.
- **Integration coverage:** fetch/consume orchestration, explicit-preference override behavior, and daemon shutdown/resume semantics all require integration-style tests beyond isolated unit tests.
- **Unchanged invariants:** feed archive storage remains local-first; successful remote actions still reconcile local likes/bookmarks archives; existing feed browse/search commands remain supported.

## Risks & Dependencies

- Semantic matching introduces new local data and scoring dependencies; the implementation must avoid turning daemon ticks into long blocking jobs.
- The handoff between fetch and consume is a new failure seam; durable pending-item state or equivalent replay protection is required.
- CLI naming churn is a usability risk; the new daemon and preference commands should be simpler than the current agent surface, not more jargon-heavy.
- Backward compatibility matters because `feed agent run` already exists; the migration strategy should be explicit in docs and command help.

## Documentation Plan

- Update `README.md` with the new daemon start/stop/status flow and the new `feed prefs` command family.
- Update `docs/README.md` to index this plan.
- Update any stale feed-agent docs so the product description reflects "fetch then consume" instead of a monolithic one-shot scorer.
