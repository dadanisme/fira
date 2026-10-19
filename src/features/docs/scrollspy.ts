import { useEffect, useState, type RefObject } from 'react';
import type { OutlineHeading } from '../../components/MarkdownEditor';
import { remPx } from '../../lib/rem';

/** Headings deeper than this stay out of the table of contents. */
const MAX_LEVEL = 3;

export function tocEntries(outline: OutlineHeading[]): OutlineHeading[] {
  return outline.filter((h) => h.level <= MAX_LEVEL && h.text);
}

/**
 * Scrollspy (pass memoized `entries`): the entry whose section is at the top of `scroller`
 * (the last heading above `offsetRem` from its top; the first entry before any). Headings
 * hidden by a fold are skipped, so their folded ancestor stays current.
 */
export function useActiveHeading(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  entries: OutlineHeading[],
  offsetRem: number,
): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const sc = scroller.current;
    const box = content.current;
    const ids = new Set(entries.map((h) => h.id));
    if (!sc || !box || ids.size === 0) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const limit = sc.getBoundingClientRect().top + offsetRem * remPx();
      let current: string | null = null;
      for (const el of box.querySelectorAll<HTMLElement>('[data-outline-id]')) {
        const id = el.dataset.outlineId!;
        if (!ids.has(id) || el.getClientRects().length === 0) continue;
        if (current !== null && el.getBoundingClientRect().top > limit) break;
        current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    sc.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(box);
    return () => {
      sc.removeEventListener('scroll', schedule);
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller, content, entries, offsetRem]);
  return active;
}
