import { decompressMtx } from 'mtx-decompressor';
import type { EmbeddedFontFaceData, PresentationData } from '../model/Presentation';

const EOT_MAGIC = 0x504c;
const EOT_COMPRESSED = 0x00000004;
const EOT_XOR_ENCRYPTED = 0x10000000;

interface EotPayload {
  bytes: Uint8Array;
  compressed: boolean;
  encrypted: boolean;
}

interface LoadedFace {
  fontFace: FontFace;
  ready: Promise<void>;
  references: number;
}

const loadedByPresentation = new WeakMap<PresentationData, Map<string, LoadedFace>>();

function readSizedUtf16(view: DataView, offset: number, trailingPadding: number): number {
  if (offset + 2 > view.byteLength) throw new Error('Invalid EOT string header');
  const size = view.getUint16(offset, true);
  const next = offset + 2 + size + trailingPadding;
  if (next > view.byteLength) throw new Error('Invalid EOT string size');
  return next;
}

export function extractEotPayload(eot: Uint8Array): EotPayload {
  if (eot.byteLength < 82) throw new Error('Invalid EOT header');
  const view = new DataView(eot.buffer, eot.byteOffset, eot.byteLength);
  const eotSize = view.getUint32(0, true);
  const fontDataSize = view.getUint32(4, true);
  const version = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const fsType = view.getUint16(32, true);
  if (view.getUint16(34, true) !== EOT_MAGIC || eotSize > eot.byteLength) {
    throw new Error('Invalid EOT signature');
  }

  // Restricted-license and bitmap-only fonts must not be exposed as outline fonts.
  if ((fsType & 0x000e) === 0x0002 || (fsType & 0x0200) !== 0) {
    throw new Error('Embedded font licensing does not permit this use');
  }

  let offset = 82;
  offset = readSizedUtf16(view, offset, 2); // family name
  offset = readSizedUtf16(view, offset, 2); // style name
  offset = readSizedUtf16(view, offset, 2); // version name
  offset = readSizedUtf16(view, offset, 0); // full name

  if (version >= 0x00020001) {
    offset = readSizedUtf16(view, offset + 2, 0); // root string has a reserved word first
  }
  if (version >= 0x00020002) {
    offset += 10; // root checksum + EUDC code page
    offset = readSizedUtf16(view, offset, 0); // signature
    offset += 4; // EUDC flags
    if (offset + 4 > view.byteLength) throw new Error('Invalid EOT EUDC header');
    const eudcSize = view.getUint32(offset, true);
    offset += 4 + eudcSize;
  }

  if (fontDataSize === 0 || offset + fontDataSize > eot.byteLength) {
    throw new Error('Invalid EOT font payload');
  }
  return {
    bytes: eot.subarray(offset, offset + fontDataSize),
    compressed: (flags & EOT_COMPRESSED) !== 0,
    encrypted: (flags & EOT_XOR_ENCRYPTED) !== 0,
  };
}

function faceKey(face: EmbeddedFontFaceData): string {
  return `${face.renderFamily}:${face.weight}:${face.style}`;
}

function createLoadedFace(face: EmbeddedFontFaceData): LoadedFace {
  const payload = extractEotPayload(face.data);
  const fontBytes = decompressMtx(payload.bytes, {
    compressed: payload.compressed,
    encrypted: payload.encrypted,
  });
  const buffer = fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength,
  ) as ArrayBuffer;
  const fontFace = new FontFace(face.renderFamily, buffer, {
    weight: face.weight,
    style: face.style,
  });
  document.fonts.add(fontFace);
  const loaded: LoadedFace = {
    fontFace,
    references: 0,
    ready: fontFace.load().then(() => undefined),
  };
  return loaded;
}

export interface EmbeddedFontUse {
  ready: Promise<void>;
  dispose(): void;
}

export function useEmbeddedFonts(
  presentation: PresentationData,
  families: ReadonlySet<string>,
): EmbeddedFontUse {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return { ready: Promise.resolve(), dispose() {} };
  }

  let loadedFaces = loadedByPresentation.get(presentation);
  if (!loadedFaces) {
    loadedFaces = new Map();
    loadedByPresentation.set(presentation, loadedFaces);
  }

  const acquired: Array<[string, LoadedFace]> = [];
  for (const face of presentation.embeddedFonts ?? []) {
    if (!families.has(face.renderFamily)) continue;
    const key = faceKey(face);
    let loaded = loadedFaces.get(key);
    if (!loaded) {
      try {
        loaded = createLoadedFace(face);
        loadedFaces.set(key, loaded);
      } catch {
        continue;
      }
    }
    loaded.references++;
    acquired.push([key, loaded]);
  }

  let disposed = false;
  return {
    ready: Promise.allSettled(acquired.map(([, face]) => face.ready)).then(() => undefined),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [key, loaded] of acquired) {
        loaded.references--;
        if (loaded.references > 0) continue;
        const release = (): void => {
          if (loaded.references > 0) return;
          document.fonts.delete(loaded.fontFace);
          loadedFaces!.delete(key);
        };
        void loaded.ready.then(release, release);
      }
    },
  };
}
