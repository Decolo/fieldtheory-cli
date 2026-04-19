---
title: feat: Add conversation-context collection for feed items
type: feat
status: active
date: 2026-04-20
origin: docs/brainstorms/2026-04-19-x-feed-collection-reset-requirements.md
---

# feat: Add conversation-context collection for feed items

## Overview

Extend feed collection with a second local dataset that captures replies/comments for selected feed items. The goal is not to automate engagement, but to preserve conversation evidence around tweets, reposts, and quoted tweets so later skills can evaluate audience reaction and likely content quality from local data.

## Problem Frame

The origin document deliberately split feed evolution into two plans: first remove autonomous action semantics, then add conversation/comment context (see origin: `docs/brainstorms/2026-04-19-x-feed-collection-reset-requirements.md`). The repo already stores conversation identifiers and reply-related metadata on individual feed, bookmark, like, and account-timeline records, but it does not yet persist the surrounding replies themselves. That leaves a gap between "tweet-shaped local archive" and "interaction-aware substrate for agent interpretation."

This is deep work because it adds a new X-contract integration surface, a new local dataset, and a new CLI collection flow. The plan therefore keeps three things narrow: context is stored as a sidecar dataset rather than inflating `FeedRecord` directly, collection starts as an explicit feed subcommand rather than a hidden daemon expansion, and the first version optimizes for useful conversation evidence, not perfect spam/AI filtering.

## Requirements Trace

- R8. Keep the existing local feed archive useful while extending it.
- R9. Extend feed collection so locally stored feed items can include valuable conversation context from replies/comments.
- R10. Apply conversation context collection to original tweets as well as reposted / quoted content when surrounding discussion adds meaning.
- R11. Treat collected comments as evidence of interaction and audience reaction, not as engagement targets.
- R12. Preserve room for later low-value / AI-like comment filtering without requiring perfect quality judgment in v1.
- R14. Expose stable local-data capabilities that future skills can compose.
- R15. Keep the later agent-evaluation skill out of scope for this plan.

## Scope Boundaries

- No skill implementation in this plan.
- No automatic liking, bookmarking, replying, or moderation actions based on collected comments.
- No requirement that `ft feed sync` always fetch conversation context inline with the base timeline fetch.
- No requirement to merge replies/comments into the canonical `feed.jsonl` item shape or `feed.db` table in v1.
- No requirement to solve comment-ranking quality exhaustively; only enough metadata should be stored so later filters can improve on top.

## Context & Research

### Relevant Code and Patterns

- `src/graphql-feed.ts` already normalizes `conversationId`, `inReplyTo*`, `quotedStatusId`, `quotedTweet`, and engagement counts into `FeedRecord`. This is the natural seed data for deciding which conversations to expand.
- `src/archive-core.ts` and `src/types.ts` show that the repo already treats tweet-like records as canonical archive items with source-specific attachments. A conversation sidecar should complement that model, not distort it.
- `src/account-export.ts` and `src/graphql-account-timeline.ts` demonstrate that richer reply/quote context already matters to downstream research workflows in this repo.
- `src/paths.ts` and the following-review modules added on 2026-04-19 are the closest precedent for introducing a new sidecar local dataset instead of overloading an existing cache.
- `tests/graphql-feed.test.ts`, `tests/graphql-account-timeline.test.ts`, and `tests/graphql-bookmarks.test.ts` already validate quote/reply field parsing patterns that the new conversation parser should follow.

### Institutional Learnings

- No `docs/solutions/` directory exists in this repo, so there are no stored implementation learnings to inherit.
- The account-research export plan (`docs/plans/2026-04-19-013-feat-account-research-export-plan.md`) reinforces the current product rule: preserve richer local tweet context for later agent consumption rather than forcing LLM logic into the CLI.

### External References

- Official X API documentation confirms that `conversation_id` is a first-class tweet field and that search operators can target one conversation thread. This is enough to validate the product concept that replies can be collected by conversation grouping.
- The repo's actual implementation path should still stay browser-session-first, consistent with existing `src/x-graphql.ts` and `src/graphql-feed.ts` patterns. Exact web-contract request ids and response shapes for reply collection remain fixture-backed implementation work.

## Key Technical Decisions

