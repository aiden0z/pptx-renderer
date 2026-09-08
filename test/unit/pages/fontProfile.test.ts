import { describe, expect, it, vi } from 'vitest';
import { loadTestFontProfile } from '../../../test/pages/fontProfile';

describe('loadTestFontProfile', () => {
  it('loads a local testdata profile into renderSlide fontFaces', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            id: ' office-zh ',
            fontFaces: [
              {
                family: 'Microsoft YaHei',
                path: 'msyh.ttc',
                descriptors: { weight: '400' },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const profile = await loadTestFontProfile('font-profiles/office-zh.json', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/testdata/font-profiles/office-zh.json');
    expect(profile).toEqual({
      id: 'office-zh',
      fontFaces: [
        {
          family: 'Microsoft YaHei',
          source: 'url("/testdata/msyh.ttc")',
          descriptors: { weight: '400' },
        },
      ],
    });
  });

  it.each(['../escape.json', '/absolute.json', 'https://example.com/profile.json'])(
    'rejects non-local profile reference %s',
    async (profileRef) => {
      await expect(loadTestFontProfile(profileRef, vi.fn())).rejects.toThrow(
        'local testdata-relative path',
      );
    },
  );

  it('returns an empty profile when no reference is configured', async () => {
    await expect(loadTestFontProfile(null, vi.fn())).resolves.toEqual({
      id: null,
      fontFaces: undefined,
    });
  });
});
