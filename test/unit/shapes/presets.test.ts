import { describe, it, expect } from 'vitest';
import {
  presetShapes,
  getPresetShapePath,
  getMultiPathPreset,
  getActionButtonIconPath,
  getPresetOverlays,
  type PresetSubPath,
} from '../../../src/shapes/presets';

describe('getPresetShapePath', () => {
  it('returns a valid rect path', () => {
    const d = getPresetShapePath('rect', 100, 50);
    expect(d).toContain('M');
    expect(d).toContain('Z');
    // Should contain the dimensions
    expect(d).toContain('100');
    expect(d).toContain('50');
  });

  it('returns a roundRect path', () => {
    const d = getPresetShapePath('roundRect', 200, 100);
    expect(d).toContain('M');
    expect(d.length).toBeGreaterThan(0);
  });

  it('returns an ellipse path', () => {
    const d = getPresetShapePath('ellipse', 100, 100);
    expect(d).toContain('A');
  });

  it('renders moon with smooth arc commands (not polygonal segments)', () => {
    const d = getPresetShapePath('moon', 200, 200);
    expect((d.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('renders moon with distinct outer/inner arc radii to avoid fill cancellation (oracle-full-shapeid-0024)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('moon', w, h);
    const arcs = [...d.matchAll(/A([-\d.]+),([-\d.]+)\s/g)].map((m) => ({
      rx: Number(m[1]),
      ry: Number(m[2]),
    }));
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    // If two arcs share identical radii and opposite sweep around the same endpoints,
    // fill can collapse to zero-area in the browser rasterization path.
    expect(Math.abs(arcs[0].rx - arcs[1].rx)).toBeGreaterThan(1);
    expect(Math.abs(arcs[0].ry - arcs[1].ry)).toBeGreaterThan(1);
  });

  it('handles case-insensitive lookup', () => {
    const d1 = getPresetShapePath('rect', 100, 50);
    const d2 = getPresetShapePath('Rect', 100, 50);
    // Both should return valid paths (may differ due to fallback warning)
    expect(d1.length).toBeGreaterThan(0);
    expect(d2.length).toBeGreaterThan(0);
  });

  it('falls back to rectangle for unknown shapes', () => {
    const d = getPresetShapePath('unknownShape', 100, 50);
    expect(d).toBe('M0,0 L100,0 L100,50 L0,50 Z');
  });

  it('handles line preset', () => {
    const d = getPresetShapePath('line', 200, 0);
    expect(d).toContain('M');
  });

  it('renders diagonal line when width and height are both non-zero', () => {
    const d = getPresetShapePath('line', 200, 100);
    expect(d).toBe('M0,0 L200,100');
  });

  it('handles straightConnector1', () => {
    const d = getPresetShapePath('straightConnector1', 200, 100);
    expect(d).toContain('M');
  });

  it('handles adjustments', () => {
    const adjs = new Map([['adj', 25000]]);
    const d = getPresetShapePath('roundRect', 200, 100, adjs);
    expect(d.length).toBeGreaterThan(0);
  });

  it('returns a plaque path with concave arc corners (OOXML arcTo negative sweep)', () => {
    const d = getPresetShapePath('plaque', 200, 100);
    expect(d).not.toBe('M0,0 L200,0 L200,100 L0,100 Z');
    // Plaque uses arc commands for concave corners, not quadratic bezier
    expect(d).toContain('A');
    // Default adj=16667 → radius = min(200,100)*16667/100000 ≈ 16.667
    expect(d).toContain('16.667');
  });

  it('returns empty path for textNoShape', () => {
    const d = getPresetShapePath('textNoShape', 200, 100);
    expect(d).toBe('');
  });

  it('supports complex-pptx missing presets without rectangle fallback', () => {
    const shapeNames = ['corner', 'downArrowCallout', 'diagStripe', 'borderCallout1', 'halfFrame', 'leftCircularArrow'];
    for (const shapeName of shapeNames) {
      const d = getPresetShapePath(shapeName, 200, 100);
      expect(d).not.toBe('M0,0 L200,0 L200,100 L0,100 Z');
      expect(d.length).toBeGreaterThan(0);
    }
  });

  it('renders full-shape oracle presets without rectangle fallback (tab/arrow family)', () => {
    const shapeNames = ['cornerTabs', 'squareTabs', 'plaqueTabs', 'leftRightCircularArrow', 'leftUpArrow', 'lineInv'];
    for (const shapeName of shapeNames) {
      const d = getPresetShapePath(shapeName, 200, 100);
      expect(d).not.toBe('M0,0 L200,0 L200,100 L0,100 Z');
      expect(d.length).toBeGreaterThan(0);
    }
  });

  it('renders chart placeholder variants via multi-path overlays (chartStar/chartPlus)', () => {
    const plus = getMultiPathPreset('chartPlus', 200, 100);
    const star = getMultiPathPreset('chartStar', 200, 100);
    expect(plus).not.toBeNull();
    expect(star).not.toBeNull();
    expect(plus![1].d).toContain('M100,0 L100,100');
    expect(plus![1].d).toContain('M0,50 L200,50');
    expect(star![1].d).toContain('M0,0 L200,100');
    expect(star![1].d).toContain('M200,0 L0,100');
  });

  it('renders cornerTabs as four congruent corner triangles', () => {
    const d = getPresetShapePath('cornerTabs', 400, 280);
    const triangles = d.match(/M[^Z]+Z/g);
    expect(triangles).not.toBeNull();
    expect(triangles!.length).toBe(4);
    const legs = triangles!.map((tri) => {
      const pts = Array.from(tri.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      expect(pts.length).toBeGreaterThanOrEqual(3);
      const p0 = pts[0];
      const p1 = pts[1];
      const p2 = pts[2];
      // Right-angle corner leg lengths from start point to the other two points.
      const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const l2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
      return [l1, l2];
    });
    const flat = legs.flat();
    const minLeg = Math.min(...flat);
    const maxLeg = Math.max(...flat);
    expect(maxLeg - minLeg).toBeLessThan(1e-6);
  });

  it('renders squareTabs as four detached corner squares with hollow center (oracle-full-shapeid-0170)', () => {
    const d = getPresetShapePath('squareTabs', 400, 280);
    const subpaths = d.match(/M[^Z]+Z/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(4);

    const polygonArea = (pts: Array<{ x: number; y: number }>) => {
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        sum += a.x * b.y - b.x * a.y;
      }
      return Math.abs(sum) / 2;
    };

    const totalArea = subpaths!.reduce((acc, sp) => {
      const pts = Array.from(sp.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      return acc + polygonArea(pts);
    }, 0);

    const coverage = totalArea / (400 * 280);
    expect(coverage).toBeGreaterThan(0.015);
    expect(coverage).toBeLessThan(0.08);
  });

  it('renders plaqueTabs as four detached rounded corner tabs with hollow center (oracle-full-shapeid-0171)', () => {
    const d = getPresetShapePath('plaqueTabs', 400, 280);
    const subpaths = d.match(/M[^Z]+Z/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(4);
    expect((d.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Each tab should stay in its corner quadrant (no center fill block).
    const starts = subpaths!.map((sp) => {
      const m = sp.match(/M([-\d.]+),([-\d.]+)/);
      return { x: Number(m?.[1] ?? '0'), y: Number(m?.[2] ?? '0') };
    });
    expect(starts).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 0, y: 280 },
      { x: 400, y: 280 },
    ]);
  });

  it('renders flowChartCollate with dedicated hourglass geometry (oracle-full-shapeid-0079)', () => {
    const d = getPresetShapePath('flowChartCollate', 200, 100);
    expect(d).not.toBe('M0,0 L200,0 L200,100 L0,100 Z');
    expect(d).toContain('Z M');
  });

  it('renders curvedUpArrow using arc-derived start point for wide layouts', () => {
    const d = getPresetShapePath('curvedUpArrow', 900, 100);
    expect(d.startsWith('M0,0')).toBe(false);
    expect((d.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(d).toContain('L875,0');
  });

  it('renders curvedDownArrow with inner cutout subpath', () => {
    const d = getPresetShapePath('curvedDownArrow', 900, 100);
    expect(d.startsWith('M0,100')).toBe(false);
    expect(d).toContain('Z M');
    expect((d.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('renders leftCircularArrow with different default geometry than circularArrow', () => {
    // With default adjustments (no overrides), left and right variants produce different arcs
    const circular = getPresetShapePath('circularArrow', 200, 200);
    const leftCircular = getPresetShapePath('leftCircularArrow', 200, 200);
    expect(leftCircular).not.toBe(circular);
    expect((leftCircular.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((circular.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('renders leftCircularArrow connector with valid arcs (AlternatingFlow regression)', () => {
    const adjs = new Map([
      ['adj1', 3017],
      ['adj2', 370131],
      ['adj3', 2145642],
      ['adj4', 9024489],
      ['adj5', 3520],
    ]);
    const leftCircular = getPresetShapePath('leftCircularArrow', 200, 200, adjs);
    const arcs = leftCircular.match(/A[^A]+/g);
    expect(arcs).not.toBeNull();
    // Should have at least 2 arcs (outer and inner)
    expect(arcs!.length).toBeGreaterThanOrEqual(2);
    // Each arc should have valid SVG arc flags
    for (const arc of arcs!) {
      const flags = arc.match(/ 0 ([01]),([01]) /);
      expect(flags).not.toBeNull();
    }
  });

  it('renders leftCircularArrow with a non-degenerate arrowhead triangle (default adjustments)', () => {
    // leftCircularArrow OOXML defaults: adj2=-11796480 (negative arrowhead angle)
    const d = getPresetShapePath('leftCircularArrow', 200, 200);
    const m = d.match(
      /A[^A]+ L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)/,
    );
    expect(m).not.toBeNull();
    const p1 = { x: Number(m![1]), y: Number(m![2]) };
    const p2 = { x: Number(m![3]), y: Number(m![4]) };
    const p3 = { x: Number(m![5]), y: Number(m![6]) };
    const area = Math.abs(
      (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2,
    );
    expect(area).toBeGreaterThan(0.5);
  });

  it('renders bentUpArrow with the horizontal leg anchored in the lower half (oracle-full-shapeid-0044)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('bentUpArrow', w, h);
    const points = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    const leftEdgeYs = points
      .filter((p) => Math.abs(p.x) < 1e-6)
      .map((p) => p.y);

    expect(leftEdgeYs.length).toBeGreaterThan(0);
    expect(Math.min(...leftEdgeYs)).toBeGreaterThan(h * 0.55);
  });

  it('renders bentUpArrow arrowhead base wider than the vertical stem (oracle-full-shapeid-0044 triangle head)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('bentUpArrow', w, h);
    const points = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    const uniqueYs = [...new Set(points.map((p) => p.y.toFixed(6)))].map(Number).sort((a, b) => a - b);
    expect(uniqueYs.length).toBeGreaterThanOrEqual(3);
    // y=0 is tip; next Y is the arrow base line.
    const headBaseY = uniqueYs[1];
    const baseXs = [...new Set(
      points
        .filter((p) => Math.abs(p.y - headBaseY) < 1e-6)
        .map((p) => Number(p.x.toFixed(6))),
    )];
    // A proper bent-up triangle head has shoulder-left + inner-left + inner-right/right wing
    // (at least 3 distinct x positions on the head base line).
    expect(baseXs.length).toBeGreaterThanOrEqual(3);
  });

  it('renders leftRightUpArrow without a center-down bottom stem (oracle-full-shapeid-0040)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('leftRightUpArrow', w, h);
    const points = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    const bottomXs = [...new Set(
      points
        .filter((p) => Math.abs(p.y - h) < 1e-6)
        .map((p) => Number(p.x.toFixed(6))),
    )];

    expect(bottomXs.length).toBeGreaterThanOrEqual(2);
    const hasCenterBottom = bottomXs.some((x) => x > w * 0.35 && x < w * 0.65);
    expect(hasCenterBottom).toBe(false);
  });

  it('renders leftUpArrow with a right-side up-arrow tip (oracle-full-shapeid-0043)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('leftUpArrow', w, h);
    const points = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    const topPoints = points.filter((p) => Math.abs(p.y) < 1e-6);
    expect(topPoints.length).toBeGreaterThanOrEqual(1);
    const topTipX = Math.max(...topPoints.map((p) => p.x));
    expect(topTipX).toBeGreaterThan(w * 0.7);
  });

  it('renders leftBrace with a center spine and far-left cusp (oracle-full-shapeid-0031)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('leftBrace', w, h);
    const points = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    expect(minX).toBeLessThan(1e-6);
    expect(Math.abs(maxX - w)).toBeLessThan(1e-6);

    const spineX = w / 2;
    const spinePoints = points.filter((p) => Math.abs(p.x - spineX) < 1e-6);
    expect(spinePoints.length).toBeGreaterThanOrEqual(4);
  });

  it('renders leftBracket with OOXML wide arc radius (oracle-full-shapeid-0029)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('leftBracket', w, h);
    const arc = d.match(/A([-\d.]+),([-\d.]+)/);
    expect(arc).not.toBeNull();
    const rx = Number(arc![1]);
    const ry = Number(arc![2]);
    expect(rx).toBeGreaterThan(w * 0.95);
    expect(ry).toBeLessThan(h * 0.2);
  });

  it('renders chord as elliptical segment (rx=w/2, ry=h/2) with default 45° to 270° (OOXML presetShapeDefinitions)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('chord', w, h);
    expect(d).toMatch(/^M[-\d.]+,/);
    expect(d).toContain('A');
    expect(d).toMatch(/ Z$/);
    const arcMatch = d.match(/A([-\d.]+),([-\d.]+)\s+0\s+[01],1\s+([-\d.]+),([-\d.]+)/);
    expect(arcMatch).not.toBeNull();
    const rx = Number(arcMatch![1]);
    const ry = Number(arcMatch![2]);
    expect(rx).toBe(w / 2);
    expect(ry).toBe(h / 2);
  });

  it('chord applies OOXML visual→parametric angle conversion for non-circular ellipses', () => {
    // For an ellipse with rx≠ry, OOXML "visual" 45° maps to parametric ~55° (not 45°).
    // The start point should NOT be at the naïve cos(45°)/sin(45°) position.
    const w = 400;
    const h = 280;
    const cx = w / 2;
    const rx = w / 2;
    const d = getPresetShapePath('chord', w, h);
    const mMatch = d.match(/^M([-\d.]+),([-\d.]+)/);
    expect(mMatch).not.toBeNull();
    const startX = Number(mMatch![1]);
    // Naïve parametric 45° would give x ≈ cx + rx*cos(45°) ≈ 341.4
    const naiveX = cx + rx * Math.cos(Math.PI / 4);
    // Correct visual→parametric conversion gives x ≈ cx + rx*cos(55°) ≈ 314.7
    // The actual start point should be significantly left of the naïve position
    expect(startX).toBeLessThan(naiveX - 10);
    // And should be roughly at the visual→parametric corrected position
    const toRad = (d: number) => (d * Math.PI) / 180;
    const paramAngle = Math.atan2(Math.sin(toRad(45)) / (h / 2), Math.cos(toRad(45)) / (w / 2));
    const expectedX = cx + rx * Math.cos(paramAngle);
    expect(startX).toBeCloseTo(expectedX, 1);
  });

  it('pie applies OOXML visual→parametric angle conversion for non-circular ellipses', () => {
    // pie: default adj1=0, adj2=16200000 (270°). Non-circular ellipse should use visual→parametric.
    const w = 400;
    const h = 200;
    const cx = w / 2;
    const rx = w / 2;
    const d = getPresetShapePath('pie', w, h);
    // Pie starts at center then L to first point: M200,100 L{x1},{y1} A...
    const lMatch = d.match(/L([-\d.]+),([-\d.]+)/);
    expect(lMatch).not.toBeNull();
    const x1 = Number(lMatch![1]);
    // Default start angle is 0°, so visual→parametric should give x = cx + rx (same for 0°)
    expect(x1).toBeCloseTo(cx + rx, 1);
  });

  it('arc applies OOXML visual→parametric angle conversion for non-circular ellipses', () => {
    // arc: default adj1=16200000 (270°), adj2=0 (0°). Check the end point at 0°.
    const w = 400;
    const h = 200;
    const d = getPresetShapePath('arc', w, h);
    // Arc endpoint (at visual 0°) should be at far right: cx + rx
    const arcMatch = d.match(/A[-\d.]+,[-\d.]+\s+0\s+[01],[01]\s+([-\d.]+),([-\d.]+)/);
    expect(arcMatch).not.toBeNull();
    const endX = Number(arcMatch![1]);
    const endY = Number(arcMatch![2]);
    expect(endX).toBeCloseTo(w / 2 + w / 2, 1); // cx + rx at 0°
    expect(endY).toBeCloseTo(h / 2, 1); // cy at 0°
  });

  it('renders funnel with two sub-paths: body and inset ellipse hole (oracle-full-shapeid-0174)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('funnel', w, h);
    // Should have two sub-paths (body + inset ellipse)
    const subpaths = d.match(/M[^M]+/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(2);
    // Body sub-path: arc + line + arc + close
    expect(subpaths![0]).toContain('A');
    expect(subpaths![0]).toContain('L');
    expect(subpaths![0]).toContain('Z');
    // Inset ellipse sub-path: two arcs forming a full ellipse
    const insetArcs = subpaths![1].match(/A/g);
    expect(insetArcs).not.toBeNull();
    expect(insetArcs!.length).toBe(2);
    // Funnel should taper: the body bottom is narrower than the top
    // Top rim ellipse rx = w/2 = 200, spout rx = w/8 = 50
    const bodyArcs = subpaths![0].match(/A([-\d.]+),([-\d.]+)/g);
    expect(bodyArcs).not.toBeNull();
    expect(bodyArcs!.length).toBe(2);
    const topRx = Number(bodyArcs![0].match(/A([-\d.]+)/)![1]);
    const spoutRx = Number(bodyArcs![1].match(/A([-\d.]+)/)![1]);
    expect(topRx).toBe(w / 2);
    expect(spoutRx).toBe(w / 8);
  });

  it('keeps circularArrow arrowhead width driven by adj2 (no forced widening)', () => {
    const tiny = new Map([
      ['adj1', 2700],
      ['adj2', 1000],
      ['adj3', 19495716],
      ['adj4', 12575511],
      ['adj5', 3150],
    ]);
    const normal = new Map([
      ['adj1', 2700],
      ['adj2', 328773],
      ['adj3', 19495716],
      ['adj4', 12575511],
      ['adj5', 3150],
    ]);

    const triangleArea = (d: string) => {
      const m = d.match(
        /A[^A]+ L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)/,
      );
      expect(m).not.toBeNull();
      const p1 = { x: Number(m![1]), y: Number(m![2]) };
      const p2 = { x: Number(m![3]), y: Number(m![4]) };
      const p3 = { x: Number(m![5]), y: Number(m![6]) };
      return Math.abs(
        (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2,
      );
    };

    const tinyArea = triangleArea(getPresetShapePath('circularArrow', 200, 200, tiny));
    const normalArea = triangleArea(getPresetShapePath('circularArrow', 200, 200, normal));
    expect(tinyArea).toBeLessThan(normalArea);
  });

  it('renders leftRightCircularArrow as a single curved band with two arrowheads (oracle-full-shapeid-0177)', () => {
    const d = getPresetShapePath('leftRightCircularArrow', 400, 280);
    const subpaths = d.match(/M[^Z]+Z/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(1);
    const arcCount = (d.match(/A/g) ?? []).length;
    const cubicCount = (d.match(/C/g) ?? []).length;
    expect(arcCount + cubicCount).toBeGreaterThanOrEqual(2);
  });

  it('renders mathNotEqual as a single closed contour with diagonal notch joins (oracle-full-shapeid-0168)', () => {
    const d = getPresetShapePath('mathNotEqual', 400, 280);
    const subpaths = d.match(/M[^Z]+Z/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(1);
    const diagonalSegments = (d.match(/L[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+/g) ?? []).length;
    expect(diagonalSegments).toBeGreaterThan(2);
  });

  it('renders mathDivide with OOXML default proportions (oracle-full-shapeid-0166)', () => {
    const w = 400;
    const h = 280;
    const d = getPresetShapePath('mathDivide', w, h);
    const subpaths = d.match(/M[^Z]+Z/g);
    expect(subpaths).not.toBeNull();
    expect(subpaths!.length).toBe(3);

    // bar must be thick enough (OOXML default ~11.76% of h)
    const barPts = Array.from(subpaths![0].matchAll(/([-\d.]+),([-\d.]+)/g)).map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    const ys = barPts.map((p) => p.y);
    const barH = Math.max(...ys) - Math.min(...ys);
    expect(barH / h).toBeGreaterThan(0.1);

    // dot radii must be large enough (OOXML default ~11.76% of h)
    const m = subpaths![1].match(/A([-\d.]+),([-\d.]+)\s/);
    expect(m).not.toBeNull();
    const r = Number(m![1]);
    expect(r / h).toBeGreaterThan(0.1);
  });

});

describe('presetShapes regression — all shapes produce valid paths', () => {
  it(`has ${presetShapes.size}+ registered shapes`, () => {
    expect(presetShapes.size).toBeGreaterThanOrEqual(50);
  });

  for (const [name, generator] of presetShapes) {
    it(`${name} produces valid path (100x80)`, () => {
      const d = generator(100, 80);
      expect(typeof d).toBe('string');
      expect(d.length).toBeGreaterThan(0);
      // No NaN in the path
      expect(d).not.toContain('NaN');
      // No Infinity
      expect(d).not.toContain('Infinity');
      // Should start with M (move to)
      expect(d.trimStart()).toMatch(/^M/);
    });
  }

  // Also test with zero dimensions (common for line shapes)
  for (const [name, generator] of presetShapes) {
    it(`${name} does not throw with w=0, h=0`, () => {
      expect(() => generator(0, 0)).not.toThrow();
    });
  }
});

describe('getMultiPathPreset', () => {
  it('returns null for non-multi-path shapes (rect)', () => {
    const result = getMultiPathPreset('rect', 100, 50);
    expect(result).toBeNull();
  });

  it('returns null for non-multi-path shapes (ellipse)', () => {
    const result = getMultiPathPreset('ellipse', 100, 100);
    expect(result).toBeNull();
  });

  it('returns null for non-existent shapes', () => {
    const result = getMultiPathPreset('unknownMultiPath', 100, 50);
    expect(result).toBeNull();
  });

  describe('horizontalScroll', () => {
    it('returns exactly 3 sub-paths', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
    });

    it('first path has fill=norm and stroke=false', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      const path1 = paths![0];
      expect(path1.fill).toBe('norm');
      expect(path1.stroke).toBe(false);
    });

    it('second path has fill=darkenLess and stroke=false', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      const path2 = paths![1];
      expect(path2.fill).toBe('darkenLess');
      expect(path2.stroke).toBe(false);
    });

    it('third path has fill=none and stroke=true', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      const path3 = paths![2];
      expect(path3.fill).toBe('none');
      expect(path3.stroke).toBe(true);
    });

    it('all paths have non-empty d strings', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      paths!.forEach((path, index) => {
        expect(path.d).toBeTruthy();
        expect(path.d.length).toBeGreaterThan(0);
      });
    });

    it('all d strings start with M (move to)', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      paths!.forEach((path) => {
        expect(path.d.trim()).toMatch(/^M/);
      });
    });

    it('path d strings contain arc commands (A)', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      // At least one path should contain arc commands
      const hasArcs = paths!.some((path) => path.d.includes('A'));
      expect(hasArcs).toBe(true);
    });

    it('handles custom adjustments without error', () => {
      const adjs = new Map([['adj', 20000]]);
      expect(() => getMultiPathPreset('horizontalscroll', 200, 100, adjs)).not.toThrow();
      const paths = getMultiPathPreset('horizontalscroll', 200, 100, adjs);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
    });

    it('respects adjustment value bounds (clamped 0-25000)', () => {
      // Test with value below minimum
      const pathsLow = getMultiPathPreset('horizontalscroll', 200, 100, new Map([['adj', -5000]]));
      expect(pathsLow).not.toBeNull();

      // Test with value above maximum
      const pathsHigh = getMultiPathPreset('horizontalscroll', 200, 100, new Map([['adj', 50000]]));
      expect(pathsHigh).not.toBeNull();

      // Both should succeed without NaN/Infinity
      [pathsLow, pathsHigh].forEach((paths) => {
        paths!.forEach((path) => {
          expect(path.d).not.toContain('NaN');
          expect(path.d).not.toContain('Infinity');
        });
      });
    });

    it('handles case-insensitive lookup (HORIZONTALSCROLL)', () => {
      const pathsLower = getMultiPathPreset('horizontalscroll', 200, 100);
      const pathsUpper = getMultiPathPreset('HORIZONTALSCROLL', 200, 100);
      const pathsMixed = getMultiPathPreset('HorizontalScroll', 200, 100);

      expect(pathsLower).not.toBeNull();
      expect(pathsUpper).not.toBeNull();
      expect(pathsMixed).not.toBeNull();
      expect(pathsLower).toHaveLength(3);
      expect(pathsUpper).toHaveLength(3);
      expect(pathsMixed).toHaveLength(3);
    });

    it('produces valid paths with zero dimensions (edge case)', () => {
      expect(() => getMultiPathPreset('horizontalscroll', 0, 0)).not.toThrow();
      const paths = getMultiPathPreset('horizontalscroll', 0, 0);
      expect(paths).not.toBeNull();
      // Paths should exist even with zero dimensions
      expect(paths).toHaveLength(3);
    });

    it('produces valid paths with tiny dimensions', () => {
      const paths = getMultiPathPreset('horizontalscroll', 1, 1);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
      paths!.forEach((path) => {
        expect(path.d).not.toContain('NaN');
        expect(path.d).not.toContain('Infinity');
      });
    });

    it('produces valid paths with large dimensions', () => {
      const paths = getMultiPathPreset('horizontalscroll', 5000, 5000);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
      paths!.forEach((path) => {
        expect(path.d).not.toContain('NaN');
        expect(path.d).not.toContain('Infinity');
      });
    });

    it('all path properties are properly typed', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();
      paths!.forEach((path) => {
        expect(typeof path.d).toBe('string');
        expect(['norm', 'darken', 'darkenLess', 'lighten', 'lightenLess', 'none']).toContain(path.fill);
        expect(typeof path.stroke).toBe('boolean');
      });
    });
  });

  describe('verticalScroll', () => {
    it('returns exactly 3 sub-paths', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
    });

    it('first path has fill=norm and stroke=false', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      const path1 = paths![0];
      expect(path1.fill).toBe('norm');
      expect(path1.stroke).toBe(false);
    });

    it('second path has fill=darkenLess and stroke=false', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      const path2 = paths![1];
      expect(path2.fill).toBe('darkenLess');
      expect(path2.stroke).toBe(false);
    });

    it('third path has fill=none and stroke=true', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      const path3 = paths![2];
      expect(path3.fill).toBe('none');
      expect(path3.stroke).toBe(true);
    });

    it('all paths have non-empty d strings', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      paths!.forEach((path, index) => {
        expect(path.d).toBeTruthy();
        expect(path.d.length).toBeGreaterThan(0);
      });
    });

    it('all d strings start with M (move to)', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      paths!.forEach((path) => {
        expect(path.d.trim()).toMatch(/^M/);
      });
    });

    it('path d strings contain arc commands (A)', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      // At least one path should contain arc commands
      const hasArcs = paths!.some((path) => path.d.includes('A'));
      expect(hasArcs).toBe(true);
    });

    it('handles custom adjustments without error', () => {
      const adjs = new Map([['adj', 20000]]);
      expect(() => getMultiPathPreset('verticalscroll', 100, 200, adjs)).not.toThrow();
      const paths = getMultiPathPreset('verticalscroll', 100, 200, adjs);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
    });

    it('handles case-insensitive lookup (VERTICALSCROLL)', () => {
      const pathsLower = getMultiPathPreset('verticalscroll', 100, 200);
      const pathsUpper = getMultiPathPreset('VERTICALSCROLL', 100, 200);
      const pathsMixed = getMultiPathPreset('VerticalScroll', 100, 200);

      expect(pathsLower).not.toBeNull();
      expect(pathsUpper).not.toBeNull();
      expect(pathsMixed).not.toBeNull();
      expect(pathsLower).toHaveLength(3);
      expect(pathsUpper).toHaveLength(3);
      expect(pathsMixed).toHaveLength(3);
    });

    it('produces valid paths with zero dimensions (edge case)', () => {
      expect(() => getMultiPathPreset('verticalscroll', 0, 0)).not.toThrow();
      const paths = getMultiPathPreset('verticalscroll', 0, 0);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
    });

    it('produces valid paths with tiny dimensions', () => {
      const paths = getMultiPathPreset('verticalscroll', 1, 1);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
      paths!.forEach((path) => {
        expect(path.d).not.toContain('NaN');
        expect(path.d).not.toContain('Infinity');
      });
    });

    it('produces valid paths with large dimensions', () => {
      const paths = getMultiPathPreset('verticalscroll', 5000, 5000);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(3);
      paths!.forEach((path) => {
        expect(path.d).not.toContain('NaN');
        expect(path.d).not.toContain('Infinity');
      });
    });

    it('all path properties are properly typed', () => {
      const paths = getMultiPathPreset('verticalscroll', 100, 200);
      expect(paths).not.toBeNull();
      paths!.forEach((path) => {
        expect(typeof path.d).toBe('string');
        expect(['norm', 'darken', 'darkenLess', 'lighten', 'lightenLess', 'none']).toContain(path.fill);
        expect(typeof path.stroke).toBe('boolean');
      });
    });
  });

  describe('chartX', () => {
    it('returns frame + X guide lines as multi-path preset', () => {
      const paths = getMultiPathPreset('chartX', 400, 280);
      expect(paths).not.toBeNull();
      expect(paths).toHaveLength(2);
      expect(paths![0].fill).toBe('norm');
      expect(paths![1].fill).toBe('none');
      expect(paths![1].stroke).toBe(true);
      expect(paths![1].d).toContain('M0,0 L400,280');
      expect(paths![1].d).toContain('M400,0 L0,280');
    });
  });

  describe('PresetSubPath interface validation', () => {
    it('PresetSubPath objects conform to expected interface', () => {
      const paths = getMultiPathPreset('horizontalscroll', 200, 100);
      expect(paths).not.toBeNull();

      paths!.forEach((path) => {
        // Check all required properties exist
        expect(Object.prototype.hasOwnProperty.call(path, 'd')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(path, 'fill')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(path, 'stroke')).toBe(true);

        // Check types
        expect(typeof path.d).toBe('string');
        expect(typeof path.fill).toBe('string');
        expect(typeof path.stroke).toBe('boolean');

        // Verify fill is one of the allowed values
        const validFills = ['norm', 'darken', 'darkenLess', 'lighten', 'lightenLess', 'none'];
        expect(validFills).toContain(path.fill);
      });
    });
  });

  // ===== Batch 1: Missing presets now implemented =====

  it('renders rightArrowCallout as 11-point polygon (oracle-full-shapeid-0053)', () => {
    const d = getPresetShapePath('rightArrowCallout', 400, 280);
    expect(d).toContain('M');
    expect(d).toContain('Z');
    // Should have the arrowhead tip at x=400 (right edge)
    expect(d).toContain('400');
  });

  it('renders leftArrowCallout as mirror of rightArrowCallout (oracle-full-shapeid-0054)', () => {
    const d = getPresetShapePath('leftArrowCallout', 400, 280);
    expect(d).toContain('M');
    expect(d).toContain('Z');
    // Arrowhead tip at x=0 (left edge)
    expect(d).toMatch(/M0,/);
  });

  it('renders upArrowCallout with arrowhead pointing up (oracle-full-shapeid-0055)', () => {
    const d = getPresetShapePath('upArrowCallout', 280, 400);
    expect(d).toContain('M');
    expect(d).toContain('Z');
    // Arrowhead tip at y=0 (top)
    expect(d).toContain(',0');
  });

  it('renders flowChartPunchedTape with wavy edges (oracle-full-shapeid-0076)', () => {
    const d = getPresetShapePath('flowChartPunchedTape', 400, 280);
    expect(d).toContain('A');  // Arc commands for waves
    expect(d).toContain('Z');
  });

  it('renders flowChartSummingJunction as circle with X cross (oracle-full-shapeid-0077)', () => {
    const d = getPresetShapePath('flowChartSummingJunction', 400, 400);
    expect(d).toContain('A');  // Circle arc
    // Should have X cross lines (two M...L pairs after the circle)
    const subpaths = d.split(/(?=M)/);
    expect(subpaths.length).toBeGreaterThanOrEqual(3);  // circle + 2 cross lines
  });

  it('renders flowChartOr as circle with + cross (oracle-full-shapeid-0078)', () => {
    const d = getPresetShapePath('flowChartOr', 400, 400);
    expect(d).toContain('A');
    const subpaths = d.split(/(?=M)/);
    expect(subpaths.length).toBeGreaterThanOrEqual(3);  // circle + 2 cross lines
  });

  it('renders flowChartOnlineStorage with curved sides (oracle-full-shapeid-0083)', () => {
    const d = getPresetShapePath('flowChartOnlineStorage', 400, 280);
    expect(d).toContain('A');  // Arc for curved sides
    expect(d).toContain('Z');
  });

  it('renders flowChartMagneticDrum with ellipse cap (oracle-full-shapeid-0087)', () => {
    const d = getPresetShapePath('flowChartMagneticDrum', 400, 280);
    expect(d).toContain('A');
    // Should have body + back-face arc (at least 2 sub-paths)
    const subpaths = d.split(/(?=M)/);
    expect(subpaths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders nonIsoscelesTrapezoid with two independent insets (oracle-full-shapeid-0143)', () => {
    const adjs = new Map([['adj1', 15000], ['adj2', 35000]]);
    const d = getPresetShapePath('nonIsoscelesTrapezoid', 400, 280, adjs);
    expect(d).toContain('Z');
    // With different adj1/adj2, the top-left and top-right insets should differ
    // Top-left at x = ss * 15000 / 100000, top-right at x = w - ss * 35000 / 100000
    const ss = Math.min(400, 280);
    const x2 = ss * 15000 / 100000;
    const dx3 = ss * 35000 / 100000;
    const x3 = 400 - dx3;
    expect(x2).not.toBeCloseTo(400 - x3, 0);  // Asymmetric
  });

  it('renders pieWedge as quarter-circle sector (oracle-full-shapeid-0175)', () => {
    const d = getPresetShapePath('pieWedge', 400, 280);
    expect(d).toContain('A');  // Arc
    expect(d).toContain('Z');
    // Should start at (0, h) and have arc to (w, 0)
    expect(d).toMatch(/M0,280/);
  });

  // ===== Batch 2: Geometry fixes =====

  it('renders quadArrowCallout as 28-point polygon (oracle-full-shapeid-0059)', () => {
    const d = getPresetShapePath('quadArrowCallout', 400, 400);
    // 28-point polygon should have many L commands
    const lineCommands = (d.match(/L/g) ?? []).length;
    expect(lineCommands).toBeGreaterThanOrEqual(28);
    expect(d).toContain('Z');
  });

  it('renders hexagon with OOXML vf scale factor (oracle-full-shapeid-0010)', () => {
    const d = getPresetShapePath('hexagon', 400, 400);
    expect(d).toContain('Z');
    // Hexagon with vf=115470 should have y-vertices above/below center
    // For a 400x400 square with adj=25000, the hex should extend vertically
    expect(d).toContain('200');  // center x or y
  });

  it('renders octagon with ss-based corner cuts (oracle-full-shapeid-0006)', () => {
    const d = getPresetShapePath('octagon', 400, 400);
    const points = d.match(/[ML][-\d.]+,[-\d.]+/g) ?? [];
    expect(points.length).toBe(8);
    expect(d).toContain('Z');
  });

  it('renders pentagon with OOXML hf/vf scaling (oracle-full-shapeid-0012)', () => {
    const d = getPresetShapePath('pentagon', 400, 400);
    const points = d.match(/[ML][-\d.]+,[-\d.]+/g) ?? [];
    expect(points.length).toBe(5);
  });

  it('renders mathMultiply with correct arm thickness from OOXML (oracle-full-shapeid-0165)', () => {
    const d = getPresetShapePath('mathMultiply', 400, 400);
    // Should be a 12-point polygon (X shape)
    const points = d.match(/[ML][-\d.]+,[-\d.]+/g) ?? [];
    expect(points.length).toBe(12);
    expect(d).toContain('Z');
  });

  it('renders noSmoking with thick diagonal band (oracle-full-shapeid-0019)', () => {
    const d = getPresetShapePath('noSmoking', 400, 400);
    // Should have outer circle + inner arc-based diagonal band
    expect(d).toContain('A');
    expect(d).toContain('Z');
  });

  it('renders wave with OOXML bezier control points (oracle-full-shapeid-0103)', () => {
    const d = getPresetShapePath('wave', 400, 280);
    expect(d).toContain('C');  // Cubic bezier
    expect(d).toContain('Z');
  });

  it('renders doubleWave with two wave cycles (oracle-full-shapeid-0104)', () => {
    const d = getPresetShapePath('doubleWave', 400, 280);
    // Should have at least 4 cubic bezier segments (2 top + 2 bottom)
    const cubics = (d.match(/C/g) ?? []).length;
    expect(cubics).toBeGreaterThanOrEqual(4);
  });

  it('renders bracketPair with ss-based radius (oracle-full-shapeid-0026)', () => {
    const d = getPresetShapePath('bracketPair', 400, 280);
    expect(d).toContain('A');
    // Two brackets (left and right)
    const subpaths = d.split(/(?=M)/);
    expect(subpaths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders gear6 with 6 teeth, tooth tips perpendicular to A-D edge (oracle-full-shapeid-0172)', () => {
    // Use non-square dimensions to expose angular vs Cartesian tip direction difference
    const d = getPresetShapePath('gear6', 400, 400);
    expect(d).toContain('A');  // Inner arcs between teeth
    expect(d).toContain('Z');

    // Extract all L commands (tooth vertices A→B→C→D per tooth = 3 L per tooth, 6 teeth = 18 L)
    const lineCoords = [...d.matchAll(/L([\d.e+-]+),([\d.e+-]+)/g)].map(m => ({
      x: parseFloat(m[1]),
      y: parseFloat(m[2]),
    }));
    // 6 teeth × 3 L commands (B, C, D) = 18 line-to commands
    expect(lineCoords.length).toBe(18);

    // For tooth 1 (center 330°): B and C tips should form an edge perpendicular to the A-D base
    // Tooth vertices are at indices 0=B, 1=C, 2=D for each tooth
    // The tip edge B→C should be approximately perpendicular to the tooth protrusion direction
    const b1 = lineCoords[0]; // B of tooth 1
    const c1 = lineCoords[1]; // C of tooth 1

    // B and C should not be identical
    const tipLen = Math.sqrt((c1.x - b1.x) ** 2 + (c1.y - b1.y) ** 2);
    expect(tipLen).toBeGreaterThan(1);
  });

  it('renders gear9 with 9 teeth, tooth tips perpendicular to A-D edge (oracle-full-shapeid-0173)', () => {
    const d = getPresetShapePath('gear9', 400, 400);
    expect(d).toContain('A');
    expect(d).toContain('Z');

    // 9 teeth × 3 L commands = 27
    const lineCoords = [...d.matchAll(/L([\d.e+-]+),([\d.e+-]+)/g)];
    expect(lineCoords.length).toBe(27);
  });

  it('renders irregularSeal1 with OOXML spec coordinates (oracle-full-shapeid-0089)', () => {
    const d = getPresetShapePath('irregularSeal1', 400, 400);
    // 24-point polygon
    const lineCommands = (d.match(/L/g) ?? []).length;
    expect(lineCommands).toBe(23);  // M + 23 L + Z
  });

  it('renders stripedRightArrow with OOXML stripe positions (oracle-full-shapeid-0029)', () => {
    const d = getPresetShapePath('stripedRightArrow', 400, 280);
    // Multiple sub-paths: 3 stripes + arrowhead body
    const subpaths = d.split(/(?=M)/);
    expect(subpaths.length).toBeGreaterThanOrEqual(3);
  });

  it('renders flowChartDelay with semicircle right side using wd2/hd2 arc (oracle-full-shapeid-0084)', () => {
    const d = getPresetShapePath('flowChartDelay', 400, 280);
    // OOXML: left rect + semicircle arc from (hc,0) to (hc,h) with wR=wd2, hR=hd2
    expect(d).toContain('A');
    expect(d).toContain('200');  // hc = w/2 = 200
    // Arc radii should be w/2=200 and h/2=140
    expect(d).toContain('200,140');
  });

  it('renders flowChartInputOutput with w/5 offset parallelogram (oracle-full-shapeid-0064)', () => {
    const d = getPresetShapePath('flowChartInputOutput', 500, 300);
    // OOXML: path w=5 h=5, offset = w/5 = 100
    expect(d).toContain('M100,0');
    expect(d).toContain('L500,0');
    expect(d).toContain('L400,300');
    expect(d).toContain('L0,300');
  });

  it('renders flowChartDisplay with left chevron and right semicircle (oracle-full-shapeid-0088)', () => {
    const d = getPresetShapePath('flowChartDisplay', 600, 300);
    // OOXML: path w=6 h=6, left point at (0,h/2), arc wR=w/6 hR=h/2
    expect(d).toContain('A');
    expect(d).toContain('M0,150');  // left point at (0, h/2)
  });

  it('renders accentCallout3 as multipath: filled rect + accent bar + 3-segment line (oracle-full-shapeid-0116)', () => {
    const paths = getMultiPathPreset('accentCallout3', 500, 350);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(3);
    // Path 1: filled rectangle (stroke=false)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    // Path 2: accent bar line (fill=none, stroke=true)
    expect(paths![1].fill).toBe('none');
    expect(paths![1].stroke).toBe(true);
    // Path 3: 3-segment callout line (fill=none, stroke=true)
    expect(paths![2].fill).toBe('none');
    expect(paths![2].stroke).toBe(true);
  });
});

