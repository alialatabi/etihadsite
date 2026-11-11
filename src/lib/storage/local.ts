/**
 * Local-disk StorageAdapter. Deliberately free of `server-only` and `@/` imports
 * so scripts/purge-orders.ts can use it under tsx.
 *
 * Layout under `root` (DATA_DIR):
 *   uploads/<uploadId>.bin + .json, orders/<orderId>.json + .pdf, settings.json,
 *   analytics/events-YYYY-MM.jsonl (one JSON event per line, UTC month),
 *   customers.json (CustomerRecord[] keyed by phone; never purged)
 * All paths in the public API are relative to `root` and traversal-checked.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../config/defaults";
import type {
  AnalyticsEvent,
  CustomerRecord,
  OrderRecord,
  ShopSettings,
  StorageAdapter,
  StoredFileMeta,
} from "../types";
import {
  ID_RE,
  metaPathForDesign,
  orderJsonPath,
  pdfPath,
  uploadMetaPath,
  uploadPath,
} from "./paths";
import { parseStoredSettings } from "./settings-schema";

export { deepMerge } from "./settings-schema";

const EVENT_FILE_RE = /^events-(\d{4})-(\d{2})\.jsonl$/;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export class LocalStorage implements StorageAdapter {
  readonly root: string;
  /** Serialises read-modify-write of customers.json inside this process. */
  private customersLock: Promise<unknown> = Promise.resolve();

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
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
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
    return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
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
    return list.sort((a, b) => (a.lastOrderAt < b.lastOrderAt ? 1 : a.lastOrderAt > b.lastOrderAt ? -1 : 0));
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
   * Retention purge (used by scripts/purge-orders.ts). Removes orders created before
   * `cutoff` with their PDF and design upload, plus orphan uploads older than `cutoff`.
   * Returns the relative paths removed (or that would be removed when dryRun).
   */
  async purgeOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]> {
    const removed: string[] = [];
    const drop = async (rel: string) => {
      if ((await this.readOptional(rel)) === null) return;
      removed.push(rel);
      if (!dryRun) await this.deleteFile(rel);
    };
    const orders = await this.listOrders();
    // Uploads still referenced by an order we keep must survive, whatever their age.
    const kept = new Set(
      orders
        .filter((o) => new Date(o.createdAt) >= cutoff)
        .map((o) => o.files.designPath),
    );
    for (const order of orders) {
      if (new Date(order.createdAt) >= cutoff) continue;
      if (kept.has(order.files.designPath)) {
        await drop(order.files.pdfPath);
        await drop(orderJsonPath(order.orderId));
        continue;
      }
      await drop(order.files.pdfPath);
      await drop(order.files.designPath);
      await drop(metaPathForDesign(order.files.designPath));
      await drop(orderJsonPath(order.orderId));
    }
    const list = async (dir: string): Promise<string[]> => {
      try {
        return await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, dir));
      } catch {
        return []; // directory does not exist
      }
    };
    // Interrupted writeAtomic() leftovers.
    for (const dir of ["uploads", "orders"]) {
      for (const name of await list(dir)) {
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
    for (const name of await list("uploads")) {
      if (!name.endsWith(".bin")) continue;
      if (kept.has(`uploads/${name}`)) continue;
      const stat = await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ this.root, "uploads", name));
      if (stat.mtime < cutoff) {
        await drop(`uploads/${name}`);
        await drop(metaPathForDesign(`uploads/${name}`));
      }
    }
    return removed;
  }
}
