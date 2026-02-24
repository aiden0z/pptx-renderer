/**
 * Vitest setup — mocks for browser APIs not available in jsdom.
 */

let blobUrlCounter = 0;
const activeBlobUrls = new Set<string>();

// Mock URL.createObjectURL / URL.revokeObjectURL for jsdom environment
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = (_blob: Blob): string => {
    const url = `blob:mock/${++blobUrlCounter}`;
    activeBlobUrls.add(url);
    return url;
  };
}

if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = (url: string): void => {
    activeBlobUrls.delete(url);
  };
}

// Mock ImageData for jsdom environment (used by EMF bitmap parser)
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

export { activeBlobUrls };