- Store conversation context in a sidecar dataset keyed by root feed tweet id, not inline on `FeedRecord`. Rationale: this keeps `feed.jsonl`, `feed.db`, and canonical archive projections stable while allowing richer reply payloads to evolve independently.
- Start with an explicit `ft feed context sync` collection surface. Rationale: comment retrieval is more expensive and contract-sensitive than base feed sync, so making it explicit keeps runtime cost and operator expectations bounded.
- Reuse browser-session X integration as the primary fetch path. Rationale: the repo already treats browser-session GraphQL as the default read/write model; adding an OAuth-only public API path would create a second auth worldview for one feature.
- Preserve raw-enough reply snapshots plus lightweight fetch metadata. Rationale: later skill-layer filtering will need author identity, timestamps, engagement, and reply-tree linkage, but the plan should avoid premature summarization or scoring inside the CLI.
- Collect context only for bounded candidate sets. Rationale: the first implementation should prefer recent feed items and explicit limits to avoid rate-limit and storage explosion.

## Open Questions

### Resolved During Planning

- Should conversation context be merged directly into the base feed record? No; use a sidecar dataset keyed by feed tweet id.
- Should first-pass collection be implicit inside every `feed sync`? No; use an explicit subcommand so cost and contract risk stay bounded.
- Should implementation use browser-session X access or introduce a new OAuth public-API requirement? Keep browser-session X access as the primary path.

### Deferred to Implementation

- The exact X web contract used to retrieve replies/comments for one conversation remains implementation-time fixture research.
- The precise recency/window heuristics for selecting which feed items deserve context sync can be finalized against real local archive behavior during implementation.
- Whether `feed daemon` should gain an optional later hook into context sync is intentionally deferred until the explicit command proves stable.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
ft feed context sync
  -> read local feed archive
  -> choose bounded candidate tweets
  -> resolve root conversation target
     - original tweet: use its conversationId / tweetId
     - repost / quote: prefer the quoted/root tweet when discussion is more meaningful there
  -> fetch replies/comments through browser-session X contract
  -> normalize reply snapshots + fetch metadata
  -> persist sidecar conversation dataset keyed by feed tweet id
  -> print collection summary

ft feed show <id>
  -> read feed item
  -> read sidecar context if present
  -> render local tweet plus conversation summary / sample replies
```

## Flow and Edge-Case Analysis

### Primary flows

1. Explicit context sync over recent feed items: operator runs `ft feed context sync`, the command fetches bounded conversations, stores results locally, and prints a concise summary.
2. Feed inspection with context: operator runs `ft feed show <id>` and sees whether conversation context exists, how fresh it is, and a small sample of replies.
3. Skill-facing reuse: later skills consume the sidecar dataset directly or through a future export surface without needing to scrape replies live.

### Important edge cases

- Feed items without usable `conversationId` or root tweet identity should be skipped explicitly, not retried forever.
- Replies may be unavailable because a tweet was deleted, protected, or the conversation contract returns partial results; this should be stored as a known fetch outcome rather than silently ignored.
- Reposts and quoted tweets need a deterministic rule for which conversation is "the" meaningful context target.
- Large or noisy conversations need bounded collection so one viral tweet does not dominate runtime and storage.
- Subsequent syncs should avoid duplicating unchanged replies while still refreshing freshness metadata for already-collected conversations.

## Implementation Units

- [ ] **Unit 1: Add conversation-context data model and local sidecar storage**

**Goal:** Introduce a durable local dataset for reply/comment context keyed to feed items without mutating the base feed archive contract.

**Requirements:** R9, R10, R11, R12, R14

**Dependencies:** Plan A should land first so the feed product surface is already collection-only.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`
- Create: `src/feed-context-store.ts`
- Test: `tests/feed-context-store.test.ts`

**Approach:**
- Add explicit types for:
  - one reply/comment snapshot,
  - one collected conversation context bundle,
  - one fetch-state record for a root feed item.
- Add sidecar paths under the existing data root for JSONL/JSON storage and, if helpful, a small SQLite read model for fast lookups by root tweet id.
- Keep the dataset keyed by the root local feed item's `tweetId`, with stored metadata for the actual conversation target when it differs from the root feed item.

**Patterns to follow:**
- `src/paths.ts`
- `src/following-review-state.ts`
- `src/account-export.ts`

**Test scenarios:**
- Happy path: a conversation-context bundle can be written and reloaded for one root feed tweet id.
- Edge case: the stored bundle preserves both the root feed tweet id and a different conversation target id when context is collected from quoted/reposted content.
- Edge case: missing optional reply fields do not prevent persistence or reload.
- Error path: malformed sidecar JSON fails explicitly instead of silently becoming empty context.

**Verification:**
- Local conversation context can be stored, reloaded, and queried without touching `feed.jsonl` or `feed.db`.

- [ ] **Unit 2: Add X conversation fetch + normalization primitives**

**Goal:** Fetch replies/comments for one conversation target through the existing browser-session X integration and normalize them into stable local snapshots.

**Requirements:** R9, R10, R11, R12

**Dependencies:** Unit 1

