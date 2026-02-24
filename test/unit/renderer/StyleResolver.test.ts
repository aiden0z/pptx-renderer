import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  resolveColorToCss,
  resolveFill,
  resolveLineStyle,
  resolveGradientFill,
  resolveGradientStroke,
} from '../../../src/renderer/StyleResolver';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import { parseXml } from '../../../src/parser/XmlParser';

describe('resolveColor', () => {
  it('resolves srgbClr', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<solidFill><srgbClr val="FF8800"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/[Ff][Ff]8800/);
    expect(result.alpha).toBe(1);
  });

  it('resolves schemeClr via colorMap and theme', () => {
    const ctx = createMockRenderContext();
    // tx1 -> dk1 (via colorMap) -> 000000 (via theme)
    const node = xmlNode('<solidFill><schemeClr val="tx1"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/000000/);
  });

  it('resolves schemeClr accent1', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<solidFill><schemeClr val="accent1"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/4472[Cc]4/);
  });

  it('resolves sysClr', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<solidFill><sysClr val="windowText" lastClr="000000"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/000000/);
  });

  it('resolves prstClr', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<solidFill><prstClr val="red"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/[Ff][Ff]0000/);
  });

  it('resolves hslClr', () => {
    const ctx = createMockRenderContext();
    // hue=0 (red), sat=100%, lum=50% => should be red
    const node = xmlNode('<solidFill><hslClr hue="0" sat="100000" lum="50000"/></solidFill>');
    const result = resolveColor(node, ctx);
    // HSL(0, 1, 0.5) = red
    expect(result.alpha).toBe(1);
  });

  it('resolves scrgbClr', () => {
    const ctx = createMockRenderContext();
    // r=100%, g=0%, b=0% => red
    const node = xmlNode('<solidFill><scrgbClr r="100000" g="0" b="0"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/[Ff][Ff]0000/);
  });

  describe('modifiers', () => {
    it('applies lumMod + lumOff', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<solidFill>
        <schemeClr val="tx1">
          <lumMod val="75000"/>
          <lumOff val="25000"/>
        </schemeClr>
      </solidFill>`);
      const result = resolveColor(node, ctx);
      // Should produce a lighter version of black
      expect(result.alpha).toBe(1);
    });

    it('applies alpha modifier', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<solidFill>
        <srgbClr val="FF0000">
          <alpha val="50000"/>
        </srgbClr>
      </solidFill>`);
      const result = resolveColor(node, ctx);
      expect(result.alpha).toBe(0.5);
    });

    it('applies tint modifier', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<solidFill>
        <srgbClr val="000000">
          <tint val="50000"/>
        </srgbClr>
      </solidFill>`);
      const result = resolveColor(node, ctx);
      // Tint moves toward white
      expect(result.color).not.toMatch(/000000/);
    });

    it('applies shade modifier', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<solidFill>
        <srgbClr val="FFFFFF">
          <shade val="50000"/>
        </srgbClr>
      </solidFill>`);
      const result = resolveColor(node, ctx);
      // Shade moves toward black
      expect(result.color).not.toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);
    });
  });

  describe('caching', () => {
    it('returns same reference on second call with same node', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode('<solidFill><srgbClr val="FF8800"/></solidFill>');
      const result1 = resolveColor(node, ctx);
      const result2 = resolveColor(node, ctx);
      expect(result1).toBe(result2);
    });

    it('cache hit uses same object reference', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode('<solidFill><schemeClr val="accent1"/></solidFill>');
      resolveColor(node, ctx);
      expect(ctx.colorCache.size).toBe(1);
      const result = resolveColor(node, ctx);
      expect(ctx.colorCache.size).toBe(1); // No new entry
    });
  });
});

