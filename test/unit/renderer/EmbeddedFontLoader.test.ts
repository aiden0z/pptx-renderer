import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationData } from '../../../src/model/Presentation';
import {
  extractEotPayload,
  type EmbeddedFontLimits,
  useEmbeddedFonts,
} from '../../../src/renderer/EmbeddedFontLoader';

const { decompressMtxMock } = vi.hoisted(() => ({
  decompressMtxMock: vi.fn(() => new Uint8Array([0, 1, 0, 0])),
}));

vi.mock('mtx-decompressor', () => ({ decompressMtx: decompressMtxMock }));

const limits: EmbeddedFontLimits = {
  maxFaces: 2,
  maxInputBytesPerFace: 256,
  maxDecompressedBytesPerFace: 8,
  maxTotalDecompressedBytes: 12,
  maxProcessingMs: 100,
};

function eot(payload = new Uint8Array([1, 2, 3]), fsType = 0): Uint8Array {
  const bytes = new Uint8Array(96 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength, true);
  view.setUint32(4, payload.byteLength, true);
  view.setUint32(8, 0x00010000, true);
  view.setUint16(32, fsType, true);
  view.setUint16(34, 0x504c, true);
  bytes.set(payload, 96);
  return bytes;
}

function presentation(faceCount = 1): PresentationData {
  return {
    embeddedFonts: Array.from({ length: faceCount }, (_, index) => ({
      family: `Example ${index}`,
      renderFamily: `__embedded_${index}`,
      data: eot(),
      weight: '400',
      style: 'normal',
    })),
  } as PresentationData;
}

