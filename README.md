# Field Theory CLI

Sync and store locally your X/Twitter bookmarks, likes, Home timeline feed items, and tracked public account timelines. Search bookmarks and likes, browse local timelines, classify bookmarks, and make them available to Claude Code, Codex, or any agent with shell access.

Free and open source. Designed for Mac.

## Install

```bash
# Install this fork directly from GitHub
npm install -g github:Decolo/fieldtheory-cli
```

If you later publish this fork to npm, use:

```bash
npm install -g fieldtheory-cli
```

Requires Node.js 20+. Chrome recommended for session sync.

## Quick start

```bash
# 1. Sync your bookmarks (needs Chrome logged into X)
ft bookmarks sync

# 2. Sync your likes into a separate local archive
ft likes sync

# 3. Fetch your Home timeline into a local read-only feed archive
ft feed sync --max-pages 2

# 4. Sync one public account into its own separate archive
ft accounts sync @elonmusk --limit 50 --retain 90d

# 5. Search bookmarks, likes, and feed
ft bookmarks search "distributed systems"
ft likes search "distributed systems"
ft search-all "best practices on claude code"
ft search-all "claude code" --mode action

# 6. Trim old likes in throttled batches
ft likes trim --keep 200 --batch-size 25 --pause-seconds 45

# 7. Run the autonomous feed agent once, or start the recurring daemon
ft feed agent run --max-pages 1
ft feed daemon start --every 30m --candidate-limit 30 --max-pages 2
ft feed semantic status
ft feed prefs like author @alice
ft feed prefs bookmark topic "ai agents"

# 8. Explore bookmarks
ft bookmarks viz
ft web
ft bookmarks categories
ft bookmarks stats
```

On first run, `ft bookmarks sync`, `ft likes sync`, and `ft feed sync` reuse your browser session from Chrome/Firefox and download data into `~/.ft-bookmarks/`.

## Commands

### Sync

| Command | Description |
|---------|-------------|
| `ft bookmarks sync` | Download and sync bookmarks from the primary browser-session path |
| `ft bookmarks sync --rebuild` | Full history re-crawl of bookmarks |
| `ft bookmarks repair` | Repair missing quoted tweets, truncated text, and invalid bookmark dates |
| `ft bookmarks sync --classify` | Sync then classify new bookmarks with LLM |
| `ft likes sync` | Download and sync liked posts into a separate local archive |
| `ft accounts sync <handle>` | Download one public account timeline into a separate local archive |
| `ft feed sync` | Fetch Home timeline tweets into a local read-only feed archive |
| `ft feed agent run` | Sync a bounded amount of feed data, score candidates, and auto-like/bookmark matches once |
| `ft feed daemon start --every <interval>` | Run recurring feed refresh plus immediate consumption on one timer |
| `ft feed daemon status` | Show daemon status and the last structured tick summary |
| `ft feed daemon stop` | Stop the recurring daemon process |
| `ft feed daemon log` | Show daemon state plus the redacted append-only log location |
| `ft feed semantic status` | Show embedding provider config and local vector coverage |
| `ft feed semantic rebuild` | Rebuild vectors for feed, likes, bookmarks, and topic preferences |
| `ft feed prefs show` | Show explicit feed preference rules |
| `ft feed prefs like <kind> <value>` | Prefer an author, domain, or topic for auto-like |
| `ft feed prefs dislike <kind> <value>` | Avoid an author, domain, or topic for auto-like |
| `ft feed prefs bookmark <kind> <value>` | Prefer an author, domain, or topic for auto-bookmark |
| `ft feed prefs avoid-bookmark <kind> <value>` | Avoid an author, domain, or topic for auto-bookmark |
| `ft feed prefs remove <mode> <kind> <value>` | Remove one explicit feed preference rule |

### Search and browse