describe('resolveFill', () => {
  it('resolves solidFill to hex', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<spPr><solidFill><srgbClr val="FF0000"/></solidFill></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toMatch(/#[Ff][Ff]0000/);
  });

  it('resolves noFill to transparent', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<spPr><noFill/></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toBe('transparent');
  });

  it('returns empty string for no fill (inherit)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<spPr></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toBe('');
  });

  it('resolves gradFill to gradient string', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="5400000"/>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('linear-gradient');
  });

  describe('pattFill', () => {
    it('resolves solid pattern to foreground color', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="solid">
          <fgClr><srgbClr val="FF0000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toMatch(/[Ff][Ff]0000/);
    });

    it('resolves percentage pattern to radial-gradient', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="pct20">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toContain('radial-gradient');
    });

    it('resolves horizontal line pattern', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="horz">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toContain('repeating-linear-gradient');
      expect(result).toContain('0deg');
    });

    it('resolves diagonal down pattern to 45deg', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="dnDiag">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toContain('45deg');
    });

    it('resolves grid pattern with two gradient layers', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="smGrid">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      // Should have both horizontal (0deg) and vertical (90deg) gradients
      expect(result).toContain('0deg');
      expect(result).toContain('90deg');
    });

    it('resolves diagonal cross pattern', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="diagCross">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toContain('45deg');
      expect(result).toContain('-45deg');
    });

    it('returns background color for unknown pattern', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="unknownXyz">
          <fgClr><srgbClr val="000000"/></fgClr>
          <bgClr><srgbClr val="FFFFFF"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);
      expect(result).not.toContain('gradient');
    });

    it('uses schemeClr for pattern colors', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(`<spPr>
        <pattFill prst="pct50">
          <fgClr><schemeClr val="accent1"/></fgClr>
          <bgClr><schemeClr val="lt1"/></bgClr>
        </pattFill>
      </spPr>`);
      const result = resolveFill(node, ctx);
      expect(result).toContain('gradient');
      // accent1 = #4472C4
      expect(result).toMatch(/4472[Cc]4/i);
    });
  });
});

describe('resolveLineStyle', () => {
  it('resolves explicit line with width and color', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700"><solidFill><srgbClr val="FF0000"/></solidFill></ln>`);
    const result = resolveLineStyle(node, ctx);
    expect(result.width).toBeCloseTo(1, 0); // 12700 EMU = 1pt = ~1.33px
    expect(result.color).toMatch(/[Ff][Ff]0000/);
    expect(result.dash).toBe('solid');
  });

  it('resolves dashed line', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="dash"/></ln>`);
    const result = resolveLineStyle(node, ctx);
    expect(result.dash).toBe('dashed');
  });

  it('resolves dotted line', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="dot"/></ln>`);
    const result = resolveLineStyle(node, ctx);
    expect(result.dash).toBe('dotted');
  });

  it('falls back to lnRef/theme width when explicit solidFill has no width', () => {
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        lineStyles: [xmlNode('<ln w="38100"><solidFill><schemeClr val="accent1"/></solidFill></ln>')],
      },
    });
    const ln = xmlNode('<ln><solidFill><srgbClr val="FF0000"/></solidFill></ln>');
    const lnRef = xmlNode('<lnRef idx="1"><schemeClr val="accent1"/></lnRef>');
    const result = resolveLineStyle(ln, ctx, lnRef);
    expect(result.width).toBeGreaterThan(3);
    expect(result.color).toMatch(/[Ff][Ff]0000/);
  });

  describe('additional dash patterns', () => {
    it('resolves lgDash to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="lgDash"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves sysDash to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="sysDash"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves sysDot to dotted', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="sysDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dotted');
    });

    it('resolves dashDot to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="dashDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves lgDashDot to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="lgDashDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves lgDashDotDot to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="lgDashDotDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves sysDashDot to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="sysDashDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves sysDashDotDot to dashed', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="sysDashDotDot"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('dashed');
    });

    it('resolves unknown dash value to solid', () => {
      const ctx = createMockRenderContext();
      const node = xmlNode(
        `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="weirdUnknown"/></ln>`,
      );
      const result = resolveLineStyle(node, ctx);
      expect(result.dash).toBe('solid');
    });
  });

  describe('lnRef fallback without theme line styles', () => {
    it('uses approximate width idx*0.75 when no theme lineStyles are present', () => {
      const ctx = createMockRenderContext();
      // ctx.theme.lineStyles is [] by default
      const ln = xmlNode('<ln/>');
      const lnRef = xmlNode('<lnRef idx="2"><srgbClr val="0000FF"/></lnRef>');
      const result = resolveLineStyle(ln, ctx, lnRef);
      expect(result.width).toBeCloseTo(1.5, 1);
      expect(result.color).toMatch(/0000[Ff][Ff]/);
    });

    it('uses transparent when lnRef has idx=0', () => {
      const ctx = createMockRenderContext();
      const ln = xmlNode('<ln/>');
      const lnRef = xmlNode('<lnRef idx="0"><srgbClr val="FF0000"/></lnRef>');
      const result = resolveLineStyle(ln, ctx, lnRef);
      expect(result.color).toBe('transparent');
      expect(result.width).toBe(0);
    });

    it('inherits dash from theme line style via lnRef', () => {
      const ctx = createMockRenderContext({
        theme: {
          ...createMockRenderContext().theme,
          lineStyles: [
            xmlNode(
              `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="dot"/></ln>`,
            ),
          ],
        },
      });
      const ln = xmlNode('<ln/>');
      const lnRef = xmlNode('<lnRef idx="1"><srgbClr val="FF0000"/></lnRef>');
      const result = resolveLineStyle(ln, ctx, lnRef);
      expect(result.dash).toBe('dotted');
    });

    it('resolves phClr in solidFill using lnRef color with modifiers', () => {
      const ctx = createMockRenderContext();
      const ln = xmlNode(
        `<ln w="12700"><solidFill><schemeClr val="phClr"><lumMod val="75000"/></schemeClr></solidFill></ln>`,
      );
      const lnRef = xmlNode('<lnRef idx="1"><srgbClr val="FF0000"/></lnRef>');
      const result = resolveLineStyle(ln, ctx, lnRef);
      // phClr should take the lnRef color (FF0000) with lumMod applied
      expect(result.color).toBeDefined();
      expect(result.color).not.toBe('transparent');
    });
  });
});

