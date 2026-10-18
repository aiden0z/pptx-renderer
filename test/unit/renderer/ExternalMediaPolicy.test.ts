import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  externalMediaOrigin,
  externalMediaPresentation,
} from '../../fixtures/external-media-policy';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { PptxViewer } from '../../../src/core/Viewer';
import { PptxRenderer } from '../../../src/core/Renderer';
import { isAllowedExternalMediaUrl } from '../../../src/utils/urlSafety';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

describe('externalMedia policy (issue #32)', () => {
  it('blocks otherwise permitted http(s) media without relaxing protocol checks', () => {
    expect(isAllowedExternalMediaUrl(`${externalMediaOrigin}/image.png`, 'block')).toBe(false);
    expect(isAllowedExternalMediaUrl(`${externalMediaOrigin}/image.png`)).toBe(true);
    expect(isAllowedExternalMediaUrl(`${externalMediaOrigin}/image.png`, 'allow')).toBe(true);
    expect(isAllowedExternalMediaUrl('file:///tmp/image.png', 'allow')).toBe(false);
  });

  it.each([false, true])(
    'blocks every external media path with lazyMedia=%s and retains embedded images',
    async (lazy) => {
      const p = externalMediaPresentation(lazy);
      const handle = renderSlide(p, p.slides[0], { externalMedia: 'block', pdfjs: false });
      await handle.ready;
      expect(handle.element.outerHTML).not.toContain(externalMediaOrigin);
      expect(handle.element.querySelector('img[src^="blob:"]')).not.toBeNull();
      expect(handle.element.querySelector('video, audio')).toBeNull();
      handle.dispose();
    },
  );

  it.each([undefined, 'allow'] as const)(
    'keeps default/allow media behavior (%s)',
    async (externalMedia) => {
      const p = externalMediaPresentation();
      const handle = renderSlide(p, p.slides[0], { externalMedia, pdfjs: false });
      await handle.ready;
      for (const id of [
        'picture',
        'linked',
        'background',
        'shape',
        'text',
        'group',
        'layout',
        'master',
        'poster',
        'video',
        'audio',
        'svg',
      ]) {
        expect(handle.element.outerHTML).toContain(`${externalMediaOrigin}/${id}.png`);
      }
      expect(handle.element.querySelector('video')?.preload).toBe('none');
      expect(handle.element.querySelector('audio')?.preload).toBe('none');
      handle.dispose();
    },
  );

  it.each(['list', 'windowed', 'slide', 'external', 'thumbnail', 'legacy'] as const)(
    'forwards block through the %s viewer entry point',
    async (mode) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const options = { externalMedia: 'block' as const, pdfjs: false as const };
      const viewer =
        mode === 'legacy' ? new PptxRenderer(host, options) : new PptxViewer(host, options);
      viewer.load(externalMediaPresentation());
      let externalHandle;
      if (mode === 'external') externalHandle = viewer.renderSlideToContainer(0, host);
      else if (mode === 'thumbnail') externalHandle = viewer.renderThumbnailToContainer(0, host);
      else if (mode === 'slide') await viewer.renderSlide(0);
      else await viewer.renderList({ windowed: mode === 'windowed' });
      await externalHandle?.ready;
      expect(host.outerHTML).not.toContain(externalMediaOrigin);
      expect(host.querySelector('img[src^="blob:"]')).not.toBeNull();
      externalHandle?.dispose();
      viewer.destroy();
      host.remove();
    },
  );
});
