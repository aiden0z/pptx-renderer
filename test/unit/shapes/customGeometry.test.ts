import { describe, it, expect } from 'vitest';
import { renderCustomGeometry } from '../../../src/shapes/customGeometry';
import { SafeXmlNode, parseXml } from '../../../src/parser/XmlParser';

function makeGeomNode(pathXml: string): SafeXmlNode {
  const xml = `<custGeom xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
    <pathLst>${pathXml}</pathLst>
  </custGeom>`;
  return parseXml(xml);
}

describe('renderCustomGeometry', () => {
  it('handles moveTo + lnTo (triangle)', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="50" y="0"/></moveTo>
        <lnTo><pt x="100" y="100"/></lnTo>
        <lnTo><pt x="0" y="100"/></lnTo>
        <close/>
      </path>
    `);
    const d = renderCustomGeometry(node, 200, 200);
    // w=100, h=100 target 200x200 => scale 2x
    expect(d).toContain('M100,0');
    expect(d).toContain('L200,200');
    expect(d).toContain('L0,200');
    expect(d).toContain('Z');
  });

  it('handles cubicBezTo', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="0" y="0"/></moveTo>
        <cubicBezTo>
          <pt x="33" y="0"/>
          <pt x="66" y="100"/>
          <pt x="100" y="100"/>
        </cubicBezTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M0,0');
    expect(d).toContain('C33,0 66,100 100,100');
  });

  it('handles arcTo', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="100" y="50"/></moveTo>
        <arcTo wR="50" hR="50" stAng="0" swAng="5400000"/>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M100,50');
    expect(d).toContain('A');
    expect(d).not.toContain('NaN');
  });

  it('applies coordinate scaling', () => {
    const node = makeGeomNode(`
      <path w="50" h="50">
        <moveTo><pt x="0" y="0"/></moveTo>
        <lnTo><pt x="50" y="50"/></lnTo>
      </path>
    `);
    // Scale 50->200 = 4x
    const d = renderCustomGeometry(node, 200, 200);
    expect(d).toContain('M0,0');
    expect(d).toContain('L200,200');
  });

  it('does not implicitly close open paths without <close/>', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="0" y="100"/></moveTo>
        <cubicBezTo>
          <pt x="25" y="100"/>
          <pt x="50" y="50"/>
          <pt x="70" y="40"/>
        </cubicBezTo>
        <cubicBezTo>
          <pt x="80" y="30"/>
          <pt x="90" y="15"/>
          <pt x="100" y="0"/>
        </cubicBezTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M0,100');
    expect(d).toContain('C25,100 50,50 70,40');
    expect(d).toContain('C80,30 90,15 100,0');
    expect(d).not.toContain('Z');
  });

  it('scales paths without explicit w/h using inferred extent (SmartArt EMU coordinates)', () => {
    const node = makeGeomNode(`
      <path>
        <moveTo><pt x="0" y="0"/></moveTo>
        <lnTo><pt x="0" y="1342408"/></lnTo>
        <lnTo><pt x="1993023" y="1342408"/></lnTo>
        <lnTo><pt x="1993023" y="1515356"/></lnTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 200, 100);
    // Before fix this produced million-scale coordinates and disappeared from SVG viewport.
    expect(d).toContain('M0,0');
    expect(d).toMatch(/L0,88\.\d+/);
    expect(d).toMatch(/L200,88\.\d+/);
    expect(d).toContain('L200,100');
  });

  it('uses source extent when path has no w/h so center lines stay centered', () => {
    const node = makeGeomNode(`
      <path>
        <moveTo><pt x="45720" y="0"/></moveTo>
        <lnTo><pt x="45720" y="1515356"/></lnTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 20, 100, { w: 91440, h: 1515356 });
    expect(d).toContain('M10,0');
    expect(d).toContain('L10,100');
  });

  it('returns empty for missing pathLst', () => {
    const node = parseXml('<custGeom xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toBe('');
  });

  it('handles quadBezTo command', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="0" y="0"/></moveTo>
        <quadBezTo>
          <pt x="50" y="100"/>
          <pt x="100" y="0"/>
        </quadBezTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 200, 200);
    expect(d).toContain('M0,0');
    expect(d).toContain('Q100,200 200,0');
  });

  it('skips quadBezTo with fewer than 2 control points', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="0" y="0"/></moveTo>
        <quadBezTo>
          <pt x="50" y="100"/>
        </quadBezTo>
        <lnTo><pt x="100" y="100"/></lnTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M0,0');
    expect(d).not.toContain('Q');
    expect(d).toContain('L100,100');
  });

  it('skips degenerate arcTo with zero radii', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="50" y="50"/></moveTo>
        <arcTo wR="0" hR="0" stAng="0" swAng="5400000"/>
        <lnTo><pt x="100" y="100"/></lnTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M50,50');
    expect(d).not.toContain('A');
    expect(d).toContain('L100,100');
  });

  it('skips degenerate arcTo with zero sweep angle', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="100" y="50"/></moveTo>
        <arcTo wR="50" hR="50" stAng="0" swAng="0"/>
        <lnTo><pt x="100" y="100"/></lnTo>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).not.toContain('A');
    expect(d).toContain('L100,100');
  });

  it('silently skips unknown path commands', () => {
    const node = makeGeomNode(`
      <path w="100" h="100">
        <moveTo><pt x="0" y="0"/></moveTo>
        <unknownCommand foo="bar"/>
        <lnTo><pt x="100" y="100"/></lnTo>
        <close/>
      </path>
    `);
    const d = renderCustomGeometry(node, 100, 100);
    expect(d).toContain('M0,0');
    expect(d).toContain('L100,100');
    expect(d).toContain('Z');
    expect(d).not.toContain('unknown');
  });
});
