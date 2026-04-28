# Field Theory CLI

Sync and store locally your X/Twitter bookmarks, likes, Home timeline feed items, and tracked public account timelines. Search bookmarks and likes, browse local timelines, and make them available to Claude Code, Codex, or any agent with shell access.

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

# 5. Export one tracked account archive for downstream analysis
ft accounts export @elonmusk --after 2026-01-01 --before 2026-04-01 --out elonmusk.json

# 6. Search bookmarks, likes, and feed
ft bookmarks search "distributed systems"
ft likes search "distributed systems"
ft search-all "best practices on claude code"
ft search-all "claude code" --mode action

# 7. Trim older archives in controlled batches
ft likes trim --keep 200 --batch-size 25 --pause-seconds 45
ft bookmarks trim --keep 500 --batch-size 25 --pause-seconds 45
ft feed trim --keep 5000

# 8. Start the recurring feed collection daemon
ft feed daemon start --every 30m --max-pages 2

# 9. Explore archives
ft bookmarks viz
ft likes viz
ft web
ft bookmarks stats
ft likes stats
```

On first run, `ft bookmarks sync`, `ft likes sync`, and `ft feed sync` reuse your browser session from Chrome/Firefox and download data into `~/.ft-bookmarks/`.

## Commands

### Sync

| Command | Description |
|---------|-------------|
| `ft bookmarks sync` | Download and sync bookmarks from the primary browser-session path |
| `ft bookmarks sync --rebuild` | Full history re-crawl of bookmarks |
| `ft bookmarks repair` | Repair missing quoted tweets, truncated text, and invalid bookmark dates |
| `ft likes sync` | Download and sync liked posts into a separate local archive |
| `ft likes repair` | Repair missing quoted tweets and truncated text in liked posts |
| `ft accounts sync <handle>` | Download one public account timeline into a separate local archive |
| `ft feed sync` | Fetch Home timeline tweets into a local read-only feed archive |
| `ft feed daemon start --every <interval>` | Run recurring feed refresh on one timer |
| `ft feed daemon status` | Show daemon status and the last structured tick summary |
| `ft feed daemon stop` | Stop the recurring daemon process |
| `ft feed daemon log` | Show daemon state plus the redacted append-only log location |

### Search and browse

| Command | Description |
|---------|-------------|
| `ft bookmarks search <query>` | Full-text bookmark search with BM25 ranking |
| `ft search-all <query>` | Hybrid search across feed, likes, and bookmarks |
| `ft bookmarks list` | Filter by author and date |
| `ft bookmarks show <id>` | Show one bookmark in detail |
| `ft bookmarks add <id>` | Create one bookmark on X |
| `ft bookmarks unbookmark <id>` | Remove a bookmark on X and update the local bookmark archive |
| `ft bookmarks trim` | Keep only the latest bookmarks and unbookmark older posts on X in throttled batches |
| `ft likes search <query>` | Full-text search across liked posts |
| `ft likes list` | Filter liked posts by query, author, and like date |
| `ft likes show <id>` | Show one liked post in detail |
| `ft likes add <id>` | Like a post on X and update the local likes archive |
| `ft likes unlike <id>` | Unlike a post on X and update the local likes archive |
| `ft likes trim` | Keep only the latest likes and unlike older posts on X in throttled batches |
| `ft likes status` | Show likes archive status |
| `ft likes stats` | Top liked authors, languages, date range |
| `ft likes viz` | Terminal dashboard with sparklines and liked-post patterns |
| `ft accounts export <handle>` | Export one tracked account archive as JSON for agent or research workflows |
| `ft accounts status <handle>` | Show one tracked account archive status |
| `ft accounts list <handle>` | Browse cached tweets for one tracked account |
| `ft accounts show <handle> <id>` | Show one cached tracked-account tweet in detail |
| `ft feed list` | Browse cached Home timeline tweets with local paging |
| `ft feed show <id>` | Show one cached feed item in detail |
| `ft feed status` | Show feed archive status |
| `ft feed trim` | Keep only the latest cached feed items and remove older local entries |
| `ft web` | Launch a local web UI for hybrid search plus archive browsing |
| `ft bookmarks stats` | Top authors, languages, date range |
| `ft bookmarks viz` | Terminal dashboard with sparklines and archive patterns |

### Agent integration

| Command | Description |
|---------|-------------|
| `ft skill install` | Install `/fieldtheory` skill for Claude Code and Codex |
| `ft skill show` | Print skill content to stdout |
| `ft skill uninstall` | Remove installed skill files |

### Utilities

| Command | Description |
|---------|-------------|
| `ft bookmarks index` | Rebuild search index from JSONL cache (preserves local enrichment fields) |
| `ft likes index` | Rebuild the likes search index from the likes cache |
| `ft bookmarks fetch-media` | Download bookmark media assets |
| `ft likes fetch-media` | Download liked-post media assets |
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

# Refresh feed every 30 minutes via cron
*/30 * * * * ft feed sync --max-pages 1

# Refresh one tracked public account every 20 minutes and keep only the last 30 days locally
*/20 * * * * ft accounts sync @elonmusk --limit 50 --retain 30d

# Or keep one daemon process alive
ft feed daemon start --every 30m --max-pages 2
```

