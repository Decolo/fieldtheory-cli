---
date: 2026-04-17
status: completed
topic: bookmark-sync-simplification
origin: docs/brainstorms/2026-04-17-x-assistant-unified-archive-requirements.md
---

# Bookmark Sync Simplification Plan

## Problem Frame

`bookmarks` is the oldest ingestion surface in this fork, and it still carries more operational modes than `likes` and `feed`. Today `ft sync` mixes three different concerns:

- primary bookmark acquisition
- resume and historical recovery behavior
- post-hoc data repair and enrichment

It also exposes two acquisition paths: the default browser-session GraphQL flow and the older OAuth v2 API fallback. That makes the bookmark surface harder to reason about than `ft likes sync` and `ft feed sync`, even though the product direction is converging on one unified archive foundation rather than a bookmark-special system (see origin: `docs/brainstorms/2026-04-17-x-assistant-unified-archive-requirements.md`).

The objective of this plan is to make bookmark sync feel like likes/feed: one obvious default path, fewer user-facing modes, and a clearer separation between "sync new data" and "repair old data", while preserving the runtime behaviors that still matter for local data safety and historical completeness.

## Planning Context

Local research shows:

- `src/cli.ts` gives bookmarks four special flags that likes/feed do not: `--api`, `--rebuild`, `--continue`, and `--gaps`.
- `src/graphql-bookmarks.ts` is already the real first-class sync path. It preserves bookmark-specific ordering and `bookmarkedAt` semantics, supports resume cursors, and contains the old-cap scan-through behavior.
- `src/bookmarks.ts` implements the OAuth API path, but that path cannot populate real `bookmarkedAt`; it only sees tweet creation time and sets bookmark time to `null`.
- `src/graphql-likes.ts` is the cleaner target shape: one browser-session GraphQL sync path, bounded stop conditions, local state for resumability, and no extra user-facing recovery taxonomy.
- `src/archive-actions.ts` already provides a pattern for shared bookmark/like archive reconciliation, which reduces the risk of moving bookmark compatibility logic behind narrower service boundaries.

The codebase already has strong local patterns for this work, so external research is unnecessary. The main challenge is product-contract simplification without regressing live bookmark capture or historical repair.

## Requirements Trace

- R4-R7: bookmark ingestion should behave like one source attachment flow within the unified archive direction, not a separate product with its own mental model.
- R8-R9: CLI contracts should converge toward consistency with likes/feed while preserving source-specific facts such as bookmark ordering and bookmark timestamps.
- R12-R15: the transition must be incremental, preserve existing local data, and explicitly identify which bookmark-era capabilities become compatibility wrappers, hidden internals, or separate repair tools.

## Scope Boundaries

### In Scope

- Simplify the public bookmark sync contract in `ft sync`
- Reclassify bookmark-only historical recovery and repair behaviors
- Narrow the long-term role of the OAuth bookmark sync path
- Align bookmark sync implementation boundaries with the likes/feed ingestion pattern
- Update help text, docs, and tests to reflect the simpler contract

### Out of Scope

- Removing bookmark-specific read features such as classification, markdown export, wiki, viz, or category browsing
- Rewriting the whole bookmark storage layer in the same change
- Unifying bookmark sorting rules with likes/feed where bookmark chronology still needs distinct semantics
- Changing remote `unbookmark` behavior

## Simplified Target UX

The target operator model is:

- `ft sync` means "sync bookmarks from the primary supported path"
- `ft sync --rebuild` remains the one advanced sync mode for a full re-crawl
- bookmark repair/enrichment moves out of the main sync taxonomy into `ft bookmarks repair`
- historical resume/scan-through behavior remains supported, but `--continue` stops being part of the public help contract
- the OAuth bookmark API path remains available in phase 1 as `ft sync --api`, but is described everywhere as a compatibility fallback rather than a peer to the default flow

In other words, the bookmark surface should converge from:

```text
sync + api + rebuild + continue + gaps
```

toward:

```text
sync + rebuild + repair
```

with `continue` either internalized or retained only as an escape hatch, and `api` hidden behind a compatibility-oriented path.

For phase 1, this plan makes these contract decisions explicit:

