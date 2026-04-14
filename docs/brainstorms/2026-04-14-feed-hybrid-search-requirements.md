---
date: 2026-04-14
topic: feed-hybrid-search
---

# Feed Hybrid Search

## Problem Frame

The current product can sync Home timeline tweets into a local feed archive and browse them with `feed list` / `feed show`, but that is not enough for the user's actual workflow. The user often wants the AI to inspect feed content on their behalf and surface tweets that are about a topic, even when the query is a longer natural-language idea such as "best practices on claude code". Pure keyword matching is therefore insufficient as the primary experience.

The next feature should turn the local feed archive into a hybrid search surface that combines topic relevance with future action-worthiness ranking. The first delivery should support both CLI and web entry points, default to topic-relevance search, and preserve a path to a second ranking mode that predicts whether the user would likely like or bookmark a result.

## Requirements

**Search Goal**
- R1. The product must support feed search that is meaningfully topic-related rather than limited to exact keyword matching.
- R2. The search input must accept short keyword queries and longer natural-language queries.
- R3. The first release must treat topic relevance as the default ranking goal.
- R4. The design must preserve a second ranking goal, action-worthiness, that can later be selected explicitly.

**Ranking Modes**
- R5. Topic relevance means ranking feed items by how semantically related they are to the user's query.
- R6. Action-worthiness means ranking feed items by how likely the user would be to like or bookmark them.
- R7. In the first release, action-worthiness should use the user's historical likes and bookmarks as its primary signal source.
- R8. The product should allow switching between topic relevance and action-worthiness instead of forcing one permanent ranking objective.

**Retrieval Model**
- R9. The product must use a hybrid search model rather than FTS-only matching.
- R10. The hybrid model should keep local indexed retrieval as the default path and may involve model assistance when queries are long or natural-language-heavy.
- R11. Full-text search may remain part of the retrieval stack, but it must not define the entire relevance model for this feature.
- R12. The product must keep search usable even when the exact query words do not all appear verbatim in the matching tweet text.

**Search Scope**
- R13. The first release should search across feed, likes, and bookmarks rather than limiting search to feed-only results.
- R14. Cross-archive search should be able to use likes and bookmarks both as searchable corpora and as preference signals.
- R15. Results should make it clear which archive family a hit came from so mixed-source output remains understandable.

**Surfaces**
- R16. The first release must support both CLI and web entry points.
- R17. CLI and web should expose the same core search capability even if the presentation differs.
- R18. The default result experience should return concrete result items first rather than replacing the result list with only an AI summary.
- R19. The product should also support an optional summary view that synthesizes what the result set is about.

## Success Criteria

- A user can search for a topic like "claude code" and get clearly relevant results even when exact word overlap is incomplete.
- A user can search with a longer natural-language prompt and still get useful local results without manually translating the query into keywords.
- A user can run the same core search from both CLI and web.
- A user can later switch between "topic relevance" and "action-worthiness" without redesigning the product model.
- Search across feed, likes, and bookmarks feels like one coherent capability rather than three disconnected archives.

## Scope Boundaries

- This brainstorm does not require autonomous liking or bookmarking of feed items.
- This brainstorm does not require finalizing the exact model provider, embedding strategy, vector store, or ranking formula.
- This brainstorm does not require a production-grade recommendation explanation system in the first release.
- This brainstorm does not require replacing the existing archive-specific list/show flows.

## Key Decisions

- Hybrid search, not FTS-only: pure full-text search is not enough for the intended "find related content" workflow.
- Default ranking starts with topic relevance: the user wants semantic topical discovery first, while preserving a later switch to action-worthiness.
- Action-worthiness proxy: "worth acting on" should be grounded in whether the user would likely like or bookmark the item.
- Signal source for first action-worthiness mode: historical likes and bookmarks are the primary signals.
- Mixed query execution: local indexed retrieval should be the default path, but model assistance is allowed when queries are long or natural-language-heavy.
- Multi-surface first release: both CLI and web should expose this capability from the start.
- Cross-archive search: the result set should span feed, likes, and bookmarks instead of limiting the first release to feed-only search.

## Dependencies / Assumptions

- Verified assumption: the repo already has archive-local FTS search for bookmarks and likes in `src/bookmarks-db.ts` and `src/likes-db.ts`.
- Verified assumption: the repo already has a local web surface for bookmarks and likes.
- Unverified assumption: the current local architecture can support a hybrid semantic retrieval layer without unacceptable sync or query latency; planning should validate this against the repo's runtime constraints.

## Outstanding Questions

### Resolve Before Planning
- None currently.

### Deferred to Planning
- [Affects R9][Technical] What hybrid retrieval architecture best fits this repo: FTS + embeddings, FTS + reranker, or a staged query-rewrite plus retrieval approach?
- [Affects R10][Technical] What is the decision rule for invoking model assistance at query time versus staying purely local?
- [Affects R13][Technical] Should cross-archive search return one unified ranked list or per-archive sections with a shared ranking model?
- [Affects R15][Technical] How should mixed-source results be labeled and normalized so the web and CLI surfaces stay coherent?
- [Affects R19][Needs research] What summary behavior is useful enough to ship without turning search into a chat product?

## Next Steps
→ `/prompts:ce-plan` for structured implementation planning
