import { decompressMtx } from 'mtx-decompressor';
import type { EmbeddedFontFaceData, PresentationData } from '../model/Presentation';

const EOT_MAGIC = 0x504c;
const EOT_COMPRESSED = 0x00000004;
const EOT_XOR_ENCRYPTED = 0x10000000;

export interface EmbeddedFontLimits {
  maxFaces?: number;
  maxInputBytesPerFace?: number;
  maxDecompressedBytesPerFace?: number;
  maxTotalDecompressedBytes?: number;
  maxProcessingMs?: number;
}

export const DEFAULT_EMBEDDED_FONT_LIMITS = Object.freeze({
  maxFaces: 16,
  maxInputBytesPerFace: 8 * 1024 * 1024,
  maxDecompressedBytesPerFace: 16 * 1024 * 1024,
  maxTotalDecompressedBytes: 32 * 1024 * 1024,
  maxProcessingMs: 250,
}) satisfies Required<EmbeddedFontLimits>;

function resolveEmbeddedFontLimits(limits: EmbeddedFontLimits): Required<EmbeddedFontLimits> {
  const resolved = { ...DEFAULT_EMBEDDED_FONT_LIMITS, ...limits };
  if (!Number.isSafeInteger(resolved.maxFaces) || resolved.maxFaces < 0) {
    throw new Error('Invalid embedded font limit: maxFaces must be a non-negative integer');
  }
  for (const key of [
    'maxInputBytesPerFace',
    'maxDecompressedBytesPerFace',
    'maxTotalDecompressedBytes',
  ] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 0) {
      throw new Error(`Invalid embedded font limit: ${key} must be a non-negative integer`);
    }
  }
  if (!Number.isFinite(resolved.maxProcessingMs) || resolved.maxProcessingMs < 0) {
    throw new Error('Invalid embedded font limit: maxProcessingMs must be finite and non-negative');
  }
  return resolved;
}

interface EotPayload {
  bytes: Uint8Array;
  compressed: boolean;
  encrypted: boolean;
}

interface LoadedFace {
  fontFace: FontFace;
  ready: Promise<void>;
  references: number;
  byteLength: number;
}

interface LoadedPresentationFonts {
  faces: Map<string, LoadedFace>;
  rejected: Set<string>;
  totalBytes: number;
}

const loadedByPresentation = new WeakMap<PresentationData, LoadedPresentationFonts>();

function readSizedUtf16(view: DataView, offset: number, trailingPadding: number): number {
  if (offset + 2 > view.byteLength) throw new Error('Invalid EOT string header');
  const size = view.getUint16(offset, true);
  const next = offset + 2 + size + trailingPadding;
  if (next > view.byteLength) throw new Error('Invalid EOT string size');
  return next;
}

export function extractEotPayload(
  eot: Uint8Array,
  maxInputBytes = DEFAULT_EMBEDDED_FONT_LIMITS.maxInputBytesPerFace,
): EotPayload {
  if (eot.byteLength > maxInputBytes) throw new Error('Embedded font input limit exceeded');
  if (eot.byteLength < 82) throw new Error('Invalid EOT header');

  const header = new DataView(eot.buffer, eot.byteOffset, eot.byteLength);
  const eotSize = header.getUint32(0, true);
  if (eotSize < 82 || eotSize > eot.byteLength) throw new Error('Invalid EOT size');

  const view = new DataView(eot.buffer, eot.byteOffset, eotSize);
  const fontDataSize = view.getUint32(4, true);
  const version = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const fsType = view.getUint16(32, true);
  if (view.getUint16(34, true) !== EOT_MAGIC) throw new Error('Invalid EOT signature');

  // Restricted-license and bitmap-only fonts must not be exposed as outline fonts.
  if ((fsType & 0x0002) !== 0 || (fsType & 0x0200) !== 0) {
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

  if (fontDataSize === 0 || offset + fontDataSize > view.byteLength) {
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

function releaseLoadedFace(state: LoadedPresentationFonts, key: string, loaded: LoadedFace): void {
  if (state.faces.get(key) !== loaded) return;
  document.fonts.delete(loaded.fontFace);
  state.faces.delete(key);
  state.totalBytes -= loaded.byteLength;
}

function createLoadedFace(face: EmbeddedFontFaceData, fontBytes: Uint8Array): LoadedFace {
  const source =
    fontBytes.buffer instanceof ArrayBuffer
      ? (fontBytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(fontBytes);
  const fontFace = new FontFace(face.renderFamily, source, {
    weight: face.weight,
    style: face.style,
  });
  document.fonts.add(fontFace);
  try {
    return {
      fontFace,
      byteLength: fontBytes.byteLength,
      references: 0,
      ready: fontFace.load().then(() => undefined),
    };
  } catch (error) {
    document.fonts.delete(fontFace);
    throw error;
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

interface EmbeddedFontUse {
  ready: Promise<void>;
  dispose(): void;
}

/** Invalid, oversized, slow, or unloadable faces are skipped so CSS falls back to host fonts. */
export function useEmbeddedFonts(
  presentation: PresentationData,
  families: ReadonlySet<string>,
  limits: EmbeddedFontLimits = {},
): EmbeddedFontUse {
  const resolvedLimits = resolveEmbeddedFontLimits(limits);
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return { ready: Promise.resolve(), dispose() {} };
  }

  let state = loadedByPresentation.get(presentation);
  if (!state) {
    state = { faces: new Map(), rejected: new Set(), totalBytes: 0 };
    loadedByPresentation.set(presentation, state);
  }

  const startedAt = now();
  const acquired: Array<[string, LoadedFace]> = [];
  let attemptedFaces = 0;
  for (const face of presentation.embeddedFonts ?? []) {
    if (!families.has(face.renderFamily)) continue;
    const key = faceKey(face);
    if (state.rejected.has(key)) continue;
    let loaded = state.faces.get(key);
    if (!loaded) {
      if (
        state.faces.size >= resolvedLimits.maxFaces ||
        attemptedFaces >= resolvedLimits.maxFaces ||
        now() - startedAt > resolvedLimits.maxProcessingMs
      ) {
        break;
      }
      attemptedFaces++;

      try {
        const payload = extractEotPayload(face.data, resolvedLimits.maxInputBytesPerFace);
        const fontBytes = decompressMtx(payload.bytes, {
          compressed: payload.compressed,
          encrypted: payload.encrypted,
        });
        if (now() - startedAt > resolvedLimits.maxProcessingMs) {
          state.rejected.add(key);
          break;
        }
        if (fontBytes.byteLength > resolvedLimits.maxDecompressedBytesPerFace) {
          state.rejected.add(key);
          continue;
        }
        if (state.totalBytes + fontBytes.byteLength > resolvedLimits.maxTotalDecompressedBytes) {
          break;
        }

        loaded = createLoadedFace(face, fontBytes);
        state.faces.set(key, loaded);
        state.totalBytes += loaded.byteLength;
        void loaded.ready.catch(() => {
          state!.rejected.add(key);
          releaseLoadedFace(state!, key, loaded!);
        });
      } catch {
        state.rejected.add(key);
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
          if (loaded.references <= 0) releaseLoadedFace(state!, key, loaded);
        };
        void loaded.ready.then(release, release);
      }
    },
  };
}
