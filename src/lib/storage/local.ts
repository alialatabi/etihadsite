/**
 * Local-disk StorageAdapter. Deliberately free of `server-only` and `@/` imports
 * so scripts/purge-orders.ts can use it under tsx.
 *
 * Layout under `root` (DATA_DIR):
 *   uploads/<uploadId>.bin + .json, orders/<orderId>.json + .pdf, settings.json,
 *   analytics/events-YYYY-MM.jsonl (one JSON event per line, UTC month),
 *   customers.json (CustomerRecord[] keyed by phone; never purged),
 *   ai/usage.json (AiUsageRow[]), ai/generations.json (AiGenerationRecord[]), ai/blocks.json (AiBlock[]),
 *   ai/staff.json (StaffAccountRecord[]; created on the first staff write only)
 * All paths in the public API are relative to `root` and traversal-checked.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, PURGE_WINDOW_DAYS } from "../../config/defaults";
import type {
  AiBlock,
  AiGenerationFilter,
  AiGenerationRecord,
  AiKind,
  AiReserveResult,
  AiUsageRow,
  AnalyticsEvent,
  CustomerRecord,
  OrderRecord,
  ShopSettings,
  StaffAccountRecord,
  StorageAdapter,
  StoredFileMeta,
} from "../types";
import {
  ID_RE,
  designPathsOf,
  metaPathForDesign,
  orderJsonPath,
  pdfPath,
  uploadMetaPath,
  uploadPath,
} from "./paths";
import { matchesGenerationFilter, resolveGenerationFilter } from "./generation-filter";
import { purgeBounds } from "./purge-rules";
import { parseStoredSettings } from "./settings-schema";
import { StaffStorageError } from "./staff-errors";
import { allDesignPaths, assertUnorderedCutoff } from "./unordered-rules";

export { deepMerge } from "./settings-schema";

const AI_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_FILE_RE = /^events-(\d{4})-(\d{2})\.jsonl$/;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

export class LocalStorage implements StorageAdapter {
  readonly root: string;
  /** Serialises read-modify-write of customers.json inside this process. */
  private customersLock: Promise<unknown> = Promise.resolve();
  /** Serialises every read-modify-write of the ai/*.json files inside this process. */
  private aiLock: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolves a relative storage path to an absolute one, rejecting traversal. */
  private resolveSafe(rel: string): string {
    if (
      typeof rel !== "string" ||
      rel === "" ||
      rel.includes("\0") ||
      rel.includes("\\") ||
      rel.startsWith("/") ||
      /^[A-Za-z]:/.test(rel) ||
      rel.split("/").some((seg) => seg === ".." || seg === "." || seg === "")
    ) {
      throw new Error("Invalid storage path");
    }
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(this.root + path.sep))
      throw new Error("Invalid storage path");
    return abs;
  }

  private async writeAtomic(
    rel: string,
    data: Uint8Array | string,
  ): Promise<void> {
    const abs = this.resolveSafe(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs);
  }

  private async readOptional(rel: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolveSafe(rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      return (await fs.stat(this.resolveSafe(rel))).isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  async saveUpload(
    uploadId: string,
    bytes: Uint8Array,
    meta: StoredFileMeta,
  ): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error("Invalid upload id");
    await this.writeAtomic(uploadPath(uploadId), bytes);
    await this.writeAtomic(uploadMetaPath(uploadId), JSON.stringify(meta));
    return uploadPath(uploadId);
  }

  async readUpload(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    const [bin, metaRaw] = await Promise.all([
      this.readOptional(uploadPath(uploadId)),
      this.readOptional(uploadMetaPath(uploadId)),
    ]);
    if (!bin || !metaRaw) return null;
    try {
      return {
        bytes: new Uint8Array(bin),
        meta: JSON.parse(metaRaw.toString("utf8")) as StoredFileMeta,
      };
    } catch {
      return null;
    }
  }

  async uploadInfo(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    const metaRaw = await this.readOptional(uploadMetaPath(uploadId));
    if (!metaRaw) return null;
    let size: number;
    try {
      size = (await fs.stat(this.resolveSafe(uploadPath(uploadId)))).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    try {
      return { meta: JSON.parse(metaRaw.toString("utf8")) as StoredFileMeta, size };
    } catch {
      return null;
    }
  }

  async savePdf(orderId: string, bytes: Uint8Array): Promise<string> {
    if (!ID_RE.test(orderId)) throw new Error("Invalid order id");
    await this.writeAtomic(pdfPath(orderId), bytes);
    return pdfPath(orderId);
  }

  async readFile(rel: string): Promise<Uint8Array | null> {
    const buf = await this.readOptional(rel);
    return buf ? new Uint8Array(buf) : null;
  }

  async deleteFile(rel: string): Promise<void> {
    try {
      await fs.unlink(this.resolveSafe(rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async saveOrder(record: OrderRecord): Promise<void> {
    if (!ID_RE.test(record.orderId)) throw new Error("Invalid order id");
    await this.writeAtomic(
      orderJsonPath(record.orderId),
      JSON.stringify(record, null, 2),
    );
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    if (!ID_RE.test(orderId)) return null;
    const raw = await this.readOptional(orderJsonPath(orderId));
    if (!raw) return null;
    try {
      return JSON.parse(raw.toString("utf8")) as OrderRecord;
    } catch {
      console.error("[storage] corrupt order file", orderId);
      return null;
    }
  }

  async listOrders(): Promise<OrderRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "orders"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const records = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map((n) => this.getOrder(n.slice(0, -".json".length))),
    );
    return records
      .filter((r): r is OrderRecord => r !== null)
      .sort((a, b) => cmp(b.createdAt, a.createdAt));
  }

  async listOrdersBetween(fromIso: string, toIso: string): Promise<OrderRecord[]> {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (Number.isNaN(from) || Number.isNaN(to)) throw new Error("[storage] listOrdersBetween: invalid date");
    const inRange = (await this.listOrders()).filter((o) => {
      const t = Date.parse(o.createdAt);
      return t >= from && t < to;
    });
    return inRange.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || cmp(a.orderId, b.orderId));
  }

  async updateOrder(
    orderId: string,
    patch: Partial<Pick<OrderRecord, "status" | "notified">>,
  ) {
    const current = await this.getOrder(orderId);
    if (!current) return null;
    const next: OrderRecord = { ...current, ...patch };
    await this.saveOrder(next);
    return next;
  }

  async getSettings(): Promise<ShopSettings> {
    const raw = await this.readOptional("settings.json");
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      const parsed = parseStoredSettings(JSON.parse(raw.toString("utf8")));
      if (parsed.ok) return parsed.settings;
      console.error(
        "[storage] settings.json is invalid, using defaults:",
        parsed.issuePaths,
      );
    } catch (e) {
      console.error(
        "[storage] settings.json is unreadable, using defaults:",
        (e as Error).message,
      );
    }
    return structuredClone(DEFAULT_SETTINGS);
  }

  async saveSettings(settings: ShopSettings): Promise<void> {
    await this.writeAtomic("settings.json", JSON.stringify(settings, null, 2));
  }

  /* ───────────── analytics & customers ───────────── */

  async recordEvent(event: AnalyticsEvent): Promise<void> {
    const t = new Date(event.ts);
    if (Number.isNaN(t.getTime())) throw new Error("Invalid event timestamp");
    const abs = this.resolveSafe(`analytics/events-${monthKey(t)}.jsonl`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, JSON.stringify(event) + "\n", "utf8");
  }

  async listEvents(since: Date): Promise<AnalyticsEvent[]> {
    let names: string[];
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "analytics"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const minMonth = monthKey(since);
    const out: AnalyticsEvent[] = [];
    for (const name of names.sort()) {
      const m = EVENT_FILE_RE.exec(name);
      if (!m || `${m[1]}-${m[2]}` < minMonth) continue;
      const raw = await this.readOptional(`analytics/${name}`);
      if (!raw) continue;
      for (const line of raw.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as AnalyticsEvent;
          if (new Date(ev.ts) >= since) out.push(ev);
        } catch {
          // a torn/corrupt line must not hide the rest
        }
      }
    }
    return out.sort((a, b) => cmp(a.ts, b.ts));
  }

  private async readCustomers(): Promise<CustomerRecord[]> {
    const raw = await this.readOptional("customers.json");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw.toString("utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as CustomerRecord[]) : [];
    } catch {
      // Never overwrite an unreadable file with a fresh list: that would lose customers.
      throw new Error("customers.json is unreadable");
    }
  }

  upsertCustomerFromOrder(record: OrderRecord): Promise<void> {
    const run = async () => {
      const c = record.customer;
      const list = await this.readCustomers();
      const cur = list.find((x) => x.phone === c.phone);
      const total = record.price.totalIqd ?? 0;
      if (cur) {
        if (c.name) cur.name = c.name;
        cur.governorate = c.governorate;
        cur.district = c.district;
        cur.landmark = c.landmark;
        cur.ordersCount += 1;
        cur.totalIqd += total;
        if (record.createdAt >= cur.lastOrderAt) {
          cur.lastOrderAt = record.createdAt;
          cur.lastOrderId = record.orderId;
          cur.lastDisplayNo = record.displayNo;
          // The latest order's explicit choice wins: an unticked box withdraws a stored yes. A customer who never
          // opted in keeps no keys at all.
          if (c.marketingOptIn === true) {
            cur.marketingOptIn = true;
            cur.marketingOptInAt = record.createdAt;
          } else if (cur.marketingOptIn !== undefined) {
            cur.marketingOptIn = false;
            cur.marketingOptInAt = null;
          }
        }
        if (record.createdAt < cur.firstOrderAt) cur.firstOrderAt = record.createdAt;
      } else {
        const fresh: CustomerRecord = {
          phone: c.phone,
          governorate: c.governorate,
          district: c.district,
          landmark: c.landmark,
          firstOrderAt: record.createdAt,
          lastOrderAt: record.createdAt,
          ordersCount: 1,
          totalIqd: total,
          lastOrderId: record.orderId,
          lastDisplayNo: record.displayNo,
        };
        if (c.name) fresh.name = c.name;
        if (c.marketingOptIn === true) {
          fresh.marketingOptIn = true;
          fresh.marketingOptInAt = record.createdAt;
        }
        list.push(fresh);
      }
      await this.writeAtomic("customers.json", JSON.stringify(list, null, 2));
    };
    const next = this.customersLock.then(run, run);
    this.customersLock = next.catch(() => undefined);
    return next;
  }

  async listCustomers(): Promise<CustomerRecord[]> {
    const list = await this.readCustomers();
    return list.sort((a, b) => cmp(b.lastOrderAt, a.lastOrderAt));
  }

  /* ───────────── AI designer (dev only; same semantics as rpc reserve_ai) ───────────── */

  private withAiLock<T>(run: () => Promise<T>): Promise<T> {
    const next = this.aiLock.then(run, run);
    this.aiLock = next.catch(() => undefined);
    return next;
  }

  private async readAiList<T>(name: "usage" | "generations" | "blocks" | "staff"): Promise<T[]> {
    const raw = await this.readOptional(`ai/${name}.json`);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw.toString("utf8")) as unknown;
      // Valid JSON that is not a list is as unreadable as broken JSON (the purge must not read it as "no generations").
      if (!Array.isArray(parsed)) throw new Error("not a list");
      return parsed as T[];
    } catch {
      // Never overwrite an unreadable file with a fresh list.
      throw new Error(`ai/${name}.json is unreadable`);
    }
  }

  private writeAiList(name: "usage" | "generations" | "blocks" | "staff", list: unknown[]): Promise<void> {
    return this.writeAtomic(`ai/${name}.json`, JSON.stringify(list, null, 2));
  }

  aiReserve(a: {
    day: string;
    ipKey: string;
    ip: string;
    kind: AiKind;
    perIpLimit: number;
    siteLimit: number;
  }): Promise<{ status: AiReserveResult; used: number }> {
    return this.withAiLock(async () => {
      const rows = await this.readAiList<AiUsageRow>("usage");
      const row = rows.find((r) => r.day === a.day && r.ipKey === a.ipKey && r.kind === a.kind);
      const used = row?.count ?? 0;
      const blocks = await this.readAiList<AiBlock>("blocks");
      // By key, or by the full IP (a new SESSION_SECRET changes every key; it must not lift blocks). Same as reserve_ai.
      if (blocks.some((b) => b.ipKey === a.ipKey || (a.ip !== "" && b.ip === a.ip))) return { status: "blocked" as const, used };
      const site = rows
        .filter((r) => r.day === a.day && r.kind === a.kind)
        .reduce((n, r) => n + r.count, 0);
      if (site >= a.siteLimit) return { status: "site_limit" as const, used };
      if (a.ipKey !== "" && used >= a.perIpLimit) return { status: "ip_limit" as const, used };
      const lastAt = new Date().toISOString();
      if (row) {
        row.count += 1;
        row.lastAt = lastAt;
        row.ip = a.ip;
      } else {
        rows.push({ day: a.day, ipKey: a.ipKey, ip: a.ip, kind: a.kind, count: 1, lastAt });
      }
      await this.writeAiList("usage", rows);
      return { status: "ok" as const, used: used + 1 };
    });
  }

  aiRelease(a: { day: string; ipKey: string; kind: AiKind }): Promise<void> {
    return this.withAiLock(async () => {
      const rows = await this.readAiList<AiUsageRow>("usage");
      const row = rows.find((r) => r.day === a.day && r.ipKey === a.ipKey && r.kind === a.kind);
      if (!row) return;
      row.count = Math.max(row.count - 1, 0);
      await this.writeAiList("usage", rows);
    });
  }

  async aiUsage(sinceDay: string, kind?: AiKind): Promise<AiUsageRow[]> {
    if (!AI_DAY_RE.test(sinceDay)) throw new Error("Invalid day");
    const rows = await this.readAiList<AiUsageRow>("usage");
    return rows
      .filter((r) => r.day >= sinceDay && (kind === undefined || r.kind === kind))
      .sort((x, y) => cmp(x.day, y.day) || cmp(x.ipKey, y.ipKey) || cmp(x.kind, y.kind));
  }

  /** Like the table's constraints: a duplicate id or uploadId is refused. */
  aiRecordGeneration(rec: AiGenerationRecord): Promise<void> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiGenerationRecord>("generations");
      if (list.some((g) => g.id === rec.id || g.uploadId === rec.uploadId)) {
        throw new Error("Duplicate AI generation");
      }
      list.push(rec);
      await this.writeAiList("generations", list);
    });
  }

  aiMarkOrdered(uploadId: string, orderId: string): Promise<void> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiGenerationRecord>("generations");
      const g = list.find((x) => x.uploadId === uploadId);
      if (!g) return;
      g.orderId = orderId;
      await this.writeAiList("generations", list);
    });
  }

  async aiListGenerations(
    q: { limit: number; offset: number } & AiGenerationFilter,
  ): Promise<{ rows: AiGenerationRecord[]; total: number }> {
    const { limit: rawLimit, offset } = q;
    const resolved = resolveGenerationFilter(q); // reads only the filter keys
    const all = await this.readAiList<AiGenerationRecord>("generations");
    // An invalid filter value (or a search that can match nothing) is no rows, like the Supabase adapter.
    const list = (resolved ? all.filter((g) => matchesGenerationFilter(g, resolved)) : []).sort(
      (x, y) => cmp(y.createdAt, x.createdAt) || cmp(y.id, x.id),
    );
    const from = Math.max(0, Math.floor(offset));
    const limit = Math.floor(rawLimit);
    return { rows: limit >= 1 ? list.slice(from, from + limit) : [], total: list.length };
  }

  async aiGetGeneration(uploadId: string): Promise<AiGenerationRecord | null> {
    if (!ID_RE.test(uploadId)) return null;
    const list = await this.readAiList<AiGenerationRecord>("generations");
    return list.find((g) => g.uploadId === uploadId) ?? null;
  }

  /** By exact id only; the upload files are not touched (the caller deletes them). */
  aiDeleteGeneration(id: string): Promise<AiGenerationRecord | null> {
    if (!ID_RE.test(id)) return Promise.resolve(null);
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiGenerationRecord>("generations");
      const at = list.findIndex((g) => g.id === id);
      if (at < 0) return null;
      const [gone] = list.splice(at, 1);
      await this.writeAiList("generations", list);
      return gone;
    });
  }

  /**
   * Every order file, strictly: an unreadable order file throws (listOrders skips it silently, which would be
   * "not used" for a safety check). A file that vanishes between the listing and the read is skipped.
   */
  private async readOrdersStrict(): Promise<OrderRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "orders"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: OrderRecord[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const raw = await this.readOptional(`orders/${n}`);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new Error(`orders/${n} is unreadable`);
      }
      if (typeof parsed !== "object" || parsed === null || typeof (parsed as OrderRecord).files !== "object") {
        throw new Error(`orders/${n} is unreadable`);
      }
      out.push(parsed as OrderRecord);
    }
    return out.sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.orderId, b.orderId));
  }

  /** Upload path → id of the (earliest) order that uses it; any order, any age. Throws when an order file is unreadable. */
  private async orderUsesByPath(): Promise<Map<string, string>> {
    const used = new Map<string, string>();
    for (const o of await this.readOrdersStrict()) {
      for (const p of allDesignPaths(o.files)) if (!used.has(p)) used.set(p, o.orderId);
    }
    return used;
  }

  async orderUsingUpload(uploadId: string): Promise<string | null> {
    if (!ID_RE.test(uploadId)) return null;
    return (await this.orderUsesByPath()).get(uploadPath(uploadId)) ?? null;
  }

  /** Already blocked = kept as is (first block time stays). */
  aiBlock(ipKey: string, ip: string): Promise<void> {
    // '' is the site-only usage row; blocking it would block every site-only reservation.
    if (ipKey === "") return Promise.reject(new Error("Invalid ipKey"));
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiBlock>("blocks");
      if (list.some((b) => b.ipKey === ipKey)) return;
      list.push({ ipKey, ip, createdAt: new Date().toISOString() });
      await this.writeAiList("blocks", list);
    });
  }

  aiUnblock(ipKey: string): Promise<void> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiBlock>("blocks");
      const next = list.filter((b) => b.ipKey !== ipKey);
      if (next.length !== list.length) await this.writeAiList("blocks", next);
    });
  }

  async aiListBlocks(): Promise<AiBlock[]> {
    const list = await this.readAiList<AiBlock>("blocks");
    return list.sort((x, y) => cmp(y.createdAt, x.createdAt));
  }

  /** Deletes usage counters of days before `day` (YYYY-MM-DD). Returns `ai_usage:<n>` (empty when none). */
  async aiPurgeUsageBefore(day: string, dryRun: boolean): Promise<string[]> {
    if (!AI_DAY_RE.test(day)) throw new Error("Invalid day");
    return this.withAiLock(async () => {
      const rows = await this.readAiList<AiUsageRow>("usage");
      const keep = rows.filter((r) => r.day >= day);
      const n = rows.length - keep.length;
      if (n > 0 && !dryRun) await this.writeAiList("usage", keep);
      return n > 0 ? [`ai_usage:${n}`] : [];
    });
  }

  /* ───────────── Staff designer accounts (dev only; ai/staff.json) ───────────── */

  /** Oldest first, then by id: the same order as the Supabase adapter. Copies, never the stored objects. */
  async staffList(): Promise<StaffAccountRecord[]> {
    const list = await this.readAiList<StaffAccountRecord>("staff");
    return list.map((r) => ({ ...r })).sort((x, y) => cmp(x.createdAt, y.createdAt) || cmp(x.id, y.id));
  }

  async staffGet(id: string): Promise<StaffAccountRecord | null> {
    const rec = (await this.readAiList<StaffAccountRecord>("staff")).find((r) => r.id === id);
    return rec ? { ...rec } : null;
  }

  async staffByPhone(phone: string): Promise<StaffAccountRecord | null> {
    const rec = (await this.readAiList<StaffAccountRecord>("staff")).find((r) => r.phone === phone);
    return rec ? { ...rec } : null;
  }

  /** Like the table's constraints: a duplicate id is refused, a duplicate phone is `phone_taken`. */
  staffCreate(rec: StaffAccountRecord): Promise<void> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<StaffAccountRecord>("staff");
      if (list.some((r) => r.id === rec.id)) throw new Error("Duplicate staff account");
      if (list.some((r) => r.phone === rec.phone)) throw new StaffStorageError("phone_taken");
      list.push({ ...rec });
      await this.writeAiList("staff", list);
    });
  }

  staffUpdate(
    id: string,
    patch: Partial<Pick<StaffAccountRecord, "name" | "active" | "passwordHash" | "passwordChangedAt">>,
  ): Promise<StaffAccountRecord | null> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<StaffAccountRecord>("staff");
      const rec = list.find((r) => r.id === id);
      if (!rec) return null;
      if (patch.name !== undefined) rec.name = patch.name;
      if (patch.active !== undefined) rec.active = patch.active;
      if (patch.passwordHash !== undefined) rec.passwordHash = patch.passwordHash;
      if (patch.passwordChangedAt !== undefined) rec.passwordChangedAt = patch.passwordChangedAt;
      await this.writeAiList("staff", list);
      return { ...rec };
    });
  }

  /** A missing id is a no-op. */
  staffTouchLogin(id: string, at: string): Promise<void> {
    return this.withAiLock(async () => {
      const list = await this.readAiList<StaffAccountRecord>("staff");
      const rec = list.find((r) => r.id === id);
      if (!rec) return;
      rec.lastLoginAt = at;
      await this.writeAiList("staff", list);
    });
  }

  /**
   * Deletes whole monthly event files that end before `cutoff`. Returns the relative
   * paths removed (or that would be when dryRun). Customers are never touched.
   */
  async purgeEventsOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]> {
    let names: string[];
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "analytics"));
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const name of names) {
      const m = EVENT_FILE_RE.exec(name);
      if (!m) continue;
      const monthEnd = Date.UTC(Number(m[1]), Number(m[2]), 1); // first instant of the next month
      if (monthEnd > cutoff.getTime()) continue;
      removed.push(`analytics/${name}`);
      if (!dryRun) await this.deleteFile(`analytics/${name}`);
    }
    return removed;
  }

  /**
   * Retention purge (used by scripts/purge-orders.ts), same rules as the Supabase adapter
   * (owner decision D10):
   *   - orders created before min(cutoff, KEEP_DESIGNS_FROM) (old rule): record, PDF and design
   *     removed, with no lower bound (nothing promised is stranded by an outage);
   *   - orders from KEEP_DESIGNS_FROM on: only their print PDF is removed when created in the window
   *     [cutoff − PURGE_WINDOW_DAYS, cutoff); the record and the design are kept forever;
   *   - uploads (by mtime, in the window) that no order and no AI generation (ai/generations.json) uses are removed.
   * Every order file is read (to learn what is in use), so the cost grows with the number of orders.
   * Interrupted .tmp writes older than `cutoff` are removed too. Returns the relative paths
   * removed (or that would be removed when dryRun).
   */
  async purgeOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]> {
    const removed: string[] = [];
    const drop = async (rel: string) => {
      if (!(await this.exists(rel))) return;
      removed.push(rel);
      if (!dryRun) await this.deleteFile(rel);
    };
    // Old rule: created before min(cutoff, KEEP_DESIGNS_FROM), with NO lower bound (a purge outage or a
    // lower retentionDays must never strand a promised deletion).
    const { oldRuleEnd, inWindow } = purgeBounds(cutoff);
    const orders = await this.listOrders();
    const oldRule = orders.filter((o) => new Date(o.createdAt) < oldRuleEnd);
    const deleting = new Set(oldRule.map((o) => o.orderId));
    // Designs used by any order we keep, and uploads behind an AI generation, survive whatever their age.
    const used = new Set(orders.filter((o) => !deleting.has(o.orderId)).flatMap((o) => designPathsOf(o.files)));
    for (const g of await this.readAiList<AiGenerationRecord>("generations")) used.add(uploadPath(g.uploadId));
    for (const order of orders) {
      const created = new Date(order.createdAt);
      const old = deleting.has(order.orderId);
      // New-rule PDFs only in the window.
      if (!old && !inWindow(created)) continue;
      await drop(order.files.pdfPath);
      if (!old) continue;
      // A multi-design order holds several uploads (files.designPaths); a single one has just designPath.
      for (const designPath of designPathsOf(order.files)) {
        if (used.has(designPath)) continue;
        await drop(designPath);
        await drop(metaPathForDesign(designPath));
      }
      await drop(orderJsonPath(order.orderId));
    }
    const list = async (dir: string): Promise<string[]> => {
      try {
        return await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, dir));
      } catch {
        return []; // directory does not exist
      }
    };
    const uploadNames = await list("uploads");
    // Interrupted writeAtomic() leftovers.
    for (const dir of ["uploads", "orders"]) {
      for (const name of dir === "uploads" ? uploadNames : await list(dir)) {
        if (!name.endsWith(".tmp")) continue;
        const stat = await fs
          .stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, dir, name))
          .catch(() => null);
        if (stat && stat.mtime < cutoff) {
          removed.push(`${dir}/${name}`);
          if (!dryRun) await this.deleteFile(`${dir}/${name}`);
        }
      }
    }
    for (const name of uploadNames) {
      if (!name.endsWith(".bin")) continue;
      if (used.has(`uploads/${name}`)) continue;
      const stat = await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "uploads", name));
      if (inWindow(stat.mtime)) {
        await drop(`uploads/${name}`);
        await drop(metaPathForDesign(`uploads/${name}`));
      }
    }
    return removed;
  }

  /**
   * 7-day rule for designs (owner 2026-11-26), same behaviour as the Supabase adapter: every generation with
   * orderId null created before `cutoff` is removed. ROWS FIRST, files second: the rows are taken out of the list
   * (and the list written) under the lock, then the files of the removed rows are deleted. Orders are read first
   * (strictly: an unreadable order file aborts, nothing is deleted) and once more right before the list is written;
   * a generation an order uses is healed (orderId set) and kept. A file that could not be deleted is left behind
   * (the row is gone for good; purgeUnusedUploads sweeps it as a plain unused upload) and the call throws at the
   * end. dryRun changes nothing (no healing either).
   */
  async aiPurgeUnordered(cutoff: Date, dryRun: boolean): Promise<string[]> {
    assertUnorderedCutoff(cutoff);
    return this.withAiLock(async () => {
      const list = await this.readAiList<AiGenerationRecord>("generations");
      const candidates = list
        .filter(
          (g) =>
            (g.orderId === null || g.orderId === undefined) &&
            ID_RE.test(g.id) &&
            ID_RE.test(g.uploadId) &&
            new Date(g.createdAt) < cutoff, // an invalid date compares false: never a candidate
        )
        .sort((x, y) => cmp(x.createdAt, y.createdAt) || cmp(x.id, y.id));
      if (candidates.length === 0) return [];
      let usedBy = await this.orderUsesByPath();
      let healed = false;
      const heal = (): void => {
        for (const g of candidates) {
          const orderId = usedBy.get(uploadPath(g.uploadId));
          if (orderId === undefined || dryRun || g.orderId === orderId) continue;
          g.orderId = orderId;
          healed = true;
        }
      };
      heal();
      // Orders saved while the first read ran (closes the gap right before the write).
      if (!dryRun) {
        usedBy = await this.orderUsesByPath();
        heal();
      }
      const gone = candidates.filter((g) => !usedBy.has(uploadPath(g.uploadId)));
      const goneIds = new Set(gone.map((g) => g.id));
      if (!dryRun && (healed || gone.length > 0)) {
        await this.writeAiList("generations", list.filter((g) => !goneIds.has(g.id)));
      }
      const removed: string[] = [];
      let failures = 0;
      for (const g of gone) {
        const files: string[] = [];
        try {
          for (const rel of [uploadPath(g.uploadId), uploadMetaPath(g.uploadId)]) {
            if (!(await this.exists(rel))) continue;
            if (!dryRun) await this.deleteFile(rel);
            files.push(rel);
          }
        } catch (e) {
          failures++;
          console.error("[storage] design row deleted but its file was not; purgeUnusedUploads will sweep it", g.id, (e as Error).message);
        }
        removed.push(...files, `ai_generation:${g.id}`);
      }
      if (failures > 0) throw new Error(`${failures} design(s) lost their row but kept a file; purgeUnusedUploads sweeps the file`);
      return removed;
    });
  }

  /**
   * 7-day rule for plain uploads (owner 2026-11-26): an upload (by mtime) in [cutoff − PURGE_WINDOW_DAYS, cutoff)
   * that no order and no remaining generation uses is removed (.bin + .json; a leftover .json without its .bin too).
   * Orders are read strictly and directory errors (other than "missing") throw: nothing is deleted on doubt.
   */
  async purgeUnusedUploads(cutoff: Date, dryRun: boolean): Promise<string[]> {
    assertUnorderedCutoff(cutoff);
    const windowStart = new Date(cutoff.getTime() - PURGE_WINDOW_DAYS * 86_400_000);
    const inWindow = (d: Date) => d >= windowStart && d < cutoff;
    // Every upload an order or a remaining generation points at (strict: an unreadable file throws).
    const readUsed = async (): Promise<Set<string>> => {
      const used = new Set((await this.orderUsesByPath()).keys());
      for (const g of await this.readAiList<AiGenerationRecord>("generations")) {
        if (typeof g.uploadId === "string" && ID_RE.test(g.uploadId)) used.add(uploadPath(g.uploadId));
      }
      return used;
    };
    let used = await readUsed();
    let names: string[];
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "uploads"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const have = new Set(names);
    const mtime = async (name: string): Promise<Date | null> => {
      try {
        return (await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "uploads", name))).mtime;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    };
    const removed: string[] = [];
    const drop = async (rel: string) => {
      if (!(await this.exists(rel))) return;
      if (!dryRun) await this.deleteFile(rel);
      removed.push(rel);
    };
    // plan: the files to remove, each group keyed by the upload (.bin path) a reference would name.
    const plan: { key: string; files: string[] }[] = [];
    for (const name of [...names].sort()) {
      const rel = `uploads/${name}`;
      if (name.endsWith(".bin")) {
        if (used.has(rel)) continue;
        const t = await mtime(name);
        if (!t || !inWindow(t)) continue;
        plan.push({ key: rel, files: [rel, metaPathForDesign(rel)] });
      } else if (name.endsWith(".json")) {
        const stem = name.slice(0, -".json".length);
        if (have.has(`${stem}.bin`) || used.has(`uploads/${stem}.bin`)) continue;
        const t = await mtime(name);
        if (t && inWindow(t)) plan.push({ key: `uploads/${stem}.bin`, files: [rel] });
      }
    }
    if (!dryRun && plan.length > 0) used = await readUsed(); // re-read right before deleting (fails closed: a throw deletes nothing)
    for (const item of plan) {
      if (used.has(item.key)) continue;
      for (const f of item.files) await drop(f);
    }
    return removed;
  }
}