`ft accounts sync` is explicit per account in v1. It stores data under a separate `accounts/<user-id>/` archive, prunes rows older than the `--retain` window during sync, and does not add tracked-account tweets into `ft search-all` yet.

`ft accounts export` stays local-first. It reads one tracked account's existing local archive, filters by `--after` / `--before` in `YYYY-MM-DD` format, and emits JSON for downstream agent or research workflows. It does not perform sync or LLM analysis itself.

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
  feed-daemon-state.json  # recurring daemon status and last tick summary
  feed-daemon.log         # append-only daemon loop log
```

Override the location with `FT_DATA_DIR`:

```bash
export FT_DATA_DIR=/path/to/custom/dir
```

If you used an older build that created `~/.ft-bookmarks/following/`, that directory is now legacy data and can be removed manually.

To remove all data: `rm -rf ~/.ft-bookmarks`

Likes are intentionally a separate archive in v1. Feed items are also a separate archive family in v1. Archive-specific list/show flows stay separate, while `ft search-all` and the local web UI now provide one mixed-source hybrid search surface across feed, likes, and bookmarks.

Single-item remote cleanup is also supported:

```bash
ft unbookmark <tweet-id>
ft likes unlike <tweet-id>
```

Both commands reuse your browser-authenticated X web session, then reconcile the matching local archive entry and index. Remote write actions now apply one conservative retry policy for transient failures only: network/transport errors, HTTP `429`, and HTTP `5xx` are retried up to 2 extra times with short `1s -> 3s` backoff, while auth failures such as `401/403` still fail fast. Bookmark-create `404` responses are now surfaced as likely X web contract/header mismatches rather than being mislabeled as temporary upstream issues.

For bulk cleanup, use the formal trim commands:

```bash
ft likes trim --keep 200 --batch-size 25 --pause-seconds 45
ft bookmarks trim --keep 500 --batch-size 25 --pause-seconds 45
ft feed trim --keep 5000
```

The likes and bookmarks trim commands recompute their trim set from the current local archive on each run, so they are safe to resume after an interruption. They unlike/unbookmark older posts on X in batches, rewrite the matching JSONL/meta files, and rebuild the matching SQLite index once per batch. `ft feed trim` is local-only: it removes older cached Home timeline items, prunes matching feed context bundles, updates `feed-meta.json`, and rebuilds `feed.db`.

## Feed collection daemon

Use `feed daemon start` when you want recurring Home timeline collection:

```bash
# Keep running every 30 minutes
ft feed daemon start --every 30m --max-pages 2

# Inspect or stop the daemon
ft feed daemon status
ft feed daemon stop
```

The daemon runs one simple loop: refresh feed, then persist a tick summary. Each run can:

- sync a bounded amount of fresh feed data
- write durable local collection state and append-only logs for later inspection

`ft feed daemon status` shows whether the recurring loop is alive plus the last stage, outcome, error kind, duration, and redacted summary for the most recent tick. `feed-daemon.log` remains an append-only local artifact for stage-by-stage follow-up, but transport secrets are redacted before errors reach status/log output.

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

## Platform support

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Session sync (`ft bookmarks sync`, `ft likes sync`) | Chrome, Brave, Arc, Firefox | Firefox | Firefox |
| Search, list, likes archive | Yes | Yes | Yes |
| Bookmark viz, web UI, tracked-account export | Yes | Yes | Yes |

Session sync extracts cookies from your browser's local database. Use `ft bookmarks sync --browser <name>` to pick a browser.

## Security

**Your data stays local.** No telemetry, no analytics, nothing phoned home. The CLI only makes network requests to X's API during sync.

**Chrome session sync** reads cookies from Chrome's local database, uses them for the sync request, and discards them. Cookies are never stored separately.

**The default bookmark sync uses X's internal GraphQL API**, the same API that x.com uses in your browser.

**The likes archive sync also uses your browser-authenticated X web session.** In v1 it is browser-session based only; there is no OAuth likes sync path yet.

**The feed archive sync uses the same browser-authenticated X web session path.** In v1 it is read-only, CLI-first, and stores tweet-only Home timeline entries for local browsing.

**Remote unlike, unbookmark, likes trim, and bookmarks trim use the same browser-authenticated X web session path.** On success, the CLI also reconciles the matching local cached records and rebuilds the relevant search index. Single-item remote write actions now retry only transient failures (`network`, `429`, `5xx`) with bounded backoff before surfacing an error.

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