// ---------------------------------------------------------------------------
// resolveColorToCss
// ---------------------------------------------------------------------------

describe('resolveColorToCss', () => {
  it('returns hex string for opaque color', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<solidFill><srgbClr val="4472C4"/></solidFill>');
    const result = resolveColorToCss(node, ctx);
    expect(result).toMatch(/^#4472[Cc]4$/i);
  });

  it('returns rgba string for semi-transparent color', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(
      `<solidFill><srgbClr val="FF0000"><alpha val="50000"/></srgbClr></solidFill>`,
    );
    const result = resolveColorToCss(node, ctx);
    expect(result).toMatch(/^rgba\(/);
    expect(result).toContain('255');
    expect(result).toContain('0.500');
  });

  it('returns rgba string for fully transparent color (alpha=0)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(
      `<solidFill><srgbClr val="000000"><alpha val="0"/></srgbClr></solidFill>`,
    );
    const result = resolveColorToCss(node, ctx);
    expect(result).toMatch(/^rgba\(/);
    expect(result).toContain('0.000');
  });
});

// ---------------------------------------------------------------------------
// resolveColor — direct color node (no wrapper element)
// ---------------------------------------------------------------------------

describe('resolveColor — direct color node (selfTag branch)', () => {
  it('resolves srgbClr node passed directly without wrapper', () => {
    const ctx = createMockRenderContext();
    // Pass the color node itself — no solidFill wrapper
    const node = parseXml(
      `<srgbClr xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" val="AABBCC"/>`,
    );
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/[Aa][Aa][Bb][Bb][Cc][Cc]/i);
    expect(result.alpha).toBe(1);
  });

  it('resolves schemeClr node passed directly without wrapper', () => {
    const ctx = createMockRenderContext();
    const node = parseXml(
      `<schemeClr xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" val="accent1"/>`,
    );
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/4472[Cc]4/i);
  });

  it('resolves sysClr node passed directly without wrapper', () => {
    const ctx = createMockRenderContext();
    const node = parseXml(
      `<sysClr xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" val="windowText" lastClr="1A1A1A"/>`,
    );
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/1[Aa]1[Aa]1[Aa]/i);
    expect(result.alpha).toBe(1);
  });

  it('resolves prstClr node passed directly without wrapper', () => {
    const ctx = createMockRenderContext();
    const node = parseXml(
      `<prstClr xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" val="blue"/>`,
    );
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/0000[Ff][Ff]/i);
  });

  it('returns black fallback for unrecognized node type', () => {
    const ctx = createMockRenderContext();
    // Node that is neither a color type nor contains color children
    const node = parseXml(
      `<unknownTag xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"/>`,
    );
    const result = resolveColor(node, ctx);
    expect(result.color).toBe('#000000');
    expect(result.alpha).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveColor — layout colorMapOverride
// ---------------------------------------------------------------------------

describe('resolveColor — layout colorMapOverride', () => {
  it('uses layout colorMapOverride when present and overrides master colorMap', () => {
    const baseCtx = createMockRenderContext();
    // Override so that "tx1" maps to "accent2" (not dk1 from master colorMap)
    const ctx = createMockRenderContext({
      layout: {
        ...baseCtx.layout,
        colorMapOverride: new Map([['tx1', 'accent2']]),
      },
    });
    const node = xmlNode('<solidFill><schemeClr val="tx1"/></solidFill>');
    const result = resolveColor(node, ctx);
    // accent2 = ED7D31
    expect(result.color).toMatch(/[Ee][Dd]7[Dd]31/i);
  });

  it('falls through to master colorMap when layout override does not cover the scheme name', () => {
    const baseCtx = createMockRenderContext();
    // Override covers only "bg1"; "tx1" should still use master colorMap (tx1 -> dk1 -> 000000)
    const ctx = createMockRenderContext({
      layout: {
        ...baseCtx.layout,
        colorMapOverride: new Map([['bg1', 'accent3']]),
      },
    });
    const node = xmlNode('<solidFill><schemeClr val="tx1"/></solidFill>');
    const result = resolveColor(node, ctx);
    expect(result.color).toMatch(/000000/i);
  });

  it('resolves directly in theme when mapped name is an explicit accent slot', () => {
    const baseCtx = createMockRenderContext();
    const ctx = createMockRenderContext({
      layout: {
        ...baseCtx.layout,
        colorMapOverride: new Map([['bg1', 'accent1']]),
      },
    });
    const node = xmlNode('<solidFill><schemeClr val="bg1"/></solidFill>');
    const result = resolveColor(node, ctx);
    // accent1 = 4472C4
    expect(result.color).toMatch(/4472[Cc]4/i);
  });
});

// ---------------------------------------------------------------------------
// resolveFill — blipFill and grpFill branches
// ---------------------------------------------------------------------------

describe('resolveFill — blipFill and grpFill', () => {
  it('returns empty string for blipFill (handled by ImageRenderer)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr><blipFill><blip embed="rId1"/></blipFill></spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toBe('');
  });

  it('returns empty string for grpFill when no groupFillNode is set in context', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<spPr><grpFill/></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toBe('');
  });

  it('resolves grpFill to parent group solid fill when groupFillNode is set', () => {
    const groupFillNode = xmlNode(
      '<grpSpPr><solidFill><srgbClr val="00FF00"/></solidFill></grpSpPr>',
    );
    const ctx = createMockRenderContext({ groupFillNode });
    const node = xmlNode('<spPr><grpFill/></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toMatch(/#00[Ff][Ff]00/i);
  });

  it('resolves grpFill to parent group gradient fill when groupFillNode is set', () => {
    const groupFillNode = xmlNode(`<grpSpPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </grpSpPr>`);
    const ctx = createMockRenderContext({ groupFillNode });
    const node = xmlNode('<spPr><grpFill/></spPr>');
    const result = resolveFill(node, ctx);
    expect(result).toContain('linear-gradient');
  });
});

// ---------------------------------------------------------------------------
// resolvePatternFill — additional patterns not yet exercised
// ---------------------------------------------------------------------------

describe('resolvePatternFill — additional pattern presets', () => {
  it('resolves vert pattern with 90deg repeating gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="vert">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('repeating-linear-gradient');
    expect(result).toContain('90deg');
  });

  it('resolves ltVert pattern to 90deg gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="ltVert">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('90deg');
  });

  it('resolves upDiag pattern to -45deg gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="upDiag">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('-45deg');
  });

  it('resolves dkDnDiag pattern to 45deg gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dkDnDiag">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
  });

  it('resolves cross pattern to two-layer grid gradient (0deg + 90deg)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="cross">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('0deg');
    expect(result).toContain('90deg');
  });

  it('resolves lgGrid pattern to two-layer grid gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="lgGrid">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('0deg');
    expect(result).toContain('90deg');
  });

  it('resolves smCheck pattern to diagonal cross (45deg + -45deg)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="smCheck">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
    expect(result).toContain('-45deg');
  });

  it('resolves openDmnd pattern to diagonal cross', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="openDmnd">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
    expect(result).toContain('-45deg');
  });

  it('resolves dotGrid to radial-gradient dot pattern', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dotGrid">
        <fgClr><srgbClr val="0000FF"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
  });

  it('resolves dotDmnd to radial-gradient dot pattern', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dotDmnd">
        <fgClr><srgbClr val="FF0000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
  });

  it('resolves trellis pattern to two-layer diagonal cross', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="trellis">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
    expect(result).toContain('-45deg');
  });

  it('resolves weave pattern to two-layer diagonal cross', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="weave">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
    expect(result).toContain('-45deg');
  });

  it('resolves dashHorz pattern to 0deg dashed gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dashHorz">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('0deg');
    expect(result).toContain('repeating-linear-gradient');
  });

  it('resolves dashVert pattern to 90deg dashed gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dashVert">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('90deg');
    expect(result).toContain('repeating-linear-gradient');
  });

  it('resolves dashDnDiag pattern to 45deg dashed gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dashDnDiag">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('45deg');
  });

  it('resolves dashUpDiag pattern to -45deg dashed gradient', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="dashUpDiag">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('-45deg');
  });

  it('resolves sphere pattern to radial-gradient approximation', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="sphere">
        <fgClr><srgbClr val="0000FF"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
  });

  it('resolves shingle pattern to radial-gradient approximation', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="shingle">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
  });

  it('resolves zigZag pattern to radial-gradient approximation', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="zigZag">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
  });

  it('resolves solidDmnd pattern to foreground color', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="solidDmnd">
        <fgClr><srgbClr val="FF00FF"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toMatch(/[Ff][Ff]00[Ff][Ff]/i);
    expect(result).not.toContain('gradient');
  });

  it('resolves pct60 pattern to larger dot size', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="pct60">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('2.5px');
  });

  it('resolves pct30 pattern to medium dot size', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="pct30">
        <fgClr><srgbClr val="000000"/></fgClr>
        <bgClr><srgbClr val="FFFFFF"/></bgClr>
      </pattFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('1.5px');
  });

  it('uses default fg=#000000 and bg=#ffffff when fgClr/bgClr are missing', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <pattFill prst="horz"/>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('repeating-linear-gradient');
    expect(result).toContain('#000000');
    expect(result).toContain('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// resolveGradientFill
// ---------------------------------------------------------------------------

describe('resolveGradientFill', () => {
  it('returns null when spPr has no gradFill', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode('<spPr><solidFill><srgbClr val="FF0000"/></solidFill></spPr>');
    const result = resolveGradientFill(node, ctx);
    expect(result).toBeNull();
  });

  it('returns null when gradFill has no stops', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr><gradFill><gsLst/><lin ang="0"/></gradFill></spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).toBeNull();
  });

  it('resolves linear gradient with angle and stops', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="5400000"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('linear');
    expect(result!.stops).toHaveLength(2);
    expect(result!.stops[0].position).toBeCloseTo(0, 1);
    expect(result!.stops[1].position).toBeCloseTo(100, 1);
    expect(result!.angle).toBeCloseTo(90, 1);
  });

  it('resolves radial gradient with path=circle and default center', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FFFFFF"/></gs>
          <gs pos="100000"><srgbClr val="000000"/></gs>
        </gsLst>
        <path path="circle"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('radial');
    expect(result!.cx).toBeCloseTo(0.5, 3);
    expect(result!.cy).toBeCloseTo(0.5, 3);
    expect(result!.pathType).toBe('circle');
  });

  it('resolves radial gradient with path=rect', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="rect"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('radial');
    expect(result!.pathType).toBe('rect');
  });

  it('resolves radial gradient with path=shape', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="00FF00"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <path path="shape"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('radial');
    expect(result!.pathType).toBe('shape');
  });

  it('resolves radial gradient fillToRect center offset from default', () => {
    const ctx = createMockRenderContext();
    // fillToRect l=50000 t=50000 r=50000 b=50000 => center stays at 0.5,0.5 (symmetric insets)
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <path path="circle">
          <fillToRect l="50000" t="50000" r="50000" b="50000"/>
        </path>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    // l=0.5, r=0.5 => cx=(0.5 + (1-0.5))/2 = 0.5
    expect(result!.cx).toBeCloseTo(0.5, 3);
    expect(result!.cy).toBeCloseTo(0.5, 3);
  });

  it('resolves radial gradient with off-center fillToRect', () => {
    const ctx = createMockRenderContext();
    // l=0 t=0 r=100000 b=0 => cx=(0 + (1-1))/2 = 0, cy=(0 + (1-0))/2 = 0.5
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <path path="circle">
          <fillToRect l="0" t="0" r="100000" b="0"/>
        </path>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.cx).toBeCloseTo(0, 3);
    expect(result!.cy).toBeCloseTo(0.5, 3);
  });

  it('sorts stops by ascending position', () => {
    const ctx = createMockRenderContext();
    // Provide stops in reverse order; result should be sorted ascending
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
          <gs pos="50000"><srgbClr val="00FF00"/></gs>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.stops[0].position).toBeCloseTo(0, 1);
    expect(result!.stops[1].position).toBeCloseTo(50, 1);
    expect(result!.stops[2].position).toBeCloseTo(100, 1);
  });

  it('defaults to linear type with angle=0 when no lin or path child exists', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('linear');
    expect(result!.angle).toBe(0);
  });

  it('inherits gradFill via grpFill when groupFillNode is set', () => {
    const groupFillNode = xmlNode(`<grpSpPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </grpSpPr>`);
    const ctx = createMockRenderContext({ groupFillNode });
    const node = xmlNode('<spPr><grpFill/></spPr>');
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('linear');
    expect(result!.stops).toHaveLength(2);
  });

  it('returns null for grpFill when groupFillNode has no gradFill', () => {
    const groupFillNode = xmlNode(
      `<grpSpPr><solidFill><srgbClr val="FF0000"/></solidFill></grpSpPr>`,
    );
    const ctx = createMockRenderContext({ groupFillNode });
    const node = xmlNode('<spPr><grpFill/></spPr>');
    const result = resolveGradientFill(node, ctx);
    expect(result).toBeNull();
  });

  it('includes stop colors as valid CSS color strings', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"><alpha val="50000"/></srgbClr></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </spPr>`);
    const result = resolveGradientFill(node, ctx);
    expect(result).not.toBeNull();
    // First stop is semi-transparent — should be rgba()
    expect(result!.stops[0].color).toMatch(/^rgba\(/);
    // Second stop is opaque — should be hex
    expect(result!.stops[1].color).toMatch(/^#/);
  });
});

