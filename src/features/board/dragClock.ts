/** Time of the last drag end: the click that follows a drop must not open the card. */
let lastDragEnd = 0;

export function markDragEnd() {
  lastDragEnd = performance.now();
}

export function justDragged(): boolean {
  return performance.now() - lastDragEnd < 250;
}
