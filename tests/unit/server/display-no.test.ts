import { describe, expect, it } from "vitest";
import { DISPLAY_NO_ALPHABET } from "@/config/defaults";
import { makeDisplayNo, pdfFileNameFor } from "@/lib/display-no";

describe("displayNo", () => {
  it("has EP-YYMMDD-XXXX shape with the Baghdad date and safe alphabet", () => {
    const no = makeDisplayNo(new Date("2025-11-07T21:30:00Z")); // 00:30 on the 8th in Baghdad (UTC+3)
    expect(no).toMatch(/^EP-\d{6}-[A-Z2-9]{4}$/);
    expect(no.startsWith("EP-251108-")).toBe(true);
    for (const ch of no.slice(-4)) expect(DISPLAY_NO_ALPHABET).toContain(ch);
    expect(makeDisplayNo(new Date("2025-11-07T10:00:00Z"), () => 0)).toBe(
      "EP-251107-2222",
    );
  });

  it("builds an ASCII pdf file name", () => {
    const n = pdfFileNameFor(
      "EP-251107-ABCD",
      { shape: "rect", widthUm: 42400, heightUm: 30000 },
      20,
    );
    expect(n).toBe("EP-251107-ABCD_rect-42.4x30mm_x20.pdf");
    expect(n).toMatch(/^[\x20-\x7e]+$/);
  });
});
