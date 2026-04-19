---
date: 2026-04-19
topic: account-research-export
---

# Account Research Export

## Problem Frame

The repo can already sync one public account timeline into a separate local archive, but it does not yet support a clean research workflow for agents. The user wants to study one account's viewpoints over a time range, using the CLI as a stable local-data tool and the skill layer as the research assistant.

The key product boundary is that the CLI should expose simple, reusable data capabilities, while agent skills should orchestrate analysis. This keeps the CLI deterministic and low-maintenance, while letting the research workflow evolve at the skill layer without coupling the CLI to LLM behavior.

```text
ft accounts sync
        |
        v
ft accounts export --since --until --format json
        |
        v
skill reads exported data
        |
        v
agent produces markdown viewpoint map
```

## Requirements

**CLI Export**
- R1. The CLI must support exporting one tracked account's tweets for a specified time range.
- R2. The export command must stay local-first and work only from the existing account timeline archive; it must not perform new LLM analysis.
- R3. The export command must support JSON output as the primary machine-readable format.
- R4. The export command must let the caller specify at least: account handle, start date, end date, and output path.
- R5. The exported records must preserve the core tweet fields needed for downstream research, including identity, text, URL, timestamp, and key context fields.

**Product Boundary**
- R6. The CLI must not take responsibility for viewpoint analysis, summarization, topic clustering, or other LLM-driven interpretation.
- R7. The research workflow should live in the installed skill layer, which can call the CLI export command and then run agent analysis on the exported data.
- R8. The CLI should expose stable, general-purpose capabilities that can be reused by multiple future agent workflows, not only viewpoint mapping.

**Research Assistant Output**
- R9. The first skill-driven research workflow should default to producing a markdown "viewpoint map" for one account over a chosen time range.
- R10. The viewpoint map should summarize the main themes and major viewpoints in the selected period.
- R11. Each theme in the markdown report should include 3 to 5 representative tweet links as evidence.
- R12. The first version should prefer concise human-readable markdown over structured analysis JSON output.

## Success Criteria
- The user can export one account's local timeline data for a defined date range with one CLI command.
- An agent skill can consume the exported JSON and produce a readable markdown viewpoint map without requiring the CLI to know anything about LLM analysis.
- The product boundary remains clear: CLI for data, skill for workflow, agent for interpretation.

## Scope Boundaries
- No LLM analysis built into the CLI.
- No requirement that exported account timelines be merged into `search-all` or the unified archive in this iteration.
- No requirement that the first skill output machine-oriented structured analysis results.
- No automatic remote sync inside the first research skill; it should analyze existing local data and prompt the user to sync first when needed.

## Key Decisions
- Keep analysis out of the CLI: this avoids coupling the tool to prompts, model providers, and high-churn interpretation logic.
- Make JSON the CLI export format: this is the cleanest substrate for agents and external tools.
- Make markdown the first research output: this matches the user's preferred reading experience.
- Make "viewpoint map" the first default workflow: this gives the research assistant one strong opinionated entry point instead of a vague all-purpose summary feature.
- Keep the skill local-first: this preserves the CLI's existing separation between deterministic local data workflows and higher-level agent behaviors.

## Dependencies / Assumptions
- The account must already have a local timeline archive from `ft accounts sync`.
- The local timeline archive contains enough tweet context for meaningful downstream viewpoint analysis.
- The installed skill mechanism remains the preferred integration point for agent workflows in this repo.

## Outstanding Questions

### Deferred to Planning
- [Affects R4][Technical] What should the exact CLI contract be for date filtering and output destination?
- [Affects R5][Technical] Which tweet fields should be included in the export payload by default, and which should be omitted to keep the JSON stable and compact?
- [Affects R7][Technical] Should the skill invoke the export command directly, or rely on a lower-level local file-reading flow when the archive already exists?
- [Affects R9][Technical] What markdown report structure best balances concise reading with enough evidence for trust?

## Next Steps
→ /prompts:ce-plan for structured implementation planning
