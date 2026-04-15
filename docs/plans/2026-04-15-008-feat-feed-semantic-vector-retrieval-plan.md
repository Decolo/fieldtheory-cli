---
title: feat: Replace feed lexical scoring with semantic retrieval via embeddings and vector DB
type: feat
status: completed
date: 2026-04-15
origin:
  - docs/brainstorms/2026-04-12-x-feed-requirements.md
  - docs/brainstorms/2026-04-14-feed-hybrid-search-requirements.md
supersedes:
  - docs/plans/2026-04-15-007-feat-feed-daemon-preference-v2-plan.md
---

# feat: Replace feed lexical scoring with semantic retrieval via embeddings and vector DB

## Overview

Replace the current feed consumer's token-overlap scoring with real semantic retrieval built on embeddings plus a local vector database. The existing `feed daemon`, `feed agent`, and `feed prefs` surfaces stay in place. What changes is the scoring core: topic preferences and historical like/bookmark taste should be represented as vectors, and feed decisions should be driven by nearest-neighbor similarity instead of lexical overlap pretending to be semantics.

## Problem Frame

The current feed daemon pipeline now exists and runs end to end, but the scoring core is still the wrong product. `src/feed-consumer.ts` uses:

- author/domain exact matches
- tokenized text overlap
- token-frequency history weights
- small heuristic boosts

That is not semantic retrieval. It fails on paraphrases, near-synonyms, and broader topic similarity, which is exactly the capability the user has been asking for across both feed automation and hybrid search. The next step is therefore not another heuristic tweak. It is a representation change:

- text becomes embeddings
- preference matching becomes nearest-neighbor search
- action scoring becomes vector-driven with metadata constraints layered on top

## Requirements Trace

