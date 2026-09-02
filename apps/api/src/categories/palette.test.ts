import { describe, it, expect } from "vitest";
import { CATEGORY_COLOR_PALETTE, pickDefaultCategoryColor } from "./palette.js";

describe("pickDefaultCategoryColor", () => {
  it("returns the first palette color for a user with no categories yet", () => {
    expect(pickDefaultCategoryColor(0)).toBe(CATEGORY_COLOR_PALETTE[0]);
  });

  it("cycles to the next palette color as the count grows", () => {
    expect(pickDefaultCategoryColor(1)).toBe(CATEGORY_COLOR_PALETTE[1]);
    expect(pickDefaultCategoryColor(7)).toBe(CATEGORY_COLOR_PALETTE[7]);
  });

  it("wraps back around past the palette's last slot", () => {
    expect(pickDefaultCategoryColor(8)).toBe(CATEGORY_COLOR_PALETTE[0]);
    expect(pickDefaultCategoryColor(9)).toBe(CATEGORY_COLOR_PALETTE[1]);
    expect(pickDefaultCategoryColor(17)).toBe(CATEGORY_COLOR_PALETTE[1]);
  });

  it("treats a negative count defensively as 0 rather than throwing", () => {
    expect(pickDefaultCategoryColor(-3)).toBe(CATEGORY_COLOR_PALETTE[0]);
  });
});
