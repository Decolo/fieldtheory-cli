---
title: plan: Unify bookmarks, likes, and feed into one Twitter operations CLI surface
type: plan
status: proposed
date: 2026-04-27
origin: conversation
---

# plan: Unify bookmarks, likes, and feed into one Twitter operations CLI surface

## Overview

Reposition the repo as a local-first Twitter operations CLI for agents, automation, research, and downstream servers. The immediate design goal is to stop treating `bookmarks`, `likes`, and `feed` as separate product silos and instead define one shared resource contract with stable source-specific extensions.

This is not a request to make every command name identical for cosmetic reasons. The real goal is to make the CLI composable: predictable command families, predictable JSON output, predictable local storage contracts, and predictable remote mutation behavior across all major Twitter data sources.

## Product Direction

The repo should optimize for this use case:

```text
Twitter local-first operations substrate
  -> collect data from X/Twitter
  -> store canonical local archives
  -> expose stable read/mutate/export surfaces
  -> let agents, servers, and custom workflows compose on top
```

Under that framing, bookmark-specific knowledge-base features are no longer the center of the product. They can exist later as workflows built on top of the substrate, but the substrate itself should stay focused on acquisition, storage, indexing, inspection, mutation, and export.

## Problem Frame

Today the CLI exposes three different maturity levels:

- `bookmarks` acts like the historical "main product" and has the richest command surface.
- `likes` shares the same basic archive model but exposes a thinner and partially inconsistent CLI.
- `feed` behaves more like a collection subsystem than a first-class archive resource.

That asymmetry is acceptable for an exploratory tool, but it is the wrong shape for an agent-facing platform. Agents and server-side workflows need stable, regular interfaces more than they need one especially rich resource family.

## Goals

- Define a shared archive-resource contract for `bookmarks`, `likes`, and `feed`.
- Make the common command skeleton consistent across resource families.
- Establish stable JSON output expectations for automation.
- Keep source-specific power features without letting them distort the common contract.
- Create a phased migration path that can be implemented incrementally.

## Non-Goals

- No immediate rename of every existing command.
- No reintroduction of deleted wiki / ask / classify features.
- No forced one-table internal refactor before the CLI contract is settled.
- No requirement that all resources support identical remote write actions.

## Core Design Principle

Consistency should apply to the resource contract, not just to spelling.

```text
good consistency:
- same command families
- same option names
- same JSON layout style
- same status/index/export behavior

bad consistency:
- copying bookmark-only features into likes/feed without a real use case
- forcing remote actions to exist where the source has no natural equivalent
```

## Unified Resource Model

Treat these as first-class Twitter archive families:

```text
bookmarks
likes
feed
accounts
conversation-context
```

The immediate baseline should cover `bookmarks`, `likes`, `feed`, and `accounts`. `conversation-context` remains a sidecar archive family for now, but it should still follow the same general design style when it grows a broader CLI surface.

Each first-class resource should be able to participate in this lifecycle:

```text
1. sync/fetch
2. list
3. show
4. search
5. status
6. index
7. export
8. remote mutation (when applicable)
9. enrichment / higher-order workflows (optional)
```

## Required Common Surface

All four primary resource families should converge on this baseline:

```text
ft <resource> sync
ft <resource> list
ft <resource> show
ft <resource> search
ft <resource> status
ft <resource> index
ft <resource> export
```

Design notes:

- `search` is separate from `list`; `search` optimizes for ranked retrieval, `list` for deterministic browsing and filtering.
- `export` is required for agent/server composition. Local JSON export is more important than custom markdown or wiki generation.
- `accounts` may temporarily remain behind on `search` and `index`, but it is part of the same contract and should converge toward it rather than being treated as a separate product.
- `index` remains explicit while SQLite/LanceDB are still implementation details that may need repair/rebuild.

## Source-Specific Extension Surface

Source-specific actions are allowed, but must live on top of the shared baseline:

```text
bookmarks
- add
- unbookmark
- repair
- fetch-media
- stats
- viz

likes
- add
- unlike
- trim
- stats
- viz

feed
- context sync
- daemon start/status/stop/log
```

These extensions are acceptable because they represent real source differences:

- bookmarks have meaningful explicit save/remove actions.
- likes have meaningful explicit like/unlike actions plus bulk hygiene.
- feed has collection scheduling and sidecar context collection concerns.

## Capability Matrix

Target state for the four primary resources:

```text
Capability              bookmarks   likes   feed    accounts
------------------------------------------------------------
sync                    yes         yes     yes     yes
list                    yes         yes     yes     yes
show                    yes         yes     yes     yes
search                  yes         yes     yes     later
status                  yes         yes     yes     yes
index                   yes         yes     yes     later
export                  yes         yes     yes     yes
json output             yes         yes     yes     yes
remote add              yes         yes     no      no
remote remove relation  yes         yes     no      no
bulk action             no          trim    daemon/context  no
stats/viz               yes         yes     later   later
```

## Current Gaps

### Bookmarks vs likes

- `bookmarks sync` supports `--rebuild`, `--yes`, and `--target-adds`; `likes sync` does not.
- `bookmarks list` supports category/domain filters; `likes list` does not expose any enriched metadata model.
- `bookmarks` has richer inspection and analysis commands (`stats`, `viz`, `sample`, `categories`, `domains`).
- `bookmarks add` exists; `likes like` does not exist.

