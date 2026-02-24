import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  applyTint,
  applyShade,
  applyLumMod,
  applyLumOff,
  applySatMod,
  applyHueMod,
  applyHueOff,
  applySatOff,
  applyAlpha,
  applyColorModifiers,
  presetColorToHex,
} from '../../../src/utils/color';

describe('hexToRgb', () => {
  it('parses 6-digit hex without #', () => {
    expect(hexToRgb('FF8000')).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('parses 6-digit hex with #', () => {
    expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('parses 3-digit shorthand', () => {
    expect(hexToRgb('F00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('returns black for invalid input', () => {
    expect(hexToRgb('XYZ')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('rgbToHex', () => {
  it('converts basic colors', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('clamps values outside 0-255', () => {
    expect(rgbToHex(300, -10, 128)).toBe('#ff0080');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(127.6, 0, 0)).toBe('#800000');
  });
});

describe('rgbToHsl / hslToRgb roundtrip', () => {
  const testCases = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 255, b: 255 },
    { r: 0, g: 0, b: 0 },
    { r: 200, g: 100, b: 50 },
  ];

  for (const { r, g, b } of testCases) {
    it(`roundtrips rgb(${r},${g},${b})`, () => {
      const { h, s, l } = rgbToHsl(r, g, b);
      const back = hslToRgb(h, s, l);
      expect(back.r).toBeCloseTo(r, 0);
      expect(back.g).toBeCloseTo(g, 0);
      expect(back.b).toBeCloseTo(b, 0);
    });
  }

  it('handles achromatic (grey)', () => {
    const { s } = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
  });
});

describe('applyTint', () => {
  it('tint=100000 returns original color (OOXML: 100% input + 0% white)', () => {
    expect(applyTint('#000000', 100000)).toBe('#000000');
  });

  it('tint=0 returns white (OOXML: 0% input + 100% white)', () => {
    expect(applyTint('#000000', 0)).toBe('#ffffff');
  });

  it('tint=50000 is 50% input + 50% white in linear RGB space', () => {
    // In linear space: 0*0.5 + 1.0*0.5 = 0.5 → sRGB ≈ 188
    const result = applyTint('#000000', 50000);
    expect(hexToRgb(result)).toEqual({ r: 188, g: 188, b: 188 });
  });

  it('tint=40000 on colored input blends toward white in linear RGB', () => {
    // #4874CB (R72,G116,B203) at 40% tint in linear space
    const result = applyTint('#4874CB', 40000);
    const { r, g, b } = hexToRgb(result);
    expect(r).toBeCloseTo(207, 0);
    expect(g).toBeCloseTo(214, 0);
    expect(b).toBeCloseTo(236, 0);
  });
});

describe('applyShade', () => {
  it('shade=100000 returns original', () => {
    expect(applyShade('#ffffff', 100000)).toBe('#ffffff');
  });

  it('shade=0 returns black', () => {
    expect(applyShade('#ffffff', 0)).toBe('#000000');
  });

  it('shade=50000 darkens by half in linear RGB space', () => {
    // In linear space: 1.0*0.5 = 0.5 → sRGB ≈ 188
    const result = applyShade('#ffffff', 50000);
    expect(hexToRgb(result)).toEqual({ r: 188, g: 188, b: 188 });
  });
});

describe('applyLumMod', () => {
  it('lumMod=100000 preserves color', () => {
    const result = applyLumMod('#FF0000', 100000);
    expect(result).toBe(rgbToHex(255, 0, 0));
  });

  it('lumMod=50000 halves luminance', () => {
    const { r, g, b } = hexToRgb(applyLumMod('#808080', 50000));
    // Grey 50% luminance -> 25% luminance
    expect(r).toBeLessThan(128);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('applyLumOff', () => {
  it('positive offset lightens', () => {
    const original = hexToRgb('#808080');
    const result = hexToRgb(applyLumOff('#808080', 25000));
    expect(result.r).toBeGreaterThan(original.r);
  });

  it('negative offset darkens', () => {
    const original = hexToRgb('#808080');
    const result = hexToRgb(applyLumOff('#808080', -25000));
    expect(result.r).toBeLessThan(original.r);
  });
});

describe('applySatMod', () => {
  it('satMod=0 desaturates to grey', () => {
    const result = applySatMod('#FF0000', 0);
    const { r, g, b } = hexToRgb(result);
    // Desaturated red should be grey (all channels similar)
    expect(Math.abs(r - g)).toBeLessThan(2);
    expect(Math.abs(g - b)).toBeLessThan(2);
  });
});

describe('applyHueMod', () => {
  it('hueMod=100000 preserves hue', () => {
    const result = applyHueMod('#FF0000', 100000);
    expect(result).toBe(rgbToHex(255, 0, 0));
  });
});

describe('applyAlpha', () => {
  it('100000 => 1', () => expect(applyAlpha(100000)).toBe(1));
  it('0 => 0', () => expect(applyAlpha(0)).toBe(0));
  it('50000 => 0.5', () => expect(applyAlpha(50000)).toBe(0.5));
  it('clamps above 1', () => expect(applyAlpha(200000)).toBe(1));
});

describe('applyColorModifiers', () => {
  it('applies multiple modifiers in order', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'lumMod', val: 75000 },
      { name: 'lumOff', val: 25000 },
    ]);
    expect(result.alpha).toBe(1);
    expect(result.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles alpha modifier', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'alpha', val: 50000 },
    ]);
    expect(result.alpha).toBe(0.5);
    expect(result.color).toBe('FF0000');
  });

  it('handles prefixed modifier names', () => {
    // tint=50000 on black in linear RGB → sRGB ≈ 188
    const result = applyColorModifiers('000000', [
      { name: 'a:tint', val: 50000 },
    ]);
    expect(hexToRgb(result.color).r).toBe(188);
  });

  it('skips unknown modifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'unknownMod', val: 50000 },
    ]);
    expect(result.color).toBe('FF0000');
  });
});

describe('applyHueOff', () => {
  it('shifts hue by positive offset', () => {
    // Red (hue=0) + 120 degrees offset => green-ish
    const result = applyHueOff('#FF0000', 120 * 60000);
    const { r, g, b } = hexToRgb(result);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('wraps negative offsets correctly', () => {
    // Red (hue=0) - 60 degrees => magenta-ish (hue=300)
    const result = applyHueOff('#FF0000', -60 * 60000);
    const { r, b } = hexToRgb(result);
    expect(r).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });
});

describe('applySatOff', () => {
  it('positive offset increases saturation', () => {
    // Start with a partially desaturated color
    const original = rgbToHsl(200, 100, 100);
    const result = applySatOff(rgbToHex(200, 100, 100), 30000);
    const resultHsl = rgbToHsl(...Object.values(hexToRgb(result)) as [number, number, number]);
    expect(resultHsl.s).toBeGreaterThan(original.s);
  });

  it('negative offset decreases saturation', () => {
    const original = rgbToHsl(255, 0, 0);
    const result = applySatOff('#FF0000', -50000);
    const resultHsl = rgbToHsl(...Object.values(hexToRgb(result)) as [number, number, number]);
    expect(resultHsl.s).toBeLessThan(original.s);
  });
});

describe('applyColorModifiers – satOff and alphaOff branches', () => {
  it('handles satOff modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'satOff', val: -50000 },
    ]);
    const hsl = rgbToHsl(...Object.values(hexToRgb(result.color)) as [number, number, number]);
    expect(hsl.s).toBeLessThan(1);
  });

  it('handles a:satOff prefixed modifier', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'a:satOff', val: -50000 },
    ]);
    const hsl = rgbToHsl(...Object.values(hexToRgb(result.color)) as [number, number, number]);
    expect(hsl.s).toBeLessThan(1);
  });

  it('handles alphaOff modifier (additive alpha adjustment)', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'alpha', val: 80000 },
      { name: 'alphaOff', val: -30000 },
    ]);
    // 0.8 + (-0.3) = 0.5
    expect(result.alpha).toBeCloseTo(0.5, 5);
  });

  it('handles a:alphaOff prefixed modifier', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'a:alpha', val: 100000 },
      { name: 'a:alphaOff', val: -50000 },
    ]);
    expect(result.alpha).toBeCloseTo(0.5, 5);
  });

  it('alphaOff clamps to [0, 1] range', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'alpha', val: 90000 },
      { name: 'alphaOff', val: 50000 },
    ]);
    // 0.9 + 0.5 = 1.4 clamped to 1
    expect(result.alpha).toBe(1);

    const result2 = applyColorModifiers('FF0000', [
      { name: 'alpha', val: 10000 },
      { name: 'alphaOff', val: -50000 },
    ]);
    // 0.1 + (-0.5) = -0.4 clamped to 0
    expect(result2.alpha).toBe(0);
  });

  it('handles satMod modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'satMod', val: 0 },
    ]);
    // Fully desaturated red should be grey
    const { r, g, b } = hexToRgb(result.color);
    expect(Math.abs(r - g)).toBeLessThan(2);
    expect(Math.abs(g - b)).toBeLessThan(2);
  });

  it('handles a:satMod prefixed modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'a:satMod', val: 50000 },
    ]);
    const hsl = rgbToHsl(...Object.values(hexToRgb(result.color)) as [number, number, number]);
    expect(hsl.s).toBeLessThan(1);
  });

  it('handles hueMod modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'hueMod', val: 100000 },
    ]);
    expect(result.color).toBe(rgbToHex(255, 0, 0));
  });

  it('handles a:hueMod prefixed modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'a:hueMod', val: 100000 },
    ]);
    expect(result.color).toBe(rgbToHex(255, 0, 0));
  });

  it('handles hueOff modifier via applyColorModifiers', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'hueOff', val: 120 * 60000 },
    ]);
    const { g } = hexToRgb(result.color);
    expect(g).toBeGreaterThan(200);
  });

  it('handles a:hueOff prefixed modifier', () => {
    const result = applyColorModifiers('FF0000', [
      { name: 'a:hueOff', val: 120 * 60000 },
    ]);
    const { g } = hexToRgb(result.color);
    expect(g).toBeGreaterThan(200);
  });
});

describe('presetColorToHex', () => {
  it('resolves basic colors', () => {
    expect(presetColorToHex('black')).toBe('#000000');
    expect(presetColorToHex('white')).toBe('#FFFFFF');
    expect(presetColorToHex('red')).toBe('#FF0000');
  });

  it('resolves OOXML extended colors', () => {
    expect(presetColorToHex('aliceBlue')).toBe('#F0F8FF');
    expect(presetColorToHex('cornflowerBlue')).toBe('#6495ED');
  });

  it('case-insensitive fallback', () => {
    expect(presetColorToHex('ALICEBLUE')).toBe('#F0F8FF');
  });

  it('returns undefined for unknown', () => {
    expect(presetColorToHex('notAColor')).toBeUndefined();
  });
});
