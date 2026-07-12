/**
 * PPTX zip archive parser.
 * Extracts and categorizes all files from a .pptx (which is a zip archive).
 */

import JSZip from 'jszip';
import type { JSZipObject } from 'jszip';
import type { MediaResolver, ResolvedMedia } from '../utils/media';
import { resolveMediaPathCandidates } from '../utils/media';

export interface PptxFiles {
  contentTypes: string;
  presentation: string;
  presentationRels: string;
  slides: Map<string, string>;
  slideRels: Map<string, string>;
  slideLayouts: Map<string, string>;
  slideLayoutRels: Map<string, string>;
  slideMasters: Map<string, string>;
  slideMasterRels: Map<string, string>;
  themes: Map<string, string>;
  themeOverrides?: Map<string, string>;
  media: Map<string, Uint8Array>;
  /** Embedded EOT font parts under ppt/fonts/. */
  fonts?: Map<string, Uint8Array>;
  mediaResolver?: MediaResolver;
  tableStyles?: string;
  charts: Map<string, string>; // ppt/charts/chart*.xml
  chartRels?: Map<string, string>; // ppt/charts/_rels/chart*.xml.rels
  chartStyles: Map<string, string>; // ppt/charts/style*.xml
  chartColors: Map<string, string>; // ppt/charts/colors*.xml
  diagramDrawings: Map<string, string>; // ppt/diagrams/drawing*.xml (SmartArt fallback)
}

export interface ZipParseLimits {
  /** Maximum number of non-directory entries in the zip archive. */
  maxEntries?: number;
  /** Maximum uncompressed size for any single entry (bytes). */
  maxEntryUncompressedBytes?: number;
  /** Maximum total uncompressed size across all entries (bytes). */
  maxTotalUncompressedBytes?: number;
  /** Maximum uncompressed size across media entries under `ppt/media/` (bytes). */
  maxMediaBytes?: number;
  /** Maximum concurrent zip entry reads during parsing. */
  maxConcurrency?: number;
}

export const RECOMMENDED_ZIP_LIMITS = Object.freeze({
  maxEntries: 4_000,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxMediaBytes: 192 * 1024 * 1024,
  maxConcurrency: 8,
}) satisfies Required<ZipParseLimits>;

function throwZipLimitExceeded(reason: string): never {
  throw new Error(`PPTX zip limit exceeded: ${reason}`);
}

function isMediaPath(path: string): boolean {
  return path.startsWith('ppt/media/');
}

function decodeZipPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function setPathMapEntry<T>(map: Map<string, T>, path: string, value: T): void {
  map.set(path, value);
  const decodedPath = decodeZipPath(path);
  if (decodedPath !== path && !map.has(decodedPath)) {
    map.set(decodedPath, value);
  }
}

function readUncompressedSize(file: JSZipObject): number | undefined {
  const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
  const size = data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
}

function textByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

interface ZipLimitState {
  limits: ZipParseLimits;
  knownSizeByPath: Map<string, number>;
  knownTotalBytes: number;
  knownMediaBytes: number;
  unknownTotalBytes: number;
  unknownMediaBytes: number;
}

interface LazyMediaEntry {
  path: string;
  file: JSZipObject;
}

class ZipLazyMediaResolver implements MediaResolver {
  private inflight = new Map<string, Promise<Uint8Array>>();
  private loadedPaths = new Set<string>();
  readonly totalCount: number;

  constructor(
    private readonly entries: Map<string, LazyMediaEntry>,
    private readonly media: Map<string, Uint8Array>,
    private readonly state: ZipLimitState,
    readonly totalBytes: number,
  ) {
    this.totalCount = new Set(Array.from(entries.values(), (entry) => entry.path)).size;
  }

  get loadedBytes(): number {
    let total = 0;
    for (const path of this.loadedPaths) {
      total += this.media.get(path)?.byteLength ?? 0;
    }
    return total;
  }

  get loadedCount(): number {
    return this.loadedPaths.size;
  }

  async resolve(target: string): Promise<ResolvedMedia | undefined> {
    for (const mediaPath of resolveMediaPathCandidates(target)) {
      const data = this.media.get(mediaPath);
      if (data) return { mediaPath, data };
    }

    for (const mediaPath of resolveMediaPathCandidates(target)) {
      const entry = this.entries.get(mediaPath);
      if (!entry) continue;

      const data = await this.readEntry(entry);
      return { mediaPath, data };
    }

    return undefined;
  }

