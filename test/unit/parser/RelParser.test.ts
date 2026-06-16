import { describe, expect, it } from 'vitest';
import { isExternalTargetMode, parseRels, resolveRelTarget } from '../../../src/parser/RelParser';

describe('parseRels', () => {
  it('parses TargetMode for external relationships', () => {
    const xml = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship
          Id="rId1"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
          Target="https://example.com"
          TargetMode="External"
        />
      </Relationships>
    `;

    const rels = parseRels(xml);
    expect(rels.get('rId1')).toEqual({
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: 'https://example.com',
      targetMode: 'External',
    });
  });

  it('parses multiple relationships', () => {
    const xml = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Type="layout" Target="../slideLayouts/slideLayout1.xml"/>
      </Relationships>
    `;
    const rels = parseRels(xml);
    expect(rels.size).toBe(2);
    expect(rels.get('rId1')!.target).toBe('slides/slide1.xml');
    expect(rels.get('rId2')!.target).toBe('../slideLayouts/slideLayout1.xml');
  });

  it('returns empty map for empty string', () => {
    expect(parseRels('').size).toBe(0);
  });

  it('skips relationships with missing Id', () => {
    const xml = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Type="slide" Target="slides/slide1.xml"/>
      </Relationships>
    `;
    expect(parseRels(xml).size).toBe(0);
  });

  it('handles relationship without TargetMode', () => {
    const xml = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
      </Relationships>
    `;
    const rel = parseRels(xml).get('rId1')!;
    expect(rel.targetMode).toBeUndefined();
  });

  it('treats TargetMode="External" case-insensitively after trimming whitespace', () => {
    expect(isExternalTargetMode(' External ')).toBe(true);
    expect(isExternalTargetMode('\texternal\n')).toBe(true);
  });
});

describe('resolveRelTarget', () => {
  it('resolves relative path', () => {
    expect(resolveRelTarget('ppt/slides', 'media/image1.png'))
      .toBe('ppt/slides/media/image1.png');
  });

  it('resolves .. in target path', () => {
    expect(resolveRelTarget('ppt/slides', '../slideLayouts/slideLayout1.xml'))
      .toBe('ppt/slideLayouts/slideLayout1.xml');
  });

  it('resolves absolute target (leading /)', () => {
    expect(resolveRelTarget('ppt/slides', '/ppt/media/image1.png'))
      .toBe('ppt/media/image1.png');
  });

  it('handles backslashes', () => {
    expect(resolveRelTarget('ppt\\slides', '..\\charts\\chart1.xml'))
      .toBe('ppt/charts/chart1.xml');
  });

  it('resolves . in target path', () => {
    expect(resolveRelTarget('ppt/slides', './media/image1.png'))
      .toBe('ppt/slides/media/image1.png');
  });

  it('handles simple relative target', () => {
    expect(resolveRelTarget('ppt', 'slides/slide1.xml'))
      .toBe('ppt/slides/slide1.xml');
  });

  it('ignores URI query and fragment suffixes for internal package targets', () => {
    expect(resolveRelTarget('ppt/slides', 'slide2.xml#section')).toBe('ppt/slides/slide2.xml');
    expect(resolveRelTarget('ppt/slides', 'slide2.xml?view=notes')).toBe('ppt/slides/slide2.xml');
  });

  it('decodes percent-encoded internal package target segments', () => {
    expect(resolveRelTarget('ppt/slides', '../slideLayouts/Product%20Intro%231.xml')).toBe(
      'ppt/slideLayouts/Product Intro#1.xml',
    );
  });

  it('preserves malformed percent-encoded target segments instead of throwing', () => {
    expect(resolveRelTarget('ppt/slides', '../media/bad%ZZname.png')).toBe(
      'ppt/media/bad%ZZname.png',
    );
    expect(resolveRelTarget('ppt/slides', '/ppt/media/bad%ZZname.png')).toBe(
      'ppt/media/bad%ZZname.png',
    );
  });
});
