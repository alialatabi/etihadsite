import 'server-only';
/**
 * Supabase StorageAdapter (`STORAGE=supabase`) for serverless hosting (Vercel has no disk).
 *
 *   Postgres  public.orders (order_id, created_at, record jsonb), public.settings (id=1, data jsonb),
 *             rpc patch_order(p_id, p_patch) for atomic status/notified updates,
 *             public.events (analytics), public.customers + rpc upsert_customer (never purged)
 *   Storage   private bucket `etihad`: uploads/<id>.bin + .json, orders/<id>.pdf
 *
 * Schema: supabase/migrations/*.sql. RLS is on with no policies, so only the SECRET key
 * (server only, never sent to the browser) can read or write. Plain fetch, no SDK.
 *
 * Failure policy: every call has a timeout, and any outage THROWS (callers answer
 * server_error → the customer gets the WhatsApp fallback). Nothing silently falls back to
 * defaults except a genuinely missing/invalid settings row, so prices never change by accident.
 *
 * Paths match the local adapter (relative, `uploads/…` / `orders/…`) and are validated
 * against a strict pattern before any request, so a stored path can never escape the bucket.
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { AnalyticsEvent, CustomerRecord, OrderRecord, ShopSettings, StorageAdapter, StoredFileMeta } from '@/lib/types';
import { ID_RE, metaPathForDesign, pdfPath, uploadMetaPath, uploadPath } from './paths';
import { parseStoredSettings } from './settings-schema';

const BUCKET = 'etihad';
const PATH_RE = /^(uploads|orders)\/[A-Za-z0-9_-]{8,64}\.(bin|json|pdf)$/;
/** Bucket hard limit (migration). Direct uploads above it cannot be stored. */
export const SUPABASE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const OBJECT_TIMEOUT_MS = 30_000;
/** Page size of every paged listing: PostgREST selects (one response is capped at max-rows, default 1000) and the Storage object list. */
const PAGE_ROWS = 1000;
/** Object paths per bulk-delete request. */
const DELETE_CHUNK = 500;
/** The `limit=` sent on both purge selects of orders (the old ones to remove, and the kept ones whose designs must stay); PostgREST's max-rows (default 1000) caps the rows actually read. */
const PURGE_ORDER_LIMIT = 10_000;
/** The `limit=` sent on the dry-run purge select of event ids (it counts what would be deleted); PostgREST's max-rows (default 1000) caps the rows actually read. */
const DRY_RUN_COUNT_LIMIT = 100_000;
/** A direct upload that was never committed (.bin without .json) is removed once it is this old. */
const ORPHAN_UPLOAD_MAX_AGE_MS = 3 * 3600_000;

function safePath(rel: string): string {
  if (typeof rel !== 'string' || !PATH_RE.test(rel)) throw new Error('Invalid storage path');
  return rel;
}

/** Storage answers "not found" as 404, or as 400 with `{ statusCode: "404" }` / `error: "not_found"`. */
async function isNotFound(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const body = (await res.clone().json()) as { statusCode?: string | number; error?: string };
    return String(body.statusCode) === '404' || body.error === 'not_found';
  } catch {
    return false;
  }
}

interface ListedObject {
  name: string;
  created_at?: string;
}

/** AnalyticsEvent → public.events row: an absent optional field is written as an explicit null. */
function eventToRow(e: AnalyticsEvent) {
  return {
    ts: e.ts,
    type: e.type,
    visitor: e.visitor,
    path: e.path ?? null,
    step: e.step ?? null,
    source: e.source ?? null,
    device: e.device ?? null,
    city: e.city ?? null,
    region: e.region ?? null,
    country: e.country ?? null,
    meta: e.meta ?? null,
  };
}

/** public.events row → AnalyticsEvent: null columns are dropped (those fields are optional). */
function rowToEvent(r: Record<string, unknown>): AnalyticsEvent {
  // Filled key by key, in the row's own order; the select list is exactly the event's fields.
  const ev = {} as AnalyticsEvent & Record<string, unknown>;
  for (const [k, v] of Object.entries(r)) if (v !== null) ev[k] = v;
  return ev;
}

/** public.customers row → CustomerRecord. */
function rowToCustomer(r: Record<string, unknown>): CustomerRecord {
  const out: CustomerRecord = {
    phone: String(r.phone),
    governorate: String(r.governorate),
    district: String(r.district),
    landmark: String(r.landmark),
    firstOrderAt: String(r.first_order_at),
    lastOrderAt: String(r.last_order_at),
    ordersCount: Number(r.orders_count),
    totalIqd: Number(r.total_iqd),
    lastOrderId: String(r.last_order_id),
    lastDisplayNo: String(r.last_display_no),
  };
  if (typeof r.name === 'string' && r.name) out.name = r.name;
  return out;
}

