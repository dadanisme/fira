/**
 * Pixels per rem: the root font size, which is the UI's single size knob (src/index.css).
 * Use it for JS layout math that has to track rem-sized CSS (pointer offsets, media queries).
 */
export function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