- `repair` lives at `ft bookmarks repair`
- `--continue` remains accepted only as a hidden compatibility flag during the transition, with deprecation-oriented wording when invoked
- `--api` remains accepted at `ft sync --api` during the transition, but it is removed from the primary happy-path help narrative and documented as a fallback for unsupported session environments
- `ft sync` remains the only primary bookmark acquisition entry point; `ft bookmarks` is not promoted into a parallel top-level sync namespace

## Key Technical Decisions

- GraphQL/browser-session sync remains the canonical bookmark acquisition path.
  Rationale: it is already the richer path, matches likes/feed, and preserves bookmark-specific chronology that the OAuth API cannot provide.

- OAuth bookmark sync is downgraded to a compatibility fallback rather than a primary peer.
  Rationale: it is useful as a contingency path, but its incomplete bookmark-time semantics make it a poor default for a local-first archive whose ordering matters.

- `gaps` should stop being a sync mode and become an explicit repair/enrichment command.
  Rationale: it does not fetch new bookmarks; it repairs quoted tweet content, truncated text, and invalid bookmark dates in existing data. Treating it as sync creates a misleading product contract.

- Resume/scan-through logic should stay in the service layer even if the CLI surface shrinks.
  Rationale: the old-cap/history-recovery logic is still valuable, but most users should not have to choose between `incremental` and `continue` manually.

- `ft bookmarks repair` is the dedicated repair surface for phase 1, even though `ft bookmarks` currently exists mostly as a backward-compat alias namespace.
  Rationale: repair is the one bookmark-specific operator action that benefits from a noun-scoped command, while primary acquisition should remain at top-level `ft sync`.

- The hidden `ft bookmarks` alias behavior should be preserved for existing forwarded commands, but `repair` becomes a real bookmark subcommand rather than another alias.
  Rationale: this keeps old muscle memory working without forcing bookmark sync itself into two parallel public entry points.

- Bookmark simplification should preserve data-file compatibility during the first phase.
  Rationale: the repo already has live data and automation around current bookmark caches, so the contract should simplify before the persistence layout changes again.

- The new bookmark sync service should own acquisition orchestration and stop-state normalization, while the CLI remains responsible for user prompts, spinner/progress presentation, and optional post-sync classify behavior.
  Rationale: this keeps service boundaries aligned with likes/feed without smuggling presentation-only behavior into the service layer.

## Target Architecture

```text
ft sync
  -> src/cli.ts bookmark sync command
  -> src/bookmark-sync.ts         primary bookmark sync service
       -> src/graphql-bookmarks.ts   X Web/GraphQL contract parsing
       -> src/archive-store.ts       unified archive rebuild/upsert
       -> bookmark state/meta files
  -> optional classify step

ft bookmarks repair
  -> src/bookmark-repair.ts       bookmark enrichment/repair service
       -> quoted tweet backfill
       -> truncated text expansion
       -> bookmark date sanitization / repair

ft auth / compatibility fallback
  -> src/bookmarks.ts             OAuth bookmark sync kept as fallback only
```

## Migration Strategy

1. Separate public product concepts first: sync, rebuild, repair, compatibility fallback.
2. Extract bookmark sync orchestration into a narrower service boundary that mirrors likes/feed.
3. Keep historical recovery logic, but move it behind internal defaults or a smaller advanced contract.
4. Deprecate the bookmark OAuth path in the primary help/docs, then decide later whether to keep, move, or remove it.
5. Once the CLI contract stabilizes, use the same service boundary to participate in deeper unified-archive refactors.

### Phase 1 Compatibility Rules

- `ft sync` stays stable for all existing default workflows.
- `ft sync --gaps` remains accepted only as a deprecation shim that redirects to `ft bookmarks repair`.
- `ft sync --continue` remains accepted only as a hidden compatibility flag and is omitted from public help text.
- `ft sync --api` remains accepted in phase 1 to avoid cross-platform regression, but help/docs must label it as fallback-only.
- `ft auth` remains available because the fallback path still exists, but its wording must stop implying that API sync is a normal peer to browser-session sync.

### CLI Acceptance Rules

- `ft sync --help` shows only the public bookmark acquisition contract: default sync, `--rebuild`, classification, and generic browser/cookie/runtime options.
- `ft sync --help` does not show `--continue` or `--gaps`.
- `ft bookmarks --help` may expose `repair`, but it must not create a second public bookmark sync path that competes with top-level `ft sync`.
- `ft status` and related status surfaces must describe browser-session GraphQL sync as the primary path and OAuth as fallback-only when mentioned.
- `ft auth` help text must describe OAuth setup as fallback-oriented rather than a normal prerequisite for bookmark sync.
- Deprecated compatibility entry points must either:
  - redirect and complete successfully with a visible deprecation notice, or
  - fail fast with a visible migration message and a non-zero exit code.
  Silent behavior changes are not acceptable.