export class SupabaseStorage implements StorageAdapter {
  private readonly base: string;
  readonly directUploadMaxBytes = SUPABASE_MAX_UPLOAD_BYTES;

  constructor(
    url: string,
    private readonly key: string,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  /**
   * One request. Throws on network errors, timeouts and non-2xx answers, except a
   * "not found" when `allowNotFound` (then the Response is returned with ok === false).
   */
  private async req(
    path: string,
    init: RequestInit & { allowNotFound?: boolean; timeoutMs?: number } = {},
  ): Promise<Response> {
    const { allowNotFound, timeoutMs, ...rest } = init;
    const res = await fetch(`${this.base}${path}`, {
      ...rest,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, ...((rest.headers as Record<string, string>) ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs ?? TIMEOUT_MS),
    });
    if (res.ok) return res;
    if (allowNotFound && (await isNotFound(res))) return res;
    const text = await res.text().catch(() => '');
    throw new Error(`[supabase] ${rest.method ?? 'GET'} ${path.split('?')[0]} -> ${res.status} ${text.slice(0, 200)}`);
  }

  /** JSON request body; `prefer` adds a PostgREST `Prefer` header after the content type. */
  private json(body: unknown, prefer?: string): RequestInit {
    return { headers: { 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: JSON.stringify(body) };
  }

  /**
   * Every row of a PostgREST select. One response is capped (max-rows, default 1000), so the
   * rows are fetched page after page with Range headers until a short page arrives.
   */
  private async selectAllPaged(pathAndQuery: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      const res = await this.req(pathAndQuery, {
        headers: { Range: `${from}-${from + PAGE_ROWS - 1}`, 'Range-Unit': 'items' },
        timeoutMs: OBJECT_TIMEOUT_MS,
      });
      const page = (await res.json()) as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < PAGE_ROWS) return rows;
    }
  }

  /* ───────────── objects ───────────── */

