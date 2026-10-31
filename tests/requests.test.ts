import { describe, expect, it } from 'vitest';
import { RequestBoard } from '../server/requests';
import { similarTitles, validateRequest } from '../shared/requests';
import { CHANGELOG } from '../shared/changelog';

const body = (title: string, category = 'Arena', details = '') => ({ title, details, category });

describe('change requests', () => {
  it('validates title/details/category, profanity, links and spam', () => {
    expect(validateRequest(body('Add a sniper scope zoom')).ok).toBe(true);
    expect(validateRequest(body('x'.repeat(81))).ok).toBe(false);
    expect(validateRequest(body('Valid title here', 'Arena', 'd'.repeat(501))).ok).toBe(false);
    expect(validateRequest(body('Valid title here', 'Nope')).ok).toBe(false);
    expect(validateRequest(body('this is shit fix it')).ok).toBe(false);
    expect(validateRequest(body('check out www.spam.com')).ok).toBe(false);
    expect(validateRequest(body('aaaaaaaaaaaa please')).ok).toBe(false);
    expect(validateRequest(body('Night map for the arena')).ok).toBe(true);
  });
  it('limits 3 per day per account and blocks exact duplicates', () => {
    const b = new RequestBoard(); const t = 1_000_000;
    expect(b.submit('alice', body('First idea for arena'), t).ok).toBe(true);
    expect(b.submit('Alice', body('first idea for arena'), t).ok).toBe(false);
    expect(b.submit('alice', body('Second idea for mines'), t).ok).toBe(true);
    expect(b.submit('alice', body('Third idea for market'), t).ok).toBe(true);
    expect(b.submit('alice', body('Fourth idea for casino'), t).ok).toBe(false);
    expect(b.submit('alice', body('Fourth idea for casino'), t + 86_400_001).ok).toBe(true);
  });
  it('one vote per account, toggles, sorts by top/new', () => {
    const b = new RequestBoard();
    const a = b.submit('alice', body('Arena night map please'), 1); const c = b.submit('carol', body('Bigger mine tunnels'), 2);
    if (!a.ok || !c.ok) throw new Error('submit');
    expect(b.vote(a.request.id, 'bob')).toMatchObject({ votes: 2, voted: true });
    expect(b.vote(a.request.id, 'BOB')).toMatchObject({ votes: 1, voted: false });
    b.vote(a.request.id, 'bob');
    expect(b.list({ sort: 'top' }).map((r) => r.id)).toEqual([a.request.id, c.request.id]);
    expect(b.list({ sort: 'new' }).map((r) => r.id)).toEqual([c.request.id, a.request.id]);
    expect(b.list({ sort: 'top', viewer: 'bob' })[0].voted).toBe(true);
  });
  it('status transitions, shipped needs a changelog entry, filter by status', () => {
    const b = new RequestBoard(); const r = b.submit('alice', body('Add grenades to arena'));
    if (!r.ok) throw new Error('submit'); const id = r.request.id;
    expect(b.setStatus(id, 'shipped', undefined, '253c035').ok).toBe(false);
    expect(b.setStatus(id, 'approved', 'Good one', undefined).ok).toBe(true);
    expect(b.setStatus(id, 'in_progress', undefined, undefined).ok).toBe(true);
    expect(b.setStatus(id, 'shipped', undefined, 'nope123')).toMatchObject({ ok: false, code: 400 });
    const s = b.setStatus(id, 'shipped', undefined, CHANGELOG.find((e) => e.commit)!.commit);
    expect(s.ok && s.request.changelog).toBeTruthy();
    expect(b.list({ status: 'shipped' })).toHaveLength(1); expect(b.list({ status: 'open' })).toHaveLength(0);
    expect(b.vote(id, 'bob').ok).toBe(false);
  });
  it('hides QA- requests from the public, shows them to QA viewers', () => {
    const b = new RequestBoard(); b.submit('QA-bot', body('QA test request here')); b.submit('alice', body('Real request here'));
    expect(b.list({})).toHaveLength(1); expect(b.list({ includeQa: true })).toHaveLength(2);
  });
  it('suggests similar titles', () => {
    expect(similarTitles('sniper zoom', [{ title: 'Add sniper scope zoom' }, { title: 'Bigger mines' }])).toHaveLength(1);
  });
});
