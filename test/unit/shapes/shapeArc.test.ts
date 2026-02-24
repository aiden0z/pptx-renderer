import { describe, it, expect } from 'vitest';
import { shapeArc } from '../../../src/shapes/shapeArc';

describe('shapeArc', () => {
  it('generates a quarter arc (0 to 90)', () => {
    const d = shapeArc(50, 50, 50, 50, 0, 90, false);
    expect(d).toContain('M');
    expect(d).toContain('A');
    expect(d).not.toContain('Z');
    expect(d).not.toContain('NaN');
  });

  it('generates a semicircle (0 to 180)', () => {
    const d = shapeArc(50, 50, 50, 50, 0, 180, false);
    expect(d).toContain('A');
    // Large arc flag should be 0 for exactly 180 degrees
    expect(d).not.toContain('NaN');
  });

  it('generates a full circle arc with close', () => {
    const d = shapeArc(50, 50, 50, 50, 0, 359, true);
    expect(d).toContain('Z');
  });

  it('closes path when isClose=true', () => {
    const d = shapeArc(50, 50, 30, 30, 0, 90, true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('does not close path when isClose=false', () => {
    const d = shapeArc(50, 50, 30, 30, 0, 90, false);
    expect(d).not.toContain('Z');
  });

  it('handles elliptical arc (different rx, ry)', () => {
    const d = shapeArc(100, 50, 80, 40, 0, 90, false);
    expect(d).toContain('A80,40');
    expect(d).not.toContain('NaN');
  });

  it('start point is correct for 0 degrees', () => {
    const d = shapeArc(50, 50, 50, 50, 0, 90, false);
    // At 0 degrees: x = cx + rx*cos(0) = 100, y = cy + ry*sin(0) = 50
    expect(d).toMatch(/^M100,50/);
  });
});