## Implementation Units

### Unit 1: Define the New Bookmark Sync Contract

**Goal**
- Make the public bookmark sync semantics explicit and simpler before moving code.

**Files**
- Modify `src/cli.ts`
- Modify `README.md`
- Modify any relevant command docs/help snapshots in tests

**Changes**
- Keep `ft sync` as the primary bookmark acquisition command.
- Keep `--rebuild` as the single explicit advanced sync mode.
- Remove `--gaps` from the public sync command surface and replace it with `ft bookmarks repair`.
- Keep `--continue` accepted only as a hidden compatibility flag with tighter recovery wording.
- Reword `--api` in help/docs as a compatibility fallback rather than a co-equal sync mode, while keeping `ft sync --api` working in phase 1.
- Update status/help text so bookmark sync reads like likes/feed rather than a special subsystem.
- Preserve the existing top-level `ft sync` happy path and do not add a second public bookmark-sync command.

**Pattern References**
- `src/cli.ts`
- `src/graphql-likes.ts`
- `src/graphql-feed.ts`
- `README.md`

**Test Files**
- Update `tests/cli.test.ts`
- Update `tests/cli-bookmarks.test.ts` if present
- Update `tests/cli-likes.test.ts`

**Test Scenarios**
- Happy path: `ft sync --help` shows the simplified bookmark contract and no longer presents repair as sync.
- Happy path: `ft sync --rebuild` remains available and clearly described as a full re-crawl.
- Edge case: invoking the old `--gaps` path produces a deprecation redirect to `ft bookmarks repair`.
- Edge case: compatibility fallback help for OAuth is still discoverable, but no longer framed as the normal route.
- Edge case: `--continue` is still accepted when explicitly invoked, but is absent from normal help output.

### Unit 2: Extract a Primary Bookmark Sync Service

**Goal**
- Give bookmarks the same implementation shape as likes/feed: one primary service with bounded options and a clear output contract.

**Files**
- Add `src/bookmark-sync.ts`
- Modify `src/cli.ts`
- Modify `src/graphql-bookmarks.ts`
- Modify `src/bookmarks.ts`

**Changes**
- Introduce one bookmark sync service that owns:
  - mode selection (`incremental` vs `rebuild`)
  - local cursor/state loading
  - stop-reason normalization
  - archive-store follow-up required to keep bookmark attachments coherent
- Leave X contract parsing in `src/graphql-bookmarks.ts`, but move orchestration and product semantics out of the CLI.
- Narrow the public service options so they resemble `syncLikesGraphQL` and `syncFeedGraphQL`.
- Move OAuth sync behind the same service boundary as a fallback implementation rather than letting the CLI branch deeply on two peer flows.
- Keep spinner rendering, rebuild confirmation prompts, command deprecation messaging, and optional classify follow-up in `src/cli.ts`.

**Pattern References**
- `src/graphql-likes.ts`
- `src/graphql-feed.ts`
- `src/graphql-bookmarks.ts`
- `src/bookmarks.ts`

**Test Files**
- Add `tests/bookmark-sync.test.ts`
- Update `tests/graphql-bookmarks.test.ts`
- Update `tests/bookmarks.test.ts`

**Test Scenarios**
- Happy path: default bookmark sync runs through the primary service and returns normalized totals/stop reason.
- Happy path: rebuild mode delegates to the same service boundary with full-history semantics.
- Edge case: if a saved cursor exists, the service resumes without exposing extra CLI complexity.
- Edge case: if no saved cursor exists but history scan-through is needed, the service performs it internally and still reports a coherent result.
- Edge case: OAuth fallback still works when explicitly requested through the compatibility path.

### Unit 3: Split Repair/Enrichment from Acquisition

**Goal**
- Make bookmark data repair a separate, explicit capability rather than a sync sub-mode.

**Files**
- Add `src/bookmark-repair.ts`
- Modify `src/cli.ts`
- Modify `src/graphql-bookmarks.ts`
- Update `README.md`