  private async readEntry(entry: LazyMediaEntry): Promise<Uint8Array> {
    let read = this.inflight.get(entry.path);
    if (!read) {
      read = readZipBinaryEntry(entry.path, entry.file, this.state).then((bytes) => {
        setPathMapEntry(this.media, entry.path, bytes);
        this.loadedPaths.add(entry.path);
        return bytes;
      });
      this.inflight.set(entry.path, read);
    }

    try {
      return await read;
    } finally {
      this.inflight.delete(entry.path);
    }
  }
}

function validateDecodedEntrySize(path: string, size: number, state: ZipLimitState): void {
  if (
    state.limits.maxEntryUncompressedBytes !== undefined &&
    size > state.limits.maxEntryUncompressedBytes
  ) {
    throwZipLimitExceeded(
      `${path} is ${size} bytes > maxEntryUncompressedBytes ${state.limits.maxEntryUncompressedBytes}`,
    );
  }

  if (state.knownSizeByPath.has(path)) return;

  state.unknownTotalBytes += size;
  const totalBytes = state.knownTotalBytes + state.unknownTotalBytes;
  if (
    state.limits.maxTotalUncompressedBytes !== undefined &&
    totalBytes > state.limits.maxTotalUncompressedBytes
  ) {
    throwZipLimitExceeded(
      `total uncompressed bytes ${totalBytes} > maxTotalUncompressedBytes ${state.limits.maxTotalUncompressedBytes}`,
    );
  }

  if (isMediaPath(path)) {
    state.unknownMediaBytes += size;
    const mediaBytes = state.knownMediaBytes + state.unknownMediaBytes;
    if (state.limits.maxMediaBytes !== undefined && mediaBytes > state.limits.maxMediaBytes) {
      throwZipLimitExceeded(
        `media bytes ${mediaBytes} > maxMediaBytes ${state.limits.maxMediaBytes}`,
      );
    }
  }
}

async function readZipTextEntry(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<string> {
  const text = await file.async('string');
  validateDecodedEntrySize(path, textByteLength(text), state);
  return text;
}

async function readZipBinaryEntry(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<Uint8Array> {
  const bytes = await file.async('uint8array');
  validateDecodedEntrySize(path, bytes.byteLength, state);
  return bytes;
}

async function countUncategorizedEntryIfNeeded(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<void> {
  if (state.knownSizeByPath.has(path)) return;
  if (
    state.limits.maxEntryUncompressedBytes === undefined &&
    state.limits.maxTotalUncompressedBytes === undefined
  ) {
    return;
  }

  const bytes = await file.async('uint8array');
  validateDecodedEntrySize(path, bytes.byteLength, state);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(concurrency, items.length);
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await mapper(items[index]);
    }
  });

  await Promise.all(workers);
}

/**
 * Parse a .pptx file buffer and extract all relevant files, categorized by type.
 */
export async function parseZip(
  buffer: ArrayBuffer,
  limits: ZipParseLimits = {},
): Promise<PptxFiles> {
  return parseZipInternal(buffer, limits, { lazyMedia: false });
}

/**
 * Parse a .pptx file while indexing media entries for on-demand decoding.
 *
 * This preserves the same XML categorisation as parseZip(), but leaves
 * PptxFiles.media empty until mediaResolver.resolve(target) is called.
 */
export async function parseZipLazyMedia(
  buffer: ArrayBuffer,
  limits: ZipParseLimits = {},
): Promise<PptxFiles> {
  return parseZipInternal(buffer, limits, { lazyMedia: true });
}

