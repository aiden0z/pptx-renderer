import { beforeAll, describe, expect, it } from 'vitest';
import * as runtime from '../../../src/shapes/ooxmlGeometryRuntime';
import {
  compilePresetShapeDefinitions,
  evaluatePresetShape,
} from '../../../scripts/ooxml-geometry/geometry-ir.mjs';
import { buildRuntimeGeometryModule } from '../../../scripts/ooxml-geometry/generate.mjs';
import { loadPinnedPresetShapeDefinitions } from '../../../scripts/ooxml-geometry/source-validator.mjs';
import manifest from '../../../scripts/ooxml-geometry/source-manifest.json';
import reconciliation from '../../../scripts/ooxml-geometry/source-reconciliation.json';

let ir: ReturnType<typeof compilePresetShapeDefinitions>;
beforeAll(async () => {
  const source = await loadPinnedPresetShapeDefinitions(process.cwd(), manifest);
  ir = compilePresetShapeDefinitions(source.xml, manifest, reconciliation);
});

describe('preset text rectangles (issue #37)', () => {
  it('projects all text rectangles with only their guide dependencies, preserving path rollout', () => {
    const generated = buildRuntimeGeometryModule(ir);
    const match = generated.match(/OOXML_PRESET_TEXT_RECTANGLE_DEFINITIONS = ([\s\S]*?) as const;/);
    expect(match).not.toBeNull();
    const definitions = JSON.parse(match![1]);
    expect(definitions.map((d: { name: string }) => d.name)).toEqual(
      ir.shapes
        .filter((s: { textRectangle: unknown }) => s.textRectangle)
        .map((s: { name: string }) => s.name),
    );
    const document = definitions.find((d: { name: string }) => d.name === 'flowChartDocument');
    expect(document.calculatedGuides.map((g: { name: string }) => g.name)).toEqual(['y1']);
    expect(document).not.toHaveProperty('paths');
    expect(runtime.ooxmlPresetRuntimeShapeNames).not.toContain('cloud');
  });

  it('uses the document text rectangle and supports case-insensitive lookup', () => {
    expect(runtime.getOoxmlPresetTextRectangle('FLOWCHARTDOCUMENT', 288, 144)).toEqual({
      x: 0,
      y: 0,
      w: 288,
      h: 115.48,
    });
  });

  it('matches every pinned preset at square, wide and tall extents', () => {
    for (const [width, height] of [
      [216, 216],
      [400, 180],
      [180, 400],
    ]) {
      for (const shape of ir.shapes) {
        const expected = evaluatePresetShape(shape, { width, height }).textRectangle;
        let actual;
        try {
          actual = runtime.getOoxmlPresetTextRectangle(shape.name, width, height);
        } catch (error) {
          throw new Error(`${shape.name}: ${String(error)}`);
        }
        if (!expected) expect(actual, shape.name).toBeNull();
        else {
          expect(actual, shape.name).not.toBeNull();
          for (const [field, value] of Object.entries({
            x: expected.left,
            y: expected.top,
            w: expected.right - expected.left,
            h: expected.bottom - expected.top,
          })) {
            expect(actual![field as 'x' | 'y' | 'w' | 'h'], `${shape.name}.${field}`).toBeCloseTo(
              value as number,
              6,
            );
          }
        }
      }
    }
  });

  it('evaluates text guides against the authored wave and roundRect adjustments', () => {
    for (const name of ['wave', 'roundRect']) {
      const shape = ir.shapes.find((s: { name: string }) => s.name === name);
      const variants =
        name === 'wave'
          ? [
              new Map([
                ['adj1', 0],
                ['adj2', -10000],
              ]),
              new Map([
                ['adj1', 20000],
                ['adj2', 10000],
              ]),
            ]
          : [new Map([['adj', 0]]), new Map([['adj', 50000]])];
      for (const overrides of variants) {
        const expected = evaluatePresetShape(shape, {
          width: 400,
          height: 180,
          adjustments: Object.fromEntries(overrides),
        }).textRectangle;
        const actual = runtime.getOoxmlPresetTextRectangle(name, 400, 180, overrides)!;
        expect(actual.x).toBeCloseTo(expected.left, 6);
        expect(actual.y).toBeCloseTo(expected.top, 6);
        expect(actual.w).toBeCloseTo(expected.right - expected.left, 6);
        expect(actual.h).toBeCloseTo(expected.bottom - expected.top, 6);
      }
    }
  });

  it.each(['leftUpArrow', 'leftRightUpArrow', 'quadArrow'])(
    'falls back for degenerate %s text guides with an explicit zero adjustment',
    (preset) => {
      expect(
        runtime.getOoxmlPresetTextRectangle(preset, 288, 144, new Map([['adj2', 0]])),
      ).toBeNull();
    },
  );

  it('falls back for unknown presets and zero/non-finite dimensions', () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ])
      expect(runtime.getOoxmlPresetTextRectangle('rect', w, h)).toBeNull();
    expect(runtime.getOoxmlPresetTextRectangle('unknown', 100, 100)).toBeNull();
    expect(runtime.getOoxmlPresetTextRectangle('rect', 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });
});
