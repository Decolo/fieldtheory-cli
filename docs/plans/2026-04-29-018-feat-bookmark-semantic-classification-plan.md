---
title: "feat: Add bookmark semantic classification"
type: feat
status: completed
date: 2026-04-29
origin: docs/brainstorms/2026-04-29-bookmark-semantic-classification-requirements.md
---

# feat: Add bookmark semantic classification

## Summary

Add an optional bookmark classification pipeline that reads the local bookmark archive, produces a regenerable sidecar analysis artifact, and exposes CLI browsing over primary categories, subcategories, content types, and tags. The implementation should combine deterministic hints with cheap model-assisted semantic analysis while keeping bookmark sync and raw archive data unchanged.

---

## Problem Frame

The bookmark archive is searchable, but it does not expose the user's saved knowledge structure. The origin requirements define V1 as browseable semantic organization, with future reuse by agent retrieval, action-priority, and profile workflows.

---

## Requirements

- R1. V1 prioritizes browseable bookmark organization over ranking, agent optimization, or profile modeling.
- R2. Each classified bookmark has one stable primary category, one narrower subcategory, and a small set of tags.
- R3. Each classified bookmark has a controlled content type.
- R4. Each classified bookmark has a short human-readable summary.
- R5. Each classification includes an audit signal such as confidence and rationale.
- R6. Classification writes a sidecar analysis artifact and does not modify raw bookmark records.
- R7. Re-running classification is safe and does not duplicate analysis rows.
- R8. Analysis rows preserve links back to source bookmarks.
- R9. Classification tolerates missing or imperfect bookmark timestamps.
- R10. Classification prefers cheap model-assisted semantic analysis where rules are insufficient.
- R11. Normal classification must not require high-cost frontier models.
- R12. Deterministic rule hints should be used where reliable.
- R13. The output shape should remain reusable by future agent retrieval.
- R14. The output shape should remain reusable by future action-priority workflows.
- R15. The output shape should remain reusable by future cross-source interest/profile workflows.

**Origin acceptance examples:** AE1, AE2, AE3

---

## Scope Boundaries

- Do not change bookmark sync behavior or X GraphQL fetching.
- Do not mutate remote X data.
- Do not add action ranking, read-next prioritization, or project-use scoring in V1.
- Do not build a knowledge graph or profile graph in V1.
- Do not classify likes, feed items, or account timelines in this plan.
- Do not make Web UI classification browsing part of the first implementation.

### Deferred to Follow-Up Work

- Web UI browse/filter surface for classification results.
- Agent retrieval integration using classification summaries/tags.
- Action-priority scoring over classified items.
- Cross-source classification for likes, feed, and account timelines.

---

## Context & Research

### Relevant Code and Patterns

- `src/paths.ts` centralizes local data artifact paths under `FT_DATA_DIR` / `~/.ft-bookmarks`.
- `src/fs.ts` provides atomic JSON and JSONL helpers suitable for sidecar writes.
- `src/archive-export.ts` and `src/archive-projections.ts` provide normalized bookmark projection/export patterns that avoid direct coupling to raw cache shape.
- `src/bookmarks-db.ts` owns bookmark listing/search/stat behavior and should not be overloaded with model-driven classification state for V1.
- `src/cli.ts` groups archive-specific commands under the `bookmarks` namespace and already uses explicit subcommands for optional workflows such as repair, trim, and fetch-media.
- Existing tests use temporary `FT_DATA_DIR` fixtures and direct module tests plus CLI tests, e.g. `tests/cli-bookmarks.test.ts`, `tests/bookmarks-db.test.ts`, and `tests/archive-export.test.ts`.

### Institutional Learnings

