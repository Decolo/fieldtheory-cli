---
date: 2026-04-19
topic: x-feed-collection-reset
supersedes:
  - docs/brainstorms/2026-04-12-x-feed-requirements.md
---

# X Feed Collection Reset

## Problem Frame

The current feed direction is misaligned with the repo's newer product boundary. `ft feed agent` and related feed preference surfaces were introduced to automate `like` and `bookmark` actions, but the newer direction is to keep the CLI deterministic and local-first while letting skills and agents handle intent, evaluation, and human-like workflow orchestration.

That means the feed product should stop pretending to be an autonomous actor. The feed layer should become a reliable collection substrate: sync Home timeline data, keep it queryable locally, and later enrich it with interaction context such as replies and comments. Agent behavior should move up into skills that call stable CLI capabilities instead of being embedded into the feed runtime itself.

```text
ft feed sync / ft feed daemon
        |
        v
collect local feed archive
        |
        v
collect conversation context
        |
        v
skill reads local data
        |
        v
agent evaluates intent, quality, and possible actions
```

## Requirements

**Product Boundary Reset**
- R1. The feed CLI must be repositioned as a local collection capability, not as an autonomous action agent.
- R2. The product must remove the `ft feed agent` command family rather than preserving it as a compatibility shell or renamed dry-run surface.
- R3. The feed CLI must no longer present automatic `like` or `bookmark` behavior as part of feed sync or daemon operation.
- R4. Remote `like` and `bookmark` capabilities may continue to exist only as explicit low-level action primitives, not as actions triggered automatically by feed collection workflows.

**Plan A: Feed Collection Reset**
- R5. `ft feed sync` must remain the primary explicit command for collecting Home timeline data into the local feed archive.
- R6. `ft feed daemon` must be narrowed to recurring collection only; its product language, status output, and operator expectations must no longer imply immediate consumption, scoring, or action-taking.
- R7. The first implementation plan must remove or rewrite feed surfaces whose meaning depends on auto-like or auto-bookmark behavior, including feed preference management and related action-oriented status or log views.
- R8. Existing local feed archive value must remain intact after the reset: users must still be able to sync, inspect status, browse items, and use feed data in cross-archive search.

**Plan B: Conversation Context Collection**
- R9. The second implementation plan must extend feed collection so locally stored feed items can include valuable conversation context from replies or comments when that context exists.
- R10. Conversation context collection should apply not only to original tweets, but also to reposted or quoted content when the surrounding discussion adds meaning to the item.
- R11. The goal of collected comments is to preserve evidence of real interaction and audience reaction, not to create a new autonomous engagement feature.
- R12. The product should preserve room for later filtering or ranking of low-value or AI-like comments, but the first conversation-context plan does not need to solve comment-quality judgment perfectly.

**Skill-Layer Responsibility**
- R13. Intent inference, content evaluation, and "act like a human" workflow logic must live in the installed skill layer rather than in feed sync or daemon commands.
- R14. The feed CLI should expose stable, reusable local-data capabilities that future skills can compose, rather than embedding one opinionated agent loop into the runtime.
- R15. The post-reset product direction should support a later skill that evaluates feed items and conversation context, but that skill is explicitly out of scope for these first two plans.

## Success Criteria
- The feed product surface no longer implies that syncing feed data will autonomously like or bookmark tweets.
- Users can still run `ft feed sync` and `ft feed daemon` as reliable local collection tools without losing feed archive utility.
- The roadmap is clearly split into two follow-on implementation plans: first reset feed to collection-only behavior, then add conversation-context collection.
- The CLI-to-skill boundary becomes coherent with the newer account research direction: CLI for deterministic local data, skill for agent workflow and evaluation.

## Scope Boundaries
- These requirements do not define the exact implementation shape of feed daemon internals, storage changes, or command-level migration mechanics.
- These requirements do not require shipping a feed-evaluation skill in the same phase as the collection reset.
- These requirements do not require perfect detection of spammy, synthetic, or AI-generated comments in the first conversation-context phase.
- These requirements do not remove explicit remote action primitives from the repo if they remain useful elsewhere; they only remove autonomous actioning from the feed collection product.

## Key Decisions
- Remove `feed agent` outright: preserving the name would keep the old product framing alive and blur ownership between CLI collection and agent behavior.
- Remove feed preference management with the reset: keeping action-oriented preferences would reintroduce the same ambiguity through a different surface.
- Split the work into two plans: deleting auto-action semantics and collecting conversation context are different product changes with different risks.
- Keep the CLI deterministic and let skills orchestrate intent: this matches the direction already established by the newer account research workflow.
- Treat comments as context, not engagement targets: their value is as evidence for later interpretation, not as another object for automation.
- Align feed with the broader product boundary set on 2026-04-19: this should be treated as the feed-side application of the same "CLI for stable local data, skill for agent workflow" model already chosen elsewhere in the repo.

## Dependencies / Assumptions
- Verified assumption: the repo currently exposes `ft feed sync`, `ft feed daemon`, `ft feed agent`, and `ft feed prefs` surfaces in `src/cli.ts`.
- Verified assumption: the current feed CLI language still describes daemon behavior in terms of refresh plus consumption, and feed preferences in terms of auto-like and auto-bookmark decisions.
- Verified assumption: the repo already preserves local feed archive and browsing/search capabilities through existing feed sync, feed archive, and hybrid search surfaces.
- Assumption: reply/comment retrieval for feed items is feasible enough to justify a dedicated second plan, but the exact X data-access path should be decided during planning.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R6][Technical] What is the cleanest replacement command/help/status language for `ft feed daemon` once "consume" semantics are removed?
- [Affects R7][Technical] Which existing feed status and log artifacts should be deleted outright versus retained as collection-oriented observability?
- [Affects R9][Needs research] What X data-access path is best suited for retrieving replies/comments related to locally archived feed items?
- [Affects R10][Technical] How should conversation context be bounded so collection stays useful without exploding runtime or storage cost?
- [Affects R12][Technical] What minimal metadata should be stored now so later skill-layer quality filtering can reason about likely low-value comments?

## Next Steps
→ `/prompts:ce-plan` for structured implementation planning
