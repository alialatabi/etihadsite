/**
 * Local-disk StorageAdapter. Deliberately free of `server-only` and `@/` imports
 * so scripts/purge-orders.ts can use it under tsx.
 *
 * Layout under `root` (DATA_DIR):
 *   uploads/<uploadId>.bin + .json, orders/<orderId>.json + .pdf, settings.json
 * All paths in the public API are relative to `root` and traversal-checked.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../../config/defaults';
import type { OrderRecord, ShopSettings, StorageAdapter, StoredFileMeta } from '../types';
import { ID_RE, orderJsonPath, pdfPath, uploadMetaPath, uploadPath } from './paths';
import { shopSettingsSchema } from './settings-schema';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge; arrays and scalars from `over` replace the base. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

export class LocalStorage implements StorageAdapter {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolves a relative storage path to an absolute one, rejecting traversal. */
  private resolveSafe(rel: string): string {
    if (
      typeof rel !== 'string' ||
      rel === '' ||
      rel.includes('\0') ||
      rel.includes('\\') ||
      rel.startsWith('/') ||
      /^[A-Za-z]:/.test(rel) ||
      rel.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
    ) {
      throw new Error('Invalid storage path');
    }
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(this.root + path.sep)) throw new Error('Invalid storage path');
    return abs;
  }

  private async writeAtomic(rel: string, data: Uint8Array | string): Promise<void> {
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
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async saveUpload(uploadId: string, bytes: Uint8Array, meta: StoredFileMeta): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    await this.writeAtomic(uploadPath(uploadId), bytes);
    await this.writeAtomic(uploadMetaPath(uploadId), JSON.stringify(meta));
    return uploadPath(uploadId);
  }

  async readUpload(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    const [bin, metaRaw] = await Promise.all([this.readOptional(uploadPath(uploadId)), this.readOptional(uploadMetaPath(uploadId))]);
    if (!bin || !metaRaw) return null;
    try {
      return { bytes: new Uint8Array(bin), meta: JSON.parse(metaRaw.toString('utf8')) as StoredFileMeta };
    } catch {
      return null;
    }
  }

  async savePdf(orderId: string, bytes: Uint8Array): Promise<string> {
    if (!ID_RE.test(orderId)) throw new Error('Invalid order id');
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
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  async saveOrder(record: OrderRecord): Promise<void> {
    if (!ID_RE.test(record.orderId)) throw new Error('Invalid order id');
    await this.writeAtomic(orderJsonPath(record.orderId), JSON.stringify(record, null, 2));
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    if (!ID_RE.test(orderId)) return null;
    const raw = await this.readOptional(orderJsonPath(orderId));
    if (!raw) return null;
    try {
      return JSON.parse(raw.toString('utf8')) as OrderRecord;
    } catch {
      console.error('[storage] corrupt order file', orderId);
      return null;
    }
  }

  async listOrders(): Promise<OrderRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(path.join(this.root, 'orders'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const records = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map((n) => this.getOrder(n.slice(0, -'.json'.length))),
    );
    return records
      .filter((r): r is OrderRecord => r !== null)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async updateOrder(orderId: string, patch: Partial<Pick<OrderRecord, 'status' | 'notified'>>) {
    const current = await this.getOrder(orderId);
    if (!current) return null;
    const next: OrderRecord = { ...current, ...patch };
    await this.saveOrder(next);
    return next;
  }

  async getSettings(): Promise<ShopSettings> {
    const raw = await this.readOptional('settings.json');
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw.toString('utf8')));
      const parsed = shopSettingsSchema.safeParse(merged);
      if (parsed.success) return parsed.data as ShopSettings;
      console.error('[storage] settings.json is invalid, using defaults:', parsed.error.issues.map((i) => i.path.join('.')).join(', '));
    } catch (e) {
      console.error('[storage] settings.json is unreadable, using defaults:', (e as Error).message);
    }
    return structuredClone(DEFAULT_SETTINGS);
  }

  async saveSettings(settings: ShopSettings): Promise<void> {
    await this.writeAtomic('settings.json', JSON.stringify(settings, null, 2));
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
    for (const order of await this.listOrders()) {
      if (new Date(order.createdAt) >= cutoff) continue;
      await drop(order.files.pdfPath);
      await drop(order.files.designPath);
      await drop(order.files.designPath.replace(/\.bin$/, '.json'));
      await drop(orderJsonPath(order.orderId));
    }
    let uploads: string[] = [];
    try {
      uploads = await fs.readdir(path.join(this.root, 'uploads'));
    } catch {
      /* no uploads dir */
    }
    for (const name of uploads) {
      if (!name.endsWith('.bin')) continue;
      const stat = await fs.stat(path.join(this.root, 'uploads', name));
      if (stat.mtime < cutoff) {
        await drop(`uploads/${name}`);
        await drop(`uploads/${name.replace(/\.bin$/, '.json')}`);
      }
    }
    return removed;
  }
}