- `docs/brainstorms/2026-04-19-account-research-export-requirements.md` and `docs/brainstorms/2026-04-19-x-feed-collection-reset-requirements.md` establish the product boundary that the CLI should remain local-first and deterministic, while LLM interpretation should be optional analysis rather than implicit sync behavior.
- `docs/brainstorms/2026-04-14-feed-hybrid-search-requirements.md` records future-facing interest in semantic/hybrid retrieval, but current implementation has removed persistent semantic vector storage; this plan should not reintroduce that broader search architecture for V1 classification.

### External References

- No external research is required for this plan. The repo already has clear local data, CLI, and test patterns; exact provider/model selection is deferred to implementation behind a small OpenAI-compatible boundary.

---

## Key Technical Decisions

- Sidecar-first storage: store classification output separately from `bookmarks.jsonl` and `bookmarks.db` so sync remains trustworthy and classification can be regenerated.
- Projection-based inputs: classify normalized bookmark projection/export data rather than raw X GraphQL records so the pipeline follows existing archive conventions.
- Controlled vocabularies for stable browsing: primary category and content type should be fixed lists in V1; subcategory and tags can carry nuance.
- Deterministic hints before model calls: obvious URL/domain and media/link signals should seed content type and prompt context to reduce model cost and improve stability.
- OpenAI-compatible model boundary: support cheap model providers through a generic chat-completions style interface rather than baking in one vendor.
- Explicit model-data boundary: model-backed classification may send bookmark text and link metadata to the configured provider, so it must be opt-in through provider configuration and clearly documented.
- CLI-first browse validation: ship a minimal CLI surface to run classification and browse results before adding Web UI integration.

---

## Open Questions

### Resolved During Planning

- Artifact placement: use dedicated bookmark analysis sidecar files under the existing data directory, not the bookmark index.
- Auditability signal: include both model confidence and short rationale/evidence text; confidence alone is not reviewable enough.
- Model path: plan for an OpenAI-compatible cheap model interface, with deterministic fallback/hints for content-type signals.

### Deferred to Implementation

- Exact model defaults: choose provider/model names based on available credentials and current local environment.
- Exact retry/backoff policy for model calls: tune once the provider boundary exists.
- Final vocabulary wording: start from the plan's proposed vocabulary, then adjust if real bookmark samples show obvious category gaps.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
bookmarks archive / projections
          |
          v
deterministic feature extraction
          |
          v
cheap model batch classification
          |
          v
validation + normalization
          |
          v
bookmark-analysis.jsonl + bookmark-analysis-meta.json
          |
          v