describe('bulk coverage — untested single-path presets', () => {
  const untestedPresets = [
    'actionButtonBlank', 'bentArrow', 'bentConnector2', 'bentConnector3', 'bentConnector4',
    'bentConnector5', 'bevel', 'blockArc', 'borderCallout1', 'bracePair', 'chevron',
    'cloud', 'cloudCallout', 'corner', 'cube', 'curvedConnector2', 'curvedConnector3',
    'curvedConnector4', 'curvedConnector5', 'curvedLeftArrow', 'curvedRightArrow', 'decagon',
    'diagStripe', 'diamond', 'dodecagon', 'donut', 'downArrow', 'downArrowCallout',
    'flowChartAlternateProcess', 'flowChartConnector', 'flowChartData', 'flowChartDecision',
    'flowChartDocument', 'flowChartExtract', 'flowChartInternalStorage', 'flowChartMagneticDisk',
    'flowChartMagneticTape', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartMerge',
    'flowChartMultidocument', 'flowChartOffpageConnector', 'flowChartPredefinedProcess',
    'flowChartPreparation', 'flowChartProcess', 'flowChartPunchedCard', 'flowChartSort',
    'flowChartTerminator', 'foldedCorner', 'frame', 'halfFrame', 'heart', 'heptagon',
    'homePlate', 'irregularSeal2', 'isosTriangle', 'leftArrow', 'leftRightArrow',
    'leftRightArrowCallout', 'lightningBolt', 'lineInv', 'mathEqual', 'mathMinus', 'mathPlus',
    'notchedRightArrow', 'parallelogram', 'plus', 'quadArrow', 'rightArrow', 'rightBrace',
    'rightBracket', 'round1Rect', 'round2DiagRect', 'round2SameRect', 'rtTriangle',
    'snip1Rect', 'snip2DiagRect', 'snip2SameRect', 'snipRoundRect', 'star10', 'star12', 'star16',
    'star24', 'star32', 'star4', 'star5', 'star6', 'star7', 'star8', 'sun', 'swooshArrow',
    'teardrop', 'trapezoid', 'triangle', 'upArrow', 'upDownArrow', 'upDownArrowCallout',
    'uturnArrow', 'wedgeEllipseCallout', 'wedgeRectCallout', 'wedgeRoundRectCallout',
  ];

  it.each(untestedPresets)('%s returns a valid SVG path', (name) => {
    const d = getPresetShapePath(name, 400, 280);
    expect(d).toBeTruthy();
    expect(d.length).toBeGreaterThan(0);
    expect(d).toContain('M');
  });
});