**Changes**
- Extract `syncGaps`-style behavior into a dedicated repair service with bookmark-specific naming.
- Keep the actual backfill logic, but describe it in terms of:
  - quoted tweet repair
  - truncated text expansion
  - invalid bookmark date cleanup
- The new command surface is `ft bookmarks repair`; separate repair sub-actions are explicitly deferred.
- Preserve failure logging and progress reporting, but move artifacts and wording away from "sync gaps" language.
- Treat `ft bookmarks repair` as the first non-alias bookmark subcommand; other existing `ft bookmarks <cmd>` forwarding behavior stays intact for compatibility.

**Pattern References**
- `src/graphql-bookmarks.ts`
- `src/bookmarks-db.ts`

**Test Files**
- Add `tests/bookmark-repair.test.ts`
- Update `tests/graphql-bookmarks.test.ts`
- Update `tests/cli-bookmarks.test.ts` if present

**Test Scenarios**
- Happy path: running the repair command fills missing quoted tweets and expands truncated text.
- Happy path: invalid bookmark dates are sanitized and persisted.
- Edge case: when nothing needs repair, the command exits cleanly with a no-op summary.
- Edge case: unavailable tweets are logged with a durable failure artifact and do not corrupt existing data.
- Edge case: `ft bookmarks repair` resolves before the backward-compat alias forwarding layer and does not recurse into top-level alias dispatch.

### Unit 4: Reposition or Deprecate the OAuth Bookmark Path

**Goal**
- Reduce user-facing complexity from the OAuth bookmark route without losing a deliberate fallback.

**Files**
- Modify `src/bookmarks.ts`
- Modify `src/cli.ts`
- Modify `README.md`
- Modify any auth-related docs/help

**Changes**
- Audit all user-facing mentions of `ft sync --api` and `ft auth`.
- Keep `ft sync --api` as an explicitly labeled fallback for unsupported session environments in phase 1.
- Make the docs explicit that OAuth bookmark sync does not preserve true `bookmarkedAt`.
- Ensure the fallback path does not silently become the preferred or recommended route.
- Update operator/status wording that currently implies GraphQL and API are co-equal bookmark sync modes.

**Pattern References**
- `src/bookmarks.ts`
- `README.md`

**Test Files**
- Update `tests/bookmarks.test.ts`
- Update any CLI/auth tests touching `ft auth` or bookmark API sync

**Test Scenarios**
- Happy path: explicit compatibility-mode invocation still reaches the OAuth path.
- Edge case: docs/help communicate the tradeoff around missing bookmark-time fidelity.
- Edge case: normal bookmark sync documentation no longer implies OAuth is equivalent to GraphQL sync.

### Unit 5: Align Downstream Surfaces with the Simpler Model

**Goal**
- Make status, docs, and future unified-archive work build on the simplified bookmark contract.

**Files**
- Modify `src/bookmarks-service.ts`
- Modify `src/web-server.ts` or bookmark-related web summaries if needed
- Modify `README.md`
- Modify any onboarding or operator docs that describe bookmark sync modes

**Changes**
- Ensure status/help output distinguishes between:
  - bookmark sync health
  - bookmark repair needs or last repair run, if surfaced
- Remove stale wording that still presents bookmarks as a special-mode subsystem.
- Update architecture docs to describe bookmarks as the same ingestion class as likes/feed, with only bookmark-specific metadata differences.
- Leave future unified-archive migration hooks visible in code comments or module naming where it reduces later churn.

**Pattern References**
- `src/bookmarks-service.ts`
- `src/likes-service.ts`
- `src/feed-service.ts`
- `docs/plans/2026-04-17-009-unified-archive-foundation-plan.md`

**Test Files**
- Update `tests/bookmarks-service.test.ts`
- Update `tests/web-server.test.ts` if bookmark sync metadata is surfaced there

**Test Scenarios**
- Happy path: bookmark status remains accurate after contract simplification.
- Happy path: docs and operator guidance consistently describe one primary sync flow.
- Edge case: existing local workflows that only call `ft sync` continue to work unchanged.
- Edge case: status output no longer advertises GraphQL and API as co-equal modes when an OAuth token is present.

## BDD Acceptance Criteria

### Scenario: Primary bookmark sync remains the default

Given a user runs `ft sync --help`
When the help output is rendered
Then the command is described as the primary bookmark sync path
And `--rebuild` is shown as the only bookmark-specific advanced sync mode
And `--continue` is not listed
And `--gaps` is not listed

