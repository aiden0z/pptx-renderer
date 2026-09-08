import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FontFaceConfig,
  useConfiguredFonts,
} from '../../../src/renderer/ConfiguredFontLoader';

function installFontMocks(
  load: () => Promise<FontFace> = async function () {
    return this as unknown as FontFace;
  },
): { add: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } {
  const fontSet = { add: vi.fn(), delete: vi.fn() };
  class MockFontFace {
    constructor(
      readonly family: string,
      readonly source: string | BufferSource,
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
});

describe('ConfiguredFontLoader', () => {
  it('registers host-provided regular and bold faces with their requested family', async () => {
    const fonts = installFontMocks();
    const regular = new Uint8Array([0, 1, 2, 3]);
    const bold = new ArrayBuffer(4);
    const config: readonly FontFaceConfig[] = [
      { family: '微软雅黑', source: regular, descriptors: { weight: '400' } },
      { family: '微软雅黑', source: bold, descriptors: { weight: '700' } },
    ];

    const use = useConfiguredFonts(config);
    await expect(use.ready).resolves.toBeUndefined();

    expect(fonts.add).toHaveBeenCalledTimes(2);
    expect(fonts.add.mock.calls[0][0]).toMatchObject({
      family: '微软雅黑',
      source: regular,
      descriptors: { weight: '400' },
    });
    expect(fonts.add.mock.calls[1][0]).toMatchObject({
      family: '微软雅黑',
      source: bold,
      descriptors: { weight: '700' },
    });
  });

  it('shares registrations for the same configuration until the last render disposes them', async () => {
    const fonts = installFontMocks();
    const config: readonly FontFaceConfig[] = [
      { family: 'Deck Sans', source: 'local("Arial")', descriptors: { weight: '400' } },
    ];

    const first = useConfiguredFonts(config);
    const second = useConfiguredFonts(config);
    await Promise.all([first.ready, second.ready]);

    expect(fonts.add).toHaveBeenCalledOnce();
    first.dispose();
    await Promise.resolve();
    expect(fonts.delete).not.toHaveBeenCalled();
    second.dispose();
    await Promise.resolve();
    expect(fonts.delete).toHaveBeenCalledOnce();
  });

  it('keeps rendering available when a configured face is invalid or fails to load', async () => {
    const fonts = installFontMocks(async () => {
      throw new Error('font rejected');
    });
    const config: readonly FontFaceConfig[] = [
      { family: 'Broken Face', source: 'url("/broken.woff2")' },
      { family: ' ', source: 'url("/ignored.woff2")' },
    ];

    const use = useConfiguredFonts(config);
    await expect(use.ready).resolves.toBeUndefined();

    expect(fonts.add).toHaveBeenCalledOnce();
    expect(fonts.delete).toHaveBeenCalledOnce();
    use.dispose();
  });
});
