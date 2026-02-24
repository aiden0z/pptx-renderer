import { describe, it, expect } from 'vitest';
import {
  emuToPx,
  emuToPt,
  angleToDeg,
  pctToDecimal,
  hundredthPtToPt,
  ptToPx,
  detectUnit,
  smartToPx,
} from '../../../src/parser/units';

describe('emuToPx', () => {
  it('converts 914400 EMU (1 inch) to 96 px', () => {
    expect(emuToPx(914400)).toBe(96);
  });

  it('converts 0 EMU to 0 px', () => {
    expect(emuToPx(0)).toBe(0);
  });

  it('handles fractional results', () => {
    expect(emuToPx(457200)).toBe(48);
  });
});

describe('emuToPt', () => {
  it('converts 12700 EMU to 1 pt', () => {
    expect(emuToPt(12700)).toBe(1);
  });

  it('converts 914400 EMU (1 inch) to 72 pt', () => {
    expect(emuToPt(914400)).toBe(72);
  });
});

describe('angleToDeg', () => {
  it('converts 60000 to 1 degree', () => {
    expect(angleToDeg(60000)).toBe(1);
  });

  it('converts 5400000 to 90 degrees', () => {
    expect(angleToDeg(5400000)).toBe(90);
  });

  it('converts 0 to 0', () => {
    expect(angleToDeg(0)).toBe(0);
  });
});

describe('pctToDecimal', () => {
  it('converts 100000 to 1.0', () => {
    expect(pctToDecimal(100000)).toBe(1);
  });

  it('converts 50000 to 0.5', () => {
    expect(pctToDecimal(50000)).toBe(0.5);
  });

  it('converts 0 to 0', () => {
    expect(pctToDecimal(0)).toBe(0);
  });
});

describe('hundredthPtToPt', () => {
  it('converts 1200 to 12', () => {
    expect(hundredthPtToPt(1200)).toBe(12);
  });

  it('converts 100 to 1', () => {
    expect(hundredthPtToPt(100)).toBe(1);
  });
});

describe('ptToPx', () => {
  it('converts 72 pt (1 inch) to 96 px', () => {
    expect(ptToPx(72)).toBe(96);
  });

  it('converts 0 to 0', () => {
    expect(ptToPx(0)).toBe(0);
  });

  it('converts 12 pt to 16 px', () => {
    expect(ptToPx(12)).toBe(16);
  });
});

describe('detectUnit', () => {
  it('detects EMU for large values', () => {
    expect(detectUnit(914400)).toBe('emu');
    expect(detectUnit(50000)).toBe('emu');
  });

  it('detects point for small values', () => {
    expect(detectUnit(72)).toBe('point');
    expect(detectUnit(12)).toBe('point');
    expect(detectUnit(0)).toBe('point');
  });

  it('handles negative values', () => {
    expect(detectUnit(-914400)).toBe('emu');
    expect(detectUnit(-12)).toBe('point');
  });

  it('boundary: 20000 is point, 20001 is EMU', () => {
    expect(detectUnit(20000)).toBe('point');
    expect(detectUnit(20001)).toBe('emu');
  });
});

describe('smartToPx', () => {
  it('converts large values as EMU', () => {
    expect(smartToPx(914400)).toBe(96);
  });

  it('converts small values as points', () => {
    expect(smartToPx(72)).toBe(96);
  });
});
