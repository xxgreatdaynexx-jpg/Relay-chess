/** Which build is running (shown at /api/build). */
import { execSync } from 'node:child_process';

const bootedAt = new Date();
let sha: string | null = null;
export function buildSha(): string {
  if (sha) return sha;
  const env = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '';
  if (env) return (sha = env.slice(0, 7));
  try { sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; } catch { sha = 'dev'; }
  return sha;
}
export const buildInfo = () => ({ ok: true, commit: buildSha(), builtAt: bootedAt.toISOString() });

/** Build notes used to be posted into chat; they now live only in the 📜 Changelog section. Old posts are hidden by isBuildPost. */
export const SYSTEM_NAME = '📜 Chud Hub';
export const isBuildPost = (m: { name: string; text: string }): boolean => m.name === SYSTEM_NAME && m.text.startsWith('New build ');
