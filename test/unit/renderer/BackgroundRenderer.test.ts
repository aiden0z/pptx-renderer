/**
 * Unit tests for BackgroundRenderer.
 *
 * Tests cover the full background resolution chain (slide -> layout -> master),
 * all fill types (solidFill, gradFill, blipFill, noFill), bgRef theme references,
 * alpha compositing on white, and image stretch/tile modes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderBackground } from '../../../src/renderer/BackgroundRenderer';
import { parseXml, SafeXmlNode } from '../../../src/parser/XmlParser';
import { createMockRenderContext } from '../helpers/mockContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a p:bg XML fragment containing a p:bgPr child with the given inner XML.
 * Includes the DrawingML namespace declaration so child elements are parsed
 * with their correct localNames.
 */
function bgPrXml(inner: string): SafeXmlNode {
  return parseXml(
    `<bg xmlns="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
       <bgPr>${inner}</bgPr>
     </bg>`,
  );
}

/**
 * Build a p:bg XML fragment containing a p:bgRef child with the given inner XML.
 */
function bgRefXml(idx: number, inner: string): SafeXmlNode {
  return parseXml(
    `<bg xmlns="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
       <bgRef idx="${idx}">${inner}</bgRef>
     </bg>`,
  );
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('renderBackground', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  // -------------------------------------------------------------------------
  // Case 1: White fallback when no background is set
  // -------------------------------------------------------------------------
  it('sets white background when no background node exists on slide, layout, or master', () => {
    const ctx = createMockRenderContext();
    // Neither slide.background, layout.background, nor master.background is set.
    renderBackground(ctx, container);

    expect(container.style.backgroundColor).toMatch(
      /white|rgb\(255,\s*255,\s*255\)|#[Ff][Ff][Ff][Ff][Ff][Ff]/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 2: Solid fill background (srgbClr)
  // -------------------------------------------------------------------------
  it('renders solid color from slide bgPr solidFill with srgbClr', () => {
    const bg = bgPrXml(`<a:solidFill><a:srgbClr val="CC3311"/></a:solidFill>`);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // backgroundColor should reflect #CC3311 (204, 51, 17)
    expect(container.style.backgroundColor).toMatch(
      /#[Cc][Cc]3311|rgb\(204,\s*51,\s*17\)/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 3: Solid fill with alpha composited on white
  // -------------------------------------------------------------------------
  it('composites semi-transparent solidFill onto white instead of leaving it transparent', () => {
    // Red at 50% alpha composited on white => rgb(255, 128, 128)
    const bg = bgPrXml(`
      <a:solidFill>
        <a:srgbClr val="FF0000">
          <a:alpha val="50000"/>
        </a:srgbClr>
      </a:solidFill>
    `);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // Must be set (not transparent / empty)
    expect(container.style.backgroundColor).not.toBe('');
    // Must use rgb() form — not rgba() — because the alpha is composited out
    expect(container.style.backgroundColor).toMatch(/^rgb\(/);
    // The red channel should be 255 and green/blue channels lifted towards 255
    const [r, g, b] = (container.style.backgroundColor.match(/\d+/g) ?? []).map(Number);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Case 4: Background from layout when slide has no background
  // -------------------------------------------------------------------------
  it('falls back to layout background when slide.background is undefined', () => {
    const bg = bgPrXml(`<a:solidFill><a:srgbClr val="00CC44"/></a:solidFill>`);
    const ctx = createMockRenderContext({
      // slide has no background (default from createMockRenderContext)
      layout: {
        placeholders: [],
        spTree: new SafeXmlNode(null),
        rels: new Map(),
        showMasterSp: true,
        background: bg,
      } as any,
    });

    renderBackground(ctx, container);

    expect(container.style.backgroundColor).toMatch(
      /#00[Cc][Cc]44|rgb\(0,\s*204,\s*68\)/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 5: Background from master when neither slide nor layout has background
  // -------------------------------------------------------------------------
  it('falls back to master background when slide and layout both have no background', () => {
    const bg = bgPrXml(`<a:solidFill><a:srgbClr val="4422AA"/></a:solidFill>`);
    const ctx = createMockRenderContext({
      master: {
        colorMap: new Map([
          ['tx1', 'dk1'],
          ['bg1', 'lt1'],
        ]),
        textStyles: {},
        placeholders: [],
        spTree: new SafeXmlNode(null),
        rels: new Map(),
        background: bg,
      } as any,
    });

    renderBackground(ctx, container);

    expect(container.style.backgroundColor).toMatch(
      /#4422[Aa][Aa]|rgb\(68,\s*34,\s*170\)/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 6: bgRef (theme reference) background
  // -------------------------------------------------------------------------
  it('renders bgRef with scheme color from the theme color scheme', () => {
    // accent1 = #4472C4 in the mock theme defined by createMockRenderContext
    const bg = bgRefXml(1001, `<a:schemeClr val="accent1"/>`);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // accent1 resolves to #4472C4 (68, 114, 196)
    expect(container.style.backgroundColor).toMatch(
      /#4472[Cc]4|rgb\(68,\s*114,\s*196\)/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 7: gradFill background
  // -------------------------------------------------------------------------
  it('renders gradient fill by setting container.style.background', () => {
    const bg = bgPrXml(`
      <a:gradFill>
        <a:gsLst>
          <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
          <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
        </a:gsLst>
        <a:lin ang="5400000"/>
      </a:gradFill>
    `);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // resolveFill returns a CSS gradient string which is set on .background
    const hasBg =
      container.style.background !== '' || container.style.backgroundColor !== '';
    expect(hasBg).toBe(true);
    expect(container.style.background).toContain('linear-gradient');
  });

  // -------------------------------------------------------------------------
  // Case 8: blipFill with stretch mode (fillRect present -> 100% 100%)
  // -------------------------------------------------------------------------
  it('renders blipFill with stretch+fillRect as 100% 100% backgroundSize', () => {
    const mediaPath = 'ppt/media/bg.png';
    const rId = 'rId10';

    const bg = bgPrXml(`
      <a:blipFill>
        <a:blip r:embed="${rId}"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:stretch><a:fillRect/></a:stretch>
      </a:blipFill>
    `);

    const slideRels = new Map([
      [rId, { type: 'image', target: '../media/bg.png' }],
    ]);
    const media = new Map([[mediaPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47])]]);

    const ctx = createMockRenderContext({
      slide: { rels: slideRels, background: bg } as any,
      presentation: {
        width: 960,
        height: 540,
        slides: [],
        layouts: new Map(),
        masters: new Map(),
        themes: new Map(),
        slideToLayout: new Map(),
        layoutToMaster: new Map(),
        masterToTheme: new Map(),
        media,
        charts: new Map(),
        isWps: false,
      },
    });

    renderBackground(ctx, container);

    // Image URL should be set
    expect(container.style.backgroundImage).toMatch(/^url\(/);
    // With fillRect present, backgroundSize must be "100% 100%"
    expect(container.style.backgroundSize).toBe('100% 100%');
  });

  // -------------------------------------------------------------------------
  // Case 9: blipFill with tile mode
  // -------------------------------------------------------------------------
  it('renders blipFill with tile as repeat backgroundRepeat', () => {
    const mediaPath = 'ppt/media/tile.png';
    const rId = 'rId11';

    const bg = bgPrXml(`
      <a:blipFill>
        <a:blip r:embed="${rId}"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>
      </a:blipFill>
    `);

    const slideRels = new Map([
      [rId, { type: 'image', target: '../media/tile.png' }],
    ]);
    const media = new Map([[mediaPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47])]]);

    const ctx = createMockRenderContext({
      slide: { rels: slideRels, background: bg } as any,
      presentation: {
        width: 960,
        height: 540,
        slides: [],
        layouts: new Map(),
        masters: new Map(),
        themes: new Map(),
        slideToLayout: new Map(),
        layoutToMaster: new Map(),
        masterToTheme: new Map(),
        media,
        charts: new Map(),
        isWps: false,
      },
    });

    renderBackground(ctx, container);

    expect(container.style.backgroundImage).toMatch(/^url\(/);
    expect(container.style.backgroundRepeat).toBe('repeat');
    expect(container.style.backgroundSize).toBe('auto');
  });

  // -------------------------------------------------------------------------
  // Case 10: noFill renders white
  // -------------------------------------------------------------------------
  it('renders noFill as white background to prevent transparent slides in dark containers', () => {
    const bg = bgPrXml(`<a:noFill/>`);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    expect(container.style.backgroundColor).toMatch(
      /white|rgb\(255,\s*255,\s*255\)|#[Ff][Ff][Ff][Ff][Ff][Ff]/i,
    );
  });

  // -------------------------------------------------------------------------
  // Case 11: bgRef with alpha composited on white
  // -------------------------------------------------------------------------
  it('composites bgRef color with alpha onto white when alpha modifier is present', () => {
    // Blue (#0000FF) at 50% alpha on white => rgb(128, 128, 255)
    const bg = bgRefXml(
      1001,
      `<a:srgbClr val="0000FF"><a:alpha val="50000"/></a:srgbClr>`,
    );
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // Should be set and use the composited rgb() form
    expect(container.style.backgroundColor).not.toBe('');
    expect(container.style.backgroundColor).toMatch(/^rgb\(/);

    // With blue at 50% alpha on white: r=128, g=128, b=255
    const [r, g, b] = (container.style.backgroundColor.match(/\d+/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(0); // white bleed-through on red channel
    expect(g).toBeGreaterThan(0); // white bleed-through on green channel
    expect(b).toBe(255);          // blue channel at full contribution
  });

  // -------------------------------------------------------------------------
  // Additional: slide background takes priority over layout
  // -------------------------------------------------------------------------
  it('uses slide background and ignores layout background when both are set', () => {
    const slideBg = bgPrXml(`<a:solidFill><a:srgbClr val="AABB00"/></a:solidFill>`);
    const layoutBg = bgPrXml(`<a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill>`);

    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: slideBg } as any,
      layout: {
        placeholders: [],
        spTree: new SafeXmlNode(null),
        rels: new Map(),
        showMasterSp: true,
        background: layoutBg,
      } as any,
    });

    renderBackground(ctx, container);

    // Must match slide color #AABB00 (170, 187, 0), not #FF00FF
    expect(container.style.backgroundColor).toMatch(
      /#[Aa][Aa][Bb][Bb]00|rgb\(170,\s*187,\s*0\)/i,
    );
    expect(container.style.backgroundColor).not.toMatch(/[Ff][Ff]00[Ff][Ff]/i);
  });

  // -------------------------------------------------------------------------
  // Additional: layout background takes priority over master
  // -------------------------------------------------------------------------
  it('uses layout background and ignores master background when slide has no background', () => {
    const layoutBg = bgPrXml(`<a:solidFill><a:srgbClr val="11CCEE"/></a:solidFill>`);
    const masterBg = bgPrXml(`<a:solidFill><a:srgbClr val="FFAA00"/></a:solidFill>`);

    const ctx = createMockRenderContext({
      layout: {
        placeholders: [],
        spTree: new SafeXmlNode(null),
        rels: new Map(),
        showMasterSp: true,
        background: layoutBg,
      } as any,
      master: {
        colorMap: new Map([['tx1', 'dk1'], ['bg1', 'lt1']]),
        textStyles: {},
        placeholders: [],
        spTree: new SafeXmlNode(null),
        rels: new Map(),
        background: masterBg,
      } as any,
    });

    renderBackground(ctx, container);

    // Must match layout color #11CCEE (17, 204, 238), not #FFAA00
    expect(container.style.backgroundColor).toMatch(
      /#11[Cc][Cc][Ee][Ee]|rgb\(17,\s*204,\s*238\)/i,
    );
    expect(container.style.backgroundColor).not.toMatch(/[Ff][Ff][Aa][Aa]00/i);
  });

  // -------------------------------------------------------------------------
  // Additional: bgRef with explicit non-black srgbClr renders that color
  // -------------------------------------------------------------------------
  it('renders bgRef with srgbClr as the resolved color when non-black', () => {
    // The bgRef renderer checks: color !== '#000000' (with leading #).
    // resolveColor for srgbClr returns the raw hex string without a '#' prefix,
    // so '223344' !== '#000000' is true and the color is applied directly.
    const bg = bgRefXml(1001, `<a:srgbClr val="223344"/>`);
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: bg } as any,
    });

    renderBackground(ctx, container);

    // #223344 = rgb(34, 51, 68)
    expect(container.style.backgroundColor).toMatch(
      /#223344|rgb\(34,\s*51,\s*68\)/i,
    );
  });

  // -------------------------------------------------------------------------
  // Additional: blipFill missing from media map does not crash and sets no URL
  // -------------------------------------------------------------------------
  it('does not crash and leaves backgroundImage empty when blipFill media is missing', () => {
    const rId = 'rId99';

    const bg = bgPrXml(`
      <a:blipFill>
        <a:blip r:embed="${rId}"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:stretch><a:fillRect/></a:stretch>
      </a:blipFill>
    `);

    const slideRels = new Map([
      [rId, { type: 'image', target: '../media/missing.png' }],
    ]);

    // Media map intentionally empty — ppt/media/missing.png is absent
    const ctx = createMockRenderContext({
      slide: { rels: slideRels, background: bg } as any,
    });

    expect(() => renderBackground(ctx, container)).not.toThrow();
    // No backgroundImage should have been set since media data was missing
    expect(container.style.backgroundImage).toBe('');
  });

  // -------------------------------------------------------------------------
  // Additional: blipFill stretch without fillRect uses cover/center/no-repeat
  // -------------------------------------------------------------------------
  it('renders blipFill with stretch but no fillRect as cover background', () => {
    const mediaPath = 'ppt/media/cover.jpg';
    const rId = 'rId12';

    const bg = bgPrXml(`
      <a:blipFill>
        <a:blip r:embed="${rId}"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:stretch/>
      </a:blipFill>
    `);

    const slideRels = new Map([
      [rId, { type: 'image', target: '../media/cover.jpg' }],
    ]);
    const media = new Map([[mediaPath, new Uint8Array([0xff, 0xd8, 0xff])]]);

    const ctx = createMockRenderContext({
      slide: { rels: slideRels, background: bg } as any,
      presentation: {
        width: 960,
        height: 540,
        slides: [],
        layouts: new Map(),
        masters: new Map(),
        themes: new Map(),
        slideToLayout: new Map(),
        layoutToMaster: new Map(),
        masterToTheme: new Map(),
        media,
        charts: new Map(),
        isWps: false,
      },
    });

    renderBackground(ctx, container);

    expect(container.style.backgroundImage).toMatch(/^url\(/);
    // Without fillRect the renderer sets cover/center/no-repeat
    expect(container.style.backgroundSize).toBe('cover');
    expect(container.style.backgroundPosition).toBe('center');
    expect(container.style.backgroundRepeat).toBe('no-repeat');
  });
});
