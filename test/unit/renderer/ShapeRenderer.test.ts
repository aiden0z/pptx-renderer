import { describe, expect, it, vi } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import { parseShapeNode } from '../../../src/model/nodes/ShapeNode';
import { renderShape } from '../../../src/renderer/ShapeRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { applyColorModifiers, applyTint, hexToRgb, rgbToHex } from '../../../src/utils/color';

function buildLineShapeXml(): string {
  return `
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="1" name="Line 1"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="1000000" cy="0"/>
        </a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
        <a:ln w="12700">
          <a:solidFill><a:srgbClr val="3366FF"/></a:solidFill>
          <a:tailEnd type="triangle" w="med" len="med"/>
        </a:ln>
      </p:spPr>
    </p:sp>
  `;
}

function mixHex(base: string, target: string, t: number): string {
  const b = hexToRgb(base);
  const dst = hexToRgb(target);
  return rgbToHex(b.r + (dst.r - b.r) * t, b.g + (dst.g - b.g) * t, b.b + (dst.b - b.b) * t);
}

function extractPathNumbers(path: string): number[] {
  return (path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

describe('ShapeRenderer', () => {
  it('keeps master text size for vertical text boxes without applying wide CSS line-height (ai-computing slide 22)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="171" name="文本框 170"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="986021" y="3435805"/><a:ext cx="660199" cy="1199896"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr vert="eaVert" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t">
            <a:noAutofit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="dist">
              <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>
            </a:pPr>
            <a:r>
              <a:rPr lang="zh-CN" b="1">
                <a:latin typeface="微软雅黑"/>
                <a:ea typeface="微软雅黑"/>
              </a:rPr>
              <a:t>应用场景</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.presentation.defaultTextStyle = parseXml(`
      <p:defaultTextStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr>
      </p:defaultTextStyle>
    `);
    ctx.master.textStyles.otherStyle = parseXml(`
      <p:otherStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>
      </p:otherStyle>
    `);

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const span = Array.from(el.querySelectorAll('span')).find((node) =>
      node.textContent?.includes('应用场景'),
    ) as HTMLElement | undefined;
    const paragraph = span?.closest('div') as HTMLElement | undefined;
    const textContainer = paragraph?.parentElement as HTMLElement | undefined;

    expect(span).toBeDefined();
    expect(span!.style.fontSize).toBe('24pt');
    expect(paragraph).toBeDefined();
    expect(paragraph!.style.lineHeight).toBe('1');
    expect(paragraph!.style.wordBreak).toBe('keep-all');
    expect(textContainer).toBeDefined();
    expect(textContainer!.style.justifyContent).toBe('center');
    expect(textContainer!.style.alignItems).toBe('flex-start');
  });

  it('continues to inherit master text styles for placeholders', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Content Placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>Placeholder</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.presentation.defaultTextStyle = parseXml(`
      <p:defaultTextStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr>
      </p:defaultTextStyle>
    `);
    ctx.master.textStyles.bodyStyle = parseXml(`
      <p:bodyStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>
      </p:bodyStyle>
    `);

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const span = el.querySelector('span') as HTMLElement;

    expect(span.style.fontSize).toBe('24pt');
  });

  it('should not add extra marker stroke for triangle arrowheads', () => {
    const shapeNode = parseShapeNode(parseXml(buildLineShapeXml()));
    const el = renderShape(shapeNode, createMockRenderContext());

    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('marker-end')).toContain('arrow-marker-');

    const markerPolygon = el.querySelector('defs marker polygon');
    expect(markerPolygon).toBeTruthy();
    expect(markerPolygon?.getAttribute('stroke')).toBeNull();
    expect(markerPolygon?.getAttribute('stroke-width')).toBeNull();

    const marker = el.querySelector('defs marker');
    expect(marker).toBeTruthy();
    // Regression: arrowhead was present but visually too tiny on connector-heavy slides.
    expect(Number.parseFloat(marker!.getAttribute('markerWidth') || '0')).toBeGreaterThanOrEqual(6);
    expect(Number.parseFloat(marker!.getAttribute('markerHeight') || '0')).toBeGreaterThanOrEqual(
      5,
    );
    // Tail arrows anchor the marker base to the shortened path endpoint, so the
    // connector stroke does not paint through the arrow head.
    expect(marker?.getAttribute('refX')).toBe('0');
  });

  it('keeps headEnd triangle arrow shape while insetting the connector start (xcloud-solution slide 45)', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="160" name="直接箭头连接符 946"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm flipV="1">
            <a:off x="11355876" y="4274747"/>
            <a:ext cx="0" cy="334899"/>
          </a:xfrm>
          <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="50800" cap="rnd">
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
            <a:headEnd type="triangle"/>
            <a:tailEnd type="none"/>
          </a:ln>
        </p:spPr>
      </p:cxnSp>
    `;

    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    const marker = el.querySelector('marker');
    const polygon = marker?.querySelector('polygon');
    const pathNumbers = extractPathNumbers(path?.getAttribute('d') ?? '');

    expect(path).toBeTruthy();
    expect(marker).toBeTruthy();
    expect(polygon?.getAttribute('points')).toBe('0,5 10,0 10,10');
    expect(marker?.getAttribute('refX')).toBe('10');
    expect(Number.parseFloat(marker!.getAttribute('markerWidth') ?? '0')).toBeCloseTo(16, 3);
    expect(Number.parseFloat(marker!.getAttribute('markerHeight') ?? '0')).toBeCloseTo(
      13.333,
      3,
    );
    expect(pathNumbers[1]).toBeCloseTo(16, 3);
  });

  it('keeps tailEnd marker visible when gradient stroke fades to transparent (xcloud-solution slide 45)', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="165" name="直接箭头连接符 942"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="11344710" y="5136329"/>
            <a:ext cx="0" cy="379362"/>
          </a:xfrm>
          <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="50800" cap="rnd">
            <a:gradFill>
              <a:gsLst>
                <a:gs pos="0"><a:schemeClr val="bg1"/></a:gs>
                <a:gs pos="100000">
                  <a:schemeClr val="bg1"><a:alpha val="0"/></a:schemeClr>
                </a:gs>
              </a:gsLst>
              <a:lin ang="16200000" scaled="0"/>
            </a:gradFill>
            <a:tailEnd type="triangle"/>
          </a:ln>
        </p:spPr>
      </p:cxnSp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const path = el.querySelector('path');
    const markerPolygon = el.querySelector('defs marker polygon');

    expect(path?.getAttribute('marker-end')).toContain('arrow-marker-');
    expect(markerPolygon?.getAttribute('fill')).not.toMatch(/rgba\([^)]*,0(?:\.000)?\)/);
    expect(path?.getAttribute('stroke-linecap')).toBe('butt');
  });

  it('anchors tailEnd triangle at its base so the connector stroke does not fill the arrow head (xcloud-solution slide 45)', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="165" name="直接箭头连接符 942"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="11344710" y="5136329"/>
            <a:ext cx="0" cy="379362"/>
          </a:xfrm>
          <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="50800" cap="rnd">
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
            <a:tailEnd type="triangle"/>
          </a:ln>
        </p:spPr>
      </p:cxnSp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const path = el.querySelector('path');
    const marker = el.querySelector('marker');
    const pathNumbers = extractPathNumbers(path?.getAttribute('d') ?? '');

    expect(path?.getAttribute('marker-end')).toContain('arrow-marker-');
    expect(marker?.getAttribute('refX')).toBe('0');
    expect(Number.parseFloat(marker!.getAttribute('markerWidth') ?? '0')).toBeCloseTo(16, 3);
    expect(pathNumbers[3]).toBeCloseTo(39.828 - 16, 1);
  });

  it('insets curved connector headEnd start so the arrow tip stays anchored (xcloud-intro slide 10)', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="42" name="直接箭头连接符 10"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm flipV="1">
            <a:off x="5488572" y="3127434"/>
            <a:ext cx="610035" cy="402630"/>
          </a:xfrm>
          <a:prstGeom prst="curvedConnector2"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="51435" cap="flat">
            <a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill>
            <a:headEnd type="triangle"/>
            <a:tailEnd type="triangle"/>
          </a:ln>
        </p:spPr>
      </p:cxnSp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const path = el.querySelector('path');
    const pathNumbers = extractPathNumbers(path?.getAttribute('d') ?? '');

    expect(path?.getAttribute('marker-start')).toContain('arrow-marker-');
    expect(path?.getAttribute('d')).toContain(' C');
    expect(pathNumbers[0]).toBeGreaterThan(10);
    expect(pathNumbers[1]).toBeGreaterThanOrEqual(0);
  });

  it('renders lineInv using theme lnRef stroke when shape has no explicit <a:ln>', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="183" name="Straight Connector 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3556000"/></a:xfrm>
          <a:prstGeom prst="lineInv"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
        </p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const themeLine = parseXml(`
      <a:ln xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" w="12700">
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:ln>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        lineStyles: [themeLine, themeLine],
      },
    });
    const el = renderShape(shapeNode, ctx);
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).not.toBe('none');
    expect(path?.getAttribute('stroke')).toBe('#4472C4');
    expect(Number(path?.getAttribute('stroke-width') || '0')).toBeGreaterThan(0);
  });

  it('renders arc using theme lnRef stroke when shape has no explicit <a:ln> (oracle-full-shapeid-0025)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="25" name="Arc"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3556000"/></a:xfrm>
          <a:prstGeom prst="arc"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
        </p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const themeLine = parseXml(`
      <a:ln xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" w="12700">
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:ln>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        lineStyles: [themeLine, themeLine],
      },
    });
    const el = renderShape(shapeNode, ctx);
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('none');
    expect(path?.getAttribute('stroke')).toBe('#4472C4');
    expect(Number(path?.getAttribute('stroke-width') || '0')).toBeGreaterThan(0);
  });

  it('renders circularArrow fill from fillRef accent1 instead of hardcoded blue (oracle-full-shapeid-0060)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Circular Arrow 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1524000" y="1016000"/><a:ext cx="5080000" cy="3556000"/></a:xfrm>
          <a:prstGeom prst="circularArrow"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="15000"/></a:schemeClr></a:lnRef>
          <a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr rtlCol="0" anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-CN"/></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    const el = renderShape(shapeNode, ctx);
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    // Fill should be theme accent1 (#4472C4), NOT hardcoded #8BBBEB
    expect(path?.getAttribute('fill')).toBe('#4472C4');
    // circularArrow should have no stroke
    expect(path?.getAttribute('stroke')).toBe('none');
  });

  it('renders fillRef theme gradient using phClr from fillRef color (windows pypptx shape adj)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Rounded Rectangle 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1828800" y="914400"/><a:ext cx="4572000" cy="3657600"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const themeFill = parseXml(`
      <a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rotWithShape="1">
        <a:gsLst>
          <a:gs pos="0">
            <a:schemeClr val="phClr">
              <a:tint val="100000"/>
              <a:shade val="100000"/>
              <a:satMod val="130000"/>
            </a:schemeClr>
          </a:gs>
          <a:gs pos="100000">
            <a:schemeClr val="phClr">
              <a:tint val="50000"/>
              <a:shade val="100000"/>
              <a:satMod val="350000"/>
            </a:schemeClr>
          </a:gs>
        </a:gsLst>
        <a:lin ang="16200000" scaled="0"/>
      </a:gradFill>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        fillStyles: [
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          themeFill,
        ],
      },
    });

    const el = renderShape(shapeNode, ctx);
    const path = el.querySelector('path');
    const stops = Array.from(el.querySelectorAll('linearGradient stop'));
    const expectedStart = applyColorModifiers('4472C4', [
      { name: 'tint', val: 100000 },
      { name: 'shade', val: 100000 },
      { name: 'satMod', val: 130000 },
    ]);
    const expectedEnd = applyColorModifiers('4472C4', [
      { name: 'tint', val: 50000 },
      { name: 'shade', val: 100000 },
      { name: 'satMod', val: 350000 },
    ]);

    expect(path?.getAttribute('fill')).toMatch(/^url\(#grad-fill-/);
    expect(stops).toHaveLength(2);
    expect(stops[0]?.getAttribute('stop-color')).toBe(expectedStart.color);
    expect(stops[1]?.getAttribute('stop-color')).toBe(expectedEnd.color);
  });

  it('uses inherited layout bodyPr normAutofit for text font sizing', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="10" name="Placeholder Text"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr sz="2400"/><a:t>Inherited scale</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    shapeNode.textBody!.layoutBodyProperties = parseXml(
      '<bodyPr><normAutofit fontScale="50000"/></bodyPr>',
    );

    const el = renderShape(shapeNode, createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find((div) =>
      div.textContent?.includes('Inherited scale'),
    ) as HTMLElement | undefined;

    expect(textContainer).toBeDefined();
    expect(textContainer!.style.transform).not.toContain('scale(');
    const span = textContainer!.querySelector('span') as HTMLSpanElement | null;
    expect(span?.style.fontSize).toBe('12pt');
  });

  it('uses explicit normAutofit fontScale as font sizing without pre-scaling textBoxBounds', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="12" name="Diagram Text"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:rPr sz="2400"/><a:t>Bounded text</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    shapeNode.textBoxBounds = { x: 8, y: 12, w: 120, h: 60 };

    const el = renderShape(shapeNode, createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find((div) =>
      div.textContent?.includes('Bounded text'),
    ) as HTMLElement | undefined;

    expect(textContainer).toBeDefined();
    expect(textContainer!.style.left).toBe('8px');
    expect(textContainer!.style.top).toBe('12px');
    expect(textContainer!.style.transform).not.toContain('scale(');
    expect(textContainer!.style.width).toBe('120px');
    expect(textContainer!.style.height).toBe('60px');
  });

  it('applies only dynamic normAutofit transform after explicit fontScale sizing', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 200 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 100 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="13" name="Scaled Autofit"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"/><a:t>Scaled then measured</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Scaled then measured') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const scaleCount = textContainer?.style.transform.match(/scale\(/g)?.length ?? 0;

      expect(textContainer).toBeDefined();
      expect(scaleCount).toBe(1);
      expect(textContainer!.style.transform).toBe('scale(0.5)');
      expect(textContainer!.style.width).toBe('200%');
      expect(textContainer!.style.height).toBe('200%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('preserves textBoxBounds pixel dimensions when explicit normAutofit still needs dynamic scale', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 120 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 60 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 240 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 60 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="15" name="Diagram NormAutofit"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"/><a:t>Scaled bounded text</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;
      const shapeNode = parseShapeNode(parseXml(xml));
      shapeNode.textBoxBounds = { x: 8, y: 12, w: 120, h: 60 };

      const el = renderShape(shapeNode, createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Scaled bounded text') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const span = textContainer?.querySelector('span') as HTMLSpanElement | null;

      expect(textContainer).toBeDefined();
      expect(span?.style.fontSize).toBe('12pt');
      expect(textContainer!.style.transform).toBe('scale(0.5)');
      expect(textContainer!.style.width).toBe('240px');
      expect(textContainer!.style.height).toBe('120px');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('preserves existing text transforms when dynamic autofit applies scale', () => {
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(100);
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(200);

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="11" name="Vertical Text"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="2000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr vert="vert270"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"/><a:t>Overflow text</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find((div) =>
        div.textContent?.includes('Overflow text'),
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).toContain('rotate(180deg)');
      expect(textContainer!.style.transform).toContain('scale(0.5)');
    } finally {
      clientHeightSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('preserves textBoxBounds pixel dimensions when dynamic spAutoFit shrinks text', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 120 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 60 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 240 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 60 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="14" name="Diagram SpAutoFit"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"/><a:t>Measured bounded text</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;
      const shapeNode = parseShapeNode(parseXml(xml));
      shapeNode.textBoxBounds = { x: 4, y: 6, w: 120, h: 60 };

      const el = renderShape(shapeNode, createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Measured bounded text') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).toContain('scale(0.5)');
      expect(textContainer!.style.width).toBe('240px');
      expect(textContainer!.style.height).toBe('120px');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('uses natural single-line width for horizontal spAutoFit scaling (ai-computing slide 14)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 1176 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 39 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 1558 : 1176;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 50 : 95;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="538" name="TextBox 22"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="267981" y="1023557"/><a:ext cx="11201149" cy="369332"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr b="1"/><a:t>异构算力纳管：支持同时管理AI集群、HPC科学计算集群，支持节点在AI/HPC模式间灵活切换，并运行任务。</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) => div.textContent?.includes('异构算力纳管') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const scaleMatch = textContainer?.style.transform.match(/scale\(([^)]+)\)/);
      const scale = Number(scaleMatch?.[1]);

      expect(textContainer).toBeDefined();
      expect(scale).toBeGreaterThan(0.7);
      expect(scale).toBeLessThan(0.8);
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps scaled single-line spAutoFit text nowrap after measuring unwrapped width (ai-computing slide 20)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 247 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 33 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 249 : 247;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 33 : 47;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="102" name="文本框 71"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="9491028" y="3989916"/><a:ext cx="2337031" cy="307777"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr marL="0" marR="0" lvl="0" indent="0"/>
              <a:r><a:rPr sz="1400" b="1"/><a:t>Max-Min Fairness</a:t></a:r>
              <a:r><a:rPr sz="1400" b="1"/><a:t>优先级：</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Max-Min Fairness优先级') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const scaleMatch = textContainer?.style.transform.match(/scale\(([^)]+)\)/);
      const scale = Number(scaleMatch?.[1]);

      expect(textContainer).toBeDefined();
      expect(scale).toBeGreaterThan(0.98);
      expect(scale).toBeLessThan(1);
      expect(textContainer!.style.whiteSpace).toBe('nowrap');
      expect(textContainer!.style.overflowY).toBe('hidden');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('top-aligns wrapping spAutoFit text boxes without an explicit anchor (oracle-pypptx-text-0007-font-impact)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="TextBox 1"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="2800"><a:latin typeface="Impact"/></a:rPr>
              <a:t>The quick brown fox jumps over the lazy dog — Impact</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (div) =>
        div.textContent?.includes('quick brown fox') && div.style.flexDirection === 'column',
    ) as HTMLElement | undefined;

    expect(textContainer).toBeDefined();
    expect(textContainer!.style.justifyContent).toBe('flex-start');
  });

  it('does not shrink narrow spAutoFit axis labels when text overflow is explicit (xcloud-plan slides 8 and 79)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 9 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 78 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 67 : 9;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 12 : 91;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="63" name="TextBox 62"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="629139" y="3833972"/><a:ext cx="89795" cy="738664"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr horzOverflow="overflow" vertOverflow="overflow" wrap="square"
                      lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr">
              <a:spAutoFit/>
            </a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="ctr"/>
              <a:r><a:rPr sz="800"/><a:t>交付服务比重</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) => div.textContent?.includes('交付服务比重') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.overflowY).toBe('visible');
      expect(textContainer!.style.paddingTop).toBe('0px');
      expect(textContainer!.style.paddingBottom).toBe('0px');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('auto-shrinks single-line shape text when bodyPr omits an autofit mode (ai-computing slide 12)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 252 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 38 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 330 : 252;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 42 : 84;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="165" name="矩形: 圆角 164"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="4716050" y="2117131"/><a:ext cx="2400600" cy="360437"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="3B75D3"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="ctr"><a:defRPr/></a:pPr>
              <a:r><a:rPr b="1"><a:solidFill><a:prstClr val="white"/></a:solidFill></a:rPr><a:t>智能算力管理平台</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('智能算力管理平台') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.overflowY).toBe('hidden');
      expect(textContainer!.style.transform).toContain('scale(');
      const scale = Number(textContainer!.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
      expect(scale).toBeLessThan(1);
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not shrink implicit single-line labels solely because insets exceed height (ai-computing slide 29)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 93 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 21 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 64 : 93;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 28 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="2182" name="矩形 332"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="10483789" y="3508625"/><a:ext cx="888470" cy="204637"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr lIns="182880" tIns="182880" rIns="182880" bIns="182880"
                      rtlCol="0" anchor="ctr"/>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="ctr"><a:defRPr/></a:pPr>
              <a:r><a:rPr sz="800" b="1"/><a:t>任务监控</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) => div.textContent?.includes('任务监控') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.overflowY).toBe('visible');
      expect(textContainer!.style.paddingTop).toBe('0px');
      expect(textContainer!.style.paddingBottom).toBe('0px');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not auto-shrink long default-wrap paragraphs without autofit (xcloud-solution slide 17)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 1131 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 68 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 2378 : 1131;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 68 : 80;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="51" name="矩形 41"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="639924" y="927609"/><a:ext cx="10776767" cy="647082"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 7818"/></a:avLst></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr lIns="82275" tIns="41137" rIns="82275" bIns="41137" rtlCol="0" anchor="ctr"/>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="just" defTabSz="1218199"><a:defRPr/></a:pPr>
              <a:r>
                <a:rPr lang="zh-CN" sz="1200"><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr>
                <a:t>提供企业知识资产全生命周期管理能力，包括知识采集、智能解析、多模态存储、精准检索和安全应用，内置RAG增强引擎与多模态解析，集成行业级知识图谱能力，支持多源异构数据接入、动态权限配置和智能语义检索，灵活适配不同行业知识管理需求，为用户提供开箱即用的知识工程服务，加速知识资产在企业运营中的价值转化。</a:t>
              </a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('提供企业知识资产全生命周期管理能力') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.overflowY).toBe('visible');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not apply implicit single-line shrink to bullet labels without autofit (xcloud-solution slide 26)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 142 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 19 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 224 : 142;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 30 : 30;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="46" name="矩形 46"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="8029893" y="2555512"/><a:ext cx="1350181" cy="182621"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr rtlCol="0" anchor="ctr"/>
            <a:lstStyle/>
            <a:p>
              <a:pPr marL="171450" indent="-171450" algn="l">
                <a:lnSpc><a:spcPct val="100000"/></a:lnSpc>
                <a:spcBef><a:spcPts val="600"/></a:spcBef>
                <a:spcAft><a:spcPts val="0"/></a:spcAft>
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr sz="900"><a:latin typeface="微软雅黑"/></a:rPr><a:t>应对常规流量</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) => div.textContent?.includes('应对常规流量') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps single-line title placeholders on one line when inherited noAutofit would wrap from font metrics (xcloud-plan slide 14)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 842 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 44 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 900 : 842;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 44 : 88;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="5" name="Title 28"/>
            <p:cNvSpPr/>
            <p:nvPr><p:ph type="title"/></p:nvPr>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="760413" y="442528"/><a:ext cx="8016034" cy="418576"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p>
              <a:r><a:rPr lang="en-US"/><a:t>FY2526</a:t></a:r>
              <a:r><a:rPr lang="zh-CN"/><a:t> 产品路线图：理清节奏、逐步推进（</a:t></a:r>
              <a:r><a:rPr lang="en-US"/><a:t>2/2</a:t></a:r>
              <a:r><a:rPr lang="zh-CN"/><a:t>）</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;
      const shapeNode = parseShapeNode(parseXml(xml));
      shapeNode.textBody!.layoutBodyProperties = parseXml(
        '<bodyPr wrap="square"><noAutofit/></bodyPr>',
      );

      const el = renderShape(shapeNode, createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('FY2526 产品路线图') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const scale = Number(textContainer?.style.transform.match(/scale\(([^)]+)\)/)?.[1]);

      expect(textContainer).toBeDefined();
      expect(scale).toBeGreaterThan(0.9);
      expect(scale).toBeLessThan(1);
      expect(textContainer!.style.width).toBe(`${100 / scale}%`);
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('allows long inherited-noAutofit titles to wrap instead of shrinking heavily (xcloud-intro slide 14)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 1120 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 44 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 1366 : 1120;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 44 : 88;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="2" name="标题 1"/>
            <p:cNvSpPr/>
            <p:nvPr><p:ph type="title"/></p:nvPr>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="760413" y="414000"/><a:ext cx="10668001" cy="418576"/></a:xfrm>
          </p:spPr>
          <p:txBody>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p>
              <a:r>
                <a:rPr lang="en-US" altLang="zh-CN" sz="2400"><a:latin typeface="+mn-lt"/></a:rPr>
                <a:t>Lenovo Intelligent Cloud Appliance Assists Customer to Build Meteorological Digital Cloud Foundation</a:t>
              </a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;
      const shapeNode = parseShapeNode(parseXml(xml));
      shapeNode.textBody!.layoutBodyProperties = parseXml(
        '<bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><noAutofit/></bodyPr>',
      );

      const el = renderShape(shapeNode, createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Meteorological Digital Cloud Foundation') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not shrink horizontal spAutoFit text when wrapped layout already fits (ai-computing slide 23)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 512 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 125 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 782 : 512;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 125 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="26" name="TextBox 25"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="6977148" y="1781009"/><a:ext cx="4431383" cy="1229764"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr marL="171450" indent="-171450">
                <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>
                <a:spcBef><a:spcPts val="600"/></a:spcBef>
                <a:buChar char="Ø"/>
              </a:pPr>
              <a:r><a:rPr sz="1100"/><a:t>将物理GPU进行细粒度切分，对GPU算力和显存进行内核级细粒度切分与池化。</a:t></a:r>
            </a:p>
            <a:p>
              <a:pPr marL="171450" indent="-171450">
                <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>
                <a:spcBef><a:spcPts val="600"/></a:spcBef>
                <a:buChar char="Ø"/>
              </a:pPr>
              <a:r><a:rPr sz="1100"/><a:t>支持按任务需求精确分配显存与算力，能够显著降低用户使用门槛和资源空置率。</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('支持按任务需求') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not force wrapped CJK spAutoFit text into one tiny line for font metric overhang (ai-computing slide 20)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 764 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 55 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 1487 : 765;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) && this.style.whiteSpace === 'nowrap' ? 55 : 66;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="7" name="文本框 6"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="4553169" y="1596670"/><a:ext cx="7274890" cy="523220"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:r><a:rPr sz="1400"><a:latin typeface="微软雅黑"/></a:rPr><a:t>DRF（Dominant Resource Fairness）是主资源公平调度策略，应用于大批量提交AI训练和大数据作业的场景，可</a:t></a:r>
              <a:r><a:rPr sz="1400" b="1"><a:latin typeface="微软雅黑"/></a:rPr><a:t>增强集群业务的吞吐量，整体缩短业务执行时间，提高训练性能。</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Dominant Resource Fairness') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not collapse or clip wrapped spAutoFit body text metric overhang (xcloud-solution slide 38)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 211 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 97 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 1048 : 211;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        if (this.style.whiteSpace === 'nowrap') return 97;
        const paragraph = this.querySelector('div') as HTMLElement | null;
        return paragraph?.style.lineHeight === '1.1' ? 105 : 132;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="87" name="文本框 86"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="9123473" y="2463215"/><a:ext cx="2011782" cy="923330"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr">
              <a:spAutoFit/>
            </a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="just"/>
              <a:r>
                <a:rPr lang="zh-CN" altLang="en-US" sz="1200">
                  <a:solidFill><a:schemeClr val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill>
                  <a:latin typeface="微软雅黑"/>
                  <a:ea typeface="微软雅黑"/>
                </a:rPr>
                <a:t>支持策略全生命周期管理（创建、配置、停用）、安全规则可视化编辑与发布、策略模拟测试，以及三方云服务密钥管理。需搭配内容检测服务使用。</a:t>
              </a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('支持策略全生命周期管理') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const paragraph = textContainer?.querySelector('div') as HTMLElement | null;

      expect(textContainer).toBeDefined();
      expect(paragraph?.style.lineHeight).toBe('1.1');
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
      expect(textContainer!.style.overflowY).toBe('visible');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps bullet spAutoFit text at full size when nowrap fits the original box (xcloud-solution slide 27)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 427 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 58 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 427 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 58 : 73;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="26" name="文本框 25"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1479548" y="1648903"/><a:ext cx="4064604" cy="548548"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr marL="171399" indent="-171399" algn="just">
                <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr lang="zh-CN" sz="1050" b="1"/><a:t>全栈兼容： </a:t></a:r>
              <a:r><a:rPr lang="zh-CN" sz="1050"/><a:t>支持主流品牌服务器/存储，无缝兼容各类国产芯片</a:t></a:r>
            </a:p>
            <a:p>
              <a:pPr marL="171399" indent="-171399" algn="just">
                <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr lang="zh-CN" sz="1050" b="1"/><a:t>开放生态： </a:t></a:r>
              <a:r><a:rPr lang="zh-CN" sz="1050"/><a:t>构建开放云市场，汇聚丰富应用生态伙伴</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) => div.textContent?.includes('全栈兼容') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.whiteSpace).toBe('nowrap');
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps normal line spacing for large wrapped spAutoFit text (oracle-pypptx-text-0015-size-72pt)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="TextBox 1"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="2743200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr sz="7200"><a:latin typeface="Calibri"/></a:rPr><a:t>Font size 72pt sample text</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (div) =>
        div.textContent?.includes('Font size 72pt sample text') &&
        div.style.flexDirection === 'column',
    ) as HTMLElement | undefined;
    const para = textContainer?.querySelector('div') as HTMLElement | null;
    const span = textContainer?.querySelector('span') as HTMLElement | null;

    expect(textContainer).toBeDefined();
    expect(para?.style.lineHeight).toBe('');
    expect(span?.style.fontSize).toBe('72pt');
  });

  it('remeasures dynamic spAutoFit after fonts are ready to remove stale fallback-font scaling', async () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    let fontsReady = false;
    let resolveFontsReady!: () => void;
    const fontsReadyPromise = new Promise<void>((resolve) => {
      resolveFontsReady = () => {
        fontsReady = true;
        resolve();
      };
    });
    const originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loading',
        ready: fontsReadyPromise,
      },
    });
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? (fontsReady ? 764 : 764) : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 55 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        if (this.style.whiteSpace === 'nowrap') return fontsReady ? 764 : 1487;
        return 764;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        if (this.style.whiteSpace === 'nowrap') return 55;
        return fontsReady ? 61 : 120;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="7" name="文本框 6"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="4553169" y="1596670"/><a:ext cx="7274890" cy="523220"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:r><a:rPr sz="1400"><a:latin typeface="微软雅黑"/></a:rPr><a:t>DRF（Dominant Resource Fairness）是主资源公平调度策略，应用于大批量提交AI训练和大数据作业的场景，可增强集群业务的吞吐量，整体缩短业务执行时间，提高训练性能。</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Dominant Resource Fairness') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).toContain('scale(');

      document.body.appendChild(el);
      resolveFontsReady();
      await fontsReadyPromise;
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        } else {
          setTimeout(resolve, 0);
        }
      });

      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
      document.body.innerHTML = '';
      if (originalFontsDescriptor) {
        Object.defineProperty(document, 'fonts', originalFontsDescriptor);
      } else {
        delete (document as Document & { fonts?: FontFaceSet }).fonts;
      }
    }
  });

  it('does not shrink bullet spAutoFit text because hanging indent uses internal width (opentelemetry slide 9)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 461 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 145 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        if (this.style.whiteSpace === 'nowrap') return 1285;
        const para = this.querySelector('div') as HTMLElement | null;
        return para?.style.boxSizing === 'border-box' && para.style.paddingLeft === '30px'
          ? 461
          : 491;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 145 : 0;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="20" name="TextBox 19"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="6893106" y="3325016"/><a:ext cx="4392856" cy="1384995"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr marL="285750" indent="-285750" algn="l">
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr sz="1400"><a:latin typeface="Arial"/></a:rPr><a:t>完全复用OpenTelemetry基础设施，包括采集和导出支持。</a:t></a:r>
            </a:p>
            <a:p>
              <a:pPr marL="285750" indent="-285750" algn="l">
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr sz="1400"><a:latin typeface="Arial"/></a:rPr><a:t>提供了GenAI体系的Telemetry数据语义约定。</a:t></a:r>
            </a:p>
            <a:p>
              <a:pPr marL="285750" indent="-285750" algn="l">
                <a:buFont typeface="Arial"/>
                <a:buChar char="•"/>
              </a:pPr>
              <a:r><a:rPr sz="1400"><a:latin typeface="Arial"/></a:rPr><a:t>支持OpenAI、 Vertex AI(Google)、 HuggingFace、 Bedrock等LLM服务，支持Pinecone、 Chroma等向量数据库，支持LangChain、LlamaIndex等框架。</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('完全复用OpenTelemetry基础设施') &&
          div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const para = textContainer?.querySelector('div') as HTMLElement | null;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(para?.style.marginLeft).toBe('');
      expect(para?.style.paddingLeft).toBe('30px');
      expect(para?.style.textIndent).toBe('0px');
      expect(para?.style.position).toBe('relative');
      expect(para?.style.boxSizing).toBe('border-box');
      const bullet = para?.querySelector('span') as HTMLElement | null;
      expect(bullet?.style.position).toBe('absolute');
      expect(bullet?.style.left).toBe('0px');
      expect(bullet?.style.width).toBe('30px');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps dense multi-paragraph spAutoFit text at Office line height (xcloud-solution slide 30 left box)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 295 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 417 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 295 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        const firstParagraph = this.querySelector('div') as HTMLElement | null;
        return firstParagraph?.style.lineHeight === '1.1' ? 410 : 504;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="34" name="文本框 33"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="963260" y="2043286"/><a:ext cx="2812666" cy="3970318"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="1050" b="1"/><a:t>1. 丰富的SAP客户经验</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>全球交付超过50000套SAP HANA系统</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>超多行业头部客户认可，SAP自身S/4平台运行在联想SAP HANA平台上</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:endParaRPr lang="zh-CN" sz="1050"/></a:p>
            <a:p><a:r><a:rPr sz="1050" b="1"/><a:t>2. 出色的性能表现</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>超过13项 SAP相关性能测试世界纪录保持</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('丰富的SAP客户经验') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const firstParagraph = textContainer?.querySelector('div') as HTMLElement | null;
      const emptyParagraph = Array.from(textContainer?.querySelectorAll('div') ?? []).find(
        (div) => !div.textContent,
      ) as HTMLElement | undefined;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(firstParagraph?.style.lineHeight).toBe('1.1');
      expect(emptyParagraph?.style.fontSize).toBe('10.5pt');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('uses near-width fit instead of heavy height shrink for short wrapped bullet spAutoFit text (xcloud-solution slide 30 right box)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 295 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 83 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 301 : 295;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        return this.style.whiteSpace === 'nowrap' ? 83 : 142;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="8" name="文本框 7"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="8412900" y="2043286"/><a:ext cx="2812666" cy="790922"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:pPr marL="171450" indent="-171450"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>SAP的全球技术合作伙伴Global Partner</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>SAP软件方案合作伙伴 PE Build Partner</a:t></a:r></a:p>
            <a:p><a:pPr marL="171450" indent="-171450"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1050"/><a:t>SAP服务合作伙伴 PE Service Partner</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('Global Partner') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const scale = Number(textContainer?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1');

      expect(textContainer).toBeDefined();
      expect(scale).toBeGreaterThan(0.95);
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('does not shrink single-line spAutoFit text because paragraph spacing is outside the fit box (ai-computing slide 23)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 388 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 39 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 388 : 0;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        const para = this.querySelector('div') as HTMLElement | null;
        return para?.style.marginTop === '0px' &&
          para?.style.marginBottom === '0px' &&
          para?.style.lineHeight === 'normal'
          ? 39
          : 89;
      });

    try {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="20" name="文本框 20"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1255813" y="1876657"/><a:ext cx="4405067" cy="373179"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr algn="ctr">
                <a:lnSpc><a:spcPts val="2250"/></a:lnSpc>
                <a:spcBef><a:spcPts val="2400"/></a:spcBef>
                <a:spcAft><a:spcPts val="1200"/></a:spcAft>
              </a:pPr>
              <a:r><a:rPr sz="1400" b="1"/><a:t>实现算力的精细切分与安全隔离</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('实现算力的精细切分') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const para = textContainer?.querySelector('div') as HTMLElement | null;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(textContainer!.style.justifyContent).toBe('center');
      expect(textContainer!.style.width).toBe('100%');
      expect(textContainer!.style.height).toBe('100%');
      expect(para?.style.marginTop).toBe('0px');
      expect(para?.style.marginBottom).toBe('0px');
      expect(para?.style.lineHeight).toBe('normal');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps Office default line height for multiline spAutoFit paragraphs with spacing (oracle-pypptx-text-0038-line-spacing)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="4" name="TextBox 3"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="457200"/><a:ext cx="9144000" cy="5486400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:spcBef><a:spcPts val="600"/></a:spcBef>
              <a:spcAft><a:spcPts val="1200"/></a:spcAft>
              <a:defRPr sz="1800"><a:latin typeface="Calibri"/></a:defRPr>
            </a:pPr>
            <a:r><a:t>Line 1</a:t></a:r>
          </a:p>
          <a:p>
            <a:pPr>
              <a:spcBef><a:spcPts val="600"/></a:spcBef>
              <a:spcAft><a:spcPts val="1200"/></a:spcAft>
              <a:defRPr sz="1800"><a:latin typeface="Calibri"/></a:defRPr>
            </a:pPr>
            <a:r><a:t>Line 2</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (div) => div.textContent?.includes('Line 2') && div.style.flexDirection === 'column',
    ) as HTMLElement | undefined;
    const paragraphs = Array.from(textContainer?.children ?? []).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.textContent?.startsWith('Line '),
    );

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].style.lineHeight).toBe('');
    expect(paragraphs[1].style.lineHeight).toBe('');
    expect(paragraphs[0].style.marginTop).toBe('0px');
    expect(paragraphs[0].style.marginBottom).toBe('12pt');
    expect(paragraphs[1].style.marginTop).toBe('6pt');
    expect(paragraphs[1].style.marginBottom).toBe('0px');
  });

  it('renders supported prstTxWarp text as SVG textPath (ai-computing slide 28)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="54" name="文本框 53"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm rot="457793">
            <a:off x="940634" y="4312755"/>
            <a:ext cx="1773757" cy="307777"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square">
            <a:prstTxWarp prst="textArchDown"><a:avLst/></a:prstTxWarp>
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:buNone/></a:pPr>
            <a:r>
              <a:rPr sz="1200">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="-apple-system"/>
                <a:ea typeface="微软雅黑"/>
              </a:rPr>
              <a:t>任务一键启停，快速训练</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const textPath = el.querySelector('textPath');
    const warpPath = el.querySelector('defs path');
    const htmlTextContainer = Array.from(el.querySelectorAll('div')).find((div) =>
      div.textContent?.includes('任务一键启停'),
    );

    expect(textPath).toBeDefined();
    expect(textPath!.textContent).toBe('任务一键启停，快速训练');
    expect(textPath!.getAttribute('startOffset')).toBe('50%');
    expect(textPath!.getAttribute('text-anchor')).toBe('middle');
    expect(warpPath?.getAttribute('d')).toContain('Q');
    expect(el.querySelector('text')?.getAttribute('font-size')).toBe('12pt');
    expect(htmlTextContainer).toBeUndefined();
  });

  it('resolves theme font placeholders for supported prstTxWarp text', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="55" name="文本框 54"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="1773757" cy="307777"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square">
            <a:prstTxWarp prst="textArchDown"><a:avLst/></a:prstTxWarp>
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:buNone/></a:pPr>
            <a:r>
              <a:rPr sz="1200">
                <a:latin typeface="+mj-ea"/>
              </a:rPr>
              <a:t>主题弧形文字</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.theme.majorFont = { latin: 'Calibri', ea: 'Microsoft YaHei', cs: '' };

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const text = el.querySelector('text');

    expect(text?.getAttribute('font-family')).toContain('Microsoft YaHei');
    expect(text?.getAttribute('font-family')).not.toContain('+mj-ea');
  });

  it('keeps East Asian theme fonts in supported prstTxWarp font stacks', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="56" name="文本框 55"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="1773757" cy="307777"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square">
            <a:prstTxWarp prst="textArchDown"><a:avLst/></a:prstTxWarp>
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:buNone/></a:pPr>
            <a:r>
              <a:rPr sz="1200">
                <a:latin typeface="+mj-lt"/>
                <a:ea typeface="+mj-ea"/>
              </a:rPr>
              <a:t>主题弧形文字</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.theme.majorFont = { latin: 'Aptos Display', ea: 'Microsoft YaHei', cs: '' };

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const text = el.querySelector('text');

    expect(text?.getAttribute('font-family')).toContain('Aptos Display');
    expect(text?.getAttribute('font-family')).toContain('Microsoft YaHei');
    expect(text?.getAttribute('font-family')).not.toContain('+mj-');
  });

  it('does not shrink wrapped spAutoFit text when Office single line spacing fits (ai-computing slide 28 footer)', () => {
    const isFitContainer = (el: HTMLElement) =>
      el.style.display === 'flex' && el.style.flexDirection === 'column';
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 685 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isFitContainer(this) ? 68 : 0;
      });
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        const para = this.querySelector('div') as HTMLElement | null;
        return para?.style.width === '100%' &&
          para.style.minWidth === '0px' &&
          para.style.overflowWrap === 'anywhere'
          ? 685
          : 1198;
      });
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (!isFitContainer(this)) return 0;
        const para = this.querySelector('div') as HTMLElement | null;
        return para?.style.lineHeight === '1' ? 74 : 119;
      });

    try {
      const ctx = createMockRenderContext();
      ctx.master.textStyles.otherStyle = parseXml(`
        <p:otherStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>
        </p:otherStyle>
      `);
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="36" name="文本框 35"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="2726188" y="5622532"/><a:ext cx="6528885" cy="646331"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr lvl="0" algn="ctr"><a:defRPr/></a:pPr>
              <a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="3F58CA"/></a:solidFill></a:rPr><a:t>为追求极致性能与灵活控制的</a:t></a:r>
              <a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="3F58CA"/></a:solidFill></a:rPr><a:t>AI</a:t></a:r>
              <a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="3F58CA"/></a:solidFill></a:rPr><a:t>团队，提供高度自主、稳定可靠的专业训练基础设施</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
      const textContainer = Array.from(el.querySelectorAll('div')).find(
        (div) =>
          div.textContent?.includes('为追求极致性能') && div.style.flexDirection === 'column',
      ) as HTMLElement | undefined;
      const para = textContainer?.querySelector('div') as HTMLElement | null;
      const span = textContainer?.querySelector('span') as HTMLElement | null;

      expect(textContainer).toBeDefined();
      expect(textContainer!.style.transform).not.toContain('scale(');
      expect(para?.style.width).toBe('100%');
      expect(para?.style.minWidth).toBe('0px');
      expect(para?.style.maxWidth).toBe('100%');
      expect(para?.style.overflowWrap).toBe('anywhere');
      expect(para?.style.lineHeight).toBe('1');
      expect(span?.style.fontSize).toBe('24pt');
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
      scrollWidthSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('keeps multi-path bevel shading anchored to fillRef base color when main fill is gradient', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Bevel 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1828800" y="914400"/><a:ext cx="4572000" cy="3657600"/></a:xfrm>
          <a:prstGeom prst="bevel"><a:avLst><a:gd name="adj" fmla="val 35000"/></a:avLst></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>
        </p:style>
      </p:sp>
    `;
    const themeFill = parseXml(`
      <a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rotWithShape="1">
        <a:gsLst>
          <a:gs pos="0"><a:schemeClr val="phClr"/></a:gs>
          <a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs>
        </a:gsLst>
        <a:lin ang="16200000" scaled="0"/>
      </a:gradFill>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        fillStyles: [
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          themeFill,
        ],
      },
    });

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const paths = el.querySelectorAll('path');

    expect(paths[0]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-/);
    expect(paths[1]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-detail-/);
    expect(paths[2]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-detail-/);
    expect(paths[3]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-detail-/);
    expect(paths[4]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-detail-/);
  });

  it('derives a tinted gradient for can top face when fillRef resolves to a theme gradient', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Can 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1828800" y="914400"/><a:ext cx="4572000" cy="3657600"/></a:xfrm>
          <a:prstGeom prst="can"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>
        </p:style>
      </p:sp>
    `;
    const themeFill = parseXml(`
      <a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rotWithShape="1">
        <a:gsLst>
          <a:gs pos="0">
            <a:schemeClr val="phClr">
              <a:tint val="100000"/>
              <a:shade val="100000"/>
              <a:satMod val="130000"/>
            </a:schemeClr>
          </a:gs>
          <a:gs pos="100000">
            <a:schemeClr val="phClr">
              <a:tint val="50000"/>
              <a:shade val="100000"/>
              <a:satMod val="350000"/>
            </a:schemeClr>
          </a:gs>
        </a:gsLst>
        <a:lin ang="16200000" scaled="0"/>
      </a:gradFill>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        fillStyles: [
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          parseXml(
            '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>',
          ),
          themeFill,
        ],
      },
    });

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const paths = el.querySelectorAll('path');
    const faceStops = Array.from(el.querySelectorAll('linearGradient[id^="grad-fill-face-"] stop'));
    expect(paths[0]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-/);
    expect(paths[1]?.getAttribute('fill')).toMatch(/^url\(#grad-fill-face-/);
    expect(faceStops[0]?.getAttribute('stop-color')).toBe(applyTint('#316dd7', 65000));
  });

  it('does not draw multi-path can outline when shape line is explicitly noFill (model-platform slide 20)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="24" name="圆柱体 23"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1068208" y="1765570"/><a:ext cx="2197118" cy="647996"/></a:xfrm>
          <a:prstGeom prst="can"><a:avLst/></a:prstGeom>
          <a:gradFill flip="none" rotWithShape="1">
            <a:gsLst>
              <a:gs pos="47000"><a:schemeClr val="accent6"/></a:gs>
              <a:gs pos="100000"><a:schemeClr val="accent5"><a:lumMod val="90000"/></a:schemeClr></a:gs>
            </a:gsLst>
            <a:lin ang="2700000" scaled="1"/>
            <a:tileRect/>
          </a:gradFill>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>
          <a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
      </p:sp>
    `;
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        colorScheme: new Map([
          ['dk1', '000000'],
          ['lt1', 'FFFFFF'],
          ['accent1', 'E1140A'],
          ['accent5', '46C8E1'],
          ['accent6', '3B51D3'],
        ]),
      },
    });

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const paths = Array.from(el.querySelectorAll('path'));

    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths.every((path) => path.getAttribute('stroke') === 'none')).toBe(true);
  });

  it('renders actionButtonBackPrevious as multi-path with darken sub-paths (oracle-full-shapeid-0129)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Action Button: Back or Previous 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1524000" y="1016000"/><a:ext cx="5080000" cy="3556000"/></a:xfrm>
          <a:prstGeom prst="actionButtonBackPrevious"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="15000"/></a:schemeClr></a:lnRef>
          <a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr rtlCol="0" anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-CN"/></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    const el = renderShape(shapeNode, ctx);
    const paths = el.querySelectorAll('path');
    // Multi-path: norm (rect+triangle), darken (triangle), stroke (triangle), stroke (rect)
    expect(paths.length).toBeGreaterThanOrEqual(4);
    // The darken path (index 1) should contain the triangle icon
    const darkenPath = paths[1];
    expect(darkenPath.getAttribute('d')).toContain('M');
    expect(darkenPath.getAttribute('d')).toContain('Z');
  });

  it('should allow title placeholder text to wrap when bodyPr wrap is not none', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>This is a very long title that should wrap to multiple lines</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;
    expect(textContainer).toBeTruthy();
    expect(textContainer?.style.whiteSpace).not.toBe('nowrap');
  });

  it('applies txXfrm rotation so diagram text stays upright when shape is rotated', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="9" name="Rotated Diagram Block"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm rot="10800000"><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm>
          <a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="993399"/></a:solidFill>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>block 3</a:t></a:r></a:p>
        </p:txBody>
        <p:txXfrm rot="10800000"><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:txXfrm>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;
    expect(textContainer).toBeTruthy();
    expect(textContainer?.style.transform).toContain('rotate(180deg)');
    // 180deg txXfrm should mirror textbox position inside shape bounds (0,0 -> 1,000,000,1,000,000 in EMU)
    expect(Number.parseFloat(textContainer!.style.left)).toBeGreaterThan(100);
    expect(Number.parseFloat(textContainer!.style.top)).toBeGreaterThan(100);
  });

  it('uses evenodd fill-rule for curved arrows to avoid seam artifacts', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="10" name="Curved Up Arrow"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="curvedUpArrow"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="E53935"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('keeps line outer shadow bounded for center-aligned scaled shadows', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="22" name="Connector Shadow Regression"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="4853940"/><a:ext cx="12188825" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="38100"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
          <a:effectLst>
            <a:outerShdw blurRad="152400" dist="1244600" sx="200000" sy="200000" algn="ctr" rotWithShape="0">
              <a:srgbClr val="FFFFFF"><a:alpha val="91000"/></a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;

    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const shadow = el.style.boxShadow;
    expect(shadow).toBeTruthy();

    // box-shadow syntax: offsetX offsetY blur spread color
    const matches = shadow.match(/(-?\d+(?:\.\d+)?)px/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    const offsetX = Number.parseFloat(matches[0]);
    const spread = Number.parseFloat(matches[3]);

    // Regression guard:
    // 1) center alignment must not produce huge side shift from mistaken "r"/"t" matching.
    // 2) line shadow spread should stay near stroke thickness, not line length.
    expect(Math.abs(offsetX)).toBeLessThan(200);
    expect(spread).toBeLessThan(20);
  });

  it('applies scaled outer shadows to non-line SVG paths instead of the wrapper box (xcloud-intro slide 12 trapezoid)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="455" name="梯形 454"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="757240" y="1751326"/>
            <a:ext cx="7701328" cy="304594"/>
          </a:xfrm>
          <a:prstGeom prst="trapezoid">
            <a:avLst><a:gd name="adj" fmla="val 109483"/></a:avLst>
          </a:prstGeom>
          <a:gradFill>
            <a:gsLst>
              <a:gs pos="100000"><a:sysClr val="window" lastClr="FFFFFF"/></a:gs>
              <a:gs pos="0"><a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="0"/></a:sysClr></a:gs>
            </a:gsLst>
            <a:lin ang="5400000" scaled="0"/>
          </a:gradFill>
          <a:ln w="11589" cap="flat" cmpd="sng" algn="in">
            <a:gradFill>
              <a:gsLst>
                <a:gs pos="0"><a:srgbClr val="3B51D3"><a:alpha val="0"/></a:srgbClr></a:gs>
                <a:gs pos="100000"><a:srgbClr val="3B51D3"><a:alpha val="50000"/></a:srgbClr></a:gs>
              </a:gsLst>
              <a:lin ang="5400000" scaled="1"/>
            </a:gradFill>
          </a:ln>
          <a:effectLst>
            <a:outerShdw blurRad="139065" sx="102000" sy="102000" algn="t" rotWithShape="0">
              <a:srgbClr val="C9D0F0"><a:lumMod val="50000"/><a:alpha val="30000"/></a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const path = el.querySelector('svg > path');
    const filter = el.querySelector('filter');

    expect(el.style.boxShadow).toBe('');
    expect(path?.getAttribute('filter')).toContain('url(#shape-shadow-');
    expect(filter).toBeTruthy();
    expect(filter?.querySelector('feDropShadow')).toBeTruthy();
  });

  it('treats spAutoFit as bounded text fit to prevent overflow bleed', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="300" name="spAutoFit overflow regression"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:t>This is a long paragraph that should not bleed outside shape bounds under spAutoFit.</a:t></a:r></a:p>
          <a:p><a:r><a:t>Second line with additional content to force overflow in browser layout metrics.</a:t></a:r></a:p>
          <a:p><a:r><a:t>Third line to make sure fitting behavior is engaged.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;

    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;

    expect(textContainer).toBeTruthy();
    expect(textContainer?.style.overflowY).toBe('hidden');
  });

  it('applies theme effectRef outer shadow when shape has no explicit effectLst', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="401" name="EffectRef Shadow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="3366FF"/></a:solidFill>
        </p:spPr>
        <p:style><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef></p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const effectStyleXml = parseXml(`
      <a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:effectLst>
          <a:outerShdw blurRad="152400" dist="76200" dir="5400000">
            <a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr>
          </a:outerShdw>
        </a:effectLst>
      </a:effectStyle>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        effectStyles: [effectStyleXml],
      },
    });
    const el = renderShape(shapeNode, ctx);
    expect(el.style.boxShadow || el.style.filter || el.querySelector('path[filter]')).toBeTruthy();
  });

  it('applies unscaled outer shadows to non-line SVG paths instead of wrapper CSS filters (oracle-pypptx-shape-adj-0009)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="402" name="Donut Shadow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="3657600"/></a:xfrm>
          <a:prstGeom prst="donut"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>
          <a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>
        </p:spPr>
        <p:style><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef></p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const effectStyleXml = parseXml(`
      <a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:effectLst>
          <a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0">
            <a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr>
          </a:outerShdw>
        </a:effectLst>
      </a:effectStyle>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        effectStyles: [effectStyleXml],
      },
    });

    const el = renderShape(shapeNode, ctx);
    const path = el.querySelector('path');

    expect(el.style.filter).toBe('');
    expect(path?.getAttribute('filter')).toContain('url(#shape-shadow-');
    expect(el.innerHTML).toContain('<filter');
    expect(el.innerHTML).toContain('stdDeviation="2.10"');
  });

  it('applies shape glow from spPr effectLst (ai-computing slide 27)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="72" name="文本框 72"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="600000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:effectLst>
            <a:glow rad="127000">
              <a:srgbClr val="C9D0F0"><a:alpha val="40000"/></a:srgbClr>
            </a:glow>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());

    expect(el.style.filter).toContain('drop-shadow');
    expect(el.style.filter).toContain('13.3px');
    expect(el.style.filter).toContain('rgba(201,208,240,0.400)');
  });

  it('renders rect shape with solidFill color', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="50" name="Rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('#FF0000');
    expect(path?.getAttribute('stroke')).toBe('#0000FF');
    expect(Number(path?.getAttribute('stroke-width') || '0')).toBeGreaterThan(0);
  });

  it('renders shape with noFill and noLine', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="51" name="NoFill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).toBe('none');
  });

  it('renders dashed stroke', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="52" name="Dashed"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          <a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dash"/></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('renders dotted stroke', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="53" name="Dotted"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          <a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dot"/></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('renders dashDot and lgDashDotDot with distinct SVG dash arrays', () => {
    const makeShape = (dash: string) =>
      parseShapeNode(
        parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="54" name="${dash}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="${dash}"/></a:ln>
        </p:spPr>
      </p:sp>
    `),
      );

    const ctx = createMockRenderContext();
    const dashDotPath = renderShape(makeShape('dashDot'), ctx).querySelector('path');
    const lgDashDotDotPath = renderShape(makeShape('lgDashDotDot'), ctx).querySelector('path');

    expect(dashDotPath?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(lgDashDotDotPath?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(dashDotPath?.getAttribute('stroke-dasharray')).not.toBe(
      lgDashDotDotPath?.getAttribute('stroke-dasharray'),
    );
  });

  it('renders schemeClr fill resolving to theme color', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="54" name="SchemeClr"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('#4472C4');
  });

  it('renders connector shape (cxnSp) as line', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="55" name="Connector"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:cxnSp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).not.toBe('none');
  });

  it('renders curved connector presets as stroke-only paths', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="155" name="Curved Connector"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3810000"/></a:xfrm>
          <a:prstGeom prst="curvedConnector3"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:ln>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef>
        </p:style>
      </p:cxnSp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('none');
    expect(path?.getAttribute('stroke')).not.toBe('none');
  });

  it('keeps flowchart connector presets filled instead of treating them as connector lines', () => {
    for (const preset of ['flowChartConnector', 'flowChartOffpageConnector']) {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr><p:cNvPr id="156" name="${preset}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="2000000"/></a:xfrm>
            <a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:style>
            <a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>
            <a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
            <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
            <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
          </p:style>
        </p:sp>
      `;
      const shapeNode = parseShapeNode(parseXml(xml));
      const el = renderShape(shapeNode, createMockRenderContext());
      const path = el.querySelector('path');
      expect(path?.getAttribute('fill')).toBe('#4472C4');
    }
  });

  it('renders shape with text body', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="56" name="TextShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>Hello Shape</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    expect(el.textContent).toContain('Hello Shape');
  });

  it('renders shape with rotation and flip', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="57" name="Rotated"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm rot="5400000" flipH="1" flipV="1"><a:off x="100" y="200"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    expect(el.style.transform).toContain('rotate(90deg)');
    expect(el.style.transform).toContain('scaleX(-1)');
    expect(el.style.transform).toContain('scaleY(-1)');
  });

  it('renders stealth arrowhead marker', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="58" name="Stealth"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:tailEnd type="stealth" w="med" len="med"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const markerPath = el.querySelector('defs marker path');
    expect(markerPath).toBeTruthy();
    expect(markerPath?.getAttribute('d')).toContain('M10,5');
  });

  it('keeps headEnd stealth arrow shape while insetting the connector start', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="581" name="Head Stealth"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:headEnd type="stealth" w="med" len="med"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const paths = el.querySelectorAll('svg > path');
    const path = paths[paths.length - 1];
    const marker = el.querySelector('defs marker');
    const markerPath = marker?.querySelector('path');
    const pathNumbers = extractPathNumbers(path?.getAttribute('d') ?? '');

    expect(path).toBeTruthy();
    expect(markerPath).toBeTruthy();
    expect(markerPath?.getAttribute('d')).toContain('M0,5');
    expect(marker?.getAttribute('refX')).toBe('10');
    expect(pathNumbers[0]).toBeGreaterThan(6);
  });

  it('renders diamond arrowhead marker', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="59" name="Diamond"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:headEnd type="diamond" w="med" len="med"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const markerPolygon = el.querySelector('defs marker polygon');
    expect(markerPolygon).toBeTruthy();
    expect(markerPolygon?.getAttribute('points')).toContain('5,0');
  });

  it('renders oval arrowhead marker', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="60" name="Oval"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:tailEnd type="oval" w="sm" len="lg"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const circle = el.querySelector('defs marker circle');
    expect(circle).toBeTruthy();
    expect(circle?.getAttribute('cx')).toBe('5');
  });

  it('renders can shape with top ellipse overlay', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="61" name="Can"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="3000000"/></a:xfrm>
          <a:prstGeom prst="can"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const paths = el.querySelectorAll('path');
    // Main path + top ellipse overlay
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders line cap round', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="62" name="RoundCap"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="25400" cap="rnd">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:round/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('applies reflection approximation via -webkit-box-reflect', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="402" name="Reflection"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
          <a:effectLst>
            <a:reflection stA="40000" endA="0" stPos="0" endPos="100000" dist="63500"/>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const reflect =
      el.style.getPropertyValue('-webkit-box-reflect') || (el.style as any).webkitBoxReflect || '';
    expect(reflect).toContain('linear-gradient');
  });

  it('renders linear gradient fill on shape', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="201" name="Gradient"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:gradFill rotWithShape="1" ang="2700000" scaled="0">
            <a:gsLst>
              <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
              <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
            </a:gsLst>
            <a:lin ang="2700000" scaled="0"/>
          </a:gradFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const defs = el.querySelector('defs');
    expect(defs).toBeTruthy();
    const linearGrad = defs?.querySelector('linearGradient');
    expect(linearGrad).toBeTruthy();
    expect(linearGrad?.children.length).toBeGreaterThanOrEqual(2);
    expect(linearGrad?.getAttribute('color-interpolation')).toBe('linearRGB');
  });

  it('renders radial gradient fill on shape', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="202" name="RadialGrad"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
          <a:gradFill path="circle">
            <a:gsLst>
              <a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>
              <a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>
            </a:gsLst>
            <a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>
          </a:gradFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const defs = el.querySelector('defs');
    expect(defs).toBeTruthy();
    const radialGrad = defs?.querySelector('radialGradient');
    expect(radialGrad).toBeTruthy();
  });

  it('renders radial gradient with path="rect" using two linear gradients with lighten blend', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="203" name="RectGrad"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:gradFill path="rect">
            <a:gsLst>
              <a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>
              <a:gs pos="100000"><a:srgbClr val="808080"/></a:gs>
            </a:gsLst>
            <a:path path="rect"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>
          </a:gradFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const svg = el.querySelector('svg');
    expect(svg).toBeTruthy();
    const defs = svg?.querySelector('defs');
    expect(defs).toBeTruthy();
    // Should have two linear gradients (H and V) for rect path
    const linearGrads = Array.from(defs?.querySelectorAll('linearGradient') ?? []);
    expect(linearGrads.length).toBeGreaterThanOrEqual(2);
    expect(
      linearGrads.every((grad) => grad.getAttribute('color-interpolation') === 'linearRGB'),
    ).toBe(true);
    // Should have blend group with lighten somewhere in the SVG
    const blendGroup = svg?.querySelector('g[style*="isolation"]');
    expect(blendGroup).toBeTruthy();
  });

  it('renders gradient stroke on shape', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="204" name="GradStroke"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="25400">
            <a:gradFill rotWithShape="1" ang="5400000" scaled="0">
              <a:gsLst>
                <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
                <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
              </a:gsLst>
              <a:lin ang="5400000" scaled="0"/>
            </a:gradFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const defs = el.querySelector('defs');
    const path = el.querySelector('path');
    expect(defs).toBeTruthy();
    // Should have gradient for stroke
    const stroke = path?.getAttribute('stroke') ?? '';
    expect(stroke).toContain('url(#');
    const linearGrad = defs?.querySelector('linearGradient');
    expect(linearGrad?.getAttribute('color-interpolation')).toBe('linearRGB');
  });

  it('uses shape bounds for non-line gradient stroke coordinates (xcloud-intro slide 13 trapezoid)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="26" name="梯形 25"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="7701328" cy="427148"/></a:xfrm>
          <a:prstGeom prst="trapezoid">
            <a:avLst><a:gd name="adj" fmla="val 109483"/></a:avLst>
          </a:prstGeom>
          <a:noFill/>
          <a:ln w="11589" algn="in">
            <a:gradFill>
              <a:gsLst>
                <a:gs pos="0"><a:srgbClr val="3B51D3"><a:alpha val="0"/></a:srgbClr></a:gs>
                <a:gs pos="100000"><a:srgbClr val="3B51D3"><a:alpha val="50000"/></a:srgbClr></a:gs>
              </a:gsLst>
              <a:lin ang="5400000" scaled="1"/>
            </a:gradFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const gradient = el.querySelector('linearGradient[id^="grad-stroke-"]');

    expect(gradient).toBeTruthy();
    expect(Number(gradient!.getAttribute('x1'))).toBeCloseTo(shapeNode.size.w / 2, 1);
    expect(Number(gradient!.getAttribute('x2'))).toBeCloseTo(shapeNode.size.w / 2, 1);
    expect(Number(gradient!.getAttribute('y1'))).toBeCloseTo(0, 1);
    expect(Number(gradient!.getAttribute('y2'))).toBeCloseTo(shapeNode.size.h, 1);
  });

  it('renders shape with blipFill (image fill) creates clipped image', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="205" name="BlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill dpi="0" rotWithShape="1">
            <a:blip r:embed="rId1"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // Create mock context with media data
    const mockCtx = createMockRenderContext();
    const ctx = createMockRenderContext({
      slide: {
        ...mockCtx.slide,
        rels: new Map([['rId1', { type: 'image', target: '../media/image1.png' }]]),
      },
      presentation: {
        ...mockCtx.presentation,
        media: new Map([['ppt/media/image1.png', new Uint8Array([137, 80, 78, 71])]]), // PNG header
      },
    });
    const el = renderShape(shapeNode, ctx);
    const svg = el.querySelector('svg');
    const defs = svg?.querySelector('defs');
    const image = svg?.querySelector('image');

    expect(image).not.toBeNull();
    expect(image!.getAttribute('preserveAspectRatio')).toBe('none');
    const clipPath = defs?.querySelector('clipPath');
    expect(clipPath).toBeTruthy();
  });

  it('renders shape blipFill after lazy media resolves asynchronously', async () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="205" name="LazyBlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip r:embed="rId1"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.asyncTasks = [];
    ctx.slide.rels.set('rId1', { type: 'image', target: '../media/lazy-shape.png' });
    ctx.presentation.mediaResolver = {
      resolve: vi.fn(async () => ({
        mediaPath: 'ppt/media/lazy-shape.png',
        data: new Uint8Array([137, 80, 78, 71]),
      })),
    };

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);

    expect(el.querySelector('svg image')).toBeNull();
    expect(ctx.asyncTasks).toHaveLength(1);

    await Promise.all(ctx.asyncTasks);

    const image = el.querySelector('svg image');
    expect(ctx.presentation.mediaResolver.resolve).toHaveBeenCalledWith('../media/lazy-shape.png');
    expect(ctx.mediaUrlCache.has('ppt/media/lazy-shape.png')).toBe(true);
    expect(image).not.toBeNull();
    expect(image!.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('honors non-zero stretch fillRect insets for shape blipFill images', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="206" name="InsetBlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip r:embed="rId1"/>
            <a:stretch><a:fillRect l="25000" t="10000" r="25000" b="10000"/></a:stretch>
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const mockCtx = createMockRenderContext();
    const ctx = createMockRenderContext({
      slide: {
        ...mockCtx.slide,
        rels: new Map([['rId1', { type: 'image', target: '../media/image1.png' }]]),
      },
      presentation: {
        ...mockCtx.presentation,
        media: new Map([['ppt/media/image1.png', new Uint8Array([137, 80, 78, 71])]]),
      },
    });

    const el = renderShape(shapeNode, ctx);
    const image = el.querySelector('svg image');

    expect(image).not.toBeNull();
    expect(Number(image!.getAttribute('x'))).toBeCloseTo(shapeNode.size.w * 0.25, 3);
    expect(Number(image!.getAttribute('y'))).toBeCloseTo(shapeNode.size.h * 0.1, 3);
    expect(Number(image!.getAttribute('width'))).toBeCloseTo(shapeNode.size.w * 0.5, 3);
    expect(Number(image!.getAttribute('height'))).toBeCloseTo(shapeNode.size.h * 0.8, 3);
    expect(image!.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('preserves shape outline when rendering blipFill image fills', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="207" name="OutlinedBlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip r:embed="rId1"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const mockCtx = createMockRenderContext();
    const ctx = createMockRenderContext({
      slide: {
        ...mockCtx.slide,
        rels: new Map([['rId1', { type: 'image', target: '../media/image1.png' }]]),
      },
      presentation: {
        ...mockCtx.presentation,
        media: new Map([['ppt/media/image1.png', new Uint8Array([137, 80, 78, 71])]]),
      },
    });

    const el = renderShape(shapeNode, ctx);
    const outlinePath = el.querySelector('svg > path');

    expect(outlinePath).not.toBeNull();
    expect(outlinePath!.getAttribute('fill')).toBe('none');
    expect(outlinePath!.getAttribute('stroke')).toBe('#FF0000');
    expect(Number(outlinePath!.getAttribute('stroke-width'))).toBeGreaterThan(0);
  });

  it('does not fall back to package media for disallowed external shape blipFill targets', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="206" name="ExternalBlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip r:embed="rId1"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rId1', {
      type: 'image',
      target: 'file:///tmp/image1.png',
      targetMode: 'External',
    });
    ctx.presentation.media.set('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71]));

    const el = renderShape(shapeNode, ctx);

    expect(el.querySelector('svg image')).toBeNull();
    expect(ctx.mediaUrlCache.has('ppt/media/image1.png')).toBe(false);
  });

  it('renders safe external linked shape blipFill targets from r:link relationships', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr><p:cNvPr id="207" name="LinkedBlipShape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip r:link="rIdLinked"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rIdLinked', {
      type: 'image',
      target: 'https://example.com/fill.png',
      targetMode: 'External',
    });

    const el = renderShape(shapeNode, ctx);
    const image = el.querySelector('svg image');

    expect(image).not.toBeNull();
    expect(image!.getAttribute('href') ?? image!.getAttribute('xlink:href')).toBe(
      'https://example.com/fill.png',
    );
  });

  it('renders multi-path preset (can shape with top ellipse)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="206" name="Can"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="3000000"/></a:xfrm>
          <a:prstGeom prst="can"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const paths = el.querySelectorAll('path');
    // Multi-path: main body + top ellipse
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders cloud without internal detail paths', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="209" name="Cloud"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2800000"/></a:xfrm>
          <a:prstGeom prst="cloud"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="156082"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="0B2531"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const svgPaths = Array.from(el.querySelectorAll('svg > path'));
    expect(svgPaths.length).toBe(1);
  });

  it('renders foldedCorner with a clipped outer corner, fold-face, and vertical crease line', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="210" name="FoldedCorner"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2800000"/></a:xfrm>
          <a:prstGeom prst="foldedCorner"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>
          <a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="3B5F8A"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const svgPaths = Array.from(el.querySelectorAll('svg > path'));
    expect(svgPaths.length).toBeGreaterThanOrEqual(3);
    const mainFill = svgPaths[0]?.getAttribute('fill');
    const foldFill = svgPaths[1]?.getAttribute('fill');
    const mainPath = svgPaths[0]?.getAttribute('d') ?? '';
    const foldPath = svgPaths[1]?.getAttribute('d') ?? '';
    const creasePath = svgPaths[2]?.getAttribute('d') ?? '';
    expect(extractPathNumbers(mainPath)).toEqual(
      [
        0, 0, 419.9475065616798, 0, 419.9475065616798, 211.65354330708664, 337.6377952755906,
        293.96325459317586, 0, 293.96325459317586,
      ].map((n) => expect.closeTo(n, 10)),
    );
    expect(extractPathNumbers(foldPath)).toEqual(
      [
        337.6377952755906, 293.96325459317586, 337.6377952755906, 211.65354330708664,
        419.9475065616798, 211.65354330708664,
      ].map((n) => expect.closeTo(n, 10)),
    );
    expect(extractPathNumbers(creasePath)).toEqual(
      [337.6377952755906, 293.96325459317586, 337.6377952755906, 211.65354330708664].map((n) =>
        expect.closeTo(n, 10),
      ),
    );
    expect(mainFill).toBeTruthy();
    expect(foldFill).toBeTruthy();
    expect(foldFill).not.toBe(mainFill);
    expect(svgPaths[1]?.getAttribute('stroke')).toBe('none');
    expect(svgPaths[2]?.getAttribute('fill')).toBe('none');
    expect(svgPaths[2]?.getAttribute('stroke')).not.toBe('none');
  });

  it('keeps foldedCorner fold-face on a darkened gradient when main fill is theme gradient', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="211" name="FoldedCornerTheme"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2800000"/></a:xfrm>
          <a:prstGeom prst="foldedCorner"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        colorScheme: new Map([['accent1', '4F81BD']]),
        fillStyles: [
          parseXml(
            `<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="phClr"/></a:solidFill>`,
          ),
          parseXml(`
            <a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rotWithShape="1">
              <a:gsLst>
                <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/></a:schemeClr></a:gs>
                <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="100000"/></a:schemeClr></a:gs>
              </a:gsLst>
              <a:lin ang="16200000" scaled="0"/>
            </a:gradFill>
          `),
          parseXml(`
            <a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" rotWithShape="1">
              <a:gsLst>
                <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/></a:schemeClr></a:gs>
                <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="100000"/></a:schemeClr></a:gs>
              </a:gsLst>
              <a:lin ang="16200000" scaled="0"/>
            </a:gradFill>
          `),
        ],
      },
    });
    const el = renderShape(shapeNode, ctx);
    const svgPaths = Array.from(el.querySelectorAll('svg > path'));
    const foldFill = svgPaths[1]?.getAttribute('fill') || '';
    expect(foldFill.startsWith('url(#')).toBe(true);
  });

  it('renders multi-path action button with darkened sub-paths', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="207" name="ActionButtonForward"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm>
          <a:prstGeom prst="actionButtonForward"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    // Action buttons are multi-path presets; should have paths rendered
    const paths = el.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
    // At least one path should exist
    expect(paths[0]).toBeTruthy();
  });

  it('handles shape with custom geometry', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="208" name="CustomGeom"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:custGeom>
            <a:avLst/>
            <a:gdLst/>
            <a:ahLst/>
            <a:cxnSpLst/>
            <a:pathLst>
              <a:path w="100" h="100">
                <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                <a:lnTo><a:pt x="100" y="0"/></a:lnTo>
                <a:lnTo><a:pt x="100" y="100"/></a:lnTo>
                <a:lnTo><a:pt x="0" y="100"/></a:lnTo>
                <a:close/>
              </a:path>
            </a:pathLst>
          </a:custGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toContain('M');
  });

  it('renders shape with pattern fill as solid fallback', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="209" name="PatternFill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:pattFill prst="ltDnDiag">
            <a:fgClr><a:srgbClr val="000000"/></a:fgClr>
            <a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr>
          </a:pattFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    // Pattern fill should fall back gracefully (fills as none or with style)
    expect(el).toBeTruthy();
  });

  it('renders cross pattFill as a shape-clipped SVG pattern with Office grid cadence', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="209" name="PatternCross"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3556000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:pattFill prst="cross">
            <a:fgClr><a:srgbClr val="000000"/></a:fgClr>
            <a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr>
          </a:pattFill>
          <a:ln w="25400">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:prstDash val="dashDot"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());

    const pattern = el.querySelector('pattern');
    const path = el.querySelector('path');
    const patternLines = pattern?.querySelectorAll('line') ?? [];

    expect(pattern).toBeTruthy();
    expect(parseFloat(pattern?.getAttribute('width') ?? '0')).toBeCloseTo(8, 2);
    expect(parseFloat(pattern?.getAttribute('height') ?? '0')).toBeCloseTo(8, 2);
    expect(pattern?.getAttribute('y')).toBe('-3');
    expect(pattern?.querySelector('rect')?.getAttribute('fill')).toMatch(/[Ff]{6}/);
    expect(patternLines.length).toBe(2);
    expect(path?.getAttribute('fill')).toBe(`url(#${pattern?.getAttribute('id')})`);
    expect(path?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(el.style.background).toBe('');
  });

  it('renders connector shape (cxnSp) as straightConnector1', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="210" name="Curved Connector 1"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1500000"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:cxnSp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).not.toBe('none');
  });

  it('renders line shape with zero height as line', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="211" name="ZeroHeight"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(el.style.height).toBe('1px'); // Should have minimum height
  });

  it('renders near-zero height connectors with a visible SVG viewport (ai-computing slide 40 title mask)', () => {
    const xml = `
      <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvCxnSpPr>
          <p:cNvPr id="39" name="Straight Connector 8"/>
          <p:cNvCxnSpPr/>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm flipV="1">
            <a:off x="745122" y="2283149"/>
            <a:ext cx="1235118" cy="1"/>
          </a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="28575" cap="flat">
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          </a:ln>
        </p:spPr>
      </p:cxnSp>
    `;
    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const svg = el.querySelector('svg');
    const path = el.querySelector('path');

    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('height')).toBe('1');
    expect(el.style.height).toBe('1px');
    expect(path?.getAttribute('stroke')).toBe('#FFFFFF');
    expect(path?.getAttribute('stroke-width')).toBe('3');
  });

  it('renders shape with transparent fill', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="212" name="Transparent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('none');
  });

  it('renders square arrowhead marker', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="213" name="Square"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:headEnd type="square" w="med" len="med"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    // Square arrowheads are not explicitly handled, so should fall back gracefully
    expect(el).toBeTruthy();
  });

  it('renders closed arrowhead marker', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="214" name="Closed"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:tailEnd type="closed" w="med" len="med"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    // Closed arrowheads are not explicitly handled, should fall back gracefully
    expect(el).toBeTruthy();
  });

  it('renders shape with miter line join', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="215" name="Miter"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          <a:ln w="25400">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:miter/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path?.getAttribute('stroke-linejoin')).toBe('miter');
  });

  it('renders shape with bevel line join', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="216" name="Bevel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          <a:ln w="25400">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:bevel/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path?.getAttribute('stroke-linejoin')).toBe('bevel');
  });

  it('renders shape with square line cap', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="217" name="SquareCap"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="25400" cap="sq">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path?.getAttribute('stroke-linecap')).toBe('square');
  });

  it('renders shape with butt line cap', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="218" name="ButtCap"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="25400" cap="flat">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path?.getAttribute('stroke-linecap')).toBe('butt');
  });

  it('renders small arrowhead when w=sm and len=sm', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="219" name="SmallArrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:tailEnd type="triangle" w="sm" len="sm"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const marker = el.querySelector('marker');
    expect(marker).toBeTruthy();
    const width = Number.parseFloat(marker?.getAttribute('markerWidth') ?? '0');
    expect(width).toBeGreaterThan(0);
  });

  it('renders large arrowhead when w=lg and len=lg', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="220" name="LargeArrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="0"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="38100">
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            <a:headEnd type="triangle" w="lg" len="lg"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const marker = el.querySelector('marker');
    expect(marker).toBeTruthy();
    const width = Number.parseFloat(marker?.getAttribute('markerWidth') ?? '0');
    expect(width).toBeGreaterThan(0);
  });

  it('renders arc shape as outline only (no fill)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="221" name="Arc"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="arc"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const path = el.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).not.toBe('none');
  });

  it('renders text-only shape without visible text as no-fill', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="222" name="EmptyText"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    expect(el).toBeTruthy();
    const path = el.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('none');
  });

  // ---- Shape-level hyperlink / action button navigation ----

  it('hlinkClick with ppaction://hlinksldjump registers click handler and sets pointer cursor', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="300" name="SlideJump">
            <a:hlinkClick r:id="rId5" action="ppaction://hlinksldjump"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([['rId5', { type: 'slide', target: 'slide28.xml' }]]),
      },
      onNavigate: (target) => navigateCalls.push(target),
    });

    const el = renderShape(shapeNode, ctx);

    expect(el.style.cursor).toBe('pointer');
    // Simulate click and verify onNavigate fires with 0-based slide index 27
    el.click();
    expect(navigateCalls.length).toBe(1);
    expect(navigateCalls[0].slideIndex).toBe(27);
  });

  it('hlinkClick slide jumps follow presentation order instead of slide file numbers', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="300" name="SlideJumpOutOfOrder">
            <a:hlinkClick r:id="rId5" action="ppaction://hlinksldjump"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
    const ctx = createMockRenderContext();
    ctx.slide.slidePath = 'ppt/slides/slide5.xml';
    ctx.slide.rels.set('rId5', { type: 'slide', target: 'slide9.xml' });
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
      { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide9.xml', rels: new Map() },
    ];
    ctx.onNavigate = (target) => navigateCalls.push(target);

    const el = renderShape(shapeNode, ctx);

    expect(el.style.cursor).toBe('pointer');
    expect(el.title).toBe('Go to slide 3');
    el.click();
    expect(navigateCalls).toEqual([{ slideIndex: 2 }]);
  });

  it('hlinkClick hlinkshowjump nextslide navigates without a relationship id', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="300" name="NextSlideAction">
            <a:hlinkClick action="ppaction://hlinkshowjump?jump=nextslide"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="actionButtonForwardNext"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
    const ctx = createMockRenderContext();
    ctx.slide.index = 1;
    ctx.presentation.slides = [
      { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
      ctx.slide,
      { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide3.xml', rels: new Map() },
    ];
    ctx.onNavigate = (target) => navigateCalls.push(target);

    const el = renderShape(shapeNode, ctx);

    expect(el.style.cursor).toBe('pointer');
    expect(el.title).toBe('Go to slide 3');
    el.click();
    expect(navigateCalls).toEqual([{ slideIndex: 2 }]);
  });

  it('hlinkClick ppaction://hlinksldjump uses tooltip as title when provided', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="301" name="SlideJumpTooltip">
            <a:hlinkClick r:id="rId6" action="ppaction://hlinksldjump" tooltip="Go to summary"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([['rId6', { type: 'slide', target: 'slide5.xml' }]]),
      },
      onNavigate: () => {},
    });

    const el = renderShape(shapeNode, ctx);

    expect(el.title).toBe('Go to summary');
  });

  it('hlinkClick ppaction://hlinksldjump falls back to "Go to slide N" title when no tooltip', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="302" name="SlideJumpNoTooltip">
            <a:hlinkClick r:id="rId7" action="ppaction://hlinksldjump"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([['rId7', { type: 'slide', target: 'slide10.xml' }]]),
      },
      onNavigate: () => {},
    });

    const el = renderShape(shapeNode, ctx);

    expect(el.title).toBe('Go to slide 10');
  });

  it('hlinkClick ppaction://hlinksldjump is a no-op when onNavigate is not set', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="303" name="SlideJumpNoHandler">
            <a:hlinkClick r:id="rId8" action="ppaction://hlinksldjump"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // No onNavigate in context — shape should render without error, no click handler
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([['rId8', { type: 'slide', target: 'slide3.xml' }]]),
      },
    });

    const el = renderShape(shapeNode, ctx);

    // No pointer cursor since no onNavigate present
    expect(el.style.cursor).not.toBe('pointer');
  });

  it('hlinkClick with external URL registers click handler and uses URL as title', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="304" name="ExternalLink">
            <a:hlinkClick r:id="rId9"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([
          ['rId9', { type: 'hyperlink', target: 'https://example.com', targetMode: 'External' }],
        ]),
      },
      onNavigate: (target) => navigateCalls.push(target),
    });

    const el = renderShape(shapeNode, ctx);

    expect(el.style.cursor).toBe('pointer');
    expect(el.title).toBe('https://example.com');
    el.click();
    expect(navigateCalls.length).toBe(1);
    expect(navigateCalls[0].url).toBe('https://example.com');
  });

  it('hlinkClick with external URL uses tooltip as title when provided', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="305" name="ExternalLinkTooltip">
            <a:hlinkClick r:id="rId10" tooltip="Visit website"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([
          ['rId10', { type: 'hyperlink', target: 'https://example.com', targetMode: 'External' }],
        ]),
      },
      onNavigate: () => {},
    });

    const el = renderShape(shapeNode, ctx);

    expect(el.title).toBe('Visit website');
  });

  it('hlinkClick with disallowed URL protocol (javascript:) does not register click handler', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="306" name="DisallowedUrl">
            <a:hlinkClick r:id="rId11"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
    const ctx = createMockRenderContext({
      slide: {
        ...createMockRenderContext().slide,
        rels: new Map([
          ['rId11', { type: 'hyperlink', target: 'javascript:alert(1)', targetMode: 'External' }],
        ]),
      },
      onNavigate: (target) => navigateCalls.push(target),
    });

    const el = renderShape(shapeNode, ctx);

    // Should not set pointer cursor; click must not call onNavigate
    expect(el.style.cursor).not.toBe('pointer');
    el.click();
    expect(navigateCalls.length).toBe(0);
  });

  it('hlinkClick with missing relationship rId does not crash or set cursor', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="307" name="MissingRel">
            <a:hlinkClick r:id="rId_missing" action="ppaction://hlinksldjump"/>
          </p:cNvPr>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext({
      onNavigate: () => {},
    });

    // Must not throw; rels map does not contain rId_missing
    const el = renderShape(shapeNode, ctx);
    expect(el).toBeTruthy();
    expect(el.style.cursor).not.toBe('pointer');
  });

  // ---- normAutofit: fontScale sizing + dynamic measurement branch ----

  it('normAutofit with explicit fontScale scales text fonts without a static container transform', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="400" name="NormAutofit"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:normAutofit fontScale="60000" lnSpcReduction="10000"/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:rPr sz="2000"/><a:t>Shrink this text to fit the shape box.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());

    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;

    expect(textContainer).toBeTruthy();
    const span = textContainer?.querySelector('span') as HTMLSpanElement | undefined;
    expect(span?.style.fontSize).toBe('12pt');
    expect(textContainer?.style.transform ?? '').not.toContain('scale(');
    expect(textContainer?.style.width).toBe('100%');
    expect(textContainer?.style.height).toBe('100%');
    // Line spacing reduction should be applied
    expect(textContainer?.style.lineHeight).toBeTruthy();
    // Text should be clipped at container boundary
    expect(textContainer?.style.overflowY).toBe('hidden');
  });

  it('normAutofit with fontScale=100000 (no shrink needed) does not apply scale transform', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="401" name="NormAutofitFull"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:normAutofit fontScale="100000"/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:t>Text fits exactly.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());

    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;

    expect(textContainer).toBeTruthy();
    // fontScale=100000 means full size — no scale transform should be applied
    expect(textContainer?.style.transform ?? '').not.toContain('scale(');
    // Still clipped
    expect(textContainer?.style.overflowY).toBe('hidden');
  });

  it('normAutofit without fontScale attribute triggers dynamic scaling path (wrapper inserted into DOM)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="402" name="NormAutofitDynamic"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:t>Dynamic fit needed.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // Must not throw — dynamic path appends/removes wrapper from document.body
    const el = renderShape(shapeNode, createMockRenderContext());
    expect(el).toBeTruthy();
    // Wrapper must have been detached (not remain in body) after rendering
    expect(document.body.contains(el)).toBe(false);
    // Text container should be present
    const textContainer = Array.from(el.querySelectorAll('div')).find(
      (d) => (d as HTMLDivElement).style.flexDirection === 'column',
    ) as HTMLDivElement | undefined;
    expect(textContainer).toBeTruthy();
    // Visibility must be restored (not left hidden)
    expect(el.style.visibility).not.toBe('hidden');
  });

  // ---- Reflection effect: additional edge cases ----

  it('reflection with default stA and endA values produces valid gradient', () => {
    // stA and endA omitted → defaults: stA=50000, endA=0
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="500" name="ReflectionDefaults"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill>
          <a:effectLst>
            <a:reflection dist="114300"/>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const reflect =
      el.style.getPropertyValue('-webkit-box-reflect') || (el.style as any).webkitBoxReflect || '';
    // Default stA=0.5, endA=0 → gradient goes from rgba(255,255,255,0.500) to rgba(255,255,255,0.000)
    expect(reflect).toContain('0.500');
    expect(reflect).toContain('0.000');
    expect(reflect).toContain('below');
  });

  it('reflection with zero dist produces "below 0.0px" in reflect value', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="501" name="ReflectionZeroDist"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill>
          <a:effectLst>
            <a:reflection stA="30000" endA="0" dist="0"/>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const reflect =
      el.style.getPropertyValue('-webkit-box-reflect') || (el.style as any).webkitBoxReflect || '';
    expect(reflect).toContain('below 0.0px');
  });

  // ---- effectRef: boundary and skip cases ----

  it('effectRef with idx=0 does not apply any theme effect (idx=0 means no effect)', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="600" name="EffectRefZero"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill>
        </p:spPr>
        <p:style><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef></p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const effectStyleXml = parseXml(`
      <a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:effectLst>
          <a:outerShdw blurRad="152400" dist="76200" dir="5400000">
            <a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr>
          </a:outerShdw>
        </a:effectLst>
      </a:effectStyle>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        effectStyles: [effectStyleXml],
      },
    });

    const el = renderShape(shapeNode, ctx);
    // idx=0 must be treated as "no effect" — shadow should NOT be applied
    expect(el.style.boxShadow).toBeFalsy();
    expect(el.style.filter).toBeFalsy();
  });

  it('effectRef with idx exceeding effectStyles length does not crash and applies no shadow', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="601" name="EffectRefOutOfBounds"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill>
        </p:spPr>
        <p:style><a:effectRef idx="5"><a:schemeClr val="accent1"/></a:effectRef></p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // effectStyles has only 1 entry, but idx=5 — must not crash
    const effectStyleXml = parseXml(`
      <a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:effectLst>
          <a:outerShdw blurRad="152400" dist="76200" dir="5400000">
            <a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr>
          </a:outerShdw>
        </a:effectLst>
      </a:effectStyle>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        effectStyles: [effectStyleXml],
      },
    });

    const el = renderShape(shapeNode, ctx);
    expect(el).toBeTruthy();
    // Out-of-bounds idx silently produces no shadow
    expect(el.style.boxShadow).toBeFalsy();
    expect(el.style.filter).toBeFalsy();
  });

  it('effectRef fallback is skipped when shape already has explicit effectLst', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="602" name="ExplicitEffectLst"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="3366FF"/></a:solidFill>
          <a:effectLst>
            <a:outerShdw blurRad="50000" dist="38100" dir="2700000">
              <a:srgbClr val="FF0000"><a:alpha val="80000"/></a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </p:spPr>
        <p:style><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef></p:style>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // Theme effectStyle has a dark shadow; explicit effectLst has a red shadow
    // The explicit one should win — theme effectRef is ignored when effectLst is present
    const themeEffectXml = parseXml(`
      <a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:effectLst>
          <a:outerShdw blurRad="152400" dist="76200" dir="5400000">
            <a:srgbClr val="000000"><a:alpha val="60000"/></a:srgbClr>
          </a:outerShdw>
        </a:effectLst>
      </a:effectStyle>
    `);
    const ctx = createMockRenderContext({
      theme: {
        ...createMockRenderContext().theme,
        effectStyles: [themeEffectXml],
      },
    });

    const el = renderShape(shapeNode, ctx);
    // A shadow must be applied (from the explicit effectLst)
    expect(el.style.boxShadow || el.style.filter || el.querySelector('path[filter]')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // fontRef color resolution from shape style (SmartArt text)
  // Covers lines ~1100-1129 in ShapeRenderer.ts
  // ---------------------------------------------------------------------------

  it('resolves fontRef scheme color from p:style for SmartArt-like text', () => {
    // Shape with <p:style> containing <a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef>
    // The resolver should pick up dk1 → #000000 and pass it as fontRefColor to text rendering.
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="100" name="SmartArt Shape"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        </p:spPr>
        <p:style>
          <a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr lang="en-US" dirty="0"/><a:t>Hello</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    const el = renderShape(shapeNode, ctx);

    // The text container should exist and contain the rendered text
    const textDiv = el.querySelector('div[style*="display"]');
    expect(textDiv).toBeTruthy();

    // The text content should be rendered
    expect(el.textContent).toContain('Hello');

    // The fontRef resolved dk1 → colorMap tx1→dk1 → theme dk1 = #000000.
    // Check that a span exists with the expected color.
    const spans = el.querySelectorAll('span');
    const hasBlackText = Array.from(spans).some((span) => {
      const color = span.style.color;
      return color === '#000000' || color === 'rgb(0, 0, 0)' || color === '#000';
    });
    expect(hasBlackText).toBe(true);
  });

  it('resolves fontRef with accent scheme color for SmartArt text', () => {
    // fontRef pointing to lt1 (white) — common for SmartArt shapes with dark fills
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="101" name="SmartArt Dark"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="333333"/></a:solidFill>
        </p:spPr>
        <p:style>
          <a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef>
          <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr lang="en-US" dirty="0"/><a:t>White Text</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();
    const el = renderShape(shapeNode, ctx);

    expect(el.textContent).toContain('White Text');
    // lt1 → colorMap bg1→lt1 → theme lt1 = #FFFFFF
    const spans = el.querySelectorAll('span');
    const hasWhiteText = Array.from(spans).some((span) => {
      const color = span.style.color;
      return color === '#FFFFFF' || color === '#ffffff' || color === 'rgb(255, 255, 255)';
    });
    expect(hasWhiteText).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Dynamic normAutofit scaling (lines ~1142-1162 in ShapeRenderer.ts)
  // In jsdom, scrollHeight often equals clientHeight, so the scale branch may not
  // trigger. Test that the code path completes without error.
  // ---------------------------------------------------------------------------

  it('handles dynamic normAutofit when fontScale is absent (no crash)', () => {
    // normAutofit without fontScale attribute triggers dynamic measurement.
    // In jsdom, scrollHeight == clientHeight, so the scale transform won't apply,
    // but the code must not throw.
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="200" name="AutofitShape"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr>
            <a:normAutofit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr lang="en-US"/><a:t>Dynamic autofit text content that may overflow</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();

    // Should not throw
    const el = renderShape(shapeNode, ctx);
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Dynamic autofit text content');
  });

  it('handles spAutoFit dynamic scaling without crash', () => {
    // spAutoFit (without normAutofit) also triggers dynamic measurement path
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="201" name="SpAutoFitShape"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr>
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr lang="en-US"/><a:t>Shape auto fit text</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const ctx = createMockRenderContext();

    const el = renderShape(shapeNode, ctx);
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Shape auto fit text');
  });

  it('applies anchor="b" from layoutBodyProperties when shape bodyPr has no anchor', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="5" name="Title 4"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="751922" y="1524000"/>
            <a:ext cx="11035967" cy="3273368"/>
          </a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="zh-CN" sz="6600"/><a:t>示例服务</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    // Set layout bodyPr with anchor="b" (as the truescale layout does)
    shapeNode.textBody!.layoutBodyProperties = parseXml(
      '<bodyPr lIns="0" tIns="0" rIns="121899" bIns="0" anchor="b" anchorCtr="0"/>',
    );
    const ctx = createMockRenderContext();
    const el = renderShape(shapeNode, ctx);

    // The text container div should have justify-content: flex-end (anchor=b)
    const textContainer = el.querySelector('div[style*="flex"]') as HTMLElement;
    expect(textContainer, 'text container should exist').not.toBeNull();
    expect(textContainer.style.justifyContent).toBe('flex-end');
  });

  it('callout1 main path (rectangle) has stroke=none when multiPath[0].stroke is false (oracle 0113-0120)', () => {
    // callout1/2/3 and accentCallout1/2/3 define their rect body with stroke:false
    // and leader line as a separate sub-path with stroke:true.
    // The main <path> element should NOT inherit the shape's line stroke.
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="10" name="Callout 1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="1000000" y="500000"/>
            <a:ext cx="3000000" cy="2000000"/>
          </a:xfrm>
          <a:prstGeom prst="callout1"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
          <a:ln w="12700">
            <a:solidFill><a:srgbClr val="2F5597"/></a:solidFill>
          </a:ln>
        </p:spPr>
      </p:sp>
    `;
    const shapeNode = parseShapeNode(parseXml(xml));
    const el = renderShape(shapeNode, createMockRenderContext());
    const svg = el.querySelector('svg');
    expect(svg).toBeTruthy();

    const paths = svg!.querySelectorAll('path');
    // First path = rectangle body (multiPaths[0], stroke: false)
    // Second path = leader line (multiPaths[1], stroke: true)
    expect(paths.length).toBeGreaterThanOrEqual(2);

    // Main path (rectangle) should have stroke=none because multiPaths[0].stroke is false
    const mainPath = paths[0];
    expect(mainPath.getAttribute('stroke')).toBe('none');

    // Leader line path should have stroke applied
    const leaderPath = paths[1];
    expect(leaderPath.getAttribute('stroke')).not.toBe('none');
  });

  it.each([
    ['pct5', 'circle', null],
    ['pct10', 'circle', null],
    ['pct20', 'circle', null],
    ['pct25', 'circle', null],
    ['pct30', 'circle', null],
    ['pct40', 'circle', null],
    ['pct50', 'circle', null],
    ['pct70', 'circle', null],
    ['pct75', 'circle', null],
    ['pct80', 'circle', null],
    ['pct90', 'circle', null],
    ['sphere', 'circle', null],
    ['shingle', 'circle', null],
    ['plaid', 'circle', null],
    ['divot', 'circle', null],
    ['zigZag', 'circle', null],
    ['horz', 'line', null],
    ['ltHorz', 'line', null],
    ['narHorz', 'line', null],
    ['dkHorz', 'line', null],
    ['vert', 'line', null],
    ['ltVert', 'line', null],
    ['narVert', 'line', null],
    ['dkVert', 'line', null],
    ['dnDiag', 'line', null],
    ['narDnDiag', 'line', null],
    ['dkDnDiag', 'line', null],
    ['wdDnDiag', 'line', null],
    ['upDiag', 'line', null],
    ['ltUpDiag', 'line', null],
    ['narUpDiag', 'line', null],
    ['dkUpDiag', 'line', null],
    ['wdUpDiag', 'line', null],
    ['smGrid', 'line', '-3'],
    ['lgGrid', 'line', '-3'],
    ['diagCross', 'line', null],
    ['smCheck', 'line', null],
    ['lgCheck', 'line', null],
    ['openDmnd', 'line', null],
    ['trellis', 'line', null],
    ['weave', 'line', null],
    ['dashHorz', 'line', null],
    ['dashVert', 'line', null],
    ['dashDnDiag', 'line', null],
    ['dashUpDiag', 'line', null],
  ])('renders OOXML pattern fill preset %s as an SVG pattern', (preset, expectedNode, y) => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="20" name="Pattern ${preset}"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:pattFill prst="${preset}">
            <a:fgClr><a:srgbClr val="112233"/></a:fgClr>
            <a:bgClr><a:srgbClr val="DDEEFF"/></a:bgClr>
          </a:pattFill>
        </p:spPr>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const path = el.querySelector('svg > path')!;
    const pattern = el.querySelector('defs pattern')!;

    expect(path.getAttribute('fill')).toMatch(/^url\(#shape-pattern-/);
    expect(pattern).toBeTruthy();
    expect(pattern.querySelector('rect')?.getAttribute('fill')).toBe('#DDEEFF');
    expect(pattern.querySelector(expectedNode)).toBeTruthy();
    expect(pattern.getAttribute('y')).toBe(y);

    const dashedLine = pattern.querySelector('line[stroke-dasharray]');
    if (preset.startsWith('dash')) {
      expect(dashedLine).toBeTruthy();
    } else {
      expect(dashedLine).toBeNull();
    }
  });

  it.each(['solid', 'solidDmnd', 'unknownPattern'])(
    'falls back to solid fill when pattern preset %s has no foreground pattern',
    (preset) => {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="21" name="Pattern fallback ${preset}"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>
            <a:pattFill prst="${preset}"/>
          </p:spPr>
        </p:sp>
      `;

      const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      const path = el.querySelector('svg > path')!;

      expect(el.querySelector('defs pattern')).toBeNull();
      expect(path.getAttribute('fill')).toBe('#ABCDEF');
    },
  );

  it.each([
    ['textArchDown', /Q50,72 96,28\.79/],
    ['textArchUp', /Q50,6.4 96,52.8/],
  ])('renders supported text warp preset %s as an SVG textPath', (preset, pathMatcher) => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="22" name="Warped text"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr>
            <a:prstTxWarp prst="${preset}"/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="zh-CN" b="1" sz="2800">
                <a:latin typeface="+mj-lt"/>
                <a:ea typeface="微软雅黑"/>
                <a:solidFill><a:srgbClr val="CC3300"/></a:solidFill>
              </a:rPr>
              <a:t>曲线文字</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
    const textPath = el.querySelector('svg textPath')!;
    const text = textPath.closest('text')!;
    const warpPath = el.querySelector('svg defs path')!;

    expect(textPath.textContent).toBe('曲线文字');
    expect(textPath.getAttribute('startOffset')).toBe('50%');
    expect(text.getAttribute('font-size')).toBe('28pt');
    expect(text.getAttribute('font-weight')).toBe('bold');
    expect(text.getAttribute('fill')).toBe('#CC3300');
    expect(text.getAttribute('font-family')).toContain('微软雅黑');
    expect(warpPath.getAttribute('d')).toMatch(pathMatcher);
  });

  it('falls back to normal text rendering when text warp has multiple visible paragraphs', () => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="23" name="Multi paragraph warp"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr><a:prstTxWarp prst="textArchDown"/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:t>第一行</a:t></a:r></a:p>
          <a:p><a:r><a:t>第二行</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `;

    const el = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());

    expect(el.querySelector('textPath')).toBeNull();
    expect(el.textContent).toContain('第一行');
    expect(el.textContent).toContain('第二行');
  });

  it.each([
    ['r:embed="rIdImage"', 'local blob', /^blob:/, 'none'],
    ['r:link="rIdAllowed"', 'allowed external URL', /^https:\/\/example.com\/image.png$/, 'xMidYMid slice'],
    ['r:embed="rIdStretchNoRect"', 'stretch without fillRect', /^blob:/, 'none'],
  ])('renders shape blipFill from %s as an SVG image', (relAttr, _label, hrefMatcher, preserve) => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="24" name="Blip fill"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill>
            <a:blip ${relAttr}/>
            ${relAttr.includes('rIdStretchNoRect') ? '<a:stretch/>' : ''}
            ${
              preserve === 'none' && !relAttr.includes('rIdStretchNoRect')
                ? '<a:stretch><a:fillRect l="10000" t="20000" r="30000" b="40000"/></a:stretch>'
                : ''
            }
          </a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rIdImage', {
      type: 'image',
      target: '../media/image1.png',
    });
    ctx.slide.rels.set('rIdAllowed', {
      type: 'image',
      target: 'https://example.com/image.png',
      targetMode: 'External',
    });
    ctx.slide.rels.set('rIdStretchNoRect', {
      type: 'image',
      target: '../media/image1.png',
    });
    ctx.presentation.media.set('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71]));

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);
    const image = el.querySelector('svg image')!;

    expect(image.getAttribute('href')).toMatch(hrefMatcher);
    expect(image.getAttribute('preserveAspectRatio')).toBe(preserve);
    if (preserve === 'none') {
      if (relAttr.includes('rIdStretchNoRect')) {
        expect(Number(image.getAttribute('x'))).toBe(0);
        expect(Number(image.getAttribute('y'))).toBe(0);
        expect(Number(image.getAttribute('width'))).toBeCloseTo(192);
        expect(Number(image.getAttribute('height'))).toBeCloseTo(96);
      } else {
        expect(Number(image.getAttribute('x'))).toBeCloseTo(19.2);
        expect(Number(image.getAttribute('y'))).toBeCloseTo(19.2);
        expect(Number(image.getAttribute('width'))).toBeCloseTo(115.2);
        expect(Number(image.getAttribute('height'))).toBeCloseTo(38.4);
      }
    }
  });

  it.each([
    ['missing rel', 'r:embed="rIdMissing"'],
    ['missing package media', 'r:embed="rIdMissingMedia"'],
    ['blocked external URL', 'r:link="rIdBlocked"'],
    ['missing rel id', ''],
  ])('skips shape blipFill image when the media reference is %s', (_label, relAttr) => {
    const xml = `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:nvSpPr>
          <p:cNvPr id="25" name="Missing blip fill"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill><a:blip ${relAttr}/></a:blipFill>
        </p:spPr>
      </p:sp>
    `;
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rIdBlocked', {
      type: 'image',
      target: 'ftp://example.com/image.png',
      targetMode: 'External',
    });
    ctx.slide.rels.set('rIdMissingMedia', {
      type: 'image',
      target: '../media/missing.png',
    });

    const el = renderShape(parseShapeNode(parseXml(xml)), ctx);

    expect(el.querySelector('svg image')).toBeNull();
  });
});
