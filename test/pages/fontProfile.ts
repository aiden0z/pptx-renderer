import type { FontFaceConfig } from '../../src/renderer/ConfiguredFontLoader';

interface FontProfileFace {
  family: string;
  path: string;
  descriptors?: FontFaceDescriptors;
}

interface FontProfileFile {
  version: number;
  id: string;
  fontFaces: FontProfileFace[];
}

export interface LoadedTestFontProfile {
  id: string | null;
  fontFaces: readonly FontFaceConfig[] | undefined;
}

type FetchProfile = (input: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function assertLocalRelativePath(value: string, label: string, suffix?: string): void {
  const segments = value.split('/');
  const validCharacters = /^[A-Za-z0-9._/-]+$/u.test(value);
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('://') ||
    segments.includes('..') ||
    !validCharacters ||
    (suffix !== undefined && !value.endsWith(suffix))
  ) {
    throw new Error(`${label} must be a local testdata-relative path`);
  }
}

function parseProfile(data: unknown): FontProfileFile {
  if (!data || typeof data !== 'object') throw new Error('Font profile must be a JSON object');
  const candidate = data as Partial<FontProfileFile>;
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || !candidate.id.trim()) {
    throw new Error('Font profile requires version=1 and a non-empty id');
  }
  if (!Array.isArray(candidate.fontFaces) || candidate.fontFaces.length === 0) {
    throw new Error('Font profile requires at least one font face');
  }
  for (const face of candidate.fontFaces) {
    if (!face || typeof face.family !== 'string' || !face.family.trim()) {
      throw new Error('Each font profile face requires a non-empty family');
    }
    if (typeof face.path !== 'string') {
      throw new Error('Each font profile face requires a local font path');
    }
    assertLocalRelativePath(face.path, 'Font face path');
  }
  return candidate as FontProfileFile;
}

/** Load an optional ignored testdata font profile for native-oracle reproduction. */
export async function loadTestFontProfile(
  profileRef: string | null,
  fetchImpl: FetchProfile = fetch,
): Promise<LoadedTestFontProfile> {
  if (!profileRef) return { id: null, fontFaces: undefined };
  assertLocalRelativePath(profileRef, 'Font profile reference', '.json');

  const response = await fetchImpl(`/testdata/${profileRef}`);
  if (!response.ok) {
    throw new Error(`Unable to load font profile ${profileRef}: HTTP ${response.status}`);
  }
  const profile = parseProfile(await response.json());
  return {
    id: profile.id.trim(),
    fontFaces: profile.fontFaces.map((face) => ({
      family: face.family.trim(),
      source: `url("/testdata/${face.path}")`,
      descriptors: face.descriptors,
    })),
  };
}
