// New primary exports (v2 API)
export { PptxViewer } from './core/Viewer';
export type {
  ViewerOptions,
  FitMode,
  ListRenderOptions,
  PptxViewerEventMap,
  PreviewInput,
} from './core/Viewer';

// Deprecated aliases (v1 compat)
export { PptxRenderer } from './core/Renderer';
export type { RendererOptions } from './core/Renderer';

export { parseZip } from './parser/ZipParser';
export type { ZipParseLimits } from './parser/ZipParser';

export { buildPresentation } from './model/Presentation';
export type { PresentationData } from './model/Presentation';

export { serializePresentation } from './export/serializePresentation';
export type {
  SerializedPresentation,
  SerializedSlide,
  SerializedNode,
} from './export/serializePresentation';

// Headless single-slide rendering
export { renderSlide } from './renderer/SlideRenderer';
export type { SlideHandle, SlideRendererOptions } from './renderer/SlideRenderer';

// Model types
export type { SlideData, SlideNode } from './model/Slide';
export type { ThemeData } from './model/Theme';
export type {
  BaseNodeData,
  Position,
  Size,
  NodeType,
  PlaceholderInfo,
  HlinkAction,
} from './model/nodes/BaseNode';
export type {
  ShapeNodeData,
  TextBody,
  TextParagraph,
  TextRun,
  LineEndInfo,
  TextBoxBounds,
} from './model/nodes/ShapeNode';
export type { PicNodeData, CropRect } from './model/nodes/PicNode';
export type { TableNodeData, TableCell, TableRow } from './model/nodes/TableNode';
export type { GroupNodeData } from './model/nodes/GroupNode';
export type { ChartNodeData } from './model/nodes/ChartNode';
export type { PptxFiles } from './parser/ZipParser';