### Scenario: Deprecated gaps flow redirects to repair

Given a user still invokes `ft sync --gaps`
When the command is handled
Then the CLI prints a deprecation message that points to `ft bookmarks repair`
And the user is not left guessing which replacement command to use
And the command either redirects successfully or exits non-zero in a clearly documented way

### Scenario: Hidden continue flow still works during transition

Given a user explicitly invokes `ft sync --continue`
When bookmark state contains a saved cursor
Then the sync resumes from the saved position
And the CLI does not require `--continue` to appear in public help text

Given a user explicitly invokes `ft sync --continue`
When bookmark state does not contain a saved cursor
Then the sync performs the historical scan-through behavior needed to recover past the old cap
And the CLI explains that recovery behavior in operator-facing output

### Scenario: Repair is a real bookmark subcommand, not an alias loop

Given a user runs `ft bookmarks repair`
When the command is dispatched
Then the CLI executes the dedicated repair service
And it does not forward through the generic `ft bookmarks <cmd>` alias shim
And existing forwarded alias commands such as `ft bookmarks list` still map to their top-level equivalents

### Scenario: OAuth remains available but clearly secondary

Given a user has an environment where browser-session sync is unavailable
When they read `ft sync --help`, `ft auth --help`, or the README
Then OAuth is described as a fallback path
And the docs state that `ft sync --api` does not preserve true `bookmarkedAt`
And the primary sync narrative still points to browser-session GraphQL sync first

Given a user explicitly invokes `ft sync --api`
When valid OAuth credentials are configured
Then bookmark sync still succeeds through the compatibility path
And the operator-facing language does not imply that this is equivalent to the default GraphQL path

### Scenario: Status reflects the simplified contract

Given a user has synced bookmarks and also has an OAuth token configured
When they run `ft status`
Then bookmark status reports bookmark counts and recency correctly
And any sync-mode wording presents browser-session GraphQL as primary
And OAuth, if mentioned, is framed as fallback availability rather than an equal peer mode

## Sequencing and Dependencies

1. Unit 1 must land first because it defines the user-facing contract the rest of the refactor is serving.
2. Unit 2 should land before Unit 3 so the new sync service boundary exists before repair is split out.
3. Unit 3 should land before aggressive documentation cleanup so docs can point to a real replacement command.
4. Unit 4 can land with or after Unit 2, but should not be deferred so long that the old OAuth route keeps appearing as a first-class sync choice.
5. Unit 5 is the cleanup pass that aligns status/docs/web summaries with the new contract.

## Risks and Mitigations

- Risk: removing `--continue` from the public surface could strand users who rely on manual recovery.
  Mitigation: keep the underlying cursor-resume and scan-through logic intact in the service layer first; only then decide whether a hidden or redirected advanced flag is still needed.

- Risk: moving `--gaps` to a new command could break habitual operator flows.
  Mitigation: ship a deprecation alias or explicit redirect during at least one release cycle.

- Risk: de-emphasizing OAuth could make cross-platform fallback less discoverable.
  Mitigation: keep `ft auth` documented, but position it as a fallback for environments where session-based sync is unavailable or undesirable.

- Risk: bookmark-specific chronology or repair invariants could be lost if the code is over-normalized toward likes.
  Mitigation: keep bookmark ordering, `bookmarkedAt`, and repair logic in bookmark-owned modules even as the service boundary and CLI shape converge.

## Open Decisions for Implementation

- Should the hidden `--continue` compatibility flag emit a warning on every invocation, or only when the command succeeds?
- Should `ft bookmarks repair` eventually grow targeted sub-actions, or stay permanently as one combined repair pass?
- Should the OAuth fallback remain at `ft sync --api` long-term, or move to a more explicit compatibility path after the simplified contract has shipped and settled?

These are implementation-owned decisions now, not planning blockers. The plan is valid as long as the chosen outcome preserves the simplified operator model.

## Definition of Done

- Bookmark sync has one clearly documented primary path aligned with likes/feed.
- Repair/enrichment is no longer framed as bookmark sync.
- OAuth bookmark sync is clearly treated as a fallback, not a normal equivalent.
- Runtime recovery logic remains available without forcing most users to choose advanced modes manually.
- Tests cover the simplified CLI contract, the extracted sync service, and the separated repair path.
