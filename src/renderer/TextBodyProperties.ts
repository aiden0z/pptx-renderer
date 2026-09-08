import { SafeXmlNode } from '../parser/XmlParser';
import type { TextBody } from '../model/nodes/ShapeNode';

/**
 * Resolve a child under the effective bodyPr for a text body.
 *
 * Slide-level bodyPr wins. Layout/master bodyPr is a fallback and is used when
 * the slide shape omits the child (or the entire autofit choice), matching placeholder inheritance.
 */
export function getEffectiveBodyPrChild(
  textBody: TextBody | undefined,
  childName: string,
): SafeXmlNode | undefined {
  const own = textBody?.bodyProperties?.child(childName);
  if (own?.exists()) return own;

  // Autofit is an OOXML choice: an explicit local mode cancels all inherited modes.
  const autofitModes = ['noAutofit', 'normAutofit', 'spAutoFit'];
  if (
    autofitModes.includes(childName) &&
    autofitModes.some((mode) => textBody?.bodyProperties?.child(mode).exists())
  )
    return undefined;

  const inherited = textBody?.layoutBodyProperties?.child(childName);
  if (inherited?.exists()) return inherited;

  return undefined;
}

/** OOXML percentages accept integer thousandths of a percent and percent strings. */
export function parseTextPercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const trimmed = value.trim();
  const percent = trimmed.endsWith('%');
  const number = Number(percent ? trimmed.slice(0, -1) : trimmed);
  return Number.isFinite(number) ? number / (percent ? 100 : 100000) : undefined;
}
