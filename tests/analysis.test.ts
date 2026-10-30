import { describe, expect, it } from 'vitest';
import { analyzeMove, centipawnLoss, classifyMove, parseEngineEval, summarizePlayers } from '../shared/analysis';

const ev = (cp: number | null, mate: number | null = null, best: string | null = null) => ({ cp, mate, best, depth: 10 });

describe('move classification from eval drops', () => {
  it('labels by centipawns lost', () => {
    expect(classifyMove(0, false)).toBe('best');
    expect(classifyMove(30, false)).toBe('good');
    expect(classifyMove(70, false)).toBe('inaccuracy');
    expect(classifyMove(150, false)).toBe('mistake');
    expect(classifyMove(400, false)).toBe('blunder');
    expect(classifyMove(400, true)).toBe('best');
  });

  it('measures the drop from the mover’s side', () => {
    expect(centipawnLoss(ev(50), ev(-250), 'white')).toBe(300);
    expect(centipawnLoss(ev(50), ev(-250), 'black')).toBe(0);
    expect(centipawnLoss(ev(-100), ev(200), 'black')).toBe(300);
    expect(centipawnLoss(ev(0), ev(null, -3), 'white')).toBe(1000);
  });

  it('marks the engine move best and summarizes players', () => {
    const a = analyzeMove(ev(20, null, 'e2e4'), ev(20), 'white', 'e2e4');
    const b = analyzeMove(ev(20, null, 'e7e5'), ev(600), 'black', 'f7f6');
    expect(a.label).toBe('best');
    expect(b.label).toBe('blunder');
    const rows = summarizePlayers(
      [
        { seat: 'white1', name: 'Ada' },
        { seat: 'black1', name: 'Ben' },
      ],
      [a, b],
    );
    expect(rows[0]).toMatchObject({ name: 'Ada', best: 1, blunders: 0, acpl: 0 });
    expect(rows[1]).toMatchObject({ name: 'Ben', blunders: 1 });
    expect(rows[1].accuracy).toBeLessThan(rows[0].accuracy);
  });

  it('parses Stockfish lines into a White-side eval', () => {
    const lines = ['info depth 8 score cp 35 pv e7e5 g1f3', 'info depth 10 score cp 40 pv e7e5', 'bestmove e7e5'];
    expect(parseEngineEval(lines, false)).toEqual({ cp: -40, mate: null, best: 'e7e5', depth: 10 });
    expect(parseEngineEval(['info depth 5 score mate 2 pv d1h5', 'bestmove d1h5'], true)?.mate).toBe(2);
  });
});
