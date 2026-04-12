---
date: 2026-04-12
topic: x-feed
---

# X Feed

## Problem Frame
The current CLI already syncs X bookmarks and likes into a local archive, supports remote unlike and unbookmark actions, and exposes a local web viewer. The next opportunity is to extend the same session-backed GraphQL approach to the Home timeline so the tool can help the user inspect feed content, archive it locally, and later rank or act on it using the user's historical likes and bookmarks.

The user wants to start with a minimal feed viewer first, while preserving a path toward feed archiving, feed triage, smart digest generation, and recommendation-driven like/bookmark actions.

For phase 1, the immediate user job is to inspect the Home timeline from the terminal without needing to stay inside x.com, and to make the feed accessible to later local workflows. The minimum visible benefit over the native X timeline is a CLI-native, scriptable, read-only view that can later connect to local search, digest, and action workflows.

## Requirements

**Phase 1: Feed Viewer**
- R1. The product must support a read-only Home timeline workflow as the first phase.
- R2. The first phase must preserve the current design principle of reusing the local logged-in X browser session and the existing GraphQL-based fetch pattern.
- R3. The first phase must focus on viewing feed items rather than immediately becoming a full X client replacement.
- R4. The phase-1 feed viewer must be CLI-first as the canonical surface.
- R5. Any web-based feed viewing is deferred until after the CLI-first phase is proven useful.
- R6. Phase 1 only needs to support tweet entries from the Home timeline.
- R7. Non-tweet entries such as promoted units, modules, and other unsupported timeline containers may be skipped in phase 1 rather than rendered.
- R8. Phase 1 should fetch Home timeline tweets and cache the fetched batch locally rather than treating the viewer as stdout-only.
- R9. Phase 1 should support paged browsing across fetched Home timeline results rather than limiting the user to a single fetched batch.

**Future Expansion**
- R10. The design must preserve stable item identity so later feed archive, triage, and digest features can refer to the same feed items without rethinking identifiers.
- R11. The design must preserve a separation between feed fetching, local storage, and remote actions so later automation does not force a redesign of the fetch path.
- R12. The design must allow a later feed archive capability that stores fetched Home timeline items locally for search, recall, and web viewing.
- R13. The design must allow a later feed triage capability where feed items become a queue for defer, ignore, or action decisions.
- R14. The design must allow a later smart digest capability that ranks, summarizes, and filters feed items instead of simply replaying raw timeline order.

**Recommendation and Action Loop**
- R15. Future feed features must be able to use the user's historical likes and bookmarks as signals for ranking or recommendation.
- R16. The future product direction should support recommendation-driven decisions about whether a feed item is worth liking or bookmarking.
- R17. Recommendations may suggest actions, but execution should remain user-confirmed unless a later requirements document explicitly changes that rule.
- R18. The product direction should preserve a path from recommendation to execution, including later support for applying like and bookmark actions to feed items.

## Success Criteria
- A user can view their Home timeline from the terminal in a way that is meaningfully useful even before archive and digest features exist.
- A user can fetch and continue browsing multiple pages of Home timeline tweets from the CLI without opening the web app.
- A planner can design a phase-1 feed viewer without inventing the overall product direction.
- The future feed archive, triage, digest, and recommendation concepts are recorded so they are not lost between sessions.
- The remaining open questions are explicit enough that the next brainstorm step can narrow phase-1 scope cleanly.

## Scope Boundaries
- Phase 1 is not a full-featured X client.
- Phase 1 does not need to include autonomous like or bookmark execution.
- Phase 1 does not need to render promoted or non-tweet timeline modules.
- Phase 1 local caching does not yet make the feature a full feed archive product with search, retention policy, or web browsing requirements.
- This brainstorm does not yet define implementation details such as GraphQL operation names, storage schemas, endpoint shapes, or UI structure.

## Key Decisions
- Start with viewer first: The user wants the first increment to be a read-only Home timeline capability.
- CLI first: phase 1 should ship as a terminal-first experience, with web deferred.
- Preserve the broader roadmap: Feed archive, feed triage, smart digest, and recommendation-driven actions remain in scope as follow-on directions and should influence the design.
- Use historical signals later: Likes and bookmarks should become core ranking signals for future recommendation and assistive action flows.
- Keep humans in the loop: future feed-driven like and bookmark actions should remain user-confirmed unless a later document explicitly expands to automation.

## Dependencies / Assumptions
- Verified assumption: the current codebase already uses browser-session-backed requests to `x.com/i/api/graphql/...` for bookmarks and likes.
- Verified assumption: the current codebase already has a local web viewer for archived bookmarks and likes.
- Unverified assumption: X still exposes a Home timeline GraphQL surface that is accessible with the same session model and acceptable request headers.

Pre-planning gate:
- Validate that Home timeline access still works with the current session model before committing to implementation scope.
- If Home timeline access is not viable, stop and reframe the feature around another accessible feed-like surface instead of forcing the current concept.

## Outstanding Questions

### Resolve Before Planning
- None currently.

### Deferred to Planning
- [Affects R2][Technical] Which Home timeline GraphQL operation and cursor shape should be used for reliable feed fetching?
- [Affects R12][Technical] If feed archiving follows, should feed items live in a dedicated archive or share infrastructure patterns with likes and bookmarks while keeping separate storage?
- [Affects R14][Needs research] What ranking and summarization strategy is strong enough for a smart digest without introducing excessive complexity or model cost?
- [Affects R18][Needs research] What guardrails should exist before recommendation-driven like and bookmark execution becomes user-facing automation?

## Next Steps
→ `/prompts:ce-plan` for structured implementation planning
