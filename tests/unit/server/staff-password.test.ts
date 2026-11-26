import { describe, expect, it } from "vitest";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";

describe("staff password hashing (scrypt)", () => {
  it("has the documented format: 6 parts, 16-byte salt, 32-byte hash", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$16384$8$1$")).toBe(true);
    const parts = h.split("$");
    expect(parts).toHaveLength(6);
    expect(Buffer.from(parts[4], "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5], "base64")).toHaveLength(32);
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct horsf", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("two hashes of the same password differ (random salt) and both verify", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("Arabic-Indic digits match the Western ones", async () => {
    const h = await hashPassword("12345678");
    expect(await verifyPassword("١٢٣٤٥٦٧٨", h)).toBe(true);
    const h2 = await hashPassword("١٢٣٤٥٦٧٨");
    expect(await verifyPassword("12345678", h2)).toBe(true);
  });

  describe("malformed stored values give false and never throw", () => {
    const good = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    it.each([
      ["empty", ""],
      ["other scheme", "bcrypt$16384$8$1$AAAA$BBBB"],
      ["five parts", "scrypt$16384$8$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
      ["seven parts", `${good}$x`],
      ["non-numeric N", good.replace("16384", "abcde")],
      ["N not a power of two", good.replace("16384", "16385")],
      ["N too large", good.replace("16384", String(2 ** 21))],
      ["N of 1", good.replace("16384", "1")],
      ["r of 0", good.replace("$8$", "$0$")],
      ["p too large", good.replace("$1$", "$99$")],
      ["bad base64 salt", good.replace("AAAAAAAAAAAAAAAAAAAAAA==", "***not base64***")],
      ["bad base64 hash", good.replace("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "@@@")],
      ["an 8-byte hash", "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAA="],
    ])("%s", async (_name, stored) => {
      await expect(verifyPassword("password", stored)).resolves.toBe(false);
    });

    it("a 2000-character password", async () => {
      const h = await hashPassword("x");
      await expect(verifyPassword("x".repeat(2000), h)).resolves.toBe(false);
    });

    it("a non-string input", async () => {
      await expect(verifyPassword(undefined as never, good)).resolves.toBe(false);
      await expect(verifyPassword("x", undefined as never)).resolves.toBe(false);
    });
  });

  it("dummyHash is memoised and is a valid hash that matches nothing guessable", async () => {
    const a = await dummyHash();
    const b = await dummyHash();
    expect(a).toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("password", a)).toBe(false);
  });
});
