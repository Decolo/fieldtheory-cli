import { readFile, writeFile } from 'node:fs/promises';
import { ensureDir, pathExists } from './fs.js';
import { dataDir, twitterBookmarkCurationProfilePath } from './paths.js';

export const DEFAULT_BOOKMARK_CURATION_PROFILE = `# Bookmark curation profile

Goal: keep high-value bookmarks that remain useful as a personal knowledge base, and remove stale or low-signal bookmarks.

Strong keep signals:
- Real AI practices: concrete implementation notes, production lessons, code, architecture, evaluation, agent memory, coding agents, AI infrastructure, CLI/devtooling, and reusable workflows.
- High-quality open-source repositories, practical tutorials, benchmark or evaluation methods, and durable research with clear applicability.
- Content that can be reused later for building, planning, debugging, or explaining systems.

Weak or remove signals:
- Marketing-heavy AI announcements, launch posts, shallow demos, growth threads, and pure positioning with little technical detail.
- Old model or product release news that has likely been superseded.
- Low-information opinions, vibes, reposts, or content that only says a tool is exciting.

When unsure, choose review instead of remove.`;

export async function readBookmarkCurationProfile(): Promise<{ path: string; content: string; usedDefault: boolean }> {
  const profilePath = twitterBookmarkCurationProfilePath();
  if (await pathExists(profilePath)) {
    return {
      path: profilePath,
      content: await readFile(profilePath, 'utf8'),
      usedDefault: false,
    };
  }
  return {
    path: profilePath,
    content: DEFAULT_BOOKMARK_CURATION_PROFILE,
    usedDefault: true,
  };
}

export async function ensureBookmarkCurationProfile(): Promise<string> {
  const profilePath = twitterBookmarkCurationProfilePath();
  if (!await pathExists(profilePath)) {
    await ensureDir(dataDir());
    await writeFile(profilePath, DEFAULT_BOOKMARK_CURATION_PROFILE, 'utf8');
  }
  return profilePath;
}
