/**
 * Framing math for the roadmap canvas.
 *
 * Kept out of the component module so it can be unit tested without mounting
 * d3 or measuring a real viewport (and so the component file only exports
 * components, which keeps react-refresh happy).
 */

/**
 * Pixels of canvas reserved on each edge, so overlay chrome drawn on top of
 * the map (the topic detail panel, the zoom dock) does not sit over nodes.
 * The fit transform frames the map into what is left, rather than into the
 * whole canvas.
 */
export type RoadmapViewportInset = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/** Bounds of the laid-out map, in layout coordinates. */
export type RoadmapBBox = { minX: number; maxX: number; minY: number; maxY: number };

export const ROADMAP_MIN_FIT_SCALE = 0.6;
/**
 * Deliberately close to 1 so a sparse map renders its nodes at roughly their
 * designed size rather than being blown up to fill the canvas. (At 2.2 a
 * three-node map produced enormous boxes with huge labels.) Zooming in past
 * this is still available from the canvas dock.
 */
export const ROADMAP_MAX_FIT_SCALE = 1.15;

/**
 * Framing math for the roadmap: scale and translate the map's bbox so it fits
 * the canvas, minus any `inset` reserved for chrome drawn over the canvas.
 *
 * Extracted as a pure function so the geometry is testable without mounting
 * d3 and measuring a real viewport. Returns null when there is nothing to fit.
 */
export function computeRoadmapFit(
  bbox: RoadmapBBox,
  dims: { width: number; height: number },
  inset: Required<RoadmapViewportInset>,
) {
  if (dims.width === 0 || dims.height === 0) { return null; }

  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (w === 0 || h === 0) { return null; }

  // Frame into the *available* rect rather than the raw canvas, so overlay
  // chrome (topic detail panel, zoom dock) never covers a node. Guard against
  // an inset larger than the canvas on a very small window.
  const availWidth = Math.max(1, dims.width - inset.left - inset.right);
  const availHeight = Math.max(1, dims.height - inset.top - inset.bottom);

  // fitScale takes the *min* of both axes so the whole map stays visible; a
  // wide-but-short canvas is therefore bound by height, not width.
  const fitScale = Math.min(availWidth / w, availHeight / h);
  const scale = Math.min(Math.max(fitScale, ROADMAP_MIN_FIT_SCALE), ROADMAP_MAX_FIT_SCALE);

  // Center within the available rect: its midpoint sits at inset + avail/2.
  const tx = inset.left + availWidth / 2 - ((bbox.minX + bbox.maxX) / 2) * scale;
  // Center vertically when the map fits; otherwise pin its top edge to the top
  // of the available rect so the first row is never hidden behind chrome.
  const contentHeight = h * scale;
  const ty = contentHeight <= availHeight
    ? inset.top + (availHeight - contentHeight) / 2 - bbox.minY * scale
    : inset.top - bbox.minY * scale;

  return { scale, tx, ty };
}