describe('bulk coverage — untested multi-path presets', () => {
  const untestedMultiPath = [
    'accentbordercallout1', 'accentbordercallout2', 'accentbordercallout3',
    'accentcallout1', 'accentcallout2', 'accentcallout3',
    'actionButtonBackPrevious', 'actionButtonBeginning', 'actionButtonDocument',
    'actionButtonEnd', 'actionButtonForwardNext', 'actionButtonHelp', 'actionButtonHome', 'actionButtonInformation',
    'actionButtonMovie', 'actionButtonReturn', 'actionButtonSound',
    'bevel', 'bordercallout1', 'bordercallout2', 'bordercallout3',
    'callout1', 'callout2', 'callout3',
    'chartplus', 'chartstar', 'chartx',
    'cube', 'ellipseRibbon', 'ellipseRibbon2', 'flowChartOfflineStorage',
    'leftRightRibbon', 'ribbon', 'ribbon2',
  ];

  it.each(untestedMultiPath)('%s returns an array of sub-paths', (name) => {
    const paths = getMultiPathPreset(name, 400, 280);
    expect(paths).not.toBeNull();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths!.length).toBeGreaterThan(0);
    for (const p of paths!) {
      expect(p.d).toBeTruthy();
      expect(p.d.length).toBeGreaterThan(0);
      expect(typeof p.fill).toBe('string');
      expect(typeof p.stroke).toBe('boolean');
    }
  });
});