| Command | Description |
|---------|-------------|
| `ft bookmarks search <query>` | Full-text bookmark search with BM25 ranking |
| `ft search-all <query>` | Hybrid search across feed, likes, and bookmarks |
| `ft bookmarks list` | Filter by author, date, category, domain |
| `ft bookmarks show <id>` | Show one bookmark in detail |
| `ft bookmarks add <id>` | Create one bookmark on X |
| `ft bookmarks unbookmark <id>` | Remove a bookmark on X and update the local bookmark archive |
| `ft likes search <query>` | Full-text search across liked posts |
| `ft likes list` | Filter liked posts by query, author, and like date |
| `ft likes show <id>` | Show one liked post in detail |
| `ft likes unlike <id>` | Unlike a post on X and update the local likes archive |
| `ft likes trim` | Keep only the latest likes and unlike older posts on X in throttled batches |
| `ft likes status` | Show likes archive status |
| `ft accounts status <handle>` | Show one tracked account archive status |
| `ft accounts list <handle>` | Browse cached tweets for one tracked account |
| `ft accounts show <handle> <id>` | Show one cached tracked-account tweet in detail |
| `ft feed list` | Browse cached Home timeline tweets with local paging |
| `ft feed show <id>` | Show one cached feed item in detail |
| `ft feed status` | Show feed archive status |
| `ft feed agent status` | Show cumulative autonomous-agent totals and local artifact paths |
| `ft feed agent log` | Show recent autonomous likes, bookmarks, and skips |
| `ft web` | Launch a local web UI for hybrid search plus archive browsing |
| `ft bookmarks sample <category>` | Random sample from a category |
| `ft bookmarks stats` | Top authors, languages, date range |
| `ft bookmarks viz` | Terminal dashboard with sparklines, categories, and domains |
| `ft bookmarks categories` | Show category distribution |
| `ft bookmarks domains` | Subject domain distribution |

### Classification

| Command | Description |
|---------|-------------|
| `ft bookmarks classify` | Classify by category and domain using LLM |
| `ft bookmarks classify --regex` | Classify by category using simple regex |
| `ft bookmarks classify-domains` | Classify by subject domain only (LLM) |
| `ft bookmarks model` | View or change the default LLM engine |

### Knowledge base

| Command | Description |
|---------|-------------|
| `ft md` | Export bookmarks as individual markdown files |
| `ft wiki` | Compile a Karpathy-style interlinked knowledge base |
| `ft ask <question>` | Ask questions against the knowledge base |
| `ft ask <question> --save` | Ask and save the answer as a concept page |
| `ft lint` | Health-check the wiki for broken links and missing pages |
| `ft lint --fix` | Auto-fix fixable wiki issues |

### Agent integration

| Command | Description |
|---------|-------------|
| `ft skill install` | Install `/fieldtheory` skill for Claude Code and Codex |
| `ft skill show` | Print skill content to stdout |
| `ft skill uninstall` | Remove installed skill files |

### Utilities

| Command | Description |
|---------|-------------|
| `ft bookmarks index` | Rebuild search index from JSONL cache (preserves classifications) |
| `ft bookmarks model` | View or change the default LLM engine for bookmark classification |
| `ft likes index` | Rebuild the likes search index from the likes cache |
| `ft bookmarks fetch-media` | Download media assets (static images only) |
| `ft bookmarks status` | Show sync status and data location |
| `ft path` | Print data directory path |

## Agent integration

Install the `/fieldtheory` skill so your agent automatically searches your bookmarks when relevant:

```bash
ft skill install     # Auto-detects Claude Code and Codex
```

Then ask your agent:

> "What have I bookmarked about cancer research in the last three years and how has it progressed?"

> "I bookmarked a number of new open source AI memory tools. Pick the best one and figure out how to incorporate it in this repo."

> "Every day please sync any new X bookmarks using the Field Theory CLI."

Works with Claude Code, Codex, or any agent with shell access.

## Scheduling

```bash
# Sync every morning at 7am
0 7 * * * ft bookmarks sync

# Sync and classify every morning
0 7 * * * ft bookmarks sync --classify

# Refresh feed and auto-like/bookmark matching items every 30 minutes via cron
*/30 * * * * ft feed agent run --max-pages 1

# Refresh one tracked public account every 20 minutes and keep only the last 30 days locally
*/20 * * * * ft accounts sync @elonmusk --limit 50 --retain 30d

# Or keep one daemon process alive
ft feed daemon start --every 30m --candidate-limit 30 --max-pages 2
```

`ft accounts sync` is explicit per account in v1. It stores data under a separate `accounts/<user-id>/` archive, prunes rows older than the `--retain` window during sync, and does not add tracked-account tweets into `ft search-all` yet.

## Data

All data is stored locally at `~/.ft-bookmarks/`:

