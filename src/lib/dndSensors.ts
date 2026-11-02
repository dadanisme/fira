import { useMemo, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type KeyboardSensorOptions,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';

/**
 * Mouse and pen: dnd-kit's PointerSensor, minus touch pointers. It still activates on pointerdown,
 * so a control inside a draggable opts out of dragging with `onPointerDown={(e) => e.stopPropagation()}`.
 */
class MousePenSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: Parameters<(typeof PointerSensor.activators)[0]['handler']>[1]) =>
        event.nativeEvent.pointerType !== 'touch' && PointerSensor.activators[0].handler(event, options),
    },
  ];
}

/** Controls a touch must not drag from (the pointerdown stopPropagation above doesn't stop touchstart). */
const NO_DRAG = 'button, input, textarea, select, [contenteditable="true"], [data-no-dnd]';

/**
 * Touch: long-press (250 ms, ≤ 5 px of movement) starts a drag; moving sooner cancels it and the
 * page scrolls natively. Once active, dnd-kit preventDefaults touchmove, so the drag doesn't scroll.
 * Touches that start on a control inside the draggable (NO_DRAG) are left alone.
 */
class LongPressTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (event: ReactTouchEvent, options: Parameters<(typeof TouchSensor.activators)[0]['handler']>[1]) => {
        const control = (event.target as Element).closest?.(NO_DRAG);
        if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return false;
        return TouchSensor.activators[0].handler(event, options);
      },
    },
  ];
}

const TOUCH = { activationConstraint: { delay: 250, tolerance: 5 } };
const NO_KEYS: KeyboardSensorOptions = {};

/**
 * Sensors for a DndContext: mouse/pen drags after `distance` px, touch after a long-press, and the
 * keyboard when `keyboard` options are given. Pass a module-level `keyboard` object (it's a memo dep).
 * Put the `drag-source` utility (index.css) on each draggable so a long-press drags instead of
 * opening the iOS link preview or selecting text.
 */
export function useDndSensors(distance: number, keyboard?: KeyboardSensorOptions): SensorDescriptor<SensorOptions>[] {
  const mouse = useSensor(MousePenSensor, useMemo(() => ({ activationConstraint: { distance } }), [distance]));
  const touch = useSensor(LongPressTouchSensor, TOUCH);
  const keys = useSensor(KeyboardSensor, keyboard ?? NO_KEYS);
  return useSensors(mouse, touch, keyboard ? keys : null);
}
