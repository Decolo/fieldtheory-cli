---
date: 2026-04-29
topic: bookmark-semantic-classification
---

# Bookmark Semantic Classification

## Summary

The first version will add a low-cost semantic classification layer for local X bookmarks, focused on making the current bookmark archive easier to browse and organize. The output should be auditable, repeatable, and reusable by future agent retrieval, action-priority, and long-term profile features.

---

## Problem Frame

The local bookmark archive now has enough synced content to be useful, but raw search, lists, and stats do not show the user's saved knowledge structure. A user can search when they know what to ask for, but they cannot quickly see the major themes, content types, or topical clusters in their saved bookmarks.

The user expects this classification layer to become a foundation for broader workflows over time. Browseable organization is the first need, but the same analysis should not close the door on future agent retrieval hints, read/try/use prioritization, or cross-source interest profiling across bookmarks, likes, feed, and tracked accounts.

---

## Requirements

**V1 Classification Goal**
- R1. V1 must prioritize browseable organization of bookmarks over action ranking, agent optimization, or profile modeling.
- R2. V1 must classify each bookmark into a restrained hierarchy: one stable primary category, one narrower subcategory, and a small set of freeform tags.
- R3. V1 must identify the content type of each bookmark using a controlled vocabulary, so users can distinguish tools, repos, papers, threads, tutorials, opinions, announcements, demos, datasets, articles, and other saved items.
- R4. V1 must include a short human-readable summary for each classified bookmark.
- R5. V1 must include enough confidence or rationale signal for a user to audit whether a classification looks trustworthy.

**Output Behavior**
- R6. Classification must produce a sidecar analysis artifact rather than modifying the raw bookmark archive.
- R7. Classification output must be safe to regenerate without duplicating bookmark entries or corrupting the source archive.
- R8. Classification should preserve the link back to each source bookmark so users and downstream tools can inspect the original tweet.
- R9. Classification should tolerate imperfect source data, including bookmarks missing reliable bookmark timestamps.

**Cost and Model Use**
- R10. The feature should prefer cheap model-assisted semantic analysis where rules alone are insufficient.
- R11. The feature should avoid requiring high-cost frontier models for normal bookmark classification.
- R12. The feature should support deterministic or rule-based signals where they are reliable, such as obvious content type or domain-derived hints.

**Future Reuse**
- R13. The classification shape should be reusable later by agent retrieval workflows.
- R14. The classification shape should be reusable later by action-priority workflows that decide what is worth reading, trying, or using in a project.
- R15. The classification shape should be reusable later by long-term interest/profile workflows across bookmarks, likes, feed, and tracked accounts.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a synced bookmark archive, when classification runs, each classified bookmark has a primary category, subcategory, content type, and tags that make it browseable without reading every tweet.
- AE2. **Covers R6, R7, R8.** Given an existing bookmark archive, when classification is run twice, the raw bookmark archive remains unchanged and the analysis output still maps cleanly back to the original bookmark records.
- AE3. **Covers R10, R11, R12.** Given a bookmark whose URL clearly points to a GitHub repository, classification may use deterministic hints for content type while still using semantic analysis for topic and tags.

---

## Success Criteria

- The user can quickly scan their bookmark collection by major themes and content types.
- Classification results are stable enough that re-running the analysis does not create confusing churn.
- A user can inspect a classified item and understand why it likely belongs in that bucket.
- The output is useful as a later input to agent retrieval, action-priority, and profile-building work.
- A downstream planning pass does not need to invent the V1 goal, scope boundaries, or classification purpose.

---

## Scope Boundaries

- V1 does not build a full personal knowledge graph.
- V1 does not rank what the user should read, try, build, or use next.
- V1 does not optimize agent retrieval beyond preserving reusable classification signals.
- V1 does not modify remote X data.
- V1 does not change bookmark sync behavior.
- V1 does not require deciding the exact model provider, storage format, command names, or UI layout during this brainstorm.
- V1 does not need to classify likes, feed items, or tracked-account timelines, though it should avoid blocking those future sources.

---

## Key Decisions

- Browseable classification first: this gives immediate value on the current bookmark archive while keeping future capabilities possible.
- Restrained hierarchy plus tags: primary category and content type keep browsing stable, while subcategory and tags preserve semantic nuance.
- Sidecar analysis artifact: raw bookmark data remains trustworthy and classification can be regenerated independently.
- Cheap model-assisted analysis: small models are enough for the current corpus size and avoid making classification feel expensive or heavyweight.
- Future reuse without overbuilding: agent retrieval, action priority, and profile modeling are recorded as future consumers, not V1 deliverables.

---

## Dependencies / Assumptions

- Verified assumption: the repo already has a local bookmark archive, local bookmark index, export flow, and unified archive search surface.
- Verified assumption: previous product direction favors keeping the CLI local-first and deterministic, with LLM interpretation treated as optional analysis rather than core sync behavior.
- Assumption: the current bookmark corpus is small enough for low-cost batch classification to be practical.
- Assumption: browseable categories will be more useful if controlled vocabularies stay small and stable.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R2, R3][Technical] What exact primary category and content type vocabularies should V1 start with?
- [Affects R5][Technical] Should auditability be expressed as confidence, rationale, evidence snippets, or some combination?
- [Affects R6, R7][Technical] Where should the analysis artifact live, and how should regeneration handle partial or failed runs?
- [Affects R10, R11][Needs research] Which cheap model path is most practical for local-first batch classification in this repo?
