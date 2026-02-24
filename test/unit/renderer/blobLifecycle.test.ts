import { describe, it, expect, vi } from 'vitest';
import { getOrCreateBlobUrl } from '../../../src/utils/media';

describe('blob URL lifecycle', () => {
  it('getOrCreateBlobUrl populates the cache', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([1, 2, 3]);

    getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    expect(cache.size).toBe(1);
    expect(cache.has('ppt/media/image1.png')).toBe(true);
  });

  it('same path returns same URL (cache reuse)', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([1, 2, 3]);

    const url1 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    const url2 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    expect(url1).toBe(url2);
    expect(cache.size).toBe(1);
  });

  it('different paths create separate URLs', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([1, 2, 3]);

    const url1 = getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    const url2 = getOrCreateBlobUrl('ppt/media/image2.jpg', data, cache);
    expect(url1).not.toBe(url2);
    expect(cache.size).toBe(2);
  });

  it('revoking all cached URLs works correctly', () => {
    const cache = new Map<string, string>();
    const data = new Uint8Array([1, 2, 3]);
    const revokedUrls: string[] = [];

    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revokedUrls.push(url);
      originalRevoke(url);
    };

    getOrCreateBlobUrl('ppt/media/image1.png', data, cache);
    getOrCreateBlobUrl('ppt/media/image2.jpg', data, cache);
    getOrCreateBlobUrl('ppt/media/image3.gif', data, cache);

    expect(cache.size).toBe(3);

    // Simulate destroy: revoke all and clear
    for (const url of cache.values()) {
      URL.revokeObjectURL(url);
    }
    cache.clear();

    expect(cache.size).toBe(0);
    expect(revokedUrls.length).toBe(3);

    URL.revokeObjectURL = originalRevoke;
  });

  it('shared cache across multiple slides reuses URLs', () => {
    const sharedCache = new Map<string, string>();
    const data = new Uint8Array([1, 2, 3]);

    // Slide 1 creates URL
    const url1 = getOrCreateBlobUrl('ppt/media/logo.png', data, sharedCache);

    // Slide 2 reuses same URL
    const url2 = getOrCreateBlobUrl('ppt/media/logo.png', data, sharedCache);

    expect(url1).toBe(url2);
    expect(sharedCache.size).toBe(1);
  });
});