  private async putObject(rel: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.req(`/storage/v1/object/${BUCKET}/${safePath(rel)}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' },
      body: typeof body === 'string' ? body : Buffer.from(body),
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
  }

  private async getObject(rel: string): Promise<Uint8Array | null> {
    const res = await this.req(`/storage/v1/object/authenticated/${BUCKET}/${safePath(rel)}`, {
      allowNotFound: true,
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async saveUpload(uploadId: string, bytes: Uint8Array, meta: StoredFileMeta): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    await this.putObject(uploadPath(uploadId), bytes, 'application/octet-stream');
    await this.putObject(uploadMetaPath(uploadId), JSON.stringify(meta), 'application/json');
    return uploadPath(uploadId);
  }

  async saveUploadMeta(uploadId: string, meta: StoredFileMeta): Promise<void> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    await this.putObject(uploadMetaPath(uploadId), JSON.stringify(meta), 'application/json');
  }

  async readUpload(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    // Meta first: it only exists once the server has checked the bytes.
    const metaRaw = await this.getObject(uploadMetaPath(uploadId));
    if (!metaRaw) return null;
    const bin = await this.getObject(uploadPath(uploadId));
    if (!bin) return null;
    try {
      return { bytes: bin, meta: JSON.parse(Buffer.from(metaRaw).toString('utf8')) as StoredFileMeta };
    } catch {
      return null;
    }
  }

  async savePdf(orderId: string, bytes: Uint8Array): Promise<string> {
    if (!ID_RE.test(orderId)) throw new Error('Invalid order id');
    await this.putObject(pdfPath(orderId), bytes, 'application/pdf');
    return pdfPath(orderId);
  }

  readFile(rel: string): Promise<Uint8Array | null> {
    return this.getObject(rel);
  }

  async deleteFile(rel: string): Promise<void> {
    await this.deleteMany([safePath(rel)]);
  }

  private async deleteMany(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
      const chunk = paths.slice(i, i + DELETE_CHUNK).map(safePath);
      await this.req(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', ...this.json({ prefixes: chunk }) });
    }
  }

  /**
   * Browser → bucket upload (Vercel caps request bodies at 4.5 MB). Returns a one-time
   * signed PUT URL for uploads/<id>.bin (no upsert: a second PUT is refused). The bucket's
   * size limit applies; the server validates the bytes before writing the meta.
   */
  async createDirectUpload(uploadId: string): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    const res = await this.req(`/storage/v1/object/upload/sign/${BUCKET}/${uploadPath(uploadId)}`, {
      method: 'POST',
      ...this.json({}),
    });
    const { url } = (await res.json()) as { url?: string };
    if (!url || !url.startsWith('/object/upload/sign/') || !url.includes('token=')) {
      throw new Error('[supabase] bad signed upload url');
    }
    return `${this.base}/storage/v1${url}`;
  }

  /** Short-lived signed download URL (admin only; Vercel caps response bodies at 4.5 MB). */
  async signedDownloadUrl(rel: string, downloadName: string, expiresInSec = 60): Promise<string | null> {
    const res = await this.req(`/storage/v1/object/sign/${BUCKET}/${safePath(rel)}`, {
      method: 'POST',
      ...this.json({ expiresIn: expiresInSec }),
      allowNotFound: true,
    });
    if (!res.ok) return null;
    const { signedURL } = (await res.json()) as { signedURL?: string };
    if (!signedURL || !signedURL.startsWith('/object/sign/') || !signedURL.includes('?token=')) return null;
    return `${this.base}/storage/v1${signedURL}&download=${encodeURIComponent(downloadName)}`;
  }

  /* ───────────── orders ───────────── */

  /**
   * First write wins: a duplicate orderId (a retry that reached another serverless
   * instance) never overwrites the stored record. Later changes go through updateOrder.
   */
  async saveOrder(record: OrderRecord): Promise<void> {
    if (!ID_RE.test(record.orderId)) throw new Error('Invalid order id');
    await this.req('/rest/v1/orders?on_conflict=order_id', {
      method: 'POST',
      ...this.json({ order_id: record.orderId, created_at: record.createdAt, record }, 'resolution=ignore-duplicates,return=minimal'),
    });
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    if (!ID_RE.test(orderId)) return null;
    const res = await this.req(`/rest/v1/orders?select=record&order_id=eq.${encodeURIComponent(orderId)}&limit=1`);
    const rows = (await res.json()) as { record: OrderRecord }[];
    return rows[0]?.record ?? null;
  }

  /** Newest first, at most 1000 (the admin list). */
  async listOrders(): Promise<OrderRecord[]> {
    const res = await this.req('/rest/v1/orders?select=record&order=created_at.desc&limit=1000');
    const rows = (await res.json()) as { record: OrderRecord }[];
    return rows.map((r) => r.record);
  }

  /** Atomic merge in Postgres (rpc patch_order: record = record || patch). */
  async updateOrder(orderId: string, patch: Partial<Pick<OrderRecord, 'status' | 'notified'>>) {
    if (!ID_RE.test(orderId)) return null;
    const clean: Record<string, unknown> = {};
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.notified !== undefined) clean.notified = patch.notified;
    const res = await this.req('/rest/v1/rpc/patch_order', { method: 'POST', ...this.json({ p_id: orderId, p_patch: clean }) });
    const out = (await res.json()) as OrderRecord | null;
    return out ?? null;
  }

  /* ───────────── settings ───────────── */

  /** Throws on outage. Defaults only when the row is missing or fails validation. */
  async getSettings(): Promise<ShopSettings> {
    const res = await this.req('/rest/v1/settings?select=data&id=eq.1&limit=1');
    const rows = (await res.json()) as { data: unknown }[];
    if (!rows[0]) return structuredClone(DEFAULT_SETTINGS);
    const parsed = parseStoredSettings(rows[0].data);
    if (parsed.ok) return parsed.settings;
    console.error('[storage] stored settings are invalid, using defaults:', parsed.issuePaths);
    return structuredClone(DEFAULT_SETTINGS);
  }

  async saveSettings(settings: ShopSettings): Promise<void> {
    await this.req('/rest/v1/settings?on_conflict=id', {
      method: 'POST',
      ...this.json({ id: 1, data: settings, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal'),
    });
  }

  /* ───────────── analytics & customers ───────────── */

  async recordEvent(e: AnalyticsEvent): Promise<void> {
    await this.req('/rest/v1/events', { method: 'POST', ...this.json(eventToRow(e), 'return=minimal') });
  }

  /** Oldest first; pages through PostgREST's 1000-row cap with Range headers. */
  async listEvents(since: Date): Promise<AnalyticsEvent[]> {
    const iso = encodeURIComponent(since.toISOString());
    const out: AnalyticsEvent[] = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      const res = await this.req(
        `/rest/v1/events?select=ts,type,visitor,path,step,source,device,city,region,country,meta&ts=gte.${iso}&order=ts.asc,id.asc`,
        { headers: { Range: `${from}-${from + PAGE_ROWS - 1}`, 'Range-Unit': 'items' }, timeoutMs: OBJECT_TIMEOUT_MS },
      );
      // Each page is converted before the next one is requested.
      const rows = (await res.json()) as Record<string, unknown>[];
      for (const r of rows) out.push(rowToEvent(r));
      if (rows.length < PAGE_ROWS) return out;
    }
  }

  async upsertCustomerFromOrder(record: OrderRecord): Promise<void> {
    const c = record.customer;
    await this.req('/rest/v1/rpc/upsert_customer', {
      method: 'POST',
      ...this.json({
        p_phone: c.phone,
        p_name: c.name ?? null,
        p_governorate: c.governorate,
        p_district: c.district,
        p_landmark: c.landmark,
        p_at: record.createdAt,
        p_order_id: record.orderId,
        p_display_no: record.displayNo,
        p_total_iqd: record.price.totalIqd ?? 0,
      }),
    });
  }

  async listCustomers(): Promise<CustomerRecord[]> {
    const rows = await this.selectAllPaged('/rest/v1/customers?select=*&order=last_order_at.desc,phone.asc');
    return rows.map(rowToCustomer);
  }

  /** Deletes analytics events older than `cutoff`. Returns `events:<n>` (empty when none). Never touches customers. */
  async purgeEventsOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]> {
    const iso = encodeURIComponent(cutoff.toISOString());
    if (dryRun) {
      const res = await this.req(`/rest/v1/events?select=id&ts=lt.${iso}&limit=${DRY_RUN_COUNT_LIMIT}`);
      const n = ((await res.json()) as unknown[]).length;
      return n ? [`events:${n}`] : [];
    }
    const res = await this.req(`/rest/v1/events?select=id&ts=lt.${iso}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    const n = ((await res.json().catch(() => [])) as unknown[]).length;
    return n ? [`events:${n}`] : [];
  }

  /* ───────────── retention ───────────── */

  private async listPrefix(prefix: 'uploads' | 'orders'): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const res = await this.req(`/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        ...this.json({ prefix, limit: PAGE_ROWS, offset, sortBy: { column: 'created_at', order: 'asc' } }),
      });
      const page = (await res.json()) as ListedObject[];
      out.push(...page);
      if (page.length < PAGE_ROWS) return out;
    }
  }

  /**
   * Retention purge (Vercel Cron → /api/cron/purge). Removes orders created before `cutoff`
   * with their PDF and design, uploads older than `cutoff` that no kept order uses, and
   * never-committed uploads (.bin without .json) older than `orphanCutoff`.
   * Returns the paths (and `order:<id>` rows) removed, or that would be when dryRun.
   */
  async purgeOlderThan(cutoff: Date, dryRun: boolean, orphanCutoff = new Date(Date.now() - ORPHAN_UPLOAD_MAX_AGE_MS)): Promise<string[]> {
    const removed: string[] = [];
    const iso = encodeURIComponent(cutoff.toISOString());
    const oldRes = await this.req(`/rest/v1/orders?select=order_id,files:record->files&created_at=lt.${iso}&limit=${PURGE_ORDER_LIMIT}`);
    const old = (await oldRes.json()) as { order_id: string; files: OrderRecord['files'] | null }[];
    const keptRes = await this.req(`/rest/v1/orders?select=design:record->files->>designPath&created_at=gte.${iso}&limit=${PURGE_ORDER_LIMIT}`);
    const kept = new Set(((await keptRes.json()) as { design: string | null }[]).map((r) => r.design).filter(Boolean));

    const files = new Set<string>();
    for (const o of old) {
      if (o.files?.pdfPath && PATH_RE.test(o.files.pdfPath)) files.add(o.files.pdfPath);
      const d = o.files?.designPath;
      if (d && PATH_RE.test(d) && !kept.has(d)) {
        files.add(d);
        files.add(metaPathForDesign(d));
      }
      removed.push(`order:${o.order_id}`);
    }

    const uploads = await this.listPrefix('uploads');
    const names = new Set(uploads.map((u) => u.name));
    for (const u of uploads) {
      if (!u.name.endsWith('.bin')) continue;
      const rel = `uploads/${u.name}`;
      if (!PATH_RE.test(rel) || kept.has(rel)) continue;
      const created = u.created_at ? new Date(u.created_at) : null;
      if (!created) continue;
      const committed = names.has(metaPathForDesign(u.name));
      if (created < cutoff || (!committed && created < orphanCutoff)) {
        files.add(rel);
        if (committed) files.add(metaPathForDesign(rel));
      }
    }
    // Orphan metas (bin already gone) older than the cutoff.
    for (const u of uploads) {
      if (!u.name.endsWith('.json')) continue;
      const rel = `uploads/${u.name}`;
      const created = u.created_at ? new Date(u.created_at) : null;
      if (PATH_RE.test(rel) && created && created < cutoff && !names.has(u.name.replace(/\.json$/, '.bin'))) files.add(rel);
    }

    removed.push(...files);
    if (!dryRun) {
      await this.deleteMany([...files]);
      if (old.length) await this.req(`/rest/v1/orders?created_at=lt.${iso}`, { method: 'DELETE' });
    }
    return removed;
  }
}
