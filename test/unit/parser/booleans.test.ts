import { describe, expect, it } from 'vitest';
import { parseOoxmlBool } from '../../../src/parser/booleans';

describe('parseOoxmlBool', () => {
  it('parses xsd:boolean and ST_OnOff true aliases case-insensitively', () => {
    expect(['1', 'true', 'TRUE', 't', 'on', ' On '].map((value) => parseOoxmlBool(value))).toEqual(
      [true, true, true, true, true, true],
    );
  });

  it('parses xsd:boolean and ST_OnOff false aliases case-insensitively', () => {
    expect(
      ['0', 'false', 'FALSE', 'f', 'off', ' Off '].map((value) => parseOoxmlBool(value, true)),
    ).toEqual([false, false, false, false, false, false]);
  });

  it('returns the caller default for missing or unrecognized values', () => {
    expect(parseOoxmlBool(undefined)).toBe(false);
    expect(parseOoxmlBool(undefined, true)).toBe(true);
    expect(parseOoxmlBool('maybe')).toBe(false);
    expect(parseOoxmlBool('maybe', true)).toBe(true);
  });
});
