---
title: feat: Add account timeline export for agent-led research
type: feat
status: completed
date: 2026-04-19
origin: docs/brainstorms/2026-04-19-account-research-export-requirements.md
---

# feat: Add account timeline export for agent-led research

## Overview

Add a local-first `ft accounts export` command that exports one tracked account's tweets for a chosen date range as JSON, then extend the installed `/fieldtheory` skill so agents can use that export as the substrate for a markdown viewpoint-map workflow.

## Problem Frame

The repo already supports syncing and browsing one public account timeline locally, but there is no stable way for an agent to consume that archive for research. The origin document defines a clear product boundary: the CLI should expose deterministic data capabilities, while the skill layer should orchestrate research and leave interpretation to the agent (see origin: `docs/brainstorms/2026-04-19-account-research-export-requirements.md`).

This is standard-scope work. The codebase already has strong local patterns for archive-local browse commands, deterministic exports, and installable skill content. The plan should therefore keep the new feature narrow: export from existing local account archives only, reuse existing date-filter conventions where possible, and update the skill content instead of adding LLM behavior to the CLI.

## Requirements Trace

- R1. Support exporting one tracked account's tweets for a specified time range.
- R2. Keep the export command local-first and analysis-free.
- R3. Support JSON output as the primary machine-readable format.
- R4. Let the caller specify account, date range, and output destination.
- R5. Preserve the core tweet fields needed for downstream research.
- R6. Keep LLM interpretation out of the CLI.
- R7. Put the research workflow in the installed skill layer.
- R8. Keep the CLI capability general-purpose and reusable beyond viewpoint mapping.
- R9. Make the first skill workflow default to a markdown viewpoint map.
- R10. Summarize main themes and viewpoints over the selected period.
- R11. Include 3-5 representative tweet links per theme.
- R12. Prefer markdown as the first user-facing research artifact.

## Scope Boundaries

- No LLM analysis or summarization inside `ft`.
- No automatic remote sync inside the research skill.
- No timeline ingestion into `search-all`, `archive.db`, or semantic indexing in this iteration.
- No requirement for JSONL, CSV, or analysis-result JSON output in the first pass.

## Context & Research

### Relevant Code and Patterns

- `src/account-timeline-db.ts` and `src/account-timeline-service.ts` are the current local read patterns for tracked account archives.
- `src/types.ts` shows that `AccountTimelineRecord` in the raw JSONL cache contains richer fields than `timeline.db`, including engagement, quoted tweet, media objects, and reply context.
- `src/md-export.ts` is the closest precedent for a deterministic local export module whose output is designed for downstream consumers rather than direct CLI browsing.
- `src/cli.ts` already exposes `accounts sync`, `accounts status`, `accounts list`, and `accounts show`, and existing archive surfaces consistently use `--after/--before` date filters in `YYYY-MM-DD` format.
- `src/skill.ts` and `tests/skill.test.ts` are the current pattern for shipping an installable `/fieldtheory` skill for Claude Code and Codex.

### Institutional Learnings

- There is no `docs/solutions/` directory in this repo, so there are no stored institutional learnings to inherit.
- `docs/plans/2026-04-18-009-feat-account-timeline-sync-plan.md` established that account timelines remain separate from `search-all` and shared archive layers in v1.

### External References

- None needed. The repo already has strong local patterns for deterministic export and installed skill content, and this feature does not depend on a new external API contract.

## Key Technical Decisions

- Export from `accounts/<user-id>/timeline.jsonl`, not from `timeline.db`. Rationale: the raw cache preserves the full `AccountTimelineRecord` shape needed for research, while the SQLite read model intentionally drops fields such as quoted tweet context, engagement, and media details.
- Reuse the repo's existing date-filter language with `--after` and `--before` in `YYYY-MM-DD` format. Rationale: `bookmarks` and `likes` already use this CLI vocabulary, so adding `--since/--until` would create unnecessary surface inconsistency.
- Make JSON the only first-pass export format. Rationale: it satisfies the agent-use case while keeping the export contract small and stable.
- Let `ft accounts export` write to stdout by default and support `--out <path>` for file output. Rationale: stdout keeps the command composable for agents, while `--out` satisfies the explicit export-file workflow in the origin document.
- Extend the existing `/fieldtheory` skill instead of adding a separate install command or second skill file. Rationale: the repo already treats `ft skill install` as the single agent-bridge surface, and the new research workflow is an extension of that bridge rather than a distinct product.
- Make the skill invoke the CLI export command rather than reading archive internals directly. Rationale: that keeps one stable contract between the local data layer and agent workflows, and avoids duplicated archive-reading logic in the skill text.

## Open Questions

### Resolved During Planning

- What should the CLI date filter contract be? Use `--after` / `--before` with `YYYY-MM-DD`, matching existing archive commands.
- Which export surface should agents rely on? The skill should call `ft accounts export`, not read local archive files directly.
- What should the first research artifact be? A markdown viewpoint map with concise themes plus representative tweet links.
- Should export require a file path? No. Support stdout by default, with optional `--out` for file output.

### Deferred to Implementation