async function parseZipInternal(
  buffer: ArrayBuffer,
  limits: ZipParseLimits,
  options: { lazyMedia: boolean },
): Promise<PptxFiles> {
  const maxConcurrency = limits.maxConcurrency ?? 8;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throwZipLimitExceeded(`maxConcurrency ${limits.maxConcurrency} must be an integer >= 1`);
  }

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir);

  if (limits.maxEntries !== undefined && entries.length > limits.maxEntries) {
    throwZipLimitExceeded(`entries ${entries.length} > maxEntries ${limits.maxEntries}`);
  }

  const knownSizeByPath = new Map<string, number>();
  let knownTotalBytes = 0;
  let knownMediaBytes = 0;

  for (const [rawPath, file] of entries) {
    const normalizedPath = rawPath.replace(/\\/g, '/');
    const size = readUncompressedSize(file);
    if (size === undefined) continue;

    knownSizeByPath.set(normalizedPath, size);

    if (limits.maxEntryUncompressedBytes !== undefined && size > limits.maxEntryUncompressedBytes) {
      throwZipLimitExceeded(
        `${normalizedPath} is ${size} bytes > maxEntryUncompressedBytes ${limits.maxEntryUncompressedBytes}`,
      );
    }

    knownTotalBytes += size;
    if (
      limits.maxTotalUncompressedBytes !== undefined &&
      knownTotalBytes > limits.maxTotalUncompressedBytes
    ) {
      throwZipLimitExceeded(
        `total uncompressed bytes ${knownTotalBytes} > maxTotalUncompressedBytes ${limits.maxTotalUncompressedBytes}`,
      );
    }

    if (isMediaPath(normalizedPath)) {
      knownMediaBytes += size;
      if (limits.maxMediaBytes !== undefined && knownMediaBytes > limits.maxMediaBytes) {
        throwZipLimitExceeded(
          `media bytes ${knownMediaBytes} > maxMediaBytes ${limits.maxMediaBytes}`,
        );
      }
    }
  }

  const result: PptxFiles = {
    contentTypes: '',
    presentation: '',
    presentationRels: '',
    slides: new Map(),
    slideRels: new Map(),
    slideLayouts: new Map(),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    themeOverrides: new Map(),
    media: new Map(),
    fonts: new Map(),
    charts: new Map(),
    chartRels: new Map(),
    chartStyles: new Map(),
    chartColors: new Map(),
    diagramDrawings: new Map(),
  };

  const limitState: ZipLimitState = {
    limits,
    knownSizeByPath,
    knownTotalBytes,
    knownMediaBytes,
    unknownTotalBytes: 0,
    unknownMediaBytes: 0,
  };
  const lazyMediaEntries = new Map<string, LazyMediaEntry>();

  await mapWithConcurrency(entries, maxConcurrency, async ([path, file]) => {
    const normalizedPath = path.replace(/\\/g, '/');

    // --- Content Types ---
    if (normalizedPath === '[Content_Types].xml') {
      result.contentTypes = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Presentation ---
    if (normalizedPath === 'ppt/presentation.xml') {
      result.presentation = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Presentation Rels ---
    if (normalizedPath === 'ppt/_rels/presentation.xml.rels') {
      result.presentationRels = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Table Styles ---
    if (normalizedPath === 'ppt/tableStyles.xml') {
      result.tableStyles = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Media (binary) ---
    if (isMediaPath(normalizedPath)) {
      if (options.lazyMedia) {
        setPathMapEntry(lazyMediaEntries, normalizedPath, { path: normalizedPath, file });
        return;
      }

      const bytes = await readZipBinaryEntry(normalizedPath, file, limitState);
      setPathMapEntry(result.media, normalizedPath, bytes);
      return;
    }

    // --- Embedded fonts (binary EOT/.fntdata) ---
    if (/^ppt\/fonts\/[^/]+\.fntdata$/i.test(normalizedPath)) {
      const bytes = await readZipBinaryEntry(normalizedPath, file, limitState);
      setPathMapEntry(result.fonts!, normalizedPath, bytes);
      return;
    }

    // --- Slide Rels (must check before slides to avoid false match) ---
    if (/^ppt\/slides\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slides ---
    if (/^ppt\/slides\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slides,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Layout Rels ---
    if (/^ppt\/slideLayouts\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayoutRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Layouts ---
    if (/^ppt\/slideLayouts\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayouts,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Master Rels ---
    if (/^ppt\/slideMasters\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasterRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Masters ---
    if (/^ppt\/slideMasters\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasters,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Themes ---
    if (/^ppt\/theme\/(?!themeOverride[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.themes,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Theme Overrides (used by chart parts) ---
    if (/^ppt\/theme\/themeOverride[^/]*\.xml$/.test(normalizedPath)) {
      if (result.themeOverrides) {
        setPathMapEntry(
          result.themeOverrides,
          normalizedPath,
          await readZipTextEntry(normalizedPath, file, limitState),
        );
      }
      return;
    }

    // --- Chart Rels ---
    if (/^ppt\/charts\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      if (result.chartRels) {
        setPathMapEntry(
          result.chartRels,
          normalizedPath,
          await readZipTextEntry(normalizedPath, file, limitState),
        );
      }
      return;
    }

    // --- Charts ---
    if (/^ppt\/charts\/(?!style[^/]*\.xml$)(?!colors[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.charts,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Chart Styles ---
    if (/^ppt\/charts\/style[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartStyles,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Chart Colors ---
    if (/^ppt\/charts\/colors[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartColors,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Diagram Drawings (SmartArt fallback) ---
    if (/^ppt\/diagrams\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.diagramDrawings,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    await countUncategorizedEntryIfNeeded(normalizedPath, file, limitState);
  });

  if (options.lazyMedia) {
    result.mediaResolver = new ZipLazyMediaResolver(
      lazyMediaEntries,
      result.media,
      limitState,
      knownMediaBytes,
    );
  }

  return result;
}