CLI browse: status / categories / list / show
```

---

## Implementation Units

- U1. **Define analysis artifact paths, types, and vocabularies**

**Goal:** Establish the stable V1 output contract and local artifact locations.

**Requirements:** R2, R3, R5, R6, R8, R13, R14, R15

**Dependencies:** None

**Files:**
- Modify: `src/paths.ts`
- Modify: `src/types.ts`
- Create: `src/bookmark-analysis-types.ts`
- Test: `tests/bookmark-analysis-types.test.ts`

**Approach:**
- Add local paths for analysis JSONL and metadata sidecars.
- Define the classification result shape around tweet identity, source URL, primary category, subcategory, content type, tags, summary, confidence, rationale/evidence, model metadata, and timestamps.
- Define controlled V1 vocabularies for primary category and content type. Start with a compact primary category set: `ai`, `software-engineering`, `infrastructure`, `product-design`, `business`, `research`, `security`, `media-culture`, `personal`, `other`.
- Define content types around the origin requirement examples: `tool`, `repo`, `paper`, `article`, `thread`, `announcement`, `tutorial`, `opinion`, `demo`, `dataset`, `other`.
- Keep the result shape source-agnostic enough that future likes/feed/account classifications can reuse the same classification semantics without sharing the same storage file.

**Patterns to follow:**
- Path helpers in `src/paths.ts`.
- Archive/source record typing style in `src/types.ts` and `src/archive-core.ts`.

**Test scenarios:**
- Happy path: every declared primary category and content type is accepted by the validator/normalizer.
- Edge case: unknown model category normalizes to `other` without throwing.
- Edge case: tags are normalized to a small unique kebab-case set.
- Edge case: missing bookmark timestamp is valid because classification is keyed by tweet identity, not collection time.

**Verification:**
- Types and validators clearly express the V1 artifact contract.
- No existing bookmark archive type requires modification to store classification fields.

---

- U2. **Build deterministic bookmark analysis inputs**

**Goal:** Convert local bookmark records into compact, model-ready classification inputs with deterministic hints.

**Requirements:** R8, R9, R12

**Dependencies:** U1

**Files:**
- Create: `src/bookmark-analysis-input.ts`
- Test: `tests/bookmark-analysis-input.test.ts`

**Approach:**
- Read bookmark projection/export data rather than raw X response internals.
- Build a compact input object containing tweet id, URL, text, author, links, domains, GitHub URLs, media/link counts, language when available, quoted tweet text when available, and posted/collected timestamps when reliable.
- Derive deterministic hints for content type and tags from obvious signals: GitHub repository URLs, arXiv-like links, YouTube/demo links, thread-like text, article domains, dataset domains, and media presence.
- Keep input compact enough for cheap batch model calls.

**Patterns to follow:**
- `src/archive-export.ts` mapping from projections to normalized export items.
- `src/archive-projections.ts` bookmark projection source queries.
- JSON parsing/normalization style from `src/bookmarks-db.ts`.

**Test scenarios:**
- Happy path: bookmark with GitHub URL produces a repo/tool hint and includes the source URL.
- Happy path: bookmark with paper-like URL produces a paper/research hint.
- Edge case: bookmark with no links still produces a valid model input from tweet text and author.
- Edge case: missing `bookmarkedAt` does not prevent input construction.
- Error path: malformed URLs are ignored as hints but do not fail classification input construction.

**Verification:**
- Model inputs contain enough context for classification while avoiding raw oversized records.
- Deterministic hints are reproducible for the same bookmark.

---

- U3. **Add cheap model classification provider boundary**

**Goal:** Provide a configurable, testable small-model interface for batch semantic classification.

**Requirements:** R4, R5, R10, R11

**Dependencies:** U1, U2

**Files:**
- Create: `src/bookmark-analysis-provider.ts`
- Modify: `src/config.ts`
- Test: `tests/bookmark-analysis-provider.test.ts`

**Approach:**
- Add a provider boundary that accepts batches of bookmark analysis inputs and returns normalized classification outputs.
- Use an OpenAI-compatible chat-completions style contract so users can point the CLI at cheap hosted or local-compatible models.
- Load config from environment variables through the existing `.env` loading path.
- Require explicit provider configuration before any real model call; avoid silently sending bookmark content to a default remote provider.
- Require structured JSON responses and validate/normalize every model output before it reaches storage.
- Include a deterministic dry/mock provider path for tests and for users who want to validate the pipeline shape without spending model calls.
- Keep prompt construction centralized and explicit about controlled vocabularies, summary length, tag limits, and rationale expectations.

**Patterns to follow:**
- Environment loading in `src/config.ts`.
- Fetch/error normalization style in `src/x-graphql.ts`, without coupling to X-specific retry behavior.
- Prompt separation style from `src/hybrid-search-prompt.ts`.

**Test scenarios:**
- Happy path: mock provider classifies a batch and returns valid normalized categories, content types, tags, summaries, confidence, and rationale.
- Happy path: provider config uses `.env` / environment values without requiring browser session config.
- Edge case: provider returns unknown category/content type; output normalizes to controlled fallback values.
- Edge case: provider returns too many tags; tags are truncated and normalized.
- Error path: missing API key for real provider produces a clear configuration error before any partial writes.
- Error path: invalid JSON response fails the batch with a recoverable error that the orchestrator can report.
- Privacy path: real provider mode makes the outbound data boundary explicit in configuration/help text, while mock/dry mode performs no network call.

**Verification:**
- Tests can exercise the classification pipeline without network access.
- Real provider details are isolated from CLI and storage code.

---

- U4. **Implement sidecar analysis store and classification orchestrator**

**Goal:** Run classification over bookmarks, merge results by tweet id, and write regenerable sidecar artifacts.

**Requirements:** R1, R6, R7, R8, R9, R10, R12, AE1, AE2, AE3

**Dependencies:** U1, U2, U3

**Files:**
- Create: `src/bookmark-analysis-store.ts`
- Create: `src/bookmark-analysis.ts`
- Test: `tests/bookmark-analysis-store.test.ts`
- Test: `tests/bookmark-analysis.test.ts`

**Approach:**
- Implement load/write helpers for analysis JSONL and metadata using atomic JSONL writes.
- Merge by tweet id so reruns update existing classifications rather than duplicating rows.
- Support classifying all bookmarks plus bounded runs for quick validation.
- Preserve source bookmark identity and URL in every analysis row.
- Track metadata such as generated time, source bookmark count, analyzed count, provider/model, and failures.
- Treat partial provider failures carefully: successful completed rows should be preservable, while failed rows should be reported and safe to retry.
- Use deterministic hints even when model classification is skipped or fails for a record, but do not pretend hint-only rows have the same confidence as model-classified rows.

**Patterns to follow:**
- Atomic JSON/JSONL writes in `src/fs.ts`.
- Archive merge-by-id behavior in `src/archive-store.ts`.
- Repair/sync progress result patterns in `src/bookmark-repair.ts` and `src/bookmarks-service.ts`.

**Test scenarios:**
- Happy path: classifying two bookmarks writes two analysis rows and metadata.
- Covers AE2. Integration: running classification twice for the same bookmarks keeps one row per tweet id and updates metadata.
- Covers AE3. Happy path: GitHub-linked bookmark receives deterministic hints that influence final content type.
- Edge case: source bookmark missing collection timestamp still writes a valid analysis row.
- Edge case: no bookmarks produces an empty analysis file and status metadata without error.
- Error path: provider fails for one batch; completed batches remain safe and failed item ids are reported.
- Error path: corrupt existing analysis file surfaces a clear error rather than silently discarding data.

**Verification:**
- Raw `bookmarks.jsonl` and `bookmarks.db` remain unchanged after classification.
- Repeated runs are idempotent by tweet id.

---

- U5. **Expose CLI classification and browsing commands**

**Goal:** Let users generate and inspect bookmark classifications from the CLI.

**Requirements:** R1, R2, R3, R4, R5, R8, AE1

**Dependencies:** U4

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-bookmark-analysis.test.ts`

