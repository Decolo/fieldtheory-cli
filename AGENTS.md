# AGENTS.md

## PR Targeting

- Default PR target is the fork repository: `Decolo/fieldtheory-cli`.
- Do not open PRs against `afar1/fieldtheory-cli` unless the user explicitly asks for an upstream PR.
- When creating a PR for this repo, prefer:
  - repo: `Decolo/fieldtheory-cli`
  - base: `main`
  - head: the current feature branch in the fork

## Chrome Constraint

- Any future Chrome usage is a hard constraint: do not connect to Chrome from scripts or tests.
- If Chrome interaction is needed, it must go through Chrome DevTools MCP only.

## Feed Daemon Runtime

- When the feed daemon needs shell-provided proxy settings such as `http_proxy` or `https_proxy`, prefer starting it from `tmux`, not `launchd`.
- Reason: `launchd` jobs do not read `~/.zshrc`, so a LaunchAgent will not reliably inherit proxy variables defined there.
- Preferred practice:
  - `tmux new-session -d -s fieldtheory-feed 'cd /Users/decolo/Github/fieldtheory-cli && pnpm exec tsx src/cli.ts feed daemon start --every 20m'`
- After starting from `tmux`, verify the daemon with `pnpm exec tsx src/cli.ts feed daemon status`.
