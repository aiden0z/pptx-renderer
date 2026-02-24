/**
 * Test helper — create a minimal RenderContext for unit testing renderers.
 */

import type { RenderContext } from '../../../src/renderer/RenderContext';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import type { ThemeData } from '../../../src/model/Theme';
import type { MasterData } from '../../../src/model/Master';
import type { LayoutData } from '../../../src/model/Layout';
import { SafeXmlNode } from '../../../src/parser/XmlParser';

function emptyXmlNode(): SafeXmlNode {
  return new SafeXmlNode(null);
}

export function createMockRenderContext(
  overrides?: Partial<RenderContext>,
): RenderContext {
  const theme: ThemeData = {
    colorScheme: new Map([
      ['dk1', '000000'],
      ['dk2', '44546A'],
      ['lt1', 'FFFFFF'],
      ['lt2', 'E7E6E6'],
      ['accent1', '4472C4'],
      ['accent2', 'ED7D31'],
      ['accent3', 'A5A5A5'],
      ['accent4', 'FFC000'],
      ['accent5', '5B9BD5'],
      ['accent6', '70AD47'],
      ['hlink', '0563C1'],
      ['folHlink', '954F72'],
    ]),
    majorFont: { latin: 'Calibri', ea: '', cs: '' },
    minorFont: { latin: 'Calibri', ea: '', cs: '' },
    fillStyles: [],
    lineStyles: [],
    effectStyles: [],
  };

  const master: MasterData = {
    colorMap: new Map([
      ['tx1', 'dk1'],
      ['tx2', 'dk2'],
      ['bg1', 'lt1'],
      ['bg2', 'lt2'],
    ]),
    textStyles: {},
    placeholders: [],
    spTree: emptyXmlNode(),
    rels: new Map(),
  };

  const layout: LayoutData = {
    placeholders: [],
    spTree: emptyXmlNode(),
    rels: new Map(),
    showMasterSp: true,
  };

  const slide: SlideData = {
    index: 0,
    nodes: [],
    layoutIndex: '',
    rels: new Map(),
    showMasterSp: true,
  };

  const presentation: PresentationData = {
    width: 960,
    height: 540,
    slides: [slide],
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  };

  return {
    presentation,
    slide,
    theme,
    master,
    layout,
    mediaUrlCache: new Map(),
    colorCache: new Map(),
    ...overrides,
  };
}