**Approach:**
- Add CLI commands under the existing `bookmarks` namespace.
- Include a generation command that runs classification with options for bounded validation runs, provider selection, and JSON output where useful.
- Include status/category browsing commands that let users see primary category counts, content type counts, tag counts, and filtered classified bookmarks.
- Include a detail command that shows a classified bookmark with summary, category, content type, tags, confidence/rationale, and original URL.
- Do not change `bookmarks list`, `bookmarks search`, or sync commands in V1 unless implementation finds a very small non-invasive integration point.

**Patterns to follow:**
- CLI command grouping and safe error handling in `src/cli.ts`.
- Output conventions from `bookmarks stats`, `bookmarks list`, and `likes viz`.
- JSON output flag behavior in existing `list` and `show` commands.

**Test scenarios:**
- Happy path: `bookmarks classify` with mock provider writes analysis and reports analyzed count.
- Happy path: category browsing command prints primary category and content type counts from analysis rows.
- Happy path: filtered list command returns classified bookmarks for a selected category/tag/content type.
- Happy path: show command prints one bookmark's classification and source URL.
- Edge case: browsing before classification reports a clear "run classification first" message.
- Error path: real provider selected without config fails clearly and does not write partial invalid output.
- Integration: CLI commands respect `FT_DATA_DIR` test fixtures.

