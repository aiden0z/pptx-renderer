/**
 * Verify that all public API types and functions are importable from the package root.
 * This test catches accidental removal of exports.
 */
import { describe, expect, it } from 'vitest';

import {
  PptxViewer,
  PptxRenderer,
  parseZip,
  buildPresentation,
  serializePresentation,
  renderSlide,
} from '../../src/index';

// Type-only imports — these just need to compile, not be used at runtime.
import type {
  ViewerOptions,
  ListRenderOptions,
  PptxViewerEventMap,
  RendererOptions,
  PreviewInput,
  FitMode,
  ZipParseLimits,
  PresentationData,
  SerializedPresentation,
  SerializedSlide,
  SerializedNode,
  SlideHandle,
  SlideRendererOptions,
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
} from '../../src/index';

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

  it('exports buildPresentation function', () => {
    expect(typeof buildPresentation).toBe('function');
  });

  it('exports serializePresentation function', () => {
    expect(typeof serializePresentation).toBe('function');
  });

  it('exports renderSlide function', () => {
    expect(typeof renderSlide).toBe('function');
  });

  it('does not export init() (removed in v1.0.0)', async () => {
    const mod = await import('../../src/index');
    expect('init' in mod).toBe(false);
  });
});