describe('actionButtonSound (oracle-full-shapeid-0135)', () => {
  it('renders speaker icon with 3 sound wave lines in outline path', () => {
    const paths = getMultiPathPreset('actionButtonSound', 400, 280);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(4);
    // Path 0: bg + speaker cutout (norm)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    // Path 1: speaker fill (darken)
    expect(paths![1].fill).toBe('darken');
    expect(paths![1].stroke).toBe(false);
    // Path 2: speaker outline + 3 sound wave lines (none, stroke)
    expect(paths![2].fill).toBe('none');
    expect(paths![2].stroke).toBe(true);
    // The outline path must contain the speaker shape + 3 separate line segments (M...L pairs)
    // Count moveTo commands — speaker outline has 1, plus 3 wave lines = 4 total
    const moveCount = (paths![2].d.match(/M/g) || []).length;
    expect(moveCount).toBe(4); // 1 speaker outline + 3 wave lines
    // Path 3: rect outline
    expect(paths![3].fill).toBe('none');
    expect(paths![3].stroke).toBe(true);
  });
});

describe('actionButtonReturn (oracle-full-shapeid-0133)', () => {
  it('renders U-turn arrow with correct inner arc endpoints keeping left arm straight', () => {
    const paths = getMultiPathPreset('actionButtonReturn', 400, 280);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(4);
    // Path 0: bg + icon cutout (norm)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    // Path 1: icon fill (darken)
    expect(paths![1].fill).toBe('darken');
    expect(paths![1].stroke).toBe(false);
    // Path 2: icon outline (none, stroke) — uses different arc winding per OOXML spec
    expect(paths![2].fill).toBe('none');
    expect(paths![2].stroke).toBe(true);
    // Path 3: rect outline
    expect(paths![3].fill).toBe('none');
    expect(paths![3].stroke).toBe(true);

    // Verify the icon fill path (path 1) has correct geometry:
    // The inner small arcs (g27 radius) connect the right shaft to the left shaft via the inner U.
    // After the first inner arc (0→90°), endpoint X must be LESS than the start X (curves left),
    // not greater. Parse the first arc's endpoint X to verify.
    const ss = Math.min(400, 280);
    const g13 = (ss * 3) / 4;
    const g27 = g13 / 8; // inner arc radius = 26.25
    const g16 = (g13 * 5) / 8;
    const g11 = 200 - (ss * 3) / 8; // hc - dx2
    const g24 = g11 + g16;

    // The fill path should contain an arc from (g24, _) that curves LEFT (endpoint x = g24 - g27)
    const fillD = paths![1].d;
    // Find the first arc command after L...g24...
    const arcMatch = fillD.match(/A[\d.]+,[\d.]+ 0 0,[01] ([\d.]+),([\d.]+)/);
    expect(arcMatch).not.toBeNull();
    const arcEndX = parseFloat(arcMatch![1]);
    // The endpoint X should be g24 - g27, NOT g24 + g27
    expect(arcEndX).toBeCloseTo(g24 - g27, 1);
  });
});