**Verification:**
- A user can classify the current bookmark archive and browse results without opening raw JSONL files.
- CLI commands do not require X cookies or browser access.

---

- U6. **Document configuration, workflow, and boundaries**

**Goal:** Make the feature discoverable and explain how it stays separate from sync and future profile/ranking work.

**Requirements:** R1, R6, R10, R11, R13, R14, R15

**Dependencies:** U5

**Files:**
- Modify: `README.md`
- Modify: `src/skill.ts`
- Test: `tests/skill.test.ts`

**Approach:**
- Add README usage examples for classification generation, browsing category counts, and listing filtered classifications.
- Document required environment variables for model-backed classification and the existence of a mock/dry path if implemented.
- Document that model-backed classification sends bookmark text and link metadata to the configured model provider, unless the user chooses a local/mock provider path.
- Document that classification is local sidecar analysis and does not alter X or bookmark sync data.
- Update the installed skill text so agents know classification output may exist and can use it when answering questions about bookmarks.

**Patterns to follow:**
- Existing README command tables and data directory section.
- Agent skill wording in `src/skill.ts` that avoids overstating what `ft` itself analyzes.

**Test scenarios:**
- Happy path: generated skill text mentions classification output without implying remote sync or automatic LLM analysis during normal search.
- Documentation check: README command examples match actual CLI command names selected during implementation.

**Verification:**
- A new user can understand how to run classification and where results live.
- Agent integration guidance remains local-first and accurate.

---

## System-Wide Impact

- **Interaction graph:** New commands read bookmark projections and write analysis sidecars; sync, repair, trim, and remote X action flows remain unchanged.
- **Error propagation:** Model configuration and provider failures should surface as classification errors, not as bookmark sync failures.
- **Data handling:** Classification reads local bookmark text and link metadata; real model provider mode crosses a data boundary chosen by the user, while mock/local-compatible modes should avoid external transmission.
- **State lifecycle risks:** Partial classification writes, duplicate rows, stale rows after bookmarks are removed, and corrupt sidecar files are the main lifecycle risks.
- **API surface parity:** Initial surface is CLI-only; Web UI parity is explicitly deferred.
- **Integration coverage:** Tests should prove the CLI can classify and browse analysis rows using isolated `FT_DATA_DIR` fixtures without network access.
- **Unchanged invariants:** `bookmarks.jsonl`, `bookmarks.db`, and X remote state must not be mutated by classification.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Model output is inconsistent or too verbose | Validate and normalize categories, content type, tags, summary length, confidence, and rationale before writing. |
| Classification becomes expensive | Default to batching, compact inputs, deterministic hints, and cheap provider configuration; include bounded validation runs. |
| Users confuse classification with sync | Keep commands and docs explicit that classification is sidecar analysis and does not contact X. |
| Users unintentionally send bookmark text to a remote model provider | Require explicit provider configuration and document the outbound data boundary in command help and README. |
| Sidecar grows stale after bookmark deletions | Store source identity and metadata; planning defers exact stale-row cleanup to implementation, but commands should make source counts visible. |
| Provider configuration adds fragility | Keep provider isolated and testable with mock provider paths. |

---

## Documentation / Operational Notes

- README should include the analysis sidecar files in the data directory section once command names and artifact paths are finalized.
- The feature should not require Chrome, Firefox, or X cookies; it operates on existing local data.
- Model-backed classification should be described as a user-configured outbound analysis step, not part of normal local search or sync.
- The command should be safe for the current 238-bookmark corpus and should remain practical for larger bookmark archives via batching and limits.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-29-bookmark-semantic-classification-requirements.md](../brainstorms/2026-04-29-bookmark-semantic-classification-requirements.md)
- Related code: `src/paths.ts`
- Related code: `src/fs.ts`
- Related code: `src/archive-export.ts`
- Related code: `src/archive-projections.ts`
- Related code: `src/bookmarks-db.ts`
- Related code: `src/cli.ts`
