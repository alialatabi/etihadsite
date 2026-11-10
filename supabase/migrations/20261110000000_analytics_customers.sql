-- First-party analytics events (no IP / user agent; visitor = daily-rotating salted hash)
-- and the permanent customers list. Server (secret key) only: RLS on, NO policies.

create table if not exists public.events (
  id      bigserial primary key,
  ts      timestamptz not null,
  type    text not null check (type in ('pageview', 'step', 'upload', 'order', 'install')),
  visitor text not null,
  path    text,
  step    text,
  source  text,
  device  text,
  city    text,
  region  text,
  country text,
  meta    jsonb
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_type_ts_idx on public.events (type, ts);

-- Never purged by the retention cron (owner decision 2026-11-10).
create table if not exists public.customers (
  phone           text primary key check (phone ~ '^964[0-9]{10}$'),
  name            text,
  governorate     text not null,
  district        text not null,
  landmark        text not null,
  first_order_at  timestamptz not null,
  last_order_at   timestamptz not null,
  orders_count    int not null default 1,
  total_iqd       bigint not null default 0,
  last_order_id   text not null,
  last_display_no text not null
);
create index if not exists customers_last_order_at_idx on public.customers (last_order_at desc);

alter table public.events    enable row level security;
alter table public.customers enable row level security;
revoke all on public.events, public.customers from anon, authenticated;
revoke all on sequence public.events_id_seq from anon, authenticated;

-- Atomic insert-or-increment so concurrent orders from one phone never race.
-- SECURITY INVOKER: only the server's secret key (service_role) may call it.
create or replace function public.upsert_customer(
  p_phone text, p_name text, p_governorate text, p_district text, p_landmark text,
  p_at timestamptz, p_order_id text, p_display_no text, p_total_iqd bigint
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.customers as c
    (phone, name, governorate, district, landmark, first_order_at, last_order_at,
     orders_count, total_iqd, last_order_id, last_display_no)
  values
    (p_phone, p_name, p_governorate, p_district, p_landmark, p_at, p_at,
     1, coalesce(p_total_iqd, 0), p_order_id, p_display_no)
  on conflict (phone) do update set
    name            = coalesce(excluded.name, c.name),
    governorate     = excluded.governorate,
    district        = excluded.district,
    landmark        = excluded.landmark,
    first_order_at  = least(c.first_order_at, excluded.first_order_at),
    last_order_at   = greatest(c.last_order_at, excluded.last_order_at),
    orders_count    = c.orders_count + 1,
    total_iqd       = c.total_iqd + coalesce(p_total_iqd, 0),
    last_order_id   = case when excluded.last_order_at >= c.last_order_at then excluded.last_order_id else c.last_order_id end,
    last_display_no = case when excluded.last_order_at >= c.last_order_at then excluded.last_display_no else c.last_display_no end;
$$;

revoke all on function public.upsert_customer(text, text, text, text, text, timestamptz, text, text, bigint) from public, anon, authenticated;
grant execute on function public.upsert_customer(text, text, text, text, text, timestamptz, text, text, bigint) to service_role;