- Whether the export module should preserve original raw field names or lightly normalize them for downstream clarity is intentionally deferred until the payload is shaped against real `AccountTimelineRecord` fixtures.
- Whether `--before` should be treated as inclusive end-of-day in UTC via string comparison or via explicit timestamp normalization is deferred to implementation, as long as the behavior is documented and tested consistently with existing date-filter conventions.
- Whether the skill text should mention only viewpoint mapping or also lightly advertise adjacent future research workflows is deferred until the final wording is reviewed against prompt bloat.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
local archive exists:
  accounts/<user-id>/timeline.jsonl

ft accounts export @mingchikuo --after 2025-04-01 --before 2026-04-01 --out ming.json
  -> resolve handle from local account registry
  -> read raw timeline.jsonl for that account
  -> filter records by date range
  -> shape stable research-friendly JSON payload
  -> write to stdout or file

/fieldtheory skill research flow
  -> confirm local data exists, else tell user to run ft accounts sync
  -> call ft accounts export ...
  -> read exported JSON
  -> produce markdown viewpoint map
  -> include 3-5 representative tweet links per theme
```

## Implementation Units

- [x] **Unit 1: Add local account export module and payload contract**

**Goal:** Create one local-first export path that reads a tracked account archive, filters it by date range, and returns a stable JSON-ready payload for downstream agent workflows.

**Requirements:** R1, R2, R3, R4, R5, R8

**Dependencies:** Existing tracked-account archive layout from `src/graphql-account-timeline.ts` and `src/account-registry.ts`

**Files:**
- Create: `src/account-export.ts`
- Modify: `src/date-utils.ts`
- Modify: `src/types.ts`
- Test: `tests/account-export.test.ts`

**Approach:**
- Add one focused export module that:
  - resolves a tracked account from the local registry,
  - reads the raw `timeline.jsonl` archive,
  - applies `--after` / `--before` filtering against the record's effective chronology field,
  - maps the retained `AccountTimelineRecord` rows into a stable export payload designed for research consumers.
- Prefer an explicit export payload shape over dumping raw rows byte-for-byte. The payload should stay close to `AccountTimelineRecord` but make the exported structure intentional and stable for agent use.
- Reuse or extend `src/date-utils.ts` for strict `YYYY-MM-DD` validation so the CLI does not silently accept ambiguous input.
- Use `postedAt` as the primary filter date and fall back to `syncedAt` when `postedAt` is unavailable, matching the archive's existing chronology behavior.

**Patterns to follow:**
- `src/md-export.ts`
- `src/account-timeline-db.ts`
- `src/account-registry.ts`

**Test scenarios:**
- Happy path: exporting one tracked account with `after` and `before` bounds returns only tweets inside the requested date range.
- Happy path: exported rows preserve the core research fields including tweet id, url, text, postedAt, author identity, reply/quote context, and engagement when present.
- Edge case: records missing `postedAt` still filter correctly via `syncedAt` fallback instead of being dropped or escaping the date window.
- Edge case: the export preserves chronological ordering from newest to oldest within the retained range.
- Error path: exporting an unsynced or unknown account fails with a clear local-first message rather than attempting a live X lookup.
- Error path: invalid `YYYY-MM-DD` input fails fast with an actionable operator-facing error.
- Integration: a temp-data account archive fixture yields deterministic JSON output that can be snapshot-asserted without building or reading the SQLite index.

**Verification:**
- A temp-data archive can be exported deterministically from raw local timeline data with stable field names and correct date filtering.

- [x] **Unit 2: Add `ft accounts export` CLI surface**

**Goal:** Expose the export capability as a first-class `accounts` subcommand that agents and users can call without knowing archive internals.

**Requirements:** R1, R2, R3, R4, R6, R8

**Dependencies:** Unit 1

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-accounts.test.ts`

**Approach:**
- Add `ft accounts export <handle>` under the existing `accounts` command group.
- Keep the surface small and composable:
  - `--after <date>`
  - `--before <date>`
  - `--out <path>` optional
- Default to pretty JSON on stdout when `--out` is omitted; write the same payload to disk when `--out` is provided.
- Keep the command local-first. It should resolve through the local account registry and export from local archive files only; it must not trigger `accounts sync` or any live X fetch.
- Mirror the current CLI ergonomics for missing-local-data errors so users are pointed back to `ft accounts sync <handle>` when necessary.

**Patterns to follow:**
- `src/cli.ts`
- `src/md-export.ts`
- `tests/cli-accounts.test.ts`

**Test scenarios:**
- Happy path: `ft accounts export @elonmusk --after 2026-04-01 --before 2026-04-30` prints valid JSON to stdout.
- Happy path: `ft accounts export @elonmusk ... --out tmp.json` writes the JSON file and prints a compact success summary with the output path and exported row count.
- Edge case: omitting one date bound exports all rows on the unbounded side rather than forcing both options.
- Edge case: handle normalization means `@ElonMusk` and `elonmusk` export the same local archive.
- Error path: exporting an account with no local archive exits non-zero and tells the user to run `ft accounts sync`.
- Error path: invalid date input exits non-zero without writing partial output.
- Integration: a temp-data archive can be exported through the CLI without requiring a built account SQLite index.

