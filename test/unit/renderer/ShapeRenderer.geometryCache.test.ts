import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import type { ShapeNodeData } from '../../../src/model/nodes/ShapeNode';
import { createMockRenderContext } from '../helpers/mockContext';

vi.mock('../../../src/shapes/presets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shapes/presets')>();
  return {
    ...actual,
    getMultiPathPreset: vi.fn(actual.getMultiPathPreset),
    getPresetShapePath: vi.fn(actual.getPresetShapePath),
  };
});

const { renderShape } = await import('../../../src/renderer/ShapeRenderer');
const { getMultiPathPreset, getPresetShapePath } = await import('../../../src/shapes/presets');

function makeRectShape(): ShapeNodeData {
  const source = parseXml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr><p:cNvPr id="1" name="Cached Rect"/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  `);

  return {
    id: '1',
    name: 'Cached Rect',
    nodeType: 'shape',
    position: { x: 0, y: 0 },
    size: { w: 96, h: 96 },
    rotation: 0,
    flipH: false,
    flipV: false,
    source,
    presetGeometry: 'rect',
    adjustments: new Map(),
  };
}

describe('renderShape preset geometry cache', () => {
  beforeEach(() => {
    vi.mocked(getMultiPathPreset).mockClear();
    vi.mocked(getPresetShapePath).mockClear();
  });

  it('reuses preset geometry for the same parsed shape node', () => {
    const shape = makeRectShape();
    const ctx = createMockRenderContext();

    renderShape(shape, ctx);
    renderShape(shape, ctx);

    expect(getMultiPathPreset).toHaveBeenCalledTimes(1);
    expect(getPresetShapePath).toHaveBeenCalledTimes(1);
  });
});