**Files:**
- Create: `src/graphql-conversation.ts`
- Modify: `src/x-graphql.ts`
- Test: `tests/graphql-conversation.test.ts`

**Approach:**
- Build one focused fetch module for:
  - selecting a conversation target from a feed/root tweet,
  - requesting replies/comments for that target,
  - normalizing reply tweet snapshots with author, timing, engagement, and parent/root linkage,
  - returning explicit fetch outcomes for unsupported, unavailable, or partially fetched conversations.
- Keep the parser close to the normalization style already used in `src/graphql-feed.ts` and `src/graphql-account-timeline.ts`.
- Fixture the web-contract behavior heavily so implementation does not depend on live X during tests.

**Patterns to follow:**
- `src/graphql-feed.ts`
- `src/graphql-account-timeline.ts`
- `src/x-graphql.ts`

**Test scenarios:**
- Happy path: one conversation fetch returns normalized reply snapshots with author, text, timestamps, and parent/root linkage.
- Happy path: quoted/reposted source selection maps to the intended conversation target id.
- Edge case: contract responses with missing optional engagement or media fields still normalize successfully.
- Edge case: unavailable/protected/deleted conversations are captured as explicit fetch outcomes instead of being treated as empty success.
- Error path: auth and contract-shape failures produce actionable errors consistent with other X GraphQL modules.

**Verification:**
- A fixture-backed conversation fetch can retrieve and normalize replies/comments without inventing a second auth model for the repo.

- [ ] **Unit 3: Add explicit `ft feed context sync` orchestration**

**Goal:** Expose a bounded, deterministic CLI workflow for collecting conversation context from existing local feed items.

**Requirements:** R8, R9, R10, R11, R12, R14

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `src/feed-context.ts`
- Modify: `src/cli.ts`
- Test: `tests/feed-context.test.ts`
- Modify: `tests/cli-feed.test.ts`

**Approach:**
- Add a `feed context` command group with a narrow first-pass contract:
  - `ft feed context sync`
  - bounded selectors such as recent-item limit and maybe `--tweet-id` for one explicit target
- Orchestrate candidate selection from existing local feed data, then call the conversation fetch module and persist sidecar results.
- Keep the command local-first in the sense that it only expands context for already-collected feed items; it should not be a substitute for `ft feed sync`.

**Patterns to follow:**
- Existing `feed` command grouping in `src/cli.ts`
- Deterministic export/orchestration style in `src/account-export.ts`

**Test scenarios:**
- Happy path: `ft feed context sync` collects and stores context for bounded recent feed items.
- Happy path: `--tweet-id <id>` limits collection to one known local feed item.
- Edge case: feed items lacking usable conversation targets are skipped with a clear summary count.
- Edge case: rerunning sync refreshes metadata without duplicating identical stored replies.
- Error path: invoking context sync before any local feed data exists fails with the same style of guidance used by other feed commands.

**Verification:**
- Operators can expand local feed items into conversation-aware local data with one explicit CLI command and no hidden live-agent behavior.

- [ ] **Unit 4: Surface collected context in local inspection flows**

**Goal:** Make conversation context inspectable from the CLI so the feature is useful before any later skill consumes it.

**Requirements:** R8, R9, R11, R14, R15

**Dependencies:** Unit 1, Unit 3

**Files:**
- Modify: `src/feed-service.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-feed.test.ts`

**Approach:**
- Extend `ft feed show <id>` to report whether context exists and render a concise conversation summary when present.
- Optionally add a context-aware status summary if the sidecar dataset has enough aggregate metadata to make that useful, but keep the first surface small.
- Avoid overcommitting to a final skill/export contract here; the goal is inspectability, not yet another export feature.

**Patterns to follow:**
- `ft accounts show` and existing `ft feed show` presentation style in `src/cli.ts`
- `src/feed-service.ts` status-formatting approach

**Test scenarios:**
- Happy path: `ft feed show <id>` renders a compact conversation summary when sidecar context exists.
- Edge case: `ft feed show <id>` still works normally when no conversation context has been synced.
- Error path: corrupted context sidecar data fails explicitly instead of showing misleading empty context.

**Verification:**
- A user can inspect one feed item locally and tell whether meaningful conversation context has been collected.

## System-Wide Impact

- **Data model:** introduces a new feed-adjacent local dataset without changing the canonical base tweet archive.
- **CLI contract:** grows by one explicit collection surface instead of making base feed sync heavier or less predictable.
- **Future skill work:** materially easier, because local conversation evidence becomes available without asking the skill to hit X live.
- **Runtime risk:** isolated to one explicit context-fetch path with bounded candidate selection and fixture-backed contract tests.

