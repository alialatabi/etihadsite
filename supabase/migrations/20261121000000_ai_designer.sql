-- In-site AI sticker designer: daily usage counters, generated designs, blocked IPs.
-- These tables hold the FULL client IP (owner decision D9, 2026-11-21) next to `ip_key`, a
-- keyed hash used as the limit/block key. Analytics events still never carry an IP.
-- Server (secret key) only: RLS on, NO policies, nothing granted to anon/authenticated.

-- One row per (shop day, ip_key, kind). ip_key '' = site-only row (per-IP check skipped).
create table if not exists public.ai_usage (
  day     date not null,
  ip_key  text not null,
  ip      text,
  kind    text not null check (kind in ('image', 'brief')),
  count   int not null default 0,
  last_at timestamptz,
  primary key (day, ip_key, kind)
);

-- Kept forever (the purge skips uploads referenced here).
create table if not exists public.ai_generations (
  id         text primary key,
  created_at timestamptz not null default now(),
  day        date,
  ip         text,
  ip_key     text,
  shape      text,
  corners    text,
  width_um   int,
  height_um  int,
  idea       text,
  lines      jsonb,
  has_refs   boolean,
  model      text,
  upload_id  text unique,
  order_id   text
);
create index if not exists ai_generations_created_at_idx on public.ai_generations (created_at desc);
create index if not exists ai_generations_ip_key_idx on public.ai_generations (ip_key);

create table if not exists public.ai_blocks (
  ip_key     text primary key,
  ip         text,
  created_at timestamptz not null default now()
);

alter table public.ai_usage       enable row level security;
alter table public.ai_generations enable row level security;
alter table public.ai_blocks      enable row level security;
revoke all on public.ai_usage, public.ai_generations, public.ai_blocks from anon, authenticated;

-- Atomic reserve: one advisory lock per (day, kind) serialises concurrent calls across
-- serverless instances. Order: blocked → site cap → per-IP cap → count one use.
-- Returns {"status": 'ok'|'ip_limit'|'site_limit'|'blocked', "used": this ip_key's count after the call}.
-- SECURITY INVOKER: only the server's secret key (service_role) may call it.
create or replace function public.reserve_ai(
  p_day date, p_ip_key text, p_ip text, p_kind text, p_per_ip int, p_site int
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_used int;
  v_site int;
begin
  perform pg_advisory_xact_lock(hashtext('ai|' || p_day::text || '|' || p_kind));

  select u.count into v_used
    from public.ai_usage u
   where u.day = p_day and u.ip_key = p_ip_key and u.kind = p_kind;
  v_used := coalesce(v_used, 0);

  -- Blocked by key, or by the full IP: a new SESSION_SECRET changes every ip_key, and must not lift blocks.
  if exists (select 1 from public.ai_blocks b where b.ip_key = p_ip_key or (p_ip <> '' and b.ip = p_ip)) then
    return jsonb_build_object('status', 'blocked', 'used', v_used);
  end if;

  select coalesce(sum(u.count), 0) into v_site
    from public.ai_usage u
   where u.day = p_day and u.kind = p_kind;
  if v_site >= p_site then
    return jsonb_build_object('status', 'site_limit', 'used', v_used);
  end if;

  if p_ip_key <> '' and v_used >= p_per_ip then
    return jsonb_build_object('status', 'ip_limit', 'used', v_used);
  end if;

  insert into public.ai_usage as a (day, ip_key, ip, kind, count, last_at)
  values (p_day, p_ip_key, p_ip, p_kind, 1, now())
  on conflict (day, ip_key, kind) do update set
    count   = a.count + 1,
    last_at = now(),
    ip      = excluded.ip
  returning a.count into v_used;

  return jsonb_build_object('status', 'ok', 'used', v_used);
end;
$$;

-- Gives back one reserved use (a failed try does not count). Never below 0.
create or replace function public.release_ai(p_day date, p_ip_key text, p_kind text)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.ai_usage
     set count = greatest(count - 1, 0)
   where day = p_day and ip_key = p_ip_key and kind = p_kind;
$$;

revoke all on function public.reserve_ai(date, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.reserve_ai(date, text, text, text, int, int) to service_role;
revoke all on function public.release_ai(date, text, text) from public, anon, authenticated;
grant execute on function public.release_ai(date, text, text) to service_role;
