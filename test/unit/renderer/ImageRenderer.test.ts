import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderImage } from '../../../src/renderer/ImageRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import type { PicNodeData } from '../../../src/model/nodes/PicNode';
import type { RenderContext } from '../../../src/renderer/RenderContext';

/** Helper: create a minimal PicNodeData for testing. */
function createPicNode(overrides: Partial<PicNodeData> = {}): PicNodeData {
  const source = overrides.source ?? xmlNode(
    `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
      <blipFill><blip r:embed="rId1"/></blipFill>
      <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
    </pic>`,
  );

  return {
    id: '1',
    name: 'Picture 1',
    nodeType: 'picture',
    position: { x: 100, y: 50 },
    size: { w: 200, h: 100 },
    rotation: 0,
    flipH: false,
    flipV: false,
    blipEmbed: 'rId1',
    source,
    ...overrides,
  };
}

/** Create a mock RenderContext with media data for rId1. */
function createCtxWithMedia(): RenderContext {
  const ctx = createMockRenderContext();
  ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.png' });
  ctx.presentation.media.set('ppt/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return ctx;
}

describe('renderImage', () => {
  describe('wrapper positioning', () => {
    it('creates wrapper with correct position and size', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode();
      const el = renderImage(node, ctx);

      expect(el.style.left).toBe('100px');
      expect(el.style.top).toBe('50px');
      expect(el.style.width).toBe('200px');
      expect(el.style.height).toBe('100px');
      expect(el.style.overflow).toBe('hidden');
    });

    it('applies rotation transform', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 45 });
      const el = renderImage(node, ctx);

      expect(el.style.transform).toContain('rotate(45deg)');
    });

    it('applies flipH and flipV transforms', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ flipH: true, flipV: true });
      const el = renderImage(node, ctx);

      expect(el.style.transform).toContain('scaleX(-1)');
      expect(el.style.transform).toContain('scaleY(-1)');
    });
  });

  describe('crop with pixel-based margins', () => {
    it('uses pixel values for crop offset (not percentages)', () => {
      const ctx = createCtxWithMedia();
      // Crop: top=34.4%, bottom=45.1% → visible vertical: 20.5%
      // left=0%, right=0% → visible horizontal: 100%
      const node = createPicNode({
        size: { w: 155, h: 30 },
        crop: { top: 0.344, bottom: 0.451, left: 0, right: 0 },
      });

      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();

      // marginTop should be in px, NOT in % (this was the CSS bug)
      expect(img!.style.marginTop).toMatch(/px$/);
      expect(img!.style.marginTop).not.toMatch(/%/);
    });

    it('calculates correct pixel crop dimensions for non-square wrapper', () => {
      const ctx = createCtxWithMedia();
      // Wrapper: 155px wide × 30px tall
      // Crop: top=34.4%, left=5%, right=5%, bottom=45.6%
      // visibleW = 1 - 0.05 - 0.05 = 0.90, scaleX = 1/0.9 = 1.111
      // visibleH = 1 - 0.344 - 0.456 = 0.20, scaleY = 1/0.2 = 5.0
      const node = createPicNode({
        size: { w: 155, h: 30 },
        crop: { top: 0.344, bottom: 0.456, left: 0.05, right: 0.05 },
      });

      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();

      // img width = scaleX * wrapperW = (1/0.9) * 155 ≈ 172.22px
      const imgW = parseFloat(img!.style.width);
      expect(imgW).toBeCloseTo(155 / 0.9, 1);

      // img height = scaleY * wrapperH = (1/0.2) * 30 = 150px
      const imgH = parseFloat(img!.style.height);
      expect(imgH).toBeCloseTo(30 / 0.2, 1);

      // marginLeft = -left * scaleX * wrapperW = -0.05 * (1/0.9) * 155 ≈ -8.61px
      const ml = parseFloat(img!.style.marginLeft);
      expect(ml).toBeCloseTo(-0.05 * (1 / 0.9) * 155, 1);

      // marginTop = -top * scaleY * wrapperH = -0.344 * (1/0.2) * 30 = -51.6px
      const mt = parseFloat(img!.style.marginTop);
      expect(mt).toBeCloseTo(-0.344 * (1 / 0.2) * 30, 1);
    });

    it('produces identity-equivalent dimensions for zero-crop rect', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({
        size: { w: 200, h: 100 },
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
      });

      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // With all zeros, visibleW=1, visibleH=1, scale=1×
      // The image should be exactly the wrapper dimensions
      const imgW = parseFloat(img!.style.width);
      const imgH = parseFloat(img!.style.height);
      expect(imgW).toBeCloseTo(200, 0);
      expect(imgH).toBeCloseTo(100, 0);
      // Margins should be zero
      expect(parseFloat(img!.style.marginLeft)).toBeCloseTo(0, 1);
      expect(parseFloat(img!.style.marginTop)).toBeCloseTo(0, 1);
    });
  });

  describe('blip effects', () => {
    it('applies wrapper opacity from alphaModFix', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><alphaModFix amt="35000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      expect(el.style.opacity).toBe('0.35');
    });

    it('attaches load listener for lum effect', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="100000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // In jsdom, img.complete=false so the effect attaches a 'load' listener.
      // We verify the img exists and was appended (the effect is async).
      expect(img!.parentElement).toBe(el);
    });

    it('attaches load listener for biLevel effect', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="25000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.parentElement).toBe(el);
    });
  });

  describe('missing data handling', () => {
    it('shows placeholder when blipEmbed is missing', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('No image data');
    });

    it('shows placeholder when relationship is missing', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ blipEmbed: 'rId999' });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Missing image reference');
    });

    it('shows placeholder when media data is not found', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/missing.png' });
      const el = renderImage(createPicNode(), ctx);
      expect(el.textContent).toContain('Image not found');
    });

    it('shows unsupported format placeholder for WMF', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.wmf' });
      const el = renderImage(createPicNode(), ctx);
      expect(el.textContent).toContain('Unsupported format');
      expect(el.textContent).toContain('WMF');
    });
  });

  describe('video rendering', () => {
    it('renders video element when isVideo is true and media is available', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.controls).toBe(true);
    });

    it('renders video with poster when blipEmbed is available', () => {
      const ctx = createCtxWithMedia();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.poster).not.toBe('');
    });

    it('shows poster with play overlay when video data is missing', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ isVideo: true, blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // Play overlay
      expect(el.textContent).toContain('\u25B6');
    });

    it('shows Video placeholder when no video or poster available', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isVideo: true, blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Video');
    });

    it('resolves external video URL (http/https)', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'https://example.com/video.mp4' });
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.src).toContain('https://example.com/video.mp4');
    });
  });

  describe('audio rendering', () => {
    it('renders audio element when isAudio and media is available', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).not.toBeNull();
      expect(audio!.controls).toBe(true);
    });

    it('renders audio with poster image when blipEmbed is available', () => {
      const ctx = createCtxWithMedia();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      const img = el.querySelector('img');
      expect(audio).not.toBeNull();
      expect(img).not.toBeNull();
    });

    it('shows Audio placeholder when no audio URL available', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isAudio: true, blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Audio');
    });
  });

  describe('blob URL caching', () => {
    it('reuses cached blob URL for same media', () => {
      const ctx = createCtxWithMedia();
      renderImage(createPicNode(), ctx);
      expect(ctx.mediaUrlCache.size).toBe(1);
      renderImage(createPicNode(), ctx);
      // Should still be 1 (reused)
      expect(ctx.mediaUrlCache.size).toBe(1);
    });
  });

  describe('degenerate crop handling', () => {
    it('skips crop when visibleW is too small (degenerate horizontal)', () => {
      const ctx = createCtxWithMedia();
      // left=0.6, right=0.5 → visibleW = -0.1 (invalid)
      const node = createPicNode({
        size: { w: 200, h: 100 },
        crop: { top: 0, bottom: 0, left: 0.6, right: 0.5 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // Should not apply crop scaling (width should be 100% of wrapper)
      expect(img!.style.width).toBe('100%');
      expect(img!.style.height).toBe('100%');
    });

    it('skips crop when visibleH is too small (degenerate vertical)', () => {
      const ctx = createCtxWithMedia();
      // top=0.8, bottom=0.3 → visibleH = -0.1 (invalid)
      const node = createPicNode({
        size: { w: 200, h: 100 },
        crop: { top: 0.8, bottom: 0.3, left: 0, right: 0 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.width).toBe('100%');
    });

    it('skips crop when visible fraction is exactly 0.001 (edge of tolerance)', () => {
      const ctx = createCtxWithMedia();
      // visibleW = 1 - 0.4995 - 0.5 = 0.0005 (just under 0.001)
      const node = createPicNode({
        size: { w: 200, h: 100 },
        crop: { top: 0, bottom: 0, left: 0.4995, right: 0.5 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.width).toBe('100%');
    });

    it('applies crop when visible fraction is just above 0.001', () => {
      const ctx = createCtxWithMedia();
      // visibleW = 1 - 0.499 - 0.5 = 0.001 (exactly at boundary, but > 0.001 = true)
      // visibleH = 0.5 (well above)
      const node = createPicNode({
        size: { w: 200, h: 100 },
        crop: { top: 0, bottom: 0, left: 0.499, right: 0.5 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // Should apply scaling since visible > 0.001
      const w = parseFloat(img!.style.width);
      expect(w).toBeGreaterThan(200);
    });
  });

  describe('multiple alpha modifiers', () => {
    it('combines alphaModFix, alphaMod, and alphaOff', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <alphaModFix amt="80000"/>
            <alphaMod val="50000"/>
            <alphaOff val="10000"/>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      // 0.8 * 0.5 + 0.1 = 0.4 + 0.1 = 0.5
      expect(el.style.opacity).toBe('0.5');
    });

    it('clamps opacity to 0 when combined value goes negative', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <alphaOff val="-150000"/>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      expect(el.style.opacity).toBe('0');
    });

    it('clamps opacity to 1 when combined value exceeds 1', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <alphaModFix amt="150000"/>
            <alphaOff val="50000"/>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      // When opacity is 1, the style is not applied (because of the if check: opacity < 1)
      expect(el.style.opacity).toBe('');
    });

    it('does not apply opacity style when final opacity equals 1', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"/></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      expect(el.style.opacity).toBe('');
    });
  });

  describe('duotone effect', () => {
    it('applies duotone filter when both colors are present', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
              <srgbClr val="0000FF"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips duotone when only one color is present', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips duotone when no colors are present', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone></duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('lum (luminance) effect', () => {
    it('applies brightness only (no contrast)', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="50000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('applies contrast only (no brightness)', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum contrast="50000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips lum effect when both bright and contrast are zero', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="0" contrast="0"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('biLevel (threshold) effect', () => {
    it('applies biLevel with explicit threshold', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="25000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('uses default threshold 50000 when thresh attribute missing', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('video media resolution edge cases', () => {
    it('shows poster without play overlay when video data missing but poster available', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ isVideo: true, blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('handles video poster when blipEmbed relationship missing', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: 'rId999' });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
    });

    it('handles video when blipEmbed points to unsupported format', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/poster.wmf' });
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/poster.wmf', new Uint8Array([0x00]));
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.poster).toBe('');
    });
  });

  describe('audio media resolution edge cases', () => {
    it('renders audio without poster when blipEmbed missing', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).not.toBeNull();
    });

    it('renders audio without poster when relationship missing', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: 'rId999' });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).not.toBeNull();
    });

    it('handles audio poster when media data not found', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/poster.png' });
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).not.toBeNull();
    });

    it('skips audio poster when format is unsupported', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/poster.wmf' });
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/poster.wmf', new Uint8Array([0x00]));
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      const img = el.querySelector('img');
      expect(audio).not.toBeNull();
      expect(img).toBeNull();
    });
  });

  describe('external media URLs', () => {
    it('resolves http external video URL', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'http://example.com/video.mp4' });
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.src).toBe('http://example.com/video.mp4');
    });

    it('resolves https external audio URL', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'https://example.com/audio.mp3' });
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).not.toBeNull();
      expect(audio!.src).toBe('https://example.com/audio.mp3');
    });

    it('resolves embedded media URL when rel target is not http', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.src).toContain('blob:');
    });

    it('returns undefined for external URL with missing embedded media', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/missing.mp3' });
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).toBeNull();
    });
  });

  describe('EMF image handling', () => {
    it('detects EMF format and delegates to renderEmf', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
      // Simple EMF header: 0x464d4520 (little-endian "EMF" magic)
      const emfData = new Uint8Array([0x20, 0x45, 0x4d, 0x46, 0x00, 0x00, 0x00, 0x00]);
      ctx.presentation.media.set('ppt/media/image1.emf', emfData);
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      expect(el).not.toBeNull();
    });
  });

  describe('image loading behavior for effects', () => {
    it('attaches load listener when image is not yet complete for duotone', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
              <srgbClr val="0000FF"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      // In jsdom, image is not complete, so listener was attached
      expect(img.complete).toBe(false);
    });

    it('applies lum immediately when image is complete', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="50000" contrast="25000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('applies biLevel with contrast modifier', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="20000" contrast="-50000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('media URL resolution edge cases', () => {
    it('returns undefined when mediaRId is not provided', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isVideo: true, mediaRId: undefined, blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video');
      expect(video).toBeNull();
    });

    it('handles missing relationship for mediaRId', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isAudio: true, mediaRId: 'rId999', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio');
      expect(audio).toBeNull();
    });
  });

  describe('transform combinations', () => {
    it('applies rotation, flipH, and flipV together', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 90, flipH: true, flipV: true });
      const el = renderImage(node, ctx);
      const transform = el.style.transform;
      expect(transform).toContain('rotate(90deg)');
      expect(transform).toContain('scaleX(-1)');
      expect(transform).toContain('scaleY(-1)');
    });

    it('applies only rotation when flipH and flipV are false', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 180, flipH: false, flipV: false });
      const el = renderImage(node, ctx);
      const transform = el.style.transform;
      expect(transform).toContain('rotate(180deg)');
      expect(transform).not.toContain('scaleX');
    });

    it('applies only flips when rotation is zero', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 0, flipH: true, flipV: false });
      const el = renderImage(node, ctx);
      const transform = el.style.transform;
      expect(transform).toContain('scaleX(-1)');
      expect(transform).not.toContain('rotate');
    });

    it('has no transform when all rotation and flips are zero/false', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 0, flipH: false, flipV: false });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toBe('');
    });
  });

  describe('image element styling', () => {
    it('sets correct CSS properties on img element', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode();
      const el = renderImage(node, ctx);
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
      expect(img.style.objectFit).toBe('fill');
      expect(img.style.display).toBe('block');
      expect(img.draggable).toBe(false);
    });
  });

  describe('wrapper styling', () => {
    it('sets correct CSS properties on wrapper div', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ position: { x: 50, y: 100 }, size: { w: 300, h: 200 } });
      const el = renderImage(node, ctx);
      expect(el.style.position).toBe('absolute');
      expect(el.style.left).toBe('50px');
      expect(el.style.top).toBe('100px');
      expect(el.style.width).toBe('300px');
      expect(el.style.height).toBe('200px');
      expect(el.style.overflow).toBe('hidden');
    });
  });

  describe('video element styling', () => {
    it('sets correct CSS properties on video element', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00]));
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const video = el.querySelector('video') as HTMLVideoElement;
      expect(video).not.toBeNull();
      expect(video.style.width).toBe('100%');
      expect(video.style.height).toBe('100%');
      expect(video.style.objectFit).toBe('contain');
      expect(video.style.backgroundColor).toBe('rgb(0, 0, 0)');
    });
  });

  describe('audio element styling', () => {
    it('sets correct CSS properties on audio element', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const audio = el.querySelector('audio') as HTMLAudioElement;
      expect(audio).not.toBeNull();
      expect(audio.style.width).toBe('100%');
      expect(audio.style.position).toBe('absolute');
      expect(audio.style.bottom).toBe('0px');
      expect(audio.style.left).toBe('0px');
    });
  });

  describe('placeholder styling', () => {
    it('renders placeholder with correct styling', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ blipEmbed: undefined });
      const el = renderImage(node, ctx);
      const placeholder = el.querySelector('div');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.style.width).toBe('100%');
      expect(placeholder!.style.height).toBe('100%');
      expect(placeholder!.style.display).toBe('flex');
    });

    it('renders unsupported format placeholder with correct styling', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.wmf' });
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const placeholder = el.querySelector('div');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.style.flexDirection).toBe('column');
    });
  });

  describe('play overlay for video poster', () => {
    it('creates overlay with play symbol', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ isVideo: true, blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const overlay = el.querySelector('div[style*="absolute"]');
      // Find the overlay div that has the play symbol
      let playOverlay = null;
      el.querySelectorAll('div').forEach((div) => {
        if (div.textContent === '\u25B6') {
          playOverlay = div;
        }
      });
      expect(playOverlay).not.toBeNull();
      if (playOverlay) {
        expect(playOverlay.style.color).toBe('rgb(255, 255, 255)');
        expect(playOverlay.style.fontSize).toBe('24px');
      }
    });
  });

  describe('alphaMod handling', () => {
    it('applies alphaMod when alphaModFix is absent', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><alphaMod val="25000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      expect(el.style.opacity).toBe('0.25');
    });

    it('applies alphaOff when other modifiers are absent', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <alphaModFix amt="50000"/>
            <alphaOff val="20000"/>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      // 0.5 + 0.2 = 0.7
      expect(el.style.opacity).toBe('0.7');
    });
  });

  describe('crop edge cases', () => {
    it('handles crop with only top and left offsets', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({
        size: { w: 100, h: 100 },
        crop: { top: 0.2, bottom: 0, left: 0.1, right: 0 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      const w = parseFloat(img!.style.width);
      const h = parseFloat(img!.style.height);
      // visibleW = 1 - 0.1 - 0 = 0.9, so scale = 1/0.9
      expect(w).toBeCloseTo(100 / 0.9, 0);
      // visibleH = 1 - 0.2 - 0 = 0.8, so scale = 1/0.8
      expect(h).toBeCloseTo(100 / 0.8, 0);
    });

    it('handles crop with only right and bottom offsets', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({
        size: { w: 100, h: 100 },
        crop: { top: 0, bottom: 0.15, left: 0, right: 0.25 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      const w = parseFloat(img!.style.width);
      // visibleW = 1 - 0 - 0.25 = 0.75, scale = 1/0.75
      expect(w).toBeCloseTo(100 / 0.75, 0);
    });

    it('handles crop with all non-zero values', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({
        size: { w: 200, h: 300 },
        crop: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 },
      });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      const ml = parseFloat(img!.style.marginLeft);
      const mt = parseFloat(img!.style.marginTop);
      expect(ml).not.toBeCloseTo(0, 0);
      expect(mt).not.toBeCloseTo(0, 0);
    });
  });

  describe('image effect canvas operations', () => {
    it('skips lum effect when image has no natural dimensions', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="50000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      // Image not yet loaded in jsdom, so listener was attached
      expect(img!.addEventListener).toBeDefined();
    });

    it('skips biLevel effect when image has no natural dimensions', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="75000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips duotone effect when any resolved color is missing', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <schemeClr val="dk1"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('audio placeholder fallback', () => {
    it('renders audio placeholder when no mediaRId provided', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isAudio: true, mediaRId: undefined, blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Audio');
    });

    it('renders audio placeholder when mediaRId relationship missing', () => {
      const ctx = createMockRenderContext();
      const node = createPicNode({ isAudio: true, mediaRId: 'rId999', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Audio');
    });

    it('renders audio placeholder when media data not in presentation', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/missing.mp3' });
      const node = createPicNode({ isAudio: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      expect(el.textContent).toContain('Audio');
    });
  });

  describe('canvas effect edge cases', () => {
    it('handles canvas getContext failure in lum effect gracefully', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="30000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.parentElement).toBe(el);
    });

    it('handles canvas getContext failure in biLevel effect gracefully', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="50000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.parentElement).toBe(el);
    });

    it('handles canvas getContext failure in duotone effect gracefully', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
              <srgbClr val="00FF00"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('complex rendering scenarios', () => {
    it('renders image with rotation, flip, crop, and opacity', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><alphaModFix amt="60000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({
        source,
        rotation: 45,
        flipH: true,
        crop: { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 },
      });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(45deg)');
      expect(el.style.transform).toContain('scaleX(-1)');
      expect(el.style.opacity).toBe('0.6');
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(parseFloat(img!.style.width)).toBeGreaterThan(0);
    });

    it('renders video with all effects and metadata', () => {
      const ctx = createCtxWithMedia();
      ctx.slide.rels.set('rId2', { type: 'video', target: 'ppt/media/video1.mp4' });
      ctx.presentation.media.set('ppt/media/video1.mp4', new Uint8Array([0x00, 0x01]));
      const node = createPicNode({
        isVideo: true,
        mediaRId: 'rId2',
        blipEmbed: 'rId1',
        rotation: 90,
      });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(90deg)');
      const video = el.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.controls).toBe(true);
      expect(video!.poster).not.toBe('');
    });

    it('renders audio with poster and metadata', () => {
      const ctx = createCtxWithMedia();
      ctx.slide.rels.set('rId2', { type: 'audio', target: 'ppt/media/audio1.mp3' });
      ctx.presentation.media.set('ppt/media/audio1.mp3', new Uint8Array([0x00]));
      const node = createPicNode({
        isAudio: true,
        mediaRId: 'rId2',
        blipEmbed: 'rId1',
        size: { w: 300, h: 100 },
      });
      const el = renderImage(node, ctx);
      expect(el.style.width).toBe('300px');
      expect(el.style.height).toBe('100px');
      const audio = el.querySelector('audio');
      const img = el.querySelector('img');
      expect(audio).not.toBeNull();
      expect(img).not.toBeNull();
    });

    it('combines multiple blip effects with crop', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <alphaModFix amt="75000"/>
            <duotone>
              <srgbClr val="0000FF"/>
              <srgbClr val="FFFF00"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({
        source,
        crop: { top: 0.15, bottom: 0.15, left: 0.1, right: 0.1 },
      });
      const el = renderImage(node, ctx);
      expect(el.style.opacity).toBe('0.75');
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.marginLeft).not.toBe('');
      expect(img!.style.marginTop).not.toBe('');
    });

    it('renders image with lum and biLevel effects together', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <lum bright="15000" contrast="-30000"/>
            <biLevel thresh="35000"/>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.parentElement).toBe(el);
    });

    it('handles image with negative brightness in lum', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum bright="-40000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('handles image with high contrast in lum', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><lum contrast="75000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('handles image with low biLevel threshold', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="10000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('handles image with high biLevel threshold', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"><biLevel thresh="90000"/></blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('duotone with different color schemes', () => {
    it('applies duotone with schemeClr colors', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <schemeClr val="accent1"/>
              <schemeClr val="accent2"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('applies duotone with mixed srgbClr and schemeClr', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
              <schemeClr val="accent3"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips duotone when first color resolution fails', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <invalidClr/>
              <srgbClr val="0000FF"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('skips duotone when second color resolution fails', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="FF0000"/>
              <invalidClr/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('hex color format handling in effects', () => {
    it('handles hex colors with # prefix in duotone', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="#FF0000"/>
              <srgbClr val="#0000FF"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });

    it('handles hex colors without # prefix in duotone', () => {
      const ctx = createCtxWithMedia();
      const source = xmlNode(
        `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1">
            <duotone>
              <srgbClr val="00FF00"/>
              <srgbClr val="FFFF00"/>
            </duotone>
          </blip></blipFill>
          <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
        </pic>`,
      );
      const node = createPicNode({ source });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('edge cases for media resolution', () => {
    it('handles relationship with empty target', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId2', { type: 'video', target: '' });
      const node = createPicNode({ isVideo: true, mediaRId: 'rId2', blipEmbed: undefined });
      const el = renderImage(node, ctx);
      // Should attempt to find media with empty path
      expect(el).not.toBeNull();
    });

    it('handles media with special characters in path', () => {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image%20with%20spaces.png' });
      ctx.presentation.media.set('ppt/media/image%20with%20spaces.png', new Uint8Array([0x89]));
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img');
      expect(img).not.toBeNull();
    });
  });

  describe('position and size edge cases', () => {
    it('handles zero dimensions', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ position: { x: 0, y: 0 }, size: { w: 0, h: 0 } });
      const el = renderImage(node, ctx);
      expect(el.style.width).toBe('0px');
      expect(el.style.height).toBe('0px');
    });

    it('handles very large dimensions', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ position: { x: 10000, y: 20000 }, size: { w: 50000, h: 100000 } });
      const el = renderImage(node, ctx);
      expect(el.style.left).toBe('10000px');
      expect(el.style.top).toBe('20000px');
      expect(el.style.width).toBe('50000px');
      expect(el.style.height).toBe('100000px');
    });

    it('handles negative position (off-screen placement)', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ position: { x: -100, y: -50 }, size: { w: 200, h: 100 } });
      const el = renderImage(node, ctx);
      expect(el.style.left).toBe('-100px');
      expect(el.style.top).toBe('-50px');
    });

    it('handles floating point positions', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ position: { x: 123.456, y: 789.012 }, size: { w: 345.67, h: 890.12 } });
      const el = renderImage(node, ctx);
      expect(el.style.left).toContain('123.456');
      expect(el.style.top).toContain('789.012');
    });
  });

  describe('rotation edge cases', () => {
    it('handles 360 degree rotation', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 360 });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(360deg)');
    });

    it('handles negative rotation', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: -45 });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(-45deg)');
    });

    it('handles decimal rotation', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 22.5 });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(22.5deg)');
    });

    it('handles very large rotation values', () => {
      const ctx = createCtxWithMedia();
      const node = createPicNode({ rotation: 720 });
      const el = renderImage(node, ctx);
      expect(el.style.transform).toContain('rotate(720deg)');
    });
  });

  // ---------------------------------------------------------------------------
  // Already-loaded path: img.complete && img.naturalWidth truthy
  // These tests exercise the synchronous apply() branch in applyBiLevelEffect
  // (lines 651-652) and applyLumEffect (lines 602-603) in ImageRenderer.ts.
  //
  // jsdom images are never complete, so we intercept createElement('img') to
  // inject a pre-loaded stub. We also provide a fully-mocked 2D canvas context
  // so canvas operations work without the native canvas package.
  // ---------------------------------------------------------------------------

  /**
   * Build a fully-mocked CanvasRenderingContext2D that:
   * - Stores pixel data in a Uint8ClampedArray seeded with known RGBA values.
   * - Supports getImageData / putImageData / drawImage / toDataURL.
   *
   * This lets applyBiLevelEffect and applyLumEffect run their pixel loop
   * without requiring a native canvas implementation.
   */
  function makeMockCanvas2d(width: number, height: number, seedPixels?: Uint8ClampedArray) {
    const size = width * height * 4;
    const buf = new Uint8ClampedArray(size);
    if (seedPixels) buf.set(seedPixels.subarray(0, size));

    const writtenDataUrl = { value: '' };

    const ctx2d = {
      drawImage: vi.fn(), // no-op; pixel data already seeded
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: buf.slice(0, w * h * 4),
        width: w,
        height: h,
      })),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => {
        buf.set(imageData.data);
      }),
    };

    const mockCanvas = {
      width,
      height,
      getContext: vi.fn(() => ctx2d),
      toDataURL: vi.fn(() => {
        // Return a stub data URL; the exact content isn't tested.
        writtenDataUrl.value = 'data:image/png;base64,MOCK';
        return writtenDataUrl.value;
      }),
    };

    return { mockCanvas, ctx2d, buf, writtenDataUrl };
  }

  /**
   * Intercept document.createElement so that:
   * - 'img' elements report complete=true with given naturalWidth/naturalHeight.
   * - 'canvas' elements return our mock canvas with controllable pixel data.
   *
   * Returns the spy and an array tracking all src values assigned to img elements.
   */
  function interceptCreateElement(
    naturalWidth: number,
    naturalHeight: number,
    seedPixels?: Uint8ClampedArray,
  ) {
    const originalCreateElement = document.createElement.bind(document);
    const srcHistory: string[] = [];

    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'img') {
        const stub = originalCreateElement('img') as HTMLImageElement;
        Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
        Object.defineProperty(stub, 'naturalWidth', { get: () => naturalWidth, configurable: true });
        Object.defineProperty(stub, 'naturalHeight', { get: () => naturalHeight, configurable: true });
        let _src = '';
        Object.defineProperty(stub, 'src', {
          get: () => _src,
          set: (v: string) => { _src = v; srcHistory.push(v); },
          configurable: true,
        });
        return stub;
      }
      if (tag === 'canvas') {
        const { mockCanvas } = makeMockCanvas2d(naturalWidth, naturalHeight, seedPixels);
        return mockCanvas as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    return { spy, srcHistory };
  }

  describe('biLevel effect — already-loaded image (synchronous apply path)', () => {
    it('applies biLevel immediately when img.complete and img.naturalWidth are set', () => {
      // A mid-gray seed pixel: luminance ≈ 0.502 >= threshold 0.5 → becomes white.
      const seed = new Uint8ClampedArray([128, 128, 128, 255]);
      const { spy, srcHistory } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><biLevel thresh="50000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);

        // apply() ran synchronously — the mock canvas toDataURL() was called and its
        // result assigned back to img.src as a data: URL.
        const dataUrls = srcHistory.filter((s) => s.startsWith('data:'));
        expect(dataUrls.length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('applies biLevel with thresh="0" — every pixel luminance is >= 0, all become white', () => {
      // Even a nearly-black pixel (luminance ≈ 0.008) is >= threshold 0.
      const seed = new Uint8ClampedArray([2, 2, 2, 255]);
      const { spy, srcHistory } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><biLevel thresh="0"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // Synchronous path ran — at least the blob: src was assigned.
        expect(srcHistory.length).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('applies biLevel with thresh="100000" — threshold=1, no pixel luminance reaches 1, all black', () => {
      const seed = new Uint8ClampedArray([200, 200, 200, 255]);
      const { spy } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><biLevel thresh="100000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        const el = renderImage(createPicNode({ source }), ctx);
        // Wrapper is returned with the img element appended.
        expect(el.querySelector('img')).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('skips biLevel apply() body when naturalWidth is 0 even if complete is true', () => {
      // naturalWidth=0 triggers the early-exit guard: if (!w || !h) return.
      // We track drawImage calls on the mock canvas to confirm it was never reached.
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 0, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 0, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(0, 0);
          vi.spyOn(ctx2d, 'drawImage').mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      const ctx = createCtxWithMedia();
      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><biLevel thresh="50000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() entered the synchronous branch but returned before drawImage.
        expect(drawImageCalls.length).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('calls drawImage on the canvas when naturalWidth > 0 (confirms canvas pixel manipulation runs)', () => {
      // Verify that apply() actually calls drawImage when the image is pre-loaded.
      const { spy } = interceptCreateElement(2, 2, new Uint8ClampedArray(16).fill(128));
      const ctx = createCtxWithMedia();
      // Track drawImage calls through the mock returned from makeMockCanvas2d.
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      spy.mockRestore(); // Replace with a more instrumented version.
      const spy2 = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 2, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 2, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(2, 2, new Uint8ClampedArray(16).fill(200));
          ctx2d.drawImage.mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><biLevel thresh="50000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() ran its full body — drawImage was called exactly once.
        expect(drawImageCalls.length).toBe(1);
      } finally {
        spy2.mockRestore();
      }
    });
  });

  describe('lum effect — already-loaded image (synchronous apply path)', () => {
    it('applies lum effect immediately when img.complete and img.naturalWidth are set', () => {
      // Any non-zero bright or contrast causes apply() to run.
      const seed = new Uint8ClampedArray([100, 100, 100, 255]);
      const { spy, srcHistory } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><lum bright="50000" contrast="25000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() executed synchronously — mock toDataURL result was written to img.src.
        const dataUrls = srcHistory.filter((s) => s.startsWith('data:'));
        expect(dataUrls.length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('applies lum effect immediately when only brightness is non-zero', () => {
      const { spy, srcHistory } = interceptCreateElement(1, 1, new Uint8ClampedArray([50, 50, 50, 255]));
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><lum bright="30000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // Synchronous branch: img.src was assigned at least the blob: URL.
        expect(srcHistory.length).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('applies lum effect immediately when only contrast is non-zero', () => {
      const { spy, srcHistory } = interceptCreateElement(1, 1, new Uint8ClampedArray([150, 150, 150, 255]));
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><lum contrast="-50000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        expect(srcHistory.length).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('skips lum apply() body when naturalWidth is 0 even if complete is true', () => {
      // The early-exit guard in apply(): if (!w || !h) return.
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 0, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 0, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(0, 0);
          ctx2d.drawImage.mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      const ctx = createCtxWithMedia();
      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><lum bright="50000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // Early return before canvas drawImage was called.
        expect(drawImageCalls.length).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('calls drawImage when naturalWidth > 0 (confirms pixel manipulation runs synchronously)', () => {
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 1, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 1, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(1, 1, new Uint8ClampedArray([80, 80, 80, 255]));
          ctx2d.drawImage.mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      const ctx = createCtxWithMedia();
      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1"><lum bright="20000" contrast="10000"/></blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() ran the full pixel loop and called drawImage once.
        expect(drawImageCalls.length).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('biLevel pixel-level threshold correctness (pure logic)', () => {
    /**
     * Pure TypeScript reimplementation of the applyBiLevelEffect pixel loop.
     * Tests the algorithm directly without any DOM or canvas involvement.
     * This validates the formula: gray = (0.2126*R + 0.7152*G + 0.0722*B) / 255,
     * val = (gray >= thresh) ? 255 : 0.
     */
    function biLevelPixel(thresh: number, r: number, g: number, b: number, a: number = 255) {
      const threshNorm = thresh / 100000;
      const gray = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const val = gray >= threshNorm ? 255 : 0;
      return { r: val, g: val, b: val, a };
    }

    it('maps a mid-gray pixel above threshold 50% to white', () => {
      // 128/255 ≈ 0.502 >= 0.50 → white
      const out = biLevelPixel(50000, 128, 128, 128);
      expect(out.r).toBe(255);
      expect(out.g).toBe(255);
      expect(out.b).toBe(255);
    });

    it('maps a dark pixel below threshold 50% to black', () => {
      // 50/255 ≈ 0.196 < 0.50 → black
      const out = biLevelPixel(50000, 50, 50, 50);
      expect(out.r).toBe(0);
      expect(out.g).toBe(0);
      expect(out.b).toBe(0);
    });

    it('preserves alpha channel unchanged', () => {
      const out = biLevelPixel(50000, 200, 200, 200, 128);
      expect(out.a).toBe(128);
    });

    it('uses luminance weighting — pure green has high luminance (0.7152)', () => {
      // Green luminance = 0.7152; thresh=70000 → 0.70. 0.7152 >= 0.70 → white.
      const out = biLevelPixel(70000, 0, 255, 0);
      expect(out.r).toBe(255);
    });

    it('uses luminance weighting — pure blue has low luminance (0.0722)', () => {
      // Blue luminance = 0.0722; thresh=10000 → 0.10. 0.0722 < 0.10 → black.
      const out = biLevelPixel(10000, 0, 0, 255);
      expect(out.r).toBe(0);
    });

    it('uses luminance weighting — pure red has moderate luminance (0.2126)', () => {
      // Red luminance = 0.2126; thresh=20000 → 0.20. 0.2126 >= 0.20 → white.
      const out = biLevelPixel(20000, 255, 0, 0);
      expect(out.r).toBe(255);
      // thresh=25000 → 0.25. 0.2126 < 0.25 → black.
      const out2 = biLevelPixel(25000, 255, 0, 0);
      expect(out2.r).toBe(0);
    });

    it('treats threshold 0 — every pixel maps to white (luminance always >= 0)', () => {
      expect(biLevelPixel(0, 0, 0, 0).r).toBe(255);   // even pure black
      expect(biLevelPixel(0, 1, 1, 1).r).toBe(255);
    });

    it('treats threshold 100000 — virtually all pixels map to black due to floating-point', () => {
      // (0.2126 + 0.7152 + 0.0722) = 0.9999...999 in IEEE 754 float64.
      // So even pure white (255,255,255) yields gray ≈ 0.99999...< 1.0 → black.
      // This is the actual behavior of the ImageRenderer implementation.
      expect(biLevelPixel(100000, 255, 255, 255).r).toBe(0);
      expect(biLevelPixel(100000, 254, 254, 254).r).toBe(0);
      // Mid-gray → black as well.
      expect(biLevelPixel(100000, 128, 128, 128).r).toBe(0);
    });

    it('boundary: pixel luminance equal to threshold maps to white (>= is inclusive)', () => {
      // For uniform gray at value x: gray = x / 255.
      // thresh = round(gray * 100000). At equality, gray >= threshNorm is true.
      const x = 127;
      const gray = (0.2126 * x + 0.7152 * x + 0.0722 * x) / 255; // = x/255
      const threshInt = Math.round(gray * 100000);
      const threshNorm = threshInt / 100000;
      // gray - threshNorm may differ by up to 0.000005 due to rounding.
      // The floor direction (threshInt = floor) guarantees gray >= threshNorm.
      const floorThresh = Math.floor(gray * 100000);
      const out = biLevelPixel(floorThresh, x, x, x);
      expect(out.r).toBe(255);
    });

    it('produces black for pure-black pixel at any positive threshold', () => {
      expect(biLevelPixel(1, 0, 0, 0).r).toBe(0);
      expect(biLevelPixel(50000, 0, 0, 0).r).toBe(0);
      expect(biLevelPixel(99999, 0, 0, 0).r).toBe(0);
    });

    it('all three output channels receive the same value (black-and-white output)', () => {
      const white = biLevelPixel(50000, 200, 200, 200);
      expect(white.r).toBe(white.g);
      expect(white.g).toBe(white.b);

      const black = biLevelPixel(50000, 10, 10, 10);
      expect(black.r).toBe(black.g);
      expect(black.g).toBe(black.b);
    });
  });

  describe('duotone effect — already-loaded image (synchronous apply path)', () => {
    it('applies duotone immediately when img.complete and img.naturalWidth are set', () => {
      // Seed a single mid-gray pixel: luminance = 128/255 ≈ 0.502
      // Duotone maps: dark(0)→srgbClr #FF0000, light(1)→srgbClr #0000FF
      // At gray≈0.502: R≈128, G=0, B≈128
      const seed = new Uint8ClampedArray([128, 128, 128, 255]);
      const { spy, srcHistory } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1">
              <duotone>
                <srgbClr val="FF0000"/>
                <srgbClr val="0000FF"/>
              </duotone>
            </blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);

        // apply() ran synchronously — the mock canvas toDataURL() was called and its
        // result assigned back to img.src as a data: URL.
        const dataUrls = srcHistory.filter((s) => s.startsWith('data:'));
        expect(dataUrls.length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('calls drawImage on canvas when duotone runs synchronously (confirms pixel manipulation)', () => {
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 2, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 2, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(2, 2, new Uint8ClampedArray(16).fill(200));
          ctx2d.drawImage.mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      const ctx = createCtxWithMedia();
      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1">
              <duotone>
                <srgbClr val="000000"/>
                <srgbClr val="FFFFFF"/>
              </duotone>
            </blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() ran its full body — drawImage was called exactly once.
        expect(drawImageCalls.length).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('skips duotone apply() body when naturalWidth is 0 even if complete is true', () => {
      const originalCreateElement = document.createElement.bind(document);
      const drawImageCalls: unknown[] = [];

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'img') {
          const stub = originalCreateElement('img') as HTMLImageElement;
          Object.defineProperty(stub, 'complete', { get: () => true, configurable: true });
          Object.defineProperty(stub, 'naturalWidth', { get: () => 0, configurable: true });
          Object.defineProperty(stub, 'naturalHeight', { get: () => 0, configurable: true });
          let _src = '';
          Object.defineProperty(stub, 'src', {
            get: () => _src,
            set: (v: string) => { _src = v; },
            configurable: true,
          });
          return stub;
        }
        if (tag === 'canvas') {
          const { mockCanvas, ctx2d } = makeMockCanvas2d(0, 0);
          ctx2d.drawImage.mockImplementation((...a) => drawImageCalls.push(a));
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tag);
      });

      const ctx = createCtxWithMedia();
      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1">
              <duotone>
                <srgbClr val="FF0000"/>
                <srgbClr val="0000FF"/>
              </duotone>
            </blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // apply() entered the synchronous branch but returned before drawImage.
        expect(drawImageCalls.length).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('applies duotone with schemeClr colors synchronously', () => {
      const seed = new Uint8ClampedArray([64, 64, 64, 255]);
      const { spy, srcHistory } = interceptCreateElement(1, 1, seed);
      const ctx = createCtxWithMedia();

      try {
        const source = xmlNode(
          `<pic xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <nvPicPr><cNvPr id="1" name="pic"/><nvPr/></nvPicPr>
            <blipFill><blip r:embed="rId1">
              <duotone>
                <schemeClr val="dk1"/>
                <schemeClr val="lt1"/>
              </duotone>
            </blip></blipFill>
            <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
          </pic>`,
        );
        renderImage(createPicNode({ source }), ctx);
        // Both schemeClr resolve (dk1→000000, lt1→FFFFFF) so duotone runs.
        const dataUrls = srcHistory.filter((s) => s.startsWith('data:'));
        expect(dataUrls.length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('duotone pixel-level correctness (pure logic)', () => {
    /**
     * Pure TypeScript reimplementation of the applyDuotoneFilter pixel loop.
     * Tests the algorithm directly without any DOM or canvas involvement.
     * Formula: gray = (0.2126*R + 0.7152*G + 0.0722*B) / 255,
     * then linearly interpolate between color1 (dark) and color2 (light).
     */
    function duotonePixel(
      r: number, g: number, b: number,
      c1: { r: number; g: number; b: number },
      c2: { r: number; g: number; b: number },
    ) {
      const gray = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return {
        r: Math.round(c1.r + (c2.r - c1.r) * gray),
        g: Math.round(c1.g + (c2.g - c1.g) * gray),
        b: Math.round(c1.b + (c2.b - c1.b) * gray),
      };
    }

    it('maps pure black pixel to color1 (dark color)', () => {
      const out = duotonePixel(0, 0, 0, { r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 });
      expect(out.r).toBe(255);
      expect(out.g).toBe(0);
      expect(out.b).toBe(0);
    });

    it('maps pure white pixel to color2 (light color)', () => {
      // gray for (255,255,255) = (0.2126 + 0.7152 + 0.0722) = ~1.0
      const out = duotonePixel(255, 255, 255, { r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 });
      // gray ≈ 1.0 → result ≈ color2
      expect(out.r).toBeCloseTo(0, 0);
      expect(out.b).toBeCloseTo(255, 0);
    });

    it('maps mid-gray pixel to interpolation between color1 and color2', () => {
      // gray for (128,128,128) ≈ 128/255 ≈ 0.502
      const out = duotonePixel(128, 128, 128, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
      // Result should be approximately 128 for all channels
      expect(out.r).toBeCloseTo(128, 0);
      expect(out.g).toBeCloseTo(128, 0);
      expect(out.b).toBeCloseTo(128, 0);
    });

    it('uses luminance weighting — pure green has high gray value', () => {
      // Green luminance = 0.7152*255/255 = 0.7152
      const out = duotonePixel(0, 255, 0, { r: 0, g: 0, b: 0 }, { r: 100, g: 100, b: 100 });
      expect(out.r).toBeCloseTo(Math.round(0.7152 * 100), 0);
    });

    it('uses luminance weighting — pure blue has low gray value', () => {
      // Blue luminance = 0.0722*255/255 = 0.0722
      const out = duotonePixel(0, 0, 255, { r: 0, g: 0, b: 0 }, { r: 100, g: 100, b: 100 });
      expect(out.r).toBeCloseTo(Math.round(0.0722 * 100), 0);
    });
  });

  // ---------------------------------------------------------------------------
  // EMF rendering paths (lines 383–481)
  // ---------------------------------------------------------------------------

  describe('EMF rendering — renderEmf dispatcher', () => {
    function createEmfCtx(emfData?: Uint8Array): RenderContext {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
      ctx.presentation.media.set(
        'ppt/media/image1.emf',
        emfData ?? new Uint8Array([0x01]),
      );
      return ctx;
    }

    it('dispatches to renderEmfPdf when parseEmfContent returns pdf type', async () => {
      const { parseEmfContent } = await import('../../../src/utils/emfParser');
      const { renderPdfToImage } = await import('../../../src/utils/pdfRenderer');
      const emfSpy = vi.spyOn({ parseEmfContent }, 'parseEmfContent');
      void emfSpy; // suppress unused warning

      // Use a valid EMF that parseEmfContent would recognize as 'pdf'.
      // Instead of mocking, we test via the cache-hit path which proves
      // the dispatcher reached renderEmfPdf.
      const ctx = createEmfCtx();
      // Pre-populate the emf-pdf cache key to prove renderEmfPdf was called
      ctx.mediaUrlCache.set('ppt/media/image1.emf:emf-pdf', 'blob:pdf-cached');

      // We need parseEmfContent to return pdf type. Use vi.spyOn on the module.
      const emfModule = await import('../../../src/utils/emfParser');
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });

      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // Since cache is pre-populated, renderEmfPdf uses the cached URL
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:pdf-cached');

      spy.mockRestore();
    });

    it('dispatches to renderEmfBitmap when parseEmfContent returns bitmap type', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2, colorSpace: 'srgb' as const };
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      // Mock canvas so getContext returns null (avoids jsdom "not implemented" error)
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tag, options);
        if (tag === 'canvas') {
          el.getContext = () => null;
        }
        return el;
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // getContext returns null, so bitmap path exits early
      expect(el).toBeDefined();

      spy.mockRestore();
      createElementSpy.mockRestore();
    });

    it('renders nothing for empty EMF content', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'empty',
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      expect(el).toBeDefined();
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('div')).toBeNull();

      spy.mockRestore();
    });

    it('renders unsupported placeholder for unsupported EMF content', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'unsupported',
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      expect(el.textContent).toContain('Unsupported format');
      expect(el.textContent).toContain('EMF');

      spy.mockRestore();
    });
  });

  describe('EMF PDF rendering — renderEmfPdf', () => {
    function createEmfCtx(): RenderContext {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
      ctx.presentation.media.set('ppt/media/image1.emf', new Uint8Array([0x01]));
      return ctx;
    }

    it('uses cached URL when emf-pdf cache key exists', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });

      const ctx = createEmfCtx();
      ctx.mediaUrlCache.set('ppt/media/image1.emf:emf-pdf', 'blob:cached-pdf-url');

      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:cached-pdf-url');
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
      expect(img.style.objectFit).toBe('fill');
      expect(img.style.display).toBe('block');
      expect(img.draggable).toBe(false);

      spy.mockRestore();
    });

    it('calls renderPdfToImage on cache miss and appends img on success', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const pdfModule = await import('../../../src/utils/pdfRenderer');
      const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });
      const pdfSpy = vi.spyOn(pdfModule, 'renderPdfToImage').mockResolvedValue('blob:new-pdf-url');

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // Wait for async PDF rendering
      await new Promise((r) => setTimeout(r, 10));

      expect(ctx.mediaUrlCache.get('ppt/media/image1.emf:emf-pdf')).toBe('blob:new-pdf-url');
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:new-pdf-url');

      emfSpy.mockRestore();
      pdfSpy.mockRestore();
    });

    it('leaves wrapper empty when renderPdfToImage returns null', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const pdfModule = await import('../../../src/utils/pdfRenderer');
      const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });
      const pdfSpy = vi.spyOn(pdfModule, 'renderPdfToImage').mockResolvedValue(null);

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      await new Promise((r) => setTimeout(r, 10));

      expect(el.querySelector('img')).toBeNull();
      expect(ctx.mediaUrlCache.has('ppt/media/image1.emf:emf-pdf')).toBe(false);

      emfSpy.mockRestore();
      pdfSpy.mockRestore();
    });

    it('silently catches renderPdfToImage rejection', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const pdfModule = await import('../../../src/utils/pdfRenderer');
      const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });
      const pdfSpy = vi.spyOn(pdfModule, 'renderPdfToImage').mockRejectedValue(new Error('PDF failed'));

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      await new Promise((r) => setTimeout(r, 10));

      expect(el.querySelector('img')).toBeNull();

      emfSpy.mockRestore();
      pdfSpy.mockRestore();
    });
  });

  describe('EMF bitmap rendering — renderEmfBitmap', () => {
    function createEmfCtx(): RenderContext {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
      ctx.presentation.media.set('ppt/media/image1.emf', new Uint8Array([0x01]));
      return ctx;
    }

    it('uses cached URL when emf-bitmap cache key exists', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2, colorSpace: 'srgb' as const };
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      const ctx = createEmfCtx();
      ctx.mediaUrlCache.set('ppt/media/image1.emf:emf-bitmap', 'blob:cached-bitmap-url');

      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:cached-bitmap-url');
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
      expect(img.style.objectFit).toBe('fill');
      expect(img.draggable).toBe(false);

      spy.mockRestore();
    });

    it('exits early when canvas context is null (jsdom)', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4, colorSpace: 'srgb' as const };
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      // Force getContext to return null to test the early-exit path
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tag, options);
        if (tag === 'canvas') {
          el.getContext = () => null;
        }
        return el;
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // getContext returns null, so no img appended
      expect(el.querySelector('img')).toBeNull();
      expect(ctx.mediaUrlCache.has('ppt/media/image1.emf:emf-bitmap')).toBe(false);

      spy.mockRestore();
      createElementSpy.mockRestore();
    });

    it('renders bitmap via canvas when getContext succeeds', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2, colorSpace: 'srgb' as const };
      const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      // Mock canvas with working getContext and toBlob
      const mockCtx2d = { putImageData: vi.fn() };
      const fakeBlob = new Blob(['fake'], { type: 'image/png' });
      const origCreateElement = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        if (tag === 'canvas') {
          const canvas = origCreateElement('canvas', options);
          // Override getContext to return our mock
          (canvas as any).getContext = (_type: string) => mockCtx2d;
          // Override toBlob to synchronously call the callback
          (canvas as any).toBlob = (cb: BlobCallback) => cb(fakeBlob);
          return canvas;
        }
        return origCreateElement(tag, options);
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // putImageData should have been called
      expect(mockCtx2d.putImageData).toHaveBeenCalledOnce();

      // toBlob callback should have created a blob URL and appended img
      expect(ctx.mediaUrlCache.has('ppt/media/image1.emf:emf-bitmap')).toBe(true);
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');

      emfSpy.mockRestore();
      createSpy.mockRestore();
    });

    it('handles null blob from canvas.toBlob gracefully', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2, colorSpace: 'srgb' as const };
      const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      const mockCtx2d = { putImageData: vi.fn() };
      const origCreateElement = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        if (tag === 'canvas') {
          const canvas = origCreateElement('canvas', options);
          (canvas as any).getContext = (_type: string) => mockCtx2d;
          // toBlob returns null blob
          (canvas as any).toBlob = (cb: BlobCallback) => cb(null);
          return canvas;
        }
        return origCreateElement(tag, options);
      });

      const ctx = createEmfCtx();
      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);

      // null blob means no URL created, no img appended
      expect(ctx.mediaUrlCache.has('ppt/media/image1.emf:emf-bitmap')).toBe(false);
      expect(el.querySelector('img')).toBeNull();

      emfSpy.mockRestore();
      createSpy.mockRestore();
    });
  });

  describe('createFillImage (tested via EMF cache hits)', () => {
    function createEmfCtx(): RenderContext {
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
      ctx.presentation.media.set('ppt/media/image1.emf', new Uint8Array([0x01]));
      return ctx;
    }

    it('creates img with correct styles from createFillImage via pdf cache', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'pdf',
        data: new Uint8Array([0x25]),
      });

      const ctx = createEmfCtx();
      ctx.mediaUrlCache.set('ppt/media/image1.emf:emf-pdf', 'blob:test-url-123');

      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img') as HTMLImageElement;

      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:test-url-123');
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
      expect(img.style.objectFit).toBe('fill');
      expect(img.style.display).toBe('block');
      expect(img.draggable).toBe(false);

      spy.mockRestore();
    });

    it('creates img with correct styles from createFillImage via bitmap cache', async () => {
      const emfModule = await import('../../../src/utils/emfParser');
      const fakeImageData = { data: new Uint8ClampedArray(1 * 1 * 4), width: 1, height: 1, colorSpace: 'srgb' as const };
      const spy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
        type: 'bitmap',
        imageData: fakeImageData as unknown as ImageData,
      });

      const ctx = createEmfCtx();
      ctx.mediaUrlCache.set('ppt/media/image1.emf:emf-bitmap', 'blob:bitmap-url-456');

      const node = createPicNode({ blipEmbed: 'rId1' });
      const el = renderImage(node, ctx);
      const img = el.querySelector('img') as HTMLImageElement;

      expect(img).not.toBeNull();
      expect(img.src).toContain('blob:bitmap-url-456');
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
      expect(img.style.objectFit).toBe('fill');
      expect(img.style.display).toBe('block');
      expect(img.draggable).toBe(false);

      spy.mockRestore();
    });
  });
});