```
~/.ft-bookmarks/
  bookmarks.jsonl         # raw bookmark cache (one per line)
  bookmarks.db            # SQLite FTS5 search index
  bookmarks-meta.json     # sync metadata
  bookmarks-backfill-state.json
  likes.jsonl             # raw likes archive cache (one per line)
  likes.db                # SQLite FTS5 search index for likes
  likes-meta.json         # likes sync metadata
  likes-backfill-state.json
  accounts-registry.json   # local handle -> user-id registry for tracked accounts
  accounts/
    44196397/
      timeline.jsonl       # raw tracked-account timeline cache
      timeline.db          # SQLite index for one account timeline
      timeline-meta.json   # last sync summary, retention, latest tweet snapshot
      timeline-state.json  # sync checkpoint state for one account
  feed.jsonl              # raw Home timeline cache (tweet-only entries)
  feed.db                 # SQLite index for local feed browsing
  feed-meta.json          # feed sync metadata
  feed-state.json
  archive.jsonl           # canonical unified archive cache with source attachments
  archive.db              # unified archive index for web/search/assistant consumers
  feed-agent-state.json   # cumulative autonomous action state and idempotency
  feed-agent-log.jsonl    # append-only autonomous action log
  feed-daemon-state.json  # recurring daemon status and last tick summary
  feed-daemon.log         # append-only daemon loop log
  semantic.lance/         # local LanceDB vector store for semantic feed retrieval
  semantic-meta.json      # embedding provider/model and semantic coverage counts
  md/                     # markdown knowledge base (ft wiki / ft md)
```

Override the location with `FT_DATA_DIR`:

```bash
export FT_DATA_DIR=/path/to/custom/dir
```

To remove all data: `rm -rf ~/.ft-bookmarks`

Likes are intentionally a separate archive in v1. Feed items are also a separate archive family in v1. Archive-specific list/show flows stay separate, while `ft search-all` and the local web UI now provide one mixed-source hybrid search surface across feed, likes, and bookmarks.

Single-item remote cleanup is also supported:

```bash
ft unbookmark <tweet-id>
ft likes unlike <tweet-id>
```

Both commands reuse your browser-authenticated X web session, then reconcile the matching local archive entry and index. Remote write actions now apply one conservative retry policy for transient failures only: network/transport errors, HTTP `429`, and HTTP `5xx` are retried up to 2 extra times with short `1s -> 3s` backoff, while auth failures such as `401/403` still fail fast. Bookmark-create `404` responses are now surfaced as likely X web contract/header mismatches rather than being mislabeled as temporary upstream issues.

For bulk likes cleanup, use the formal trim command:

```bash
ft likes trim --keep 200 --batch-size 25 --pause-seconds 45
```

The command recomputes the trim set from your current local archive on each run, so it is safe to resume after an interruption. It unlikes older posts on X in batches, rewrites `likes.jsonl`, updates `likes-meta.json`, and rebuilds `likes.db` once per batch.

## Autonomous feed actions

Use `feed agent run` for a one-shot pass, or `feed daemon start` for the recurring fetch-then-consume loop:

```bash
# One real run
ft feed agent run --max-pages 1

# Keep running every 30 minutes
ft feed daemon start --every 30m --candidate-limit 30 --max-pages 2

# Inspect or stop the daemon
ft feed daemon status
ft feed daemon stop

# Inspect or rebuild semantic retrieval state
ft feed semantic status
ft feed semantic rebuild

# Inspect cumulative state and recent actions
ft feed agent status
ft feed agent log --limit 20

# Show or edit explicit preferences
ft feed prefs show
ft feed prefs like author @alice
ft feed prefs dislike domain example.com
ft feed prefs bookmark topic "ai agents"
ft feed prefs avoid-bookmark domain example.com

# Preview what would happen without sending remote actions
ft feed agent run --max-pages 1 --dry-run
```

Semantic feed matching is embedding-based. By default the CLI is preconfigured for Aliyun Bailian `text-embedding-v4` through its OpenAI-compatible embeddings API.

```bash
export FT_EMBEDDING_API_KEY=...
# optional overrides
export FT_EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export FT_EMBEDDING_MODEL=text-embedding-v4
export FT_EMBEDDING_PROVIDER=aliyun-bailian
export FT_EMBEDDING_BATCH_SIZE=32
```