- R1. Feed automation must use embeddings and vector retrieval for semantic matching, not lexical overlap stand-ins. (user clarification; see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R2. The existing one-command recurring workflow must remain intact: fetch, then consume, per tick. (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R3. Explicit preferences must still override learned history. (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R4. Like and bookmark decisions must remain separate. (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R5. Topics must be matched semantically, including when wording differs materially. (see origin: `docs/brainstorms/2026-04-14-feed-hybrid-search-requirements.md`)
- R6. The system must stay local-first at query time: vector search runs against local persisted data. Remote API usage is allowed for embedding generation. (inference from both origin docs)
- R7. The system must remain inspectable: status/log output should explain vector-driven reasons well enough to debug behavior. (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R8. Existing feed sync, archive reconciliation, and daemon controls must keep working. (see origin: `docs/brainstorms/2026-04-12-x-feed-requirements.md`)
- R9. The design should set up later reuse by `search-all` so the repo stops maintaining one fake-semantic path for search and another for feed actions. (see origin: `docs/brainstorms/2026-04-14-feed-hybrid-search-requirements.md`)

## Scope Boundaries

- No LLM judge in the action path. Embeddings are in; generative evaluation is still out.
- No hosted vector database. Use an embedded local vector database stored under the repo's existing data directory.
- No second scheduler or queue. The existing fetch-then-consume daemon flow stays intact.
- No manual approval inbox or human-in-the-loop review step.
- No attempt in this pass to redesign `search-all` output UX. The plan only ensures the new semantic substrate can be reused later.
- No fallback to lexical action scoring when vector infra is unavailable. Safe failure is better than fake semantics.

## Context & Research

### Relevant Code and Patterns

- `src/feed-consumer.ts` is the current scoring bottleneck and the main semantic-replacement target.
- `src/feed-daemon.ts` and `src/feed-fetcher.ts` already provide the right orchestration shape: fetch first, then consume newly seen items.
- `src/feed-preferences.ts` already models explicit preference buckets cleanly enough to attach embedding-backed topic semantics.
- `src/hybrid-search.ts` already expresses the repo's broader need for semantic retrieval, but today still uses local FTS probes and lexical reranking.
- `src/feed-db.ts`, `src/bookmarks-db.ts`, and `src/likes-db.ts` show the repo's current SQLite artifact pattern for browse/search indices.
- `src/archive-actions.ts` and `src/graphql-actions.ts` already define the local archive mutation and remote X mutation boundaries; those should not move.
- `src/paths.ts` and `src/types.ts` are the correct extension points for new vector artifacts and embedding metadata.

### External Guidance

- OpenAI-compatible embeddings APIs expose dense numerical vectors for relatedness search; this lets the repo integrate a provider without coupling semantic retrieval to one vendor-specific SDK.
- LanceDB documents its OSS mode as an embedded database that runs in-process against a local filesystem path, which fits this repo's local artifact model better than introducing a separate service. Source: LanceDB quickstart.

### Why This Plan Chooses LanceDB Instead of sqlite-vec

- The repo currently uses `sql.js`, not a native SQLite driver, for its searchable archive databases.
- `sqlite-vec` is a SQLite extension, which would force a more invasive database/runtime shift before semantic work can even start.
- LanceDB can live alongside the existing `sql.js` artifacts as a separate embedded vector store, letting this plan replace the scoring core without first rewriting every SQLite integration in the repo.

## Key Technical Decisions

- Use an embedded local vector database, not a hosted service.
  Rationale: preserves the product's local-first operator model while still giving real nearest-neighbor retrieval.

- Use a provider abstraction for embeddings, but ship the first adapter against OpenAI-compatible embeddings with Aliyun Bailian `text-embedding-v4` as the default model.
  Rationale: the repo currently has no local embedding runtime; shipping a real semantic version is more important than prematurely optimizing for local-model optionality. The abstraction preserves a later path to local embeddings while matching the chosen provider.

- Keep existing FTS databases for browse/list/search primitives; add a parallel vector store for semantic retrieval.
  Rationale: avoids destabilizing the current archive/index code and keeps semantic rollout scoped to the ranking layer.

- Make semantic failure fail closed for actions.
  Rationale: if embeddings or vector search are unavailable, the daemon should log a semantic-infra failure and skip auto-actions for that tick instead of silently falling back to lexical scoring.

- Preserve author/domain rules as metadata constraints, but move topic relevance and historical taste matching to vectors.
  Rationale: exact author/domain intent is still best modeled as metadata; topic similarity is what embeddings are for.

- Reuse one shared semantic indexing substrate across feed, likes, bookmarks, and explicit topic preferences.
  Rationale: avoids separate embedding logic for each archive family and sets up later unification with `search-all`.

## High-Level Technical Design

> This is directional design guidance, not implementation code.

```text
feed daemon tick
  |
  v
fetch new feed items
  |
  v
semantic index sync
  |- embed new feed items
  |- ensure likes/bookmarks vectors exist
  |- ensure explicit topic prefs vectors exist
  |
  v
consume new feed items
  |- hard-block explicit avoid author/domain/topic
  |- vector search against like-profile space
  |- vector search against bookmark-profile space
  |- combine with exact author/domain boosts
  |- threshold into like / bookmark decisions
  |
  v
execute remote actions
  |
  v
reconcile local archives + append state/logs
```

## Data Model

### New semantic artifacts

- `semantic.lance/`
  - local LanceDB root directory
- `semantic-meta.json`
  - schema version
  - embedding provider + model
  - vector dimensions
  - last full backfill time
  - per-corpus coverage counters

### Core table families

- `documents`
  - one row per embedded item from `feed`, `likes`, and `bookmarks`
  - metadata: `source`, `tweetId`, `url`, `authorHandle`, `postedAt`, `textHash`, `embeddingVersion`
- `preferences`
  - explicit topic preference vectors
  - metadata: `action`, `disposition`, `rawText`, `normalizedText`
- `profiles`
  - optional materialized centroid/profile rows per action type for future optimization
  - not required in v1 if nearest-neighbor-on-history is fast enough

## Implementation Units

- [x] **Unit 1: Introduce an embedding provider and local semantic store**

**Goal:** Add the new semantic infrastructure without disturbing the existing FTS and archive databases.

**Requirements:** R1, R6, R8, R9

**Dependencies:** None

**Files:**
- Create: `src/embeddings.ts`
- Create: `src/semantic-store.ts`
- Modify: `src/paths.ts`
- Modify: `src/types.ts`
- Modify: `package.json`
- Test: `tests/semantic-store.test.ts`

**Approach:**
- Add a small embedding client abstraction with one shipped adapter for OpenAI-compatible embeddings.
- Default to `text-embedding-3-small`, but keep model and base URL configurable through environment variables.
- Add a LanceDB-backed semantic store under the data directory for document vectors and preference vectors.
- Store enough metadata to detect stale embeddings after model/provider changes.

**Execution note:** Test-first for store initialization, vector upsert, nearest-neighbor search, and stale-version detection.

**Patterns to follow:**
- `src/paths.ts`
- `src/types.ts`
- `src/feed-db.ts`

**Test scenarios:**
- Happy path: a vectorized document is inserted and later retrieved by nearest-neighbor search.
- Edge case: reopening an existing local semantic store preserves prior vectors.
- Edge case: a changed embedding model/version marks old vectors stale instead of silently mixing incompatible dimensions.
- Error path: provider failure surfaces a typed semantic-infra error.

**Verification:**
- Store tests prove create/open/upsert/query behavior and version mismatch handling.

- [x] **Unit 2: Build semantic indexing for archives and explicit topic preferences**

**Goal:** Keep feed, likes, bookmarks, and explicit topic rules embedded and queryable locally.

**Requirements:** R1, R3, R5, R6, R8, R9

**Dependencies:** Unit 1

**Files:**
- Create: `src/semantic-indexer.ts`
- Modify: `src/feed-preferences.ts`
- Modify: `src/preferences.ts`
- Modify: `src/archive-actions.ts`
- Modify: `src/graphql-feed.ts`
- Test: `tests/semantic-indexer.test.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Define a canonical text projection for embedding:
  - main tweet text
  - quoted text when present
  - author handle/name as low-weight textual context
  - resolved link domains as supplemental text tokens
- Upsert vectors whenever:
  - new feed items are fetched
  - likes/bookmarks archives gain new rows
  - explicit topic preferences are created or removed
- Keep id-based upsert behavior aligned with the repo's current archive reconciliation style.
- Add one backfill entry point so existing archives can be embedded once.

**Patterns to follow:**
- `src/archive-actions.ts`
- `src/graphql-feed.ts`
- `src/feed-preferences.ts`

**Test scenarios:**
- Happy path: fetching feed items inserts corresponding vectors before consumption.
- Happy path: adding a topic preference produces a preference vector.
- Edge case: re-embedding an unchanged record is skipped via content hash/version checks.
- Edge case: deleting a preference removes its vector row.
- Integration: successful auto-like or auto-bookmark reconciliation also keeps semantic coverage consistent.

**Verification:**
- Indexer tests prove archive and preference updates keep the semantic store in sync.

- [x] **Unit 3: Replace feed consumer topic scoring with vector retrieval**

**Goal:** Make like/bookmark decisions semantically driven instead of token driven.

**Requirements:** R1, R3, R4, R5, R7, R8

**Dependencies:** Unit 2

**Files:**
- Modify: `src/feed-consumer.ts`
- Create: `src/feed-semantic-scorer.ts`
- Modify: `src/feed-agent.ts`
- Test: `tests/feed-agent.test.ts`

**Approach:**
- Replace token overlap scoring with:
  - explicit topic preference similarity against preference vectors
  - nearest-neighbor similarity against historical like vectors for the like path
  - nearest-neighbor similarity against historical bookmark vectors for the bookmark path
- Preserve exact author/domain rules:
  - explicit avoid author/domain remains a hard block
  - explicit prefer author/domain remains a strong boost
- Emit explainable reasons such as:
  - `pref-topic-sim:0.82`
  - `history-like-nn:@foo:0.79`
  - `history-bookmark-domain:example.com`
- Remove lexical fallback from the action path entirely.

**Patterns to follow:**
- `src/feed-consumer.ts`
- `src/feed-agent.ts`
- `src/hybrid-search.ts`

**Test scenarios:**
- Happy path: paraphrased but semantically similar text crosses the threshold even with weak token overlap.
- Happy path: bookmark history raises bookmark score without automatically raising like score to the same level.
- Edge case: explicit avoid topic blocks an otherwise high semantic match.
- Edge case: exact preferred author still wins even when semantic similarity is mediocre.
- Error path: missing semantic coverage causes the run to skip actioning with a clear logged semantic error, not lexical fallback.

**Verification:**
- Feed-agent tests prove semantic similarity, action separation, and explicit override behavior through the public consumer path.

- [x] **Unit 4: Wire daemon-time semantic upkeep and operator visibility**

**Goal:** Ensure the daemon can maintain and inspect semantic infrastructure without extra mental overhead.

**Requirements:** R2, R6, R7, R8

**Dependencies:** Unit 3

**Files:**
- Modify: `src/feed-daemon.ts`
- Modify: `src/cli.ts`
- Modify: `src/feed-fetcher.ts`
- Modify: `src/types.ts`
- Test: `tests/cli-feed-agent.test.ts`

**Approach:**
- Before consumption, ensure all newly fetched items have embeddings in the local semantic store.
- On daemon start, run a semantic health check:
  - provider configuration present
  - semantic store initialized
  - historical likes/bookmarks coverage available
- Add status output for semantic health and coverage counts.
- Add one explicit backfill command for operators and CI-like setups:
  - `ft feed semantic rebuild`
  - this command is not required for every run, but gives a clear recovery path after provider/model changes

**Patterns to follow:**
- `src/feed-daemon.ts`
- `src/cli.ts`
- status formatting patterns in `src/feed-agent.ts`

**Test scenarios:**
- Happy path: daemon tick embeds new feed items, then consumes them in the same tick.
- Edge case: daemon start with stale semantic store reports a rebuild requirement clearly.
- Edge case: semantic rebuild updates coverage counts and unblocks future ticks.
- Error path: provider credentials missing causes semantic status failure and no action attempt.

**Verification:**
- CLI/service tests prove daemon semantic checks, status output, and rebuild command behavior.

- [x] **Unit 5: Document the semantic architecture and align future search work**

**Goal:** Keep docs and future work aligned with the new embedding-based direction.

**Requirements:** R1, R7, R9

**Dependencies:** Units 1-4

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/2026-04-15-007-feat-feed-daemon-preference-v2-plan.md`
- Test: `tests/cli-feed-agent.test.ts`

**Approach:**
- Update user-facing docs so they stop implying token scoring is semantic.
- Mark the older v2 plan as superseded where it conflicts with the new vector-backed design.
- Document required environment variables for embeddings provider configuration.
- Note that `search-all` is still lexical today but now has a shared semantic substrate available for future migration.

**Patterns to follow:**
- `README.md`
- `docs/README.md`
- prior plan status sync patterns in `tasks/todo.md`

**Test scenarios:**
- Happy path: CLI help and docs reflect the new semantic rebuild/status surfaces.
- Integration: documented command examples correspond to real command names.

**Verification:**
- Docs and CLI tests agree on command names and semantic-status output.

## System-Wide Impact

- **Storage model:** the repo will move from "only FTS artifacts" to "FTS artifacts plus one local vector store." This is additive, not a replacement.
- **Sync path:** feed fetch, likes/bookmark reconciliation, and preference writes now all become semantic-index maintenance triggers.
- **Decision path:** feed actions shift from lexical heuristics to nearest-neighbor semantic scoring plus metadata rules.
- **Future reuse:** `search-all` can later query the same semantic store instead of rebuilding a second semantic layer.
- **Failure model:** semantic infra problems should block auto-actions but not corrupt archives or daemon state.

## Risks & Mitigations

- **Embedding-provider dependency risk:** remote API outages or missing credentials can stall semantic actioning.
  Mitigation: typed semantic health checks, explicit status output, and fail-closed action behavior.

- **Index drift risk:** archive rows and vector rows can diverge.
  Mitigation: content-hash/version based idempotent upserts and one explicit rebuild command.

- **Latency risk on first daemon run:** backfilling large historical archives can be slow.
  Mitigation: separate rebuild command plus incremental upkeep after the first full semantic build.

- **Design split risk between feed and search:** one semantic layer for automation and another for search would create long-term drift.
  Mitigation: centralize semantic storage and embedding generation in shared modules from day one.

## Documentation Plan

- Create this plan as the canonical semantic-retrieval successor to the v2 lexical plan.
- Update README after implementation so operators understand:
  - embedding provider setup
  - semantic rebuild flow
  - semantic status interpretation
- Keep `docs/README.md` indexed with this plan.

## Verification Strategy

- Focused tests:
  - `tests/semantic-store.test.ts`
  - `tests/semantic-indexer.test.ts`
  - `tests/feed-agent.test.ts`
  - `tests/cli-feed-agent.test.ts`
- Build:
  - `npm run build`
- Real operator smoke:
  - run semantic rebuild against a temp data dir
  - run `feed daemon start --every 5s --candidate-limit 30 --dry-run`
  - inspect semantic status plus feed agent log reasons
- Live guarded smoke:
  - with real credentials configured, run one `feed agent run` and confirm reasons include semantic similarity evidence rather than token-history labels

## Unresolved Questions

- None blocking for planning.
- Implementation-time choices still open:
  - exact environment variable names for embedding provider config
  - whether to materialize action centroids in v1 or rely purely on nearest-neighbor history search
  - whether `search-all` migration should happen in the same workstream or immediately after this plan lands
