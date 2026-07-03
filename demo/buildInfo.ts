export type DemoBuildChannel = 'release' | 'test';

export interface DemoBuildInfo {
  channel: DemoBuildChannel;
  refName: string;
  sha: string;
  shortSha: string;
  buildTime: string;
  runUrl: string;
  repository: string;
}

export type DemoBuildEnv = Record<string, string | undefined>;

const DEFAULT_DEMO_BASE = '/pptx-renderer/';
const DEFAULT_REPOSITORY = 'aiden0z/pptx-renderer';

export const getDemoBase = (env: DemoBuildEnv): string => {
  const rawBase = env.DEMO_BASE?.trim();
  if (!rawBase) return DEFAULT_DEMO_BASE;
  if (rawBase === '.' || rawBase === './') return './';

  const withLeadingSlash = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export const createDemoBuildInfo = (env: DemoBuildEnv): DemoBuildInfo => {
  const channel: DemoBuildChannel = env.DEMO_BUILD_CHANNEL === 'test' ? 'test' : 'release';
  const sha = env.DEMO_BUILD_SHA?.trim() ?? '';

  return {
    channel,
    refName: env.DEMO_BUILD_REF_NAME?.trim() ?? '',
    sha,
    shortSha: sha.slice(0, 7),
    buildTime: env.DEMO_BUILD_TIME?.trim() ?? '',
    runUrl: env.DEMO_BUILD_RUN_URL?.trim() ?? '',
    repository: env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY,
  };
};
