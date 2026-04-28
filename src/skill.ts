import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promptText } from './prompt.js';

// ── Skill content ────────────────────────────────────────────────────────────

const FRONTMATTER = `---
name: fieldtheory
description: Search the user's local X/Twitter archives for content relevant to their current work. Trigger when the user mentions bookmarks, saved tweets, tracked account research, or asks questions their local X archive could answer.
---`;

const BODY = `
# Field Theory — Local X Archive Assistant

Search the user's local X/Twitter archives for content relevant to the current task.

## When to trigger

- User mentions bookmarks, saved tweets, or X/Twitter content they saved
- User asks to find something they bookmarked ("find that tweet about...")
- User asks a question their bookmarks could answer ("what AI tools have I been looking at?")
- User wants bookmark or like stats, patterns, or insights
- User wants to research one tracked X account's viewpoints over time
- Starting a task where the user's reading history adds context

## Workflow

1. Look at what the user is working on (conversation, open files, branch name)
2. Generate 2-3 targeted search queries
3. Run \`ft bookmarks search <query>\` for each
4. Narrow with filters if needed
5. Summarize what you found — highlight relevant bookmarks, note patterns

## Commands

\`\`\`bash
ft bookmarks search <query>              # Full-text BM25 search ("exact phrase", AND, OR, NOT)
ft bookmarks list --author @handle       # By author
ft bookmarks list --after/--before DATE  # Date range (YYYY-MM-DD)
ft bookmarks stats                       # Collection overview
ft bookmarks viz                         # Terminal dashboard
ft likes stats                           # Likes overview
ft likes viz                             # Likes terminal dashboard
ft likes add <id>                        # Like a post and cache it locally
ft bookmarks show <id>                   # Full detail for one bookmark
\`\`\`

Combine filters: \`ft bookmarks list --author @handle --after 2026-01-01 --limit 10\`

## Guidelines

- Start broad, narrow with filters
- Don't dump raw output — summarize and connect findings to the user's current work
- Cross-reference multiple queries to build a complete picture
- Look for recurring authors, topic clusters, and connections between bookmarks

## Account Research Workflow

Use this when the user wants to study one tracked account's viewpoints, themes, or recurring claims over time.

1. Confirm the account already has local data
2. If not, tell the user to run \`ft accounts sync @handle\`
3. Export the local archive for the requested date range:

\`\`\`bash
ft accounts export @handle --after YYYY-MM-DD --before YYYY-MM-DD
\`\`\`

4. Read the exported JSON
5. Produce a concise markdown viewpoint map:
   - main themes
   - major viewpoints per theme
   - 3-5 representative tweet links per theme

Keep this local-first. Do not imply that \`ft\` itself performs the analysis.
`;

/** Full skill file with YAML frontmatter (for Claude Code commands). */
export function skillWithFrontmatter(): string {
  return `${FRONTMATTER}\n${BODY}`.trim() + '\n';
}

/** Skill body without frontmatter (for AGENTS.md / Codex). */
export function skillBody(): string {
  return BODY.trim() + '\n';
}

// ── Detection ────────────────────────────────────────────────────────────────

interface Agent {
  name: string;
  detected: boolean;
  installPath: string;
}

function detectAgents(): Agent[] {
  const home = os.homedir();
  return [
    {
      name: 'Claude Code',
      detected: fs.existsSync(path.join(home, '.claude')),
      installPath: path.join(home, '.claude', 'commands', 'fieldtheory.md'),
    },
    {
      name: 'Codex',
      detected: fs.existsSync(path.join(home, '.codex')),
      installPath: path.join(home, '.codex', 'instructions', 'fieldtheory.md'),
    },
  ];
}

// ── Install / uninstall ──────────────────────────────────────────────────────

export interface SkillResult {
  agent: string;
  path: string;
  action: 'installed' | 'updated' | 'up-to-date' | 'removed';
}

export async function installSkill(): Promise<SkillResult[]> {
  const detected = detectAgents();
  const targets = detected.filter((a) => a.detected);

  if (targets.length === 0) {
    // Nothing auto-detected — fall back to Claude Code as default
    const home = os.homedir();
    targets.push({
      name: 'Claude Code',
      detected: false,
      installPath: path.join(home, '.claude', 'commands', 'fieldtheory.md'),
    });
  }

  const results: SkillResult[] = [];
  for (const agent of targets) {
    const dir = path.dirname(agent.installPath);
    fs.mkdirSync(dir, { recursive: true });

    const content = agent.name === 'Codex' ? skillBody() : skillWithFrontmatter();
    const exists = fs.existsSync(agent.installPath);

    if (exists) {
      const existing = fs.readFileSync(agent.installPath, 'utf-8');
      if (existing === content) {
        results.push({ agent: agent.name, path: agent.installPath, action: 'up-to-date' });
        continue;
      }

      const answer = await promptText(`  ${agent.name} skill already exists. Overwrite? (y/n/compare) `);
      if (answer.kind !== 'answer') continue;
      const val = answer.value.toLowerCase();

      if (val === 'compare' || val === 'c') {
        console.log(`\n  ── Installed (${agent.installPath}) ──`);
        console.log(existing);
        console.log(`  ── New ──`);
        console.log(content);
        const confirm = await promptText(`  Overwrite with new version? (y/n) `);
        if (confirm.kind !== 'answer' || confirm.value.toLowerCase() !== 'y') continue;
      } else if (val !== 'y') {
        continue;
      }
    }

    fs.writeFileSync(agent.installPath, content, 'utf-8');
    results.push({ agent: agent.name, path: agent.installPath, action: exists ? 'updated' : 'installed' });
  }
  return results;
}

export function uninstallSkill(): SkillResult[] {
  const detected = detectAgents();
  const results: SkillResult[] = [];
  for (const agent of detected) {
    if (fs.existsSync(agent.installPath)) {
      fs.unlinkSync(agent.installPath);
      results.push({ agent: agent.name, path: agent.installPath, action: 'removed' });
    }
  }
  return results;
}