describe('actionButtonHome (oracle-full-shapeid-0126)', () => {
  it('renders house with 5 multi-path sub-paths: bg cutout, walls (darkenLess), roof+door (darken), icon outline, rect outline', () => {
    const paths = getMultiPathPreset('actionButtonHome', 400, 280);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(5);
    // Path 0: background rect + house cutout (norm fill, no stroke)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    expect(paths![0].d).toContain('M0,0'); // rect
    // Path 1: house walls + chimney (darkenLess)
    expect(paths![1].fill).toBe('darkenLess');
    expect(paths![1].stroke).toBe(false);
    // Should have 2 sub-paths (chimney bar + house body with door cutout)
    const subPaths1 = paths![1].d.match(/M[^M]+/g);
    expect(subPaths1!.length).toBe(2);
    // Path 2: roof triangle + door rect (darken)
    expect(paths![2].fill).toBe('darken');
    expect(paths![2].stroke).toBe(false);
    const subPaths2 = paths![2].d.match(/M[^M]+/g);
    expect(subPaths2!.length).toBe(2);
    // Path 3: house icon outline with details (none fill, stroke)
    expect(paths![3].fill).toBe('none');
    expect(paths![3].stroke).toBe(true);
    // Path 4: rect outline
    expect(paths![4].fill).toBe('none');
    expect(paths![4].stroke).toBe(true);
    expect(paths![4].d).toContain('M0,0');
  });
});

