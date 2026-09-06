import { describe, expect, it } from "vitest";
import {
  computeRoadmapFit,
  ROADMAP_MAX_FIT_SCALE,
  type RoadmapBBox,
} from "@/lib/roadmapFit";

const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };
// A wide, short map, well inside the canvas so the max-scale clamp applies.
const bbox: RoadmapBBox = { minX: 0, maxX: 400, minY: 0, maxY: 200 };
const dims = { width: 1000, height: 600 };

/** Where the map's bbox lands on the canvas under a given fit. */
function project(fit: { scale: number; tx: number; ty: number }, box: RoadmapBBox) {
  return {
    top: fit.ty + box.minY * fit.scale,
    bottom: fit.ty + box.maxY * fit.scale,
    left: fit.tx + box.minX * fit.scale,
    right: fit.tx + box.maxX * fit.scale,
  };
}

describe("computeRoadmapFit", () => {
  it("centers the map in the canvas when nothing is reserved", () => {
    const fit = computeRoadmapFit(bbox, dims, NO_INSET);
    if (!fit) { throw new Error("expected a fit"); }
    const rect = project(fit, bbox);

    expect((rect.left + rect.right) / 2).toBeCloseTo(dims.width / 2);
    expect((rect.top + rect.bottom) / 2).toBeCloseTo(dims.height / 2);
  });

  it("keeps the map clear of a bottom inset reserved for overlay chrome", () => {
    const inset = { ...NO_INSET, bottom: 200 };
    const fit = computeRoadmapFit(bbox, dims, inset);
    if (!fit) { throw new Error("expected a fit"); }
    const rect = project(fit, bbox);

    // The whole map must sit above the reserved strip -- this is the bug the
    // inset exists to prevent: nodes laid out under the detail panel.
    expect(rect.bottom).toBeLessThanOrEqual(dims.height - inset.bottom + 0.001);
    // and it is centered in what remains, not in the full canvas.
    expect((rect.top + rect.bottom) / 2).toBeCloseTo((dims.height - inset.bottom) / 2);
  });

  it("honours insets on every edge", () => {
    const inset = { top: 40, right: 60, bottom: 80, left: 100 };
    const fit = computeRoadmapFit(bbox, dims, inset);
    if (!fit) { throw new Error("expected a fit"); }
    const rect = project(fit, bbox);

    expect(rect.top).toBeGreaterThanOrEqual(inset.top - 0.001);
    expect(rect.bottom).toBeLessThanOrEqual(dims.height - inset.bottom + 0.001);
    expect(rect.left).toBeGreaterThanOrEqual(inset.left - 0.001);
    expect(rect.right).toBeLessThanOrEqual(dims.width - inset.right + 0.001);
  });

  it("shrinks the map when an inset makes the available rect too small for it", () => {
    const withoutInset = computeRoadmapFit(bbox, dims, NO_INSET);
    // Reserve most of the height so the map can no longer fit at full size.
    const withInset = computeRoadmapFit(bbox, dims, { ...NO_INSET, bottom: 520 });
    if (!withoutInset || !withInset) { throw new Error("expected a fit"); }

    expect(withoutInset.scale).toBeCloseTo(ROADMAP_MAX_FIT_SCALE);
    expect(withInset.scale).toBeLessThan(withoutInset.scale);
  });

  it("pins the top edge inside the inset when the map is taller than the space", () => {
    const tall: RoadmapBBox = { minX: 0, maxX: 400, minY: 0, maxY: 5000 };
    const inset = { ...NO_INSET, top: 50 };
    const fit = computeRoadmapFit(tall, dims, inset);
    if (!fit) { throw new Error("expected a fit"); }
    const rect = project(fit, tall);

    // Too tall to center, so the first row must start at the inset rather than
    // being scrolled up behind the chrome.
    expect(rect.top).toBeCloseTo(inset.top);
  });

  it("returns null when there is nothing to frame", () => {
    expect(computeRoadmapFit(bbox, { width: 0, height: 0 }, NO_INSET)).toBeNull();
    expect(computeRoadmapFit({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, dims, NO_INSET)).toBeNull();
  });

  it("does not divide by zero when the inset exceeds the canvas", () => {
    const fit = computeRoadmapFit(bbox, dims, { top: 400, right: 900, bottom: 400, left: 900 });
    if (!fit) { throw new Error("expected a fit"); }
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.tx)).toBe(true);
    expect(Number.isFinite(fit.ty)).toBe(true);
  });
});
