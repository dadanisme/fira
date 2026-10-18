import { LABEL_COLORS, type Label, type LabelColor } from './types.js';

/** Case-insensitive label lookup by name. */
export function findLabel<T extends Pick<Label, 'name'>>(labels: readonly T[], name: string): T | undefined {
  const needle = name.trim().toLowerCase();
  return labels.find((l) => l.name.toLowerCase() === needle);
}

/** A stable palette color derived from a string (for new labels, avatars, tokens). */
export function colorFor(seed: string): LabelColor {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  // Skip 'gray' so derived colors are distinguishable.
  return LABEL_COLORS[1 + (Math.abs(h) % (LABEL_COLORS.length - 1))];
}
