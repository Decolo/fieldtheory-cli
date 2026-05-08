# Account Research CLI Capabilities

Date: 2026-05-09

## Context

The immediate user workflow is: sync a tracked public X account, search that account's local tweets within a time range, find investment advice or predictions, and summarize the evidence with tweet URLs.

The current CLI already supports:

- `ft accounts sync <handle>`
- `ft accounts export <handle> --after --before`
- `ft accounts list <handle>`
- `ft accounts show <handle> <id>`
- `ft search-all <query>` across feed, likes, and bookmarks only

The account timeline index currently stores account tweets in SQLite but has no FTS table and is not included in `search-all`.

## Evaluated Ideas

### 1. Add `ft accounts search <handle> <query>`

Status: Strongest next feature.

Why it matters: This directly addresses the repeated workflow gap. Users should not need to export JSON and write ad hoc scripts just to ask "what did this account say about X in 2026?"

Scope:

- Add FTS5 indexing to `accounts/<user-id>/timeline.db`.
- Support `--after`, `--before`, `--limit`, `--json`.
- Search only one tracked account by default.
- Return date, handle, text snippet, and URL.

Risks:

- Chinese tokenization with default SQLite FTS5 `unicode61` may be weak for semantic Chinese search.
- Still valuable for tickers, English, exact Chinese phrases, and boolean queries.

Verdict: Do first. It is low complexity and high leverage.

### 2. Add `ft accounts grep <handle> --terms ...`

Status: Useful but probably redundant after `accounts search`.

Why it matters: Keyword recall is exactly what we did manually for investment research. It is easy to explain and scriptable.

Better shape:

- Make it a mode or option on `accounts search`, not a separate command.
- Example: `ft accounts search @LinQingV --terms 投资,看好,风险,$INTC --after 2026-01-01`.

Verdict: Fold into `accounts search` if possible.

### 3. Add `ft accounts export --jsonl`

Status: Small, high-quality DX improvement.

Why it matters: JSONL is much easier for local pipelines, `rg`, `jq`, and batch LLM workflows than one giant JSON document. It also avoids EPIPE-prone `head` workflows on large JSON output.

Scope:

- `ft accounts export @handle --after ... --before ... --format jsonl`
- One tweet per line.
- Keep the existing JSON envelope as default for backward compatibility.

Verdict: Do near-term. It is cheap and compounds with search/summarization.

### 4. Include tracked accounts in `ft search-all`

Status: Valuable, but not first.

Why it matters: Eventually, tracked account timelines should be first-class archive sources alongside bookmarks, likes, and feed.

Why not first:

- Search-all currently has source semantics built around feed/likes/bookmarks.
- Account timelines are person-scoped. Querying "all tracked accounts" and ranking by source raises product questions: Which accounts? How are account sources shown? Should account tweets compete with bookmarks?

Verdict: Do after single-account search is solid.

### 5. Add `ft accounts brief <handle> --topic ...`

Status: High user value, but should depend on search first.

Why it matters: This is the workflow the user actually wants: "tell me this account's view on a topic, with sources."

Required shape:

- Local retrieval first.
- Explicit evidence list with tweet URLs.
- Model provider config optional, similar to existing classify flows.
- Refuse or say "not enough evidence" when retrieval is thin.

Risks:

- Without a retrieval layer, this becomes a brittle "summarize everything" feature.
- Needs strict citation discipline so it does not hallucinate advice.

Verdict: Strong second-phase feature after `accounts search`.

### 6. Add semantic embeddings for account timelines

Status: Premature.

Why it matters: Chinese semantic search and vague topic queries would benefit from embeddings.

Why not now:

- Existing local-first CLI already gets a lot from FTS + keyword/ticker recall.
- Embeddings introduce provider config, storage, refresh semantics, model drift, cost, and privacy questions.
- The user need can be satisfied first with lexical search plus LLM summarization.

Verdict: Park it. Revisit after FTS search and brief workflows are used.

### 7. Improve account sync transport/rate-limit ergonomics

Status: Important support work.

Why it matters: Research quality depends on reliable local archives. The recent run showed practical problems: proxy routing, SSL timeouts, 429s, long historical backfills.

Scope:

- `FT_X_USE_CURL=1` or a CLI option like `--transport curl`.
- Stop gracefully on 429 after saving checkpoint.
- Make `--backfill-all --limit 200` the documented safe historical backfill pattern.
- Consider clearer command split: default newer-only sync vs historical backfill.

Verdict: Do alongside search work, because users will hit it while building account corpora.

## Recommended Priority

1. Build `ft accounts search`.
2. Add `accounts export --format jsonl`.
3. Improve 429/checkpoint messaging for account sync.
4. Build `ft accounts brief` on top of `accounts search`.
5. Later, include accounts in `search-all`.
6. Later still, consider embeddings.

## Rejected Or Deferred

- Full semantic search first: too much infrastructure before proving the workflow.
- Separate `accounts grep` command: useful behavior, but likely belongs inside `accounts search`.
- Summarization without retrieval: too likely to produce unsupported conclusions.