// ---------------------------------------------------------------------------
// resolveGradientStroke
// ---------------------------------------------------------------------------

describe('resolveGradientStroke', () => {
  it('returns null when ln has no gradFill', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(
      `<ln w="12700"><solidFill><srgbClr val="FF0000"/></solidFill></ln>`,
    );
    const result = resolveGradientStroke(node, ctx);
    expect(result).toBeNull();
  });

  it('returns null when gradFill has no stops', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700"><gradFill><gsLst/><lin ang="0"/></gradFill></ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).toBeNull();
  });

  it('resolves gradient stroke with width, angle and stops', () => {
    const ctx = createMockRenderContext();
    // 38100 EMU = 3pt = 4px
    const node = xmlNode(`<ln w="38100">
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="5400000"/>
      </gradFill>
    </ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.stops).toHaveLength(2);
    expect(result!.stops[0].position).toBeCloseTo(0, 1);
    expect(result!.stops[1].position).toBeCloseTo(100, 1);
    expect(result!.angle).toBeCloseTo(90, 1);
    expect(result!.width).toBeGreaterThan(0);
  });

  it('defaults width to 1 when ln w attribute is 0 or missing', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1);
  });

  it('defaults angle to 0 when lin element is absent', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700">
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
      </gradFill>
    </ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.angle).toBe(0);
  });

  it('sorts stops by ascending position', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700">
      <gradFill>
        <gsLst>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.stops[0].position).toBeCloseTo(0, 1);
    expect(result!.stops[1].position).toBeCloseTo(100, 1);
  });

  it('includes rgba CSS color for semi-transparent stops', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<ln w="12700">
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"><alpha val="30000"/></srgbClr></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
        <lin ang="0"/>
      </gradFill>
    </ln>`);
    const result = resolveGradientStroke(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.stops[0].color).toMatch(/^rgba\(/);
  });
});

