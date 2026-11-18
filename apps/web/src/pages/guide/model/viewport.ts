/** Pan/zoom of the guide canvas (legacy `guide.html`: scale 25%–300%, buttons ×1.2, wheel ×1.12 / ×0.89). */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;
export const BUTTON_ZOOM = 1.2;
export const WHEEL_ZOOM_IN = 1.12;
export const WHEEL_ZOOM_OUT = 0.89;
/** Top offset of the tree after "center". */
export const TOP_OFFSET = 60;

export function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

/** Zooms by `factor` keeping the viewport point (px, py) where it is. */
export function zoomAround(view: View, factor: number, px: number, py: number): View {
  return scaleAround(view, view.scale * factor, px, py);
}

/** Sets the scale keeping the viewport point (px, py) where it is. */
export function scaleAround(view: View, nextScale: number, px: number, py: number): View {
  const scale = clampScale(nextScale);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** 100% and the tree layer centered horizontally. */
export function centeredView(viewportWidth: number, layerWidth: number): View {
  return { scale: 1, x: (viewportWidth - layerWidth) / 2, y: TOP_OFFSET };
}

/** Horizontal padding of the tree layer (`.guide-layer`), left out when fitting. */
export const LAYER_PAD_X = 100;
const FIT_MARGIN = 24;

/**
 * "Fit to view": the tree (without the layer padding) fits the viewport width, never above 100%.
 * Legacy only re-centered at 100%; inside the app shell (sidebar) the top row no longer fits at 100% on
 * 1366–1440 px screens, so the first view and the fit button scale down when needed.
 */
export function fitView(viewportWidth: number, layerWidth: number): View {
  const content = Math.max(layerWidth - 2 * LAYER_PAD_X, 1);
  const scale = clampScale(Math.min(1, (viewportWidth - 2 * FIT_MARGIN) / content));
  return { scale, x: (viewportWidth - layerWidth * scale) / 2, y: TOP_OFFSET };
}

export function zoomPercent(view: View): number {
  return Math.round(view.scale * 100);
}