**Verification:**
- Users and agents can export one tracked account's local tweets as JSON through a stable CLI contract without touching the network.

- [x] **Unit 3: Extend the installed `/fieldtheory` skill for account research**

**Goal:** Teach the installed skill to use the new export command as the substrate for a markdown viewpoint-map workflow while keeping the CLI free of analysis logic.

**Requirements:** R6, R7, R9, R10, R11, R12

**Dependencies:** Unit 2

**Files:**
- Modify: `src/skill.ts`
- Test: `tests/skill.test.ts`

**Approach:**
- Extend the existing skill content so it can trigger on account-research questions in addition to bookmark-search questions.
- Add a compact workflow section for account research:
  - verify that local account data exists,
  - if not, tell the user to run `ft accounts sync`,
  - call `ft accounts export ...`,
  - analyze the exported JSON,
  - produce a markdown viewpoint map with representative links.
- Keep the skill text opinionated but narrow. The first baked-in research flow should be the viewpoint map, not a long menu of speculative analysis modes.
- Preserve the current install model in `src/skill.ts`; do not add a second installer or parallel skill artifact in this iteration.

**Patterns to follow:**
- `src/skill.ts`
- `tests/skill.test.ts`
- Existing command-list style in the bookmark skill content

**Test scenarios:**
- Happy path: both installed skill variants include the new `ft accounts export` workflow guidance.
- Happy path: the skill text tells agents to analyze existing local data first and prompt for `ft accounts sync` when account data is missing.
- Edge case: the skill still preserves the existing bookmark-search workflow rather than replacing it with research-only guidance.
- Error path: none -- content-only unit, but test assertions should fail if required command examples or workflow instructions are accidentally dropped.

**Verification:**
- Installing or showing the skill yields content that teaches agents to run the account research workflow without implying that the CLI itself performs analysis.

- [x] **Unit 4: Document the export workflow and product boundary**

**Goal:** Make the new export capability and skill-layer research boundary discoverable in user-facing docs.

**Requirements:** R2, R6, R7, R8, R9, R12

**Dependencies:** Unit 2, Unit 3

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`

**Approach:**
- Add `ft accounts export` to the command reference and quick-start examples where it materially helps.
- Document the local-first research flow clearly:
  - `accounts sync` populates local data,
  - `accounts export` emits machine-readable account data,
  - the installed skill uses that export to help agents produce research outputs.
- Preserve the existing boundary that tracked account timelines stay separate from `search-all` and unified archive layers.

**Patterns to follow:**
- `README.md`
- Existing archive-family documentation style in `README.md`

**Test scenarios:**
- Test expectation: none -- documentation-only unit.

**Verification:**
- A reader can understand how to export one account for research, what the CLI does, and what the agent skill does without inferring hidden LLM behavior inside `ft`.

## System-Wide Impact

- **Interaction graph:** `accounts export` will sit alongside `accounts status/list/show` as another local-only consumer of tracked account archives; unlike `accounts sync`, it should never touch X session or network code.
- **Error propagation:** local archive or date-parse failures should stop at the CLI boundary and produce deterministic non-zero exits without partial exports.
- **State lifecycle risks:** the export command is read-only, but it depends on registry/account-cache consistency; stale or partial local archives must fail clearly rather than silently exporting misleading data.
- **API surface parity:** this adds a new CLI contract and expands the installed skill contract. It does not change bookmark, like, feed, review, or unified-archive behavior.
- **Integration coverage:** temp-data CLI export tests are the key cross-layer proof because they verify local registry resolution, raw archive reading, date filtering, and output shaping together.
- **Unchanged invariants:** tracked account timelines remain separate from `search-all`, `archive.db`, semantic indexing, and any built-in LLM analysis.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Export payload drifts toward a raw internal dump and becomes unstable for agents | Define an intentional payload contract in Unit 1 and test it against fixtures |
| CLI surface drifts from existing archive conventions | Reuse `accounts` group placement and `--after` / `--before` date vocabulary from existing commands |
| Skill text becomes too broad and starts implying unsupported workflows | Keep the first research workflow opinionated around viewpoint mapping and cover it with `tests/skill.test.ts` |
| Exporting from `timeline.db` would omit needed research fields | Export from raw `timeline.jsonl` and keep the SQLite read model as browse-only |
| Users assume the skill will sync remotely for them | Document and encode the local-first requirement in both CLI errors and skill instructions |

## Documentation / Operational Notes

- README examples should show the two-step research setup clearly: `ft accounts sync ...` followed by `ft accounts export ...`.
- The skill text should make the local-first boundary explicit so agents do not accidentally imply that `ft` performs viewpoint analysis itself.
- This feature should remain compatible with the repo's current browser constraint: only `accounts sync` touches live X session flows; export and research stay local.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-19-account-research-export-requirements.md`
- Related code: `src/account-timeline-db.ts`
- Related code: `src/md-export.ts`
- Related code: `src/skill.ts`
- Related plan: `docs/plans/2026-04-18-009-feat-account-timeline-sync-plan.md`
