import { describe, it, expect } from "vitest";
import { formatFewShots } from "@/lib/ai/few-shot-formatter";
import type { FewShot } from "@/lib/ai/few-shot-formatter";

describe("formatFewShots", () => {
  it("returns empty string when no shots provided", () => {
    expect(formatFewShots([])).toBe("");
  });

  it("formats confirmed matches as ACCEPTED", () => {
    const shots: FewShot[] = [
      {
        rfqDescription: "TAPE SEALING CLOTH",
        productName: "Marine Sealing Tape 50mm",
        action: "confirmed",
      },
    ];
    const result = formatFewShots(shots);
    expect(result).toContain("ACCEPTED");
    expect(result).toContain("TAPE SEALING CLOTH");
    expect(result).toContain("Marine Sealing Tape 50mm");
    expect(result).toContain("PAST DECISIONS");
  });

  it("formats rejected matches as REJECTED", () => {
    const shots: FewShot[] = [
      {
        rfqDescription: "PAINT PRIMER GREY",
        productName: "Grey House Paint 1L",
        action: "rejected",
      },
    ];
    const result = formatFewShots(shots);
    expect(result).toContain("REJECTED");
    expect(result).toContain("PAINT PRIMER GREY");
  });

  it("handles multiple shots", () => {
    const shots: FewShot[] = [
      { rfqDescription: "Item A", productName: "Product A", action: "confirmed" },
      { rfqDescription: "Item B", productName: "Product B", action: "rejected" },
    ];
    const result = formatFewShots(shots);
    expect(result).toContain("ACCEPTED");
    expect(result).toContain("REJECTED");
    // Each shot produces a line starting with "-"
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(2);
  });
});
