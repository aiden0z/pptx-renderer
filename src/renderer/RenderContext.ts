/**
 * Render context — provides resolved theme/master/layout chain for a given slide.
 */

import { PresentationData } from '../model/Presentation';
import { SlideData } from '../model/Slide';
import { ThemeData } from '../model/Theme';
import { MasterData } from '../model/Master';
import { LayoutData } from '../model/Layout';
import { SafeXmlNode } from '../parser/XmlParser';
import type { EChartsType } from 'echarts/core';
import type { PdfjsConfig } from '../utils/pdfRenderer';
import type { ExternalMediaPolicy } from '../utils/urlSafety';

export interface RenderContext {
  presentation: PresentationData;
  slide: SlideData;
  theme: ThemeData;
  master: MasterData;
  layout: LayoutData;
  /** Current OOXML part path used for resolving relationships while rendering this context. */
  partPath?: string;
  /** Resolved slide layout part path for the current slide. */
  layoutPath?: string;
  /** Resolved slide master part path for the current slide. */
  masterPath?: string;
  mediaUrlCache: Map<string, string>; // path -> blob URL
  colorCache: Map<string, { color: string; alpha: number }>;
  /** Async media/rendering work that callers may await before screenshot/export. */
  asyncTasks?: Promise<void>[];
  /** Presentation-specific embedded CSS families referenced by this render. */
  usedEmbeddedFontFamilies?: Set<string>;
  /** Aborted when the owning slide is disposed; async renderers must stop late writes. */
  signal?: AbortSignal;
  /** Optional pdfjs URLs for EMF-embedded PDF fallback rendering. */
  pdfjs?: PdfjsConfig;
  /** External media relationship policy; omitted means allow. */
  externalMedia?: ExternalMediaPolicy;
  /** Shared set of live ECharts instances for explicit disposal. */
  chartInstances?: Set<EChartsType>;
  /** Fill node from parent group's grpSpPr, used to resolve `a:grpFill` in children. */
  groupFillNode?: SafeXmlNode;
  /** Template provenance and group depth keep narrowly verified renderer lanes from overclaiming. */
  nodeOrigin?: 'slide' | 'layout' | 'master';
  groupDepth?: number;
  /** Scale from the current group child's OOXML coordinate space into rendered slide pixels. */
  groupChildScale?: { x: number; y: number };
  /** True when any ancestor group rotates or flips this node's rendered coordinate space. */
  groupTransformHasRotationOrFlip?: boolean;
  /** True when an ancestor group declares a 3D scene, whether supported or kept flat. */
  groupAncestorHas3dScene?: boolean;
  /** Connected root used for hidden text measurement while slide nodes are still detached. */
  measurementRoot?: HTMLElement;
  /** Template rendering skips placeholder descendants inside groups as well as top-level shapes. */
  skipPlaceholderChildren?: boolean;
  /**
   * Navigation callback for shape-level hyperlink actions (action buttons, clickable shapes).
   * Called with target slide index (0-based) for supported internal slide actions,
   * or with a URL string for external links.
   */
  onNavigate?: (target: { slideIndex?: number; url?: string }) => void;
}

export function createRenderContext(
  presentation: PresentationData,
  slide: SlideData,
  mediaUrlCache?: Map<string, string>,
  chartInstances?: Set<EChartsType>,
  pdfjs?: PdfjsConfig,
  signal?: AbortSignal,
): RenderContext {
  // Resolve the chain: slide -> layout -> master -> theme
  const layoutPath = presentation.slideToLayout.get(slide.index) || '';
  const masterPath = presentation.layoutToMaster.get(layoutPath) || '';
  const themePath = presentation.masterToTheme.get(masterPath) || '';

  const layout: LayoutData = presentation.layouts.get(layoutPath) || {
    placeholders: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spTree: {} as any,
    rels: new Map(),
    showMasterSp: true,
  };

  const master: MasterData = presentation.masters.get(masterPath) || {
    colorMap: new Map(),
    textStyles: {},
    placeholders: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spTree: {} as any,
    rels: new Map(),
  };

  const theme: ThemeData = presentation.themes.get(themePath) || {
    colorScheme: new Map(),
    majorFont: { latin: 'Calibri', ea: '', cs: '' },
    minorFont: { latin: 'Calibri', ea: '', cs: '' },
    fillStyles: [],
    bgFillStyles: [],
    lineStyles: [],
    effectStyles: [],
  };

  return {
    presentation,
    slide,
    theme,
    master,
    layout,
    partPath: slide.slidePath,
    layoutPath,
    masterPath,
    mediaUrlCache: mediaUrlCache ?? new Map(),
    colorCache: new Map(),
    nodeOrigin: 'slide',
    groupDepth: 0,
    groupAncestorHas3dScene: false,
    usedEmbeddedFontFamilies: new Set(),
    pdfjs,
    signal,
    chartInstances,
  };
}
