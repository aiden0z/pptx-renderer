/** Host-provided font faces used to reproduce fonts that are not embedded in a PPTX. */

export interface FontFaceConfig {
  /** CSS family name used by the presentation, for example "微软雅黑". */
  family: string;
  /** A FontFace CSS source such as `url(...)`/`local(...)`, or decoded font bytes. */
  source: string | ArrayBuffer | Uint8Array<ArrayBuffer>;
  /** Optional weight/style/stretch and other native FontFace descriptors. */
  descriptors?: FontFaceDescriptors;
}

interface LoadedFace {
  fontFace: FontFace;
  ready: Promise<void>;
  registered: boolean;
}

interface LoadedConfig {
  faces: LoadedFace[];
  references: number;
}

interface ConfiguredFontUse {
  ready: Promise<void>;
  dispose(): void;
}

const loadedByConfig = new WeakMap<readonly FontFaceConfig[], LoadedConfig>();

function normalizeSource(source: FontFaceConfig['source']): string | BufferSource {
  if (!(source instanceof Uint8Array)) return source;
  return source.buffer instanceof ArrayBuffer ? source : new Uint8Array(source);
}

function removeFace(face: LoadedFace): void {
  if (!face.registered) return;
  document.fonts.delete(face.fontFace);
  face.registered = false;
}

function createLoadedFace(config: FontFaceConfig): LoadedFace | undefined {
  if (!config.family.trim()) return undefined;

  let fontFace: FontFace;
  try {
    fontFace = new FontFace(
      config.family.trim(),
      normalizeSource(config.source),
      config.descriptors,
    );
    document.fonts.add(fontFace);
  } catch {
    return undefined;
  }

  const loaded: LoadedFace = {
    fontFace,
    registered: true,
    ready: Promise.resolve(),
  };
  try {
    loaded.ready = fontFace.load().then(
      () => undefined,
      () => removeFace(loaded),
    );
  } catch {
    removeFace(loaded);
  }
  return loaded;
}

/**
 * Register caller-owned font faces before slide nodes are laid out.
 * Invalid or unloadable faces fall back to the renderer's normal CSS font stack.
 */
export function useConfiguredFonts(
  config: readonly FontFaceConfig[] | undefined,
): ConfiguredFontUse {
  if (
    !config?.length ||
    typeof FontFace === 'undefined' ||
    typeof document === 'undefined' ||
    !document.fonts
  ) {
    return { ready: Promise.resolve(), dispose() {} };
  }

  let loaded = loadedByConfig.get(config);
  if (!loaded) {
    loaded = {
      faces: config.flatMap((face) => {
        const created = createLoadedFace(face);
        return created ? [created] : [];
      }),
      references: 0,
    };
    loadedByConfig.set(config, loaded);
  }
  loaded.references++;

  let disposed = false;
  return {
    ready: Promise.allSettled(loaded.faces.map((face) => face.ready)).then(() => undefined),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loaded!.references--;
      if (loaded!.references > 0) return;
      for (const face of loaded!.faces) removeFace(face);
      loadedByConfig.delete(config);
    },
  };
}
