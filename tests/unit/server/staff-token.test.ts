import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/auth/token";
import {
  STAFF_COOKIE_NAME,
  STAFF_SESSION_TTL_SEC,
  signStaffToken,
  verifyStaffToken,
} from "@/lib/auth/staff-token";
import { SECRET } from "./helpers";

const ID = "st_abcdefgh12";

describe("staff token", () => {
  it("uses its own cookie name and a 7 day TTL", () => {
    expect(STAFF_COOKIE_NAME).toBe("sf_staff");
    expect(STAFF_SESSION_TTL_SEC).toBe(7 * 24 * 3600);
  });

  it("signs and verifies, returning the staff id and the issue time in seconds", async () => {
    const now = 1_800_000_000_500;
    const t = await signStaffToken(SECRET, ID, now);
    expect(await verifyStaffToken(t, SECRET, now + 1000)).toEqual({ staffId: ID, iatSec: 1_800_000_000 });
  });

  it("expires after 7 days plus a second", async () => {
    const now = Date.now();
    const t = await signStaffToken(SECRET, ID, now);
    expect(await verifyStaffToken(t, SECRET, now + 7 * 24 * 3600 * 1000 - 5000)).not.toBeNull();
    expect(await verifyStaffToken(t, SECRET, now + 7 * 24 * 3600 * 1000 + 1000)).toBeNull();
  });

  it("refuses a wrong secret, garbage and undefined", async () => {
    const t = await signStaffToken(SECRET, ID);
    expect(await verifyStaffToken(t, "y".repeat(40))).toBeNull();
    expect(await verifyStaffToken("garbage", SECRET)).toBeNull();
    expect(await verifyStaffToken(undefined, SECRET)).toBeNull();
    expect(await verifyStaffToken(t, undefined)).toBeNull();
  });

  it("refuses secrets shorter than 32 characters on both sides", async () => {
    const short = "s".repeat(31);
    await expect(signStaffToken(short, ID)).rejects.toThrow(/too short/);
    await expect(signStaffToken("", ID)).rejects.toThrow(/too short/);
    const t = await signStaffToken("s".repeat(32), ID);
    expect(await verifyStaffToken(t, short)).toBeNull();
  });

  it("refuses to sign a bad staff id", async () => {
    await expect(signStaffToken(SECRET, "short")).rejects.toThrow();
    await expect(signStaffToken(SECRET, "bad id with spaces")).rejects.toThrow();
  });

  it("refuses a token with a bad or missing subject or a non-staff role", async () => {
    const key = new TextEncoder().encode(SECRET);
    const mk = (claims: Record<string, unknown>, sub?: string) => {
      const j = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h");
      if (sub !== undefined) j.setSubject(sub);
      return j.sign(key);
    };
    expect(await verifyStaffToken(await mk({ role: "staff" }, ID), SECRET)).not.toBeNull();
    expect(await verifyStaffToken(await mk({ role: "staff" }, "bad sub!"), SECRET)).toBeNull();
    expect(await verifyStaffToken(await mk({ role: "staff" }), SECRET)).toBeNull();
    expect(await verifyStaffToken(await mk({ role: "admin" }, ID), SECRET)).toBeNull();
    expect(await verifyStaffToken(await mk({}, ID), SECRET)).toBeNull();
  });

  it("an admin token is not a staff token, and a staff token is not an admin token", async () => {
    const admin = await signToken(SECRET);
    const staff = await signStaffToken(SECRET, ID);
    expect(await verifyStaffToken(admin, SECRET)).toBeNull();
    expect(await verifyToken(staff, SECRET)).toBe(false);
  });
});