// ---------------------------------------------------------------------------
// Edge-case branches for remaining coverage
// ---------------------------------------------------------------------------

describe('resolveFill — gradient fallback (no lin or path child)', () => {
  it('returns linear-gradient(180deg) as default when gradFill has no lin or path', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="0000FF"/></gs>
        </gsLst>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('linear-gradient');
    expect(result).toContain('180deg');
  });

  it('returns empty string when gradFill gsLst has no stops (zero-stop guard)', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst/>
        <lin ang="0"/>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toBe('');
  });
});

describe('resolveLineStyle — solid prstDash explicit pass', () => {
  it('keeps solid dash when prstDash val="solid" is explicitly set', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(
      `<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill><prstDash val="solid"/></ln>`,
    );
    const result = resolveLineStyle(node, ctx);
    expect(result.dash).toBe('solid');
  });
});

describe('resolveLineStyle — approximate width fallback when solidFill present but w=0 and no theme lines', () => {
  it('uses lnRef idx*0.75 for width when explicit solidFill but w=0 and no matching theme line', () => {
    const ctx = createMockRenderContext();
    // ctx.theme.lineStyles = [] (empty) — no theme lines to look up
    const ln = xmlNode('<ln><solidFill><srgbClr val="FF0000"/></solidFill></ln>');
    const lnRef = xmlNode('<lnRef idx="3"><srgbClr val="FF0000"/></lnRef>');
    const result = resolveLineStyle(ln, ctx, lnRef);
    // idx=3, no theme lineStyles => width = 3 * 0.75 = 2.25
    expect(result.width).toBeCloseTo(2.25, 2);
    expect(result.color).toMatch(/[Ff][Ff]0000/);
  });
});