### Feed vs bookmarks/likes

- `feed` has underlying search/index primitives in code, but they are not yet exposed as stable first-class CLI commands.
- `feed` has no simple `export` command.
- `feed` is treated more as a collector than as a stable archive resource.

### Accounts vs the rest of the platform

- `accounts` already has first-class export, but it is still modeled as a separate research surface rather than part of the common archive contract.
- `accounts` does not yet expose `search` or explicit `index` commands.
- if `accounts` stays outside the unified contract, the repo will continue to carry a fourth divergent archive model.

## Command Contract Rules

### Shared option names

For shared commands, shared concepts should use the same flags:

```text
sync:
- --max-pages
- --delay-ms
- --max-minutes
- --browser
- --cookies
- --chrome-user-data-dir
- --chrome-profile-directory
- --firefox-profile-dir

list/search:
- --query
- --author
- --after
- --before
- --limit
- --offset   (for list)
- --json
```

Resource-specific filters are allowed only as additive fields after the shared baseline is stable.

### Shared output style

Human-readable output should align on:

- headline line with resource id, author, and primary date
- summary text next
- canonical URL next
- optional source-specific metadata after that

JSON output should align on:

- stable top-level naming
- stable date field naming conventions
- consistent nullability style
- no source-specific surprise nesting when a flat field works

### Shared export contract

Default export behavior should be defined now, not left to each resource module.

Rule:

```text
`ft <resource> export` should default to a canonical archive-oriented JSON schema,
not a source-private cache shape.
```

Implications:

- exports should be predictable for agents and servers regardless of source family
- source-specific fields may still be included, but they should be attached in a stable extension area rather than replacing the common shape
- if raw source-native export is needed, it should be an explicit opt-in mode such as a future `--raw` flag rather than the default

### Shared operational semantics

- `status` should always print cache path, index path if present, totals, and last sync metadata if known.
- `index` should always support `--force`.
- `export` should always be local-first and side-effect free.
- remote mutation commands should always print remote result first, then local reconciliation result.

## Archive and Data Model Direction

The repo already has the right broad direction:

```text
source cache(s) -> canonical unified archive -> resource-specific and cross-resource retrieval
```

That direction should be strengthened:

- `archive.jsonl` and `archive.db` should be treated as a platform-level canonical layer, not just a convenience for `search-all` and `web`.
- every first-class resource should default to exporting canonical archive-shaped JSON, even if the implementation reads from source caches internally.
- future agent/server integrations should prefer the unified archive contract wherever source-specific detail is not required.

## Phased Rollout

### Phase 1: Normalize the common contract

Scope:

- define and document shared command families
- expose already-existing retrieval/index primitives where they exist but are not yet first-class CLI surfaces
- add missing `export` / `search` / `index` surfaces where clearly absent
- align shared option names
- align shared human-readable output patterns
- align JSON output patterns
- define the canonical export schema before adding multiple resource exports

Expected deliverables:

- documented common contract in README/docs
- `feed search`
- `feed export`
- `feed index`
- `bookmarks export` and `likes export`
- documented canonical export schema
- `accounts` explicitly included in the common contract roadmap

### Phase 2: Strengthen resource parity

Scope:

- add lightweight stats for `likes` and `feed` if useful
- normalize list/show rendering depth
- reduce bookmark-only assumptions in user-facing copy
- make the CLI feel like one platform rather than one flagship module plus sidecars

Expected deliverables:

- more symmetric `status`, `list`, `show`
- consistent support for agent-oriented JSON flows
- cleaner README positioning

### Phase 3: Move higher-level workflows onto the substrate

Scope:

- build agent/server/research workflows on top of export/search/list/mutate
- keep advanced workflows out of the core CLI unless they expose reusable primitives

Examples:

- autonomous monitoring services
- research digests
- account/topic study pipelines
- local knowledge-base builders implemented outside the base archive contract

## Concrete Recommendations

### Keep

- keep `bookmarks add`
- keep `bookmarks repair`
- keep `bookmarks fetch-media`
- keep `likes trim`
- keep `feed daemon`
- keep `feed context sync`

### Add

- add `bookmarks export`
- add `likes export`
- add `feed search`
- add `feed export`
- add `feed index`
- include `accounts` in the common surface roadmap now, not as a separate later product

### Normalize

- normalize `sync` flags across bookmarks/likes/feed
- normalize `list`/`show` formatting across bookmarks/likes/feed
- normalize `status` output sections across resources
- normalize JSON output conventions before adding more agent/server workflows

### Defer

- defer reintroducing any LLM-powered top-layer product features
- defer internal mega-refactors until the external CLI contract is agreed
- defer forcing bookmarks' enriched metadata model onto likes/feed until a clear enrichment pipeline exists

## Risks

- Over-normalization could hide meaningful source differences and produce awkward commands.
- Under-normalization would leave the repo hard to compose from agents and servers.
- Adding `export` and `feed search` may reveal schema mismatches that were previously hidden by the current ad hoc surfaces.
- Internal refactors attempted before contract alignment could churn the codebase without improving the product.

## Decision Summary

Adopt this rule:

```text
All first-class Twitter archive resources must share one common archive CLI contract.
Source-specific operations are extensions layered on top of that contract.
```

That gives the repo a stable future:

```text
Twitter CLI substrate first
workflows, agents, and knowledge systems second
```