The daemon runs one simple loop: refresh feed, hand just the newly seen items to the consumer, then persist a tick summary. The consumer combines explicit rules with locally inferred history from existing likes and bookmarks. Explicit rules win. Each run can:

- sync a bounded amount of fresh feed data
- score newly discovered feed items against explicit rules plus historical likes and bookmarks via local vector search
- auto-like and auto-bookmark strong matches on X
- avoid replaying already-successful actions for the same tweet/action pair
- write durable local state and append-only logs for later inspection

`ft feed daemon status` shows whether the recurring loop is alive plus the last stage, outcome, error kind, duration, and redacted summary for the most recent tick. `feed-daemon.log` remains an append-only local artifact for stage-by-stage follow-up, but transport secrets are redacted before errors reach status/log output. `ft feed semantic status` shows whether embeddings are configured and how much local vector coverage exists. `ft feed agent status` and `ft feed agent log` show cumulative action history, including when an action needed multiple attempts before succeeding or finally failed. `--dry-run` is useful when tuning thresholds and explicit preferences before letting the system act live.

## Hybrid search

Use the new mixed-source search command when you want topic discovery instead of exact archive-by-archive matching:

```bash
# Topic relevance across feed + likes + bookmarks
ft search-all "claude code"

# Use action-worthiness ranking to prioritize items you'd likely like/bookmark
ft search-all "claude code" --mode action

```

`ft search-all` stays local-first. It uses SQLite/FTS candidate retrieval across feed, likes, and bookmarks, then reranks locally. No LLM is required for the hybrid search path.

## Web UI

Build and launch the local web UI:

```bash
npm run build
node dist/cli.js web
```

Or during development:

```bash
npm run build
tsx src/cli.ts web
```

The web UI is local-only by default and binds to `127.0.0.1`. It serves the built frontend assets, so run `npm run build` at least once before starting `ft web`.

The default web view is now search-first:

- search across feed, likes, and bookmarks in one result list
- switch between `topic` and `action` ranking
- keep bookmarks/likes archive browsing available as separate tabs
- keep the list pane and detail pane independently scrollable on desktop

## Categories

| Category | What it catches |
|----------|----------------|
| **tool** | GitHub repos, CLI tools, npm packages, open-source projects |
| **security** | CVEs, vulnerabilities, exploits, supply chain |
| **technique** | Tutorials, demos, code patterns, "how I built X" |
| **launch** | Product launches, announcements, "just shipped" |
| **research** | ArXiv papers, studies, academic findings |
| **opinion** | Takes, analysis, commentary, threads |
| **commerce** | Products, shopping, physical goods |

Use `ft bookmarks classify` for LLM-powered classification that catches what regex misses.

## Platform support

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Session sync (`ft bookmarks sync`, `ft likes sync`) | Chrome, Brave, Arc, Firefox | Firefox | Firefox |
| Search, list, likes archive | Yes | Yes | Yes |
| Bookmark classify, viz, wiki | Yes | Yes | Yes |

Session sync extracts cookies from your browser's local database. Use `ft bookmarks sync --browser <name>` to pick a browser.

## Security

**Your data stays local.** No telemetry, no analytics, nothing phoned home. The CLI only makes network requests to X's API during sync.

**Chrome session sync** reads cookies from Chrome's local database, uses them for the sync request, and discards them. Cookies are never stored separately.

**The default bookmark sync uses X's internal GraphQL API**, the same API that x.com uses in your browser.

**The likes archive sync also uses your browser-authenticated X web session.** In v1 it is browser-session based only; there is no OAuth likes sync path yet.

**The feed archive sync uses the same browser-authenticated X web session path.** In v1 it is read-only, CLI-first, and stores tweet-only Home timeline entries for local browsing.

**Remote unlike, unbookmark, likes trim, and feed-agent auto-actions use the same browser-authenticated X web session path.** On success, the CLI also reconciles the matching local cached records and rebuilds the relevant search index. Single-item remote write actions now retry only transient failures (`network`, `429`, `5xx`) with bounded backoff before surfacing an error.

## License

MIT — [fieldtheory.dev/cli](https://fieldtheory.dev/cli)

## Star History

<a href="https://www.star-history.com/?repos=afar1%2Ffieldtheory-cli&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&legend=top-left" />
 </picture>
</a>