function installFontMocks(
  load: () => Promise<FontFace> = async function () {
    return this as unknown as FontFace;
  },
): { add: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } {
  const fontSet = { add: vi.fn(), delete: vi.fn() };
  class MockFontFace {
    constructor(
      readonly family: string,
      readonly source: BufferSource,
      readonly descriptors: FontFaceDescriptors,
    ) {}

    load = load;
  }
  vi.stubGlobal('FontFace', MockFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
  return fontSet;
}

beforeEach(() => {
  vi.restoreAllMocks();
  decompressMtxMock.mockReset();
  decompressMtxMock.mockReturnValue(new Uint8Array([0, 1, 0, 0]));
});

describe('EmbeddedFontLoader', () => {
  it('rejects truncated headers, declared-size overreads, and oversized EOT input', () => {
    expect(() => extractEotPayload(new Uint8Array(81), 256)).toThrow(/header/);

    const declaredTooSmall = eot();
    new DataView(declaredTooSmall.buffer).setUint32(0, declaredTooSmall.byteLength - 1, true);
    expect(() => extractEotPayload(declaredTooSmall, 256)).toThrow(/payload/);
    expect(() => extractEotPayload(eot(), 20)).toThrow(/input limit/);
  });

  it('rejects restricted and bitmap-only licensing bits, including mixed flags', () => {
    expect(() => extractEotPayload(eot(undefined, 0x0006))).toThrow(/licensing/);
    expect(() => extractEotPayload(eot(undefined, 0x0200))).toThrow(/licensing/);
  });

  it('falls back without registering malformed or oversized faces', async () => {
    const fonts = installFontMocks();
    const malformed = presentation();
    malformed.embeddedFonts![0].data = new Uint8Array([1]);

    const malformedUse = useEmbeddedFonts(malformed, new Set(['__embedded_0']), limits);
    await expect(malformedUse.ready).resolves.toBeUndefined();

    const oversized = presentation();
    oversized.embeddedFonts![0].data = new Uint8Array(257);
    const oversizedUse = useEmbeddedFonts(oversized, new Set(['__embedded_0']), limits);
    await expect(oversizedUse.ready).resolves.toBeUndefined();
    expect(fonts.add).not.toHaveBeenCalled();
    expect(decompressMtxMock).not.toHaveBeenCalled();
  });

  it('stops after the configured face count', async () => {
    const fonts = installFontMocks();
    const pres = presentation(3);
    const families = new Set(pres.embeddedFonts!.map((face) => face.renderFamily));

    await useEmbeddedFonts(pres, families, limits).ready;

    expect(decompressMtxMock).toHaveBeenCalledTimes(2);
    expect(fonts.add).toHaveBeenCalledTimes(2);
  });

  it('enforces per-face and aggregate decompressed-byte limits', async () => {
    const fonts = installFontMocks();
    const pres = presentation(4);
    const families = new Set(pres.embeddedFonts!.map((face) => face.renderFamily));
    decompressMtxMock
      .mockReturnValueOnce(new Uint8Array(9))
      .mockReturnValueOnce(new Uint8Array(7))
      .mockReturnValueOnce(new Uint8Array(7))
      .mockReturnValueOnce(new Uint8Array(7));

    await useEmbeddedFonts(pres, families, { ...limits, maxFaces: 4 }).ready;

    expect(decompressMtxMock).toHaveBeenCalledTimes(3);
    expect(fonts.add).toHaveBeenCalledTimes(1);
  });

  it('accepts partial overrides, validates limits, and passes FontFace a typed-array view', async () => {
    const fonts = installFontMocks();
    const pres = presentation(2);
    const families = new Set(pres.embeddedFonts!.map((face) => face.renderFamily));
    const decoded = new Uint8Array([0, 1, 0, 0]);
    decompressMtxMock.mockReturnValue(decoded);

    await useEmbeddedFonts(pres, families, { maxFaces: 1 }).ready;

    expect(decompressMtxMock).toHaveBeenCalledOnce();
    expect(fonts.add.mock.calls[0][0].source).toBe(decoded);

    const disabled = presentation();
    await useEmbeddedFonts(disabled, new Set(['__embedded_0']), { maxFaces: 0 }).ready;
    expect(decompressMtxMock).toHaveBeenCalledOnce();

    expect(() => useEmbeddedFonts(presentation(), families, { maxFaces: 1.5 })).toThrow(/maxFaces/);
    expect(() =>
      useEmbeddedFonts(presentation(), families, { maxProcessingMs: Number.POSITIVE_INFINITY }),
    ).toThrow(/maxProcessingMs/);
    expect(() => useEmbeddedFonts(presentation(), families, { maxInputBytesPerFace: -1 })).toThrow(
      /maxInputBytesPerFace/,
    );
  });

  it('stops registering faces when the processing budget is exhausted', async () => {
    const fonts = installFontMocks();
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(101);

    await useEmbeddedFonts(presentation(), new Set(['__embedded_0']), limits).ready;

    expect(decompressMtxMock).toHaveBeenCalledOnce();
    expect(fonts.add).not.toHaveBeenCalled();
  });

  it('keeps shared faces until the last reference is disposed', async () => {
    const fonts = installFontMocks();
    const pres = presentation();
    const first = useEmbeddedFonts(pres, new Set(['__embedded_0']), limits);
    const second = useEmbeddedFonts(pres, new Set(['__embedded_0']), limits);
    await Promise.all([first.ready, second.ready]);

    first.dispose();
    await Promise.resolve();
    expect(fonts.delete).not.toHaveBeenCalled();

    second.dispose();
    await Promise.resolve();
    expect(fonts.delete).toHaveBeenCalledOnce();
  });

  it('removes a failed FontFace and resolves ready so host fallback remains usable', async () => {
    const fonts = installFontMocks(async () => {
      throw new Error('font rejected');
    });
    const pres = presentation();
    const use = useEmbeddedFonts(pres, new Set(['__embedded_0']), limits);

    await expect(use.ready).resolves.toBeUndefined();
    expect(fonts.add).toHaveBeenCalledOnce();
    expect(fonts.delete).toHaveBeenCalledOnce();
    await useEmbeddedFonts(pres, new Set(['__embedded_0']), limits).ready;
    expect(fonts.add).toHaveBeenCalledOnce();
    use.dispose();
  });
});
