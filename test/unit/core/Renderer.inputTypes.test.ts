import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

vi.mock('../../../src/model/Presentation', () => ({
  buildPresentation: vi.fn(() => ({
    width: 1000,
    height: 750,
    slides: [],
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  })),
}));

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn(() => {
    const el = document.createElement('div');
    return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
  }),
}));

import { parseZip } from '../../../src/parser/ZipParser';
import { PptxRenderer } from '../../../src/core/Renderer';
import { normalizePreviewInput } from '../../../src/core/Viewer';

describe('PptxRenderer preview input types', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts ArrayBuffer input', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    const input = new ArrayBuffer(4);
    await renderer.preview(input);

    expect(parseZip).toHaveBeenCalledTimes(1);
    expect(parseZip).toHaveBeenCalledWith(input, undefined);
  });

  it('accepts Uint8Array input', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    const input = new Uint8Array([1, 2, 3, 4]);
    await renderer.preview(input);

    expect(parseZip).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(parseZip).mock.calls[0][0];
    expect(arg).toBeInstanceOf(ArrayBuffer);
    expect((arg as ArrayBuffer).byteLength).toBe(4);
  });

  it('accepts Blob input', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    const input = new Blob([new Uint8Array([9, 8, 7])]);
    await renderer.preview(input);

    expect(parseZip).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(parseZip).mock.calls[0][0];
    expect(arg).toBeInstanceOf(ArrayBuffer);
    expect((arg as ArrayBuffer).byteLength).toBe(3);
  });
});

describe('normalizePreviewInput fallback runtimes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses FileReader when blob-like input has no arrayBuffer method', async () => {
    const expected = new Uint8Array([7, 8, 9]).buffer;

    class FakeFileReader {
      result: ArrayBuffer | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(_blob: Blob): void {
        this.result = expected;
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', FakeFileReader);

    await expect(normalizePreviewInput({} as Blob)).resolves.toBe(expected);
  });

  it('rejects with FileReader.error when FileReader fails', async () => {
    const expectedError = new Error('reader failed');

    class FakeFileReader {
      result: ArrayBuffer | null = null;
      error: Error | null = expectedError;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(_blob: Blob): void {
        this.onerror?.();
      }
    }

    vi.stubGlobal('FileReader', FakeFileReader);

    await expect(normalizePreviewInput({} as Blob)).rejects.toThrow(expectedError);
  });

  it('falls back to Response.arrayBuffer when FileReader is unavailable', async () => {
    const expected = new Uint8Array([1, 2, 3, 4]).buffer;

    class FakeResponse {
      constructor(_body: unknown) {}
      async arrayBuffer(): Promise<ArrayBuffer> {
        return expected;
      }
    }

    vi.stubGlobal('FileReader', undefined);
    vi.stubGlobal('Response', FakeResponse);

    await expect(normalizePreviewInput({} as Blob)).resolves.toBe(expected);
  });

  it('throws when blob-like input cannot be read by any runtime API', async () => {
    vi.stubGlobal('FileReader', undefined);
    vi.stubGlobal('Response', undefined);

    await expect(normalizePreviewInput({} as Blob)).rejects.toThrow(
      'Blob preview input is not supported in this runtime',
    );
  });
});
