import { describe, expect, it } from 'vitest';
import { createDemoBuildInfo, getDemoBase } from '../../../demo/buildInfo';

describe('demo build metadata', () => {
  it('defaults to the release demo base and release channel', () => {
    expect(getDemoBase({})).toBe('/pptx-renderer/');

    expect(createDemoBuildInfo({})).toEqual({
      channel: 'release',
      refName: '',
      sha: '',
      shortSha: '',
      buildTime: '',
      runUrl: '',
      repository: 'aiden0z/pptx-renderer',
    });
  });

  it('normalizes test demo metadata for fix branch previews', () => {
    const info = createDemoBuildInfo({
      DEMO_BUILD_CHANNEL: 'test',
      DEMO_BUILD_REF_NAME: 'fix/issue-4-nowrap-scrollbar',
      DEMO_BUILD_SHA: 'b1517148f00df00df00df00df00df00df00df00d',
      DEMO_BUILD_TIME: '2026-07-03T08:00:00Z',
      DEMO_BUILD_RUN_URL: 'https://github.com/aiden0z/pptx-renderer/actions/runs/123',
      GITHUB_REPOSITORY: 'aiden0z/pptx-renderer',
    });

    expect(getDemoBase({ DEMO_BASE: '/pptx-renderer/test' })).toBe('/pptx-renderer/test/');
    expect(info).toEqual({
      channel: 'test',
      refName: 'fix/issue-4-nowrap-scrollbar',
      sha: 'b1517148f00df00df00df00df00df00df00df00d',
      shortSha: 'b151714',
      buildTime: '2026-07-03T08:00:00Z',
      runUrl: 'https://github.com/aiden0z/pptx-renderer/actions/runs/123',
      repository: 'aiden0z/pptx-renderer',
    });
  });
});
