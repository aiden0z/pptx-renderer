import { describe, it, expect, vi } from 'vitest';
import {
  getMimeType,
  resolveMediaPath,
  resolveMediaPathCandidates,
  findMediaByTarget,
  findMediaByTargetAsync,
  getOrCreateBlobUrl,
} from '../../../src/utils/media';

describe('getMimeType', () => {
  it('returns correct MIME for common image formats', () => {
    expect(getMimeType('image1.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('icon.gif')).toBe('image/gif');
    expect(getMimeType('logo.svg')).toBe('image/svg+xml');
    expect(getMimeType('pic.bmp')).toBe('image/bmp');
    expect(getMimeType('pic.webp')).toBe('image/webp');
  });

  it('returns correct MIME for video formats', () => {
    expect(getMimeType('clip.mp4')).toBe('video/mp4');
    expect(getMimeType('clip.m4v')).toBe('video/mp4');
    expect(getMimeType('clip.webm')).toBe('video/webm');
    expect(getMimeType('clip.avi')).toBe('video/x-msvideo');
  });

  it('returns correct MIME for audio formats', () => {
    expect(getMimeType('sound.mp3')).toBe('audio/mpeg');
    expect(getMimeType('sound.wav')).toBe('audio/wav');
    expect(getMimeType('sound.m4a')).toBe('audio/mp4');
    expect(getMimeType('sound.ogg')).toBe('audio/ogg');
  });

  it('returns correct MIME for legacy formats', () => {
    expect(getMimeType('old.emf')).toBe('image/x-emf');
    expect(getMimeType('old.wmf')).toBe('image/x-wmf');
  });

  it('is case-insensitive', () => {
    expect(getMimeType('image1.PNG')).toBe('image/png');
    expect(getMimeType('photo.JPG')).toBe('image/jpeg');
  });

  it('returns octet-stream for unknown extension', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('noext')).toBe('application/octet-stream');
  });

  it('handles paths with directories', () => {
    expect(getMimeType('ppt/media/image1.png')).toBe('image/png');
    expect(getMimeType('../media/image1.jpeg')).toBe('image/jpeg');
  });
});

describe('resolveMediaPath', () => {
  it('extracts filename and prepends ppt/media/', () => {
    expect(resolveMediaPath('../media/image1.png')).toBe('ppt/media/image1.png');
  });

  it('handles simple filenames', () => {
    expect(resolveMediaPath('image1.png')).toBe('ppt/media/image1.png');
  });

  it('handles deeply nested relative paths', () => {
    expect(resolveMediaPath('../../something/media/chart1.png')).toBe('ppt/media/chart1.png');
  });

  it('preserves subdirectories below the media package folder', () => {
    expect(resolveMediaPath('../media/icons/logo.png')).toBe('ppt/media/icons/logo.png');
  });

  it('normalizes backslash relationship targets before extracting the filename', () => {
    expect(resolveMediaPath('..\\media\\image1.png')).toBe('ppt/media/image1.png');
  });

  it('decodes percent-encoded relationship target filenames', () => {
    expect(resolveMediaPath('../media/product%20photo%231.png')).toBe(
      'ppt/media/product photo#1.png',
    );
  });

  it('ignores URI query and fragment suffixes before extracting filenames', () => {
    expect(resolveMediaPath('../media/image1.png#preview')).toBe('ppt/media/image1.png');
    expect(resolveMediaPath('../media/image1.png?cache=1')).toBe('ppt/media/image1.png');
  });

  it('keeps raw percent-encoded filenames as fallback candidates', () => {
    expect(resolveMediaPathCandidates('../media/product%20photo.png')).toEqual([
      'ppt/media/product photo.png',
      'ppt/media/product%20photo.png',
    ]);
  });

  it('keeps raw percent-encoded subdirectory media paths as fallback candidates', () => {
    expect(resolveMediaPathCandidates('../media/icons/product%20photo.png')).toEqual([
      'ppt/media/icons/product photo.png',
      'ppt/media/icons/product%20photo.png',
    ]);
  });

  it('keeps a single candidate when decoded and raw targets are identical', () => {
    expect(resolveMediaPathCandidates('../media/plain.png')).toEqual(['ppt/media/plain.png']);
  });

  it('preserves malformed URI segments instead of throwing while resolving media paths', () => {
    expect(resolveMediaPath('../media/bad%ZZname.png')).toBe('ppt/media/bad%ZZname.png');
    expect(resolveMediaPathCandidates('../media/bad%ZZname.png')).toEqual([
      'ppt/media/bad%ZZname.png',
    ]);
  });

  it('finds media by decoded target first and raw encoded target as compatibility fallback', () => {
    const decodedMedia = new Map([['ppt/media/product photo.png', new Uint8Array([1])]]);
    const rawMedia = new Map([['ppt/media/product%20photo.png', new Uint8Array([2])]]);

    expect(findMediaByTarget('../media/product%20photo.png', decodedMedia)?.mediaPath).toBe(
      'ppt/media/product photo.png',
    );
    expect(findMediaByTarget('../media/product%20photo.png', rawMedia)?.mediaPath).toBe(
      'ppt/media/product%20photo.png',
    );
  });

  it('finds media stored in subdirectories below ppt/media', () => {
    const media = new Map([['ppt/media/icons/logo.png', new Uint8Array([1])]]);

    expect(findMediaByTarget('../media/icons/logo.png', media)?.mediaPath).toBe(
      'ppt/media/icons/logo.png',
    );
  });

  it('resolves media through an async resolver when the eager media map is empty', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const resolver = {
      resolve: vi.fn(async () => ({ mediaPath: 'ppt/media/image1.png', data })),
    };

    const resolved = await findMediaByTargetAsync('../media/image1.png', new Map(), resolver);

    expect(resolved).toEqual({ mediaPath: 'ppt/media/image1.png', data });
    expect(resolver.resolve).toHaveBeenCalledWith('../media/image1.png');
  });
});

describe('getOrCreateBlobUrl', () => {
  it('creates a blob URL and caches it', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const url = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);

    expect(url).toMatch(/^blob:/);
    expect(cache.get('ppt/media/image1.png')).toBe(url);
  });

  it('returns cached URL on second call', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const url1 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    const url2 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);

    expect(url1).toBe(url2);
  });

  it('creates different URLs for different paths', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const url1 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    const url2 = getOrCreateBlobUrl('ppt/media/image2.png', data, cache);

    expect(url1).not.toBe(url2);
    expect(cache.size).toBe(2);
  });
});
