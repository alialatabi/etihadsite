import { describe, expect, it } from "vitest";
import { orderRequestSchema } from "@/lib/order-schema";

const BASE = {
  orderId: "order-aaaaaaaaaaaaaaaaaa",
  uploadId: "upload-aaaaaaaaaaaaaaaa",
  spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
  material: "paper",
  sheets: 20,
  customer: { phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "x" },
};
const parse = (marketingOptIn?: unknown) =>
  orderRequestSchema.safeParse({ ...BASE, customer: { ...BASE.customer, ...(marketingOptIn === undefined ? {} : { marketingOptIn }) } });

describe("orderRequestSchema customer.marketingOptIn", () => {
  it("stays absent when the page does not send it (an older cached page); every reader treats anything but true as false", () => {
    const r = parse();
    expect(r.success && "marketingOptIn" in r.data.customer).toBe(false);
  });
  it("accepts true and false", () => {
    const t = parse(true);
    const f = parse(false);
    expect(t.success && t.data.customer.marketingOptIn).toBe(true);
    expect(f.success && f.data.customer.marketingOptIn).toBe(false);
  });
  it("refuses anything that is not a boolean", () => {
    for (const v of ["true", 1, null, "yes"]) expect(parse(v).success).toBe(false);
  });
});
