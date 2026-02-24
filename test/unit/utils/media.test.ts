import { describe, it, expect, vi } from 'vitest';
import { getMimeType, resolveMediaPath, getOrCreateBlobUrl } from '../../../src/utils/media';

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
