import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BUTTON_ZOOM,
  type View,
  WHEEL_ZOOM_IN,
  WHEEL_ZOOM_OUT,
  centeredView,
  fitView,
  scaleAround,
  zoomAround,
  zoomPercent,
} from './viewport';

/** Elements where a press must not start panning (cards, buttons, links, the zoom panel). */
const NO_PAN = 'button, a, .gft-card, [data-no-pan]';

function startsPan(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(NO_PAN));
}

/**
 * The legacy `guide.html` canvas engine: wheel zoom at the cursor, drag to pan, pinch on touch screens,
 * zoom buttons, "center" and "fit". The transform is written straight to the layer (no React render per frame);
 * React state only holds the zoom percentage and the dragging flag.
 */
export function usePanZoom(viewportRef: RefObject<HTMLDivElement | null>, layerRef: RefObject<HTMLDivElement | null>) {
  const view = useRef<View>({ scale: 1, x: 0, y: 40 });
  const [percent, setPercent] = useState(100);
  const [dragging, setDragging] = useState(false);
  const transitionTimer = useRef<number | undefined>(undefined);

  const apply = useCallback(
    (next: View, animated: boolean) => {
      view.current = next;
      setPercent(zoomPercent(next));
      const layer = layerRef.current;
      if (!layer) return;
      window.clearTimeout(transitionTimer.current);
      if (animated) {
        layer.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)';
        transitionTimer.current = window.setTimeout(() => {
          layer.style.transition = 'none';
        }, 260);
      } else {
        layer.style.transition = 'none';
      }
      const x = Math.round(next.x * 10) / 10;
      const y = Math.round(next.y * 10) / 10;
      const s = Math.round(next.scale * 1000) / 1000;
      layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    },
    [layerRef],
  );

  /** Legacy "Markazga olish": 100% and centered. */
  const center = useCallback(
    (animated = true) => {
      const viewport = viewportRef.current;
      const layer = layerRef.current;
      if (!viewport || !layer) return;
      apply(centeredView(viewport.clientWidth, layer.offsetWidth || 1000), animated);
    },
    [apply, viewportRef, layerRef],
  );

  /** "Fit to view": centered, scaled down when the tree is wider than the viewport. */
  const fit = useCallback(
    (animated = true) => {
      const viewport = viewportRef.current;
      const layer = layerRef.current;
      if (!viewport || !layer) return;
      apply(fitView(viewport.clientWidth, layer.offsetWidth || 1000), animated);
    },
    [apply, viewportRef, layerRef],
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      apply(zoomAround(view.current, factor, viewport.clientWidth / 2, viewport.clientHeight / 2), true);
    },
    [apply, viewportRef],
  );

  const zoomIn = useCallback(() => zoomAtCenter(BUTTON_ZOOM), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter(1 / BUTTON_ZOOM), [zoomAtCenter]);
  /** Click on the percentage: back to 100% and centered. */
  const resetZoom = useCallback(() => center(true), [center]);

  // First paint: the whole top row visible, without the animation.
  useLayoutEffect(() => fit(false), [fit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let drag: { dx: number; dy: number } | null = null;
    let pinch: { distance: number; scale: number } | null = null;

    const local = (clientX: number, clientY: number) => {
      const r = viewport.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      apply(zoomAround(view.current, e.deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT, p.x, p.y), false);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !startsPan(e.target)) return;
      drag = { dx: e.clientX - view.current.x, dy: e.clientY - view.current.y };
      setDragging(true);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!drag) return;
      apply({ ...view.current, x: e.clientX - drag.dx, y: e.clientY - drag.dy }, false);
    };
    const onMouseUp = () => {
      if (!drag) return;
      drag = null;
      setDragging(false);
    };

    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        drag = null;
        pinch = { distance: distance(e.touches), scale: view.current.scale };
      } else if (e.touches.length === 1 && startsPan(e.target)) {
        const t = e.touches[0];
        drag = { dx: t.clientX - view.current.x, dy: t.clientY - view.current.y };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch && pinch.distance > 0) {
        e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const mid = local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        const scale = pinch.scale * (distance(e.touches) / pinch.distance);
        apply(scaleAround(view.current, scale, mid.x, mid.y), false);
      } else if (e.touches.length === 1 && drag) {
        e.preventDefault();
        const t = e.touches[0];
        apply({ ...view.current, x: t.clientX - drag.dx, y: t.clientY - drag.dy }, false);
      }
    };
    const onTouchEnd = () => {
      drag = null;
      pinch = null;
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    viewport.addEventListener('touchcancel', onTouchEnd);
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      window.clearTimeout(transitionTimer.current);
    };
  }, [apply, viewportRef]);

  return { percent, dragging, zoomIn, zoomOut, resetZoom, center, fit };
}
