/**
 * Verify that all public API types and functions are importable from the package root.
 * This test catches accidental removal of exports.
 */
import { describe, expect, it } from 'vitest';

import {
  PptxViewer,
  PptxRenderer,
  parseZip,
  parseZipLazyMedia,
  RECOMMENDED_ZIP_LIMITS,
  buildPresentation,
  serializePresentation,
  buildTextIndex,
  searchPresentation,
  searchText,
  renderSlide,
} from '../../src/index';

// Type-only imports — these just need to compile, not be used at runtime.
import type {
  ViewerOptions,
  ListRenderOptions,
  ThumbnailRenderOptions,
  SearchHighlightHandle,
  SearchHighlightOptions,
  PptxViewerEventMap,
  RendererOptions,
  PreviewInput,
  FitMode,
  ZipParseLimits,
  PresentationData,
  SerializedPresentation,
  SerializedSlide,
  SerializedNode,
  SearchTextKind,
  TextBounds,
  TextIndexEntry,
  TextIndexOptions,
  TextSearchOptions,
  TextSearchResult,
  SlideHandle,
  SlideRendererOptions,
  PdfjsOptions,
  PdfjsConfig,
  SlideData,
  SlideNode,
  ThemeData,
  BaseNodeData,
  Position,
  Size,
  NodeType,
  PlaceholderInfo,
  HlinkAction,
  ShapeNodeData,
  TextBody,
  TextParagraph,
  TextRun,
  LineEndInfo,
  TextBoxBounds,
  PicNodeData,
  CropRect,
  TableNodeData,
  TableCell,
  TableRow,
  GroupNodeData,
  ChartNodeData,
  PptxFiles,
  MediaResolver,
  ResolvedMedia,
} from '../../src/index';

type _PdfjsOptionsCompileCheck = PdfjsOptions;
type _PdfjsConfigCompileCheck = PdfjsConfig;
type _ThumbnailRenderOptionsCompileCheck = ThumbnailRenderOptions;
type _SearchHighlightHandleCompileCheck = SearchHighlightHandle;
type _SearchHighlightOptionsCompileCheck = SearchHighlightOptions;
type _SearchTextKindCompileCheck = SearchTextKind;
type _TextBoundsCompileCheck = TextBounds;
type _TextIndexEntryCompileCheck = TextIndexEntry;
type _TextIndexOptionsCompileCheck = TextIndexOptions;
type _TextSearchOptionsCompileCheck = TextSearchOptions;
type _TextSearchResultCompileCheck = TextSearchResult;
type _MediaResolverCompileCheck = MediaResolver;
type _ResolvedMediaCompileCheck = ResolvedMedia;

describe('package exports', () => {
  it('exports PptxViewer class', () => {
    expect(PptxViewer).toBeDefined();
    expect(typeof PptxViewer).toBe('function');
  });

  it('exports PptxRenderer class (deprecated)', () => {
    expect(PptxRenderer).toBeDefined();
    expect(typeof PptxRenderer).toBe('function');
  });

  it('exports parseZip function', () => {
    expect(typeof parseZip).toBe('function');
  });

  it('exports parseZipLazyMedia function', () => {
    expect(typeof parseZipLazyMedia).toBe('function');
  });

  it('exports recommended ZIP limits for untrusted PPTX input', () => {
    expect(RECOMMENDED_ZIP_LIMITS.maxEntries).toBeGreaterThan(0);
    expect(RECOMMENDED_ZIP_LIMITS.maxTotalUncompressedBytes).toBeGreaterThan(0);
    expect(RECOMMENDED_ZIP_LIMITS.maxMediaBytes).toBeGreaterThan(0);
  });

  it('exports buildPresentation function', () => {
    expect(typeof buildPresentation).toBe('function');
  });

  it('exports serializePresentation function', () => {
    expect(typeof serializePresentation).toBe('function');
  });

  it('exports text search helpers', () => {
    expect(typeof buildTextIndex).toBe('function');
    expect(typeof searchText).toBe('function');
    expect(typeof searchPresentation).toBe('function');
  });

  it('exports renderSlide function', () => {
    expect(typeof renderSlide).toBe('function');
  });

  it('does not export init() (removed in v1.0.0)', async () => {
    const mod = await import('../../src/index');
    expect('init' in mod).toBe(false);
  });
});
