/**
 * OOXML boolean values appear in several wire formats depending on the schema
 * family and producer: xsd:boolean (true/false/1/0) and ST_OnOff (on/off/t/f).
 */

const TRUE_VALUES = new Set(['1', 'true', 't', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'f', 'off']);

export function parseOoxmlBool(value: string | undefined, defaultValue: boolean = false): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}
