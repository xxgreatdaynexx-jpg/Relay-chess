/** Which build is running, and a once-per-build "what's new" chat note (deduped in Postgres). */
import { execSync } from 'node:child_process';
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getChatLog } from './chat.js';
import { changelogBullets } from '../shared/changelog.js';

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

export const BUILD_MIGRATION = 'CREATE TABLE IF NOT EXISTS build_announcements (sha TEXT PRIMARY KEY, announced_at TIMESTAMPTZ NOT NULL DEFAULT now())';
export const SYSTEM_NAME = '📜 Chud Hub';

export function buildNote(commit: string, bullets = changelogBullets(3)): string {
  const lines = bullets.map((b) => `• ${b}`);
  let text = `New build ${commit} is live:`;
  for (const l of lines) { if ([...text].length + l.length + 1 > 290) break; text += `\n${l}`; }
  return text;
}

/** Posts the build note once per SHA. The INSERT ... ON CONFLICT is the dedupe, so restarts/multiple boots never repeat it. */
export async function announceBuild(db: Queryable, commit = buildSha()): Promise<boolean> {
  if (commit === 'dev') return false;
  await db.query(BUILD_MIGRATION);
  const { rows } = await db.query('INSERT INTO build_announcements (sha) VALUES ($1) ON CONFLICT (sha) DO NOTHING RETURNING sha', [commit]);
  if (!rows.length) return false;
  getChatLog().postSystem(SYSTEM_NAME, buildNote(commit));
  return true;
}

export async function initBuildAnnounce(): Promise<void> {
  const url = databaseUrl();
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try { if (await announceBuild(pool)) console.log(`[build] announced ${buildSha()} in chat`); }
  catch (err) { console.error('[build] announce failed:', (err as Error).message); }
  finally { await pool.end().catch(() => {}); }
}