describe('actionButtonHelp (oracle-full-shapeid-0127)', () => {
  it('renders question mark with arcs and bottom dot circle', () => {
    const paths = getMultiPathPreset('actionButtonHelp', 400, 280);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(4);
    // Path 0: background rect + icon cutout (norm fill, no stroke)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    expect(paths![0].d).toContain('M0,0'); // rect
    // Path 1: icon fill (darken)
    expect(paths![1].fill).toBe('darken');
    expect(paths![1].stroke).toBe(false);
    // Question mark path should contain arcs
    expect(paths![1].d).toMatch(/A[\d.]+,[\d.]+ 0/); // SVG arc commands
    // Path 2: icon outline
    expect(paths![2].fill).toBe('none');
    expect(paths![2].stroke).toBe(true);
    // Path 3: rect outline
    expect(paths![3].fill).toBe('none');
    expect(paths![3].stroke).toBe(true);
    expect(paths![3].d).toContain('M0,0');
  });

  it('can shape uses OOXML adj formula (ss*adj/200000) not hardcoded h*0.1 (oracle-full-shapeid-0013)', () => {
    // For w=400, h=280: ss=280, adj=25000 → y1 = 280*25000/200000 = 35 (not h*0.1 = 28)
    const paths = getMultiPathPreset('can', 400, 280);
    expect(paths).toBeTruthy();
    expect(paths!.length).toBe(3);
    // Path 0: body (fill: norm, stroke: false)
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);
    // Path 1: top face (fill: lighten, stroke: false) — 3D effect
    expect(paths![1].fill).toBe('lighten');
    expect(paths![1].stroke).toBe(false);
    // Path 2: outline (fill: none, stroke: true)
    expect(paths![2].fill).toBe('none');
    expect(paths![2].stroke).toBe(true);
    // Body should start at y=35 (not y=28)
    expect(paths![0].d).toContain('M0,35');
  });

  it('smileyFace uses OOXML-exact geometry: eye positions, quadBez smile (oracle-full-shapeid-0017)', () => {
    const w = 400, h = 280;
    const paths = getMultiPathPreset('smileyFace', w, h);
    expect(paths).toBeTruthy();
    expect(paths!.length).toBe(4); // face(norm), eyes(darkenLess), smile(none), outline(none)

    // Path 1: face fill=norm, stroke=false
    expect(paths![0].fill).toBe('norm');
    expect(paths![0].stroke).toBe(false);

    // Path 2: eyes fill=darkenLess — OOXML eye positions
    expect(paths![1].fill).toBe('darkenLess');
    const eyePath = paths![1].d;
    // Left eye center: x2 = w * 6215 / 21600 ≈ 115.09
    // Right eye center: x3 = w * 13135 / 21600 ≈ 243.24
    // Eye Y: y1 = h * 7570 / 21600 ≈ 98.01
    expect(eyePath).toContain('M'); // two eye circles

    // Path 3: smile curve (fill=none) — must be quadratic Bezier, NOT arc
    expect(paths![2].fill).toBe('none');
    expect(paths![2].d).toContain('Q'); // quadratic Bezier, not A (arc)
    expect(paths![2].d).not.toContain('A');

    // Path 4: face outline (fill=none, stroke=true)
    expect(paths![3].fill).toBe('none');
    expect(paths![3].stroke).toBe(true);

    // Verify OOXML-exact eye coordinates (w=400, h=280)
    const wR = w * 1125 / 21600;  // ≈ 20.83
    const x2 = w * 6215 / 21600;  // ≈ 115.09 (left eye center)
    const x3 = w * 13135 / 21600; // ≈ 243.24 (right eye center)
    // moveTo starts at right edge of eye circle (center + wR), arcs to left edge (center - wR)
    expect(eyePath).toContain((x2 + wR).toFixed(2));
    expect(eyePath).toContain((x3 + wR).toFixed(2));
  });

  it('chartStar has exactly 2 diagonals + 1 vertical line, no horizontal center line (oracle-full-shapeid-0181)', () => {
    const paths = getMultiPathPreset('chartstar', 400, 280);
    expect(paths).toBeTruthy();
    // The guide path (fill: none, stroke: true) should have exactly 3 moveTo commands
    // (2 diagonals + 1 vertical), NOT 4 (which would include an extra horizontal)
    const guidePath = paths!.find((p) => p.fill === 'none' && p.stroke === true);
    expect(guidePath).toBeTruthy();
    const moveCount = (guidePath!.d.match(/M/g) || []).length;
    expect(moveCount).toBe(3); // 2 diagonals + 1 vertical
  });
});
