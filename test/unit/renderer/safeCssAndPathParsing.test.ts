import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  scaleCssLengthForTransform,
  splitTiledPatternFillCss,
} from '../../../src/renderer/cssValues';
import {
  flipAbsoluteSvgPathData,
  parseMoveCubicPathData,
  parseMoveLinePathData,
  parseSimpleMoveLinePathData,
  tokenizeSvgPathData,
} from '../../../src/renderer/pathData';

function expectFast(fn: () => unknown): void {
  const start = performance.now();
  fn();
  expect(performance.now() - start).toBeLessThan(50);
}

describe('safe CSS value parsing', () => {
  it('scales valid CSS lengths without regex backtracking', () => {
    expect(scaleCssLengthForTransform('', 2)).toBe('50%');
    expect(scaleCssLengthForTransform('120px', 2)).toBe('60px');
    expect(scaleCssLengthForTransform('-1.5e2%', 2)).toBe('-75%');
    expect(scaleCssLengthForTransform('calc(100% - 4px)', 2)).toBe('calc(100% - 4px)');
  });

  it('rejects pathological CSS lengths in bounded time', () => {
    const malicious = '1'.repeat(30_000) + 'e+';

    expectFast(() => {
      expect(scaleCssLengthForTransform(malicious, 2)).toBe(malicious);
    });
  });

  it('splits tiled pattern fill CSS with a linear top-level comma scan', () => {
    const fillCss = 'linear-gradient(45deg, #000 0 0) 0 0 / 8px 8px, rgba(255, 255, 255, 0.5)';

    expect(splitTiledPatternFillCss(fillCss)).toEqual({
      imageLayers: 'linear-gradient(45deg, #000 0 0)',
      color: 'rgba(255, 255, 255, 0.5)',
    });
  });

  it('rejects pathological tiled pattern fill CSS in bounded time', () => {
    const malicious =
      'linear-gradient(red 0 0 / 8px 8px),' + ' '.repeat(100_000) + 'a'.repeat(100_000) + '!';

    expectFast(() => {
      expect(splitTiledPatternFillCss(malicious)).toBeNull();
    });
  });

  it('does not rescan long non-matching whitespace runs in tiled image layers', () => {
    const fillCss = `linear-gradient(red 0 0)${' '.repeat(40_000)}x, #fff`;

    expectFast(() => {
      expect(splitTiledPatternFillCss(fillCss)).toEqual({
        imageLayers: `linear-gradient(red 0 0)${' '.repeat(40_000)}x`,
        color: '#fff',
      });
    });
  });
});

describe('safe SVG path parsing', () => {
  it('preserves over-limit paths when an absolute-path flip cannot be parsed safely', () => {
    const pathD = `M0,0 L${'1'.repeat(100_001)},1`;

    expect(flipAbsoluteSvgPathData(pathD, 100, 100, true, false)).toBe(pathD);
  });

  it('flips ordinary absolute paths without changing their command structure', () => {
    expect(flipAbsoluteSvgPathData('M0,10 L20,30', 100, 50, true, false)).toBe('M100,10 L80,30');
  });

  it('preserves malformed absolute paths instead of emitting NaN coordinates', () => {
    const pathD = 'M0,0 L10';

    expect(flipAbsoluteSvgPathData(pathD, 100, 50, true, false)).toBe(pathD);
  });

  it('tokenizes ordinary SVG path data', () => {
    expect(tokenizeSvgPathData('M0,0 L10,20 A5,6 0 0,1 20,30 Z')).toEqual([
      'M',
      '0',
      '0',
      'L',
      '10',
      '20',
      'A',
      '5',
      '6',
      '0',
      '0',
      '1',
      '20',
      '30',
      'Z',
    ]);
  });

  it('parses simple line and cubic move paths without anchored numeric regexes', () => {
    expect(parseSimpleMoveLinePathData('M0,0 L10,20')).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 20 },
    });
    expect(parseMoveLinePathData('M0,0 L10,20 L30,40')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    expect(parseMoveCubicPathData('M0,0 C1,2 3,4 5,6')).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ c1: { x: 1, y: 2 }, c2: { x: 3, y: 4 }, end: { x: 5, y: 6 } }],
    });
  });

  it('rejects pathological path data in bounded time', () => {
    const malicious = `M${'1'.repeat(30_000)}e+,0 L1,1`;

    expectFast(() => {
      expect(parseSimpleMoveLinePathData(malicious)).toBeNull();
      expect(parseMoveLinePathData(malicious)).toBeNull();
      expect(parseMoveCubicPathData(malicious)).toBeNull();
    });
  });
});