// ---------------------------------------------------------------------------
// resolveColor — default: break branch (unrecognized color child element)
// ---------------------------------------------------------------------------

describe('resolveColor — unrecognized child elements are skipped', () => {
  it('skips unrecognized child tags and falls back to black when all children are unknown', () => {
    const ctx = createMockRenderContext();
    // The solidFill wrapper has a child that is not a recognized color type
    const node = xmlNode(
      `<solidFill><unknownColorType val="FF0000"/></solidFill>`,
    );
    const result = resolveColor(node, ctx);
    // Should fall through all children and reach the selfTag checks, then return black
    expect(result.color).toBe('#000000');
    expect(result.alpha).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveSchemeColor — fallback when mapped name not in theme
// ---------------------------------------------------------------------------

describe('resolveSchemeColor — fallback when mapped name absent from theme', () => {
  it('falls back to original schemeName in theme when mapped name is not in colorScheme', () => {
    const baseCtx = createMockRenderContext();
    // Set up colorMap to map "tx1" to a name not in the theme ("nonExistent")
    const ctx = createMockRenderContext({
      master: {
        ...baseCtx.master,
        colorMap: new Map([['tx1', 'nonExistentKey']]),
      },
    });
    // "tx1" maps to "nonExistentKey" which is not in theme; fallback = original "tx1"
    // "tx1" also not in theme directly => returns '000000'
    const node = xmlNode('<solidFill><schemeClr val="tx1"/></solidFill>');
    const result = resolveColor(node, ctx);
    // Neither "nonExistentKey" nor "tx1" is in colorScheme => final fallback '000000'
    expect(result.color).toMatch(/000000/);
  });

  it('falls back to original schemeName color when mapped name is absent but original exists', () => {
    const baseCtx = createMockRenderContext();
    // colorMap maps "accent1" -> "missingKey" (not in theme), but "accent1" IS in theme
    const ctx = createMockRenderContext({
      master: {
        ...baseCtx.master,
        colorMap: new Map([['accent1', 'missingKey']]),
      },
    });
    const node = xmlNode('<solidFill><schemeClr val="accent1"/></solidFill>');
    const result = resolveColor(node, ctx);
    // "missingKey" not in theme => fallback to "accent1" in theme => 4472C4
    expect(result.color).toMatch(/4472[Cc]4/i);
  });
});

// ---------------------------------------------------------------------------
// resolveFill — CSS gradient path branches (rect and ellipse with fillToRect)
// ---------------------------------------------------------------------------

describe('resolveFill — CSS path gradient variants', () => {
  it('generates radial-gradient with closest-side for path=rect', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="rect"/>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('closest-side');
  });

  it('generates radial-gradient with fillToRect for path=rect with offset center', () => {
    const ctx = createMockRenderContext();
    // l=0 t=0 r=100000 b=0 => cx=0%, cy=50%
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="rect">
          <fillToRect l="0" t="0" r="100000" b="0"/>
        </path>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('closest-side');
    expect(result).toContain('0.0%');
  });

  it('generates ellipse radial-gradient for path=circle with fillToRect', () => {
    const ctx = createMockRenderContext();
    // l=25000 t=25000 r=25000 b=25000 => cx=50%, cy=50% (symmetric)
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="FF0000"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="circle">
          <fillToRect l="25000" t="25000" r="25000" b="25000"/>
        </path>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('ellipse at');
    expect(result).toContain('50.0%');
  });

  it('generates ellipse radial-gradient for path=shape with off-center fillToRect', () => {
    const ctx = createMockRenderContext();
    // l=10000 t=20000 r=30000 b=40000
    // cx = (0.1 + (1-0.3))/2 * 100 = (0.1 + 0.7)/2 * 100 = 40%
    // cy = (0.2 + (1-0.4))/2 * 100 = (0.2 + 0.6)/2 * 100 = 40%
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="00FF00"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="shape">
          <fillToRect l="10000" t="20000" r="30000" b="40000"/>
        </path>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('radial-gradient');
    expect(result).toContain('ellipse at');
    expect(result).toContain('40.0%');
  });

  it('uses default center 50% 50% when path gradient has no fillToRect', () => {
    const ctx = createMockRenderContext();
    const node = xmlNode(`<spPr>
      <gradFill>
        <gsLst>
          <gs pos="0"><srgbClr val="AAAAAA"/></gs>
          <gs pos="100000"><srgbClr val="FFFFFF"/></gs>
        </gsLst>
        <path path="circle"/>
      </gradFill>
    </spPr>`);
    const result = resolveFill(node, ctx);
    expect(result).toContain('50.0%');
  });
});
