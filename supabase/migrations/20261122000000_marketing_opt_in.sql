-- Optional WhatsApp-offers opt-in (owner request 2026-11-21). The customer ticks an unticked-by-default box on the
-- delivery step. The LATEST order's explicit choice wins: an order without the box ticked withdraws a stored yes.
-- marketing_opt_in_at is the time of the latest opt-in order (null once withdrawn / never opted in).
-- Server (secret key) only: RLS stays on with NO policies (set in 20261110000000_analytics_customers.sql).
--
-- APPLY THIS BEFORE DEPLOYING the code that calls upsert_customer_v2. (Without it the code falls back to the old
-- upsert_customer, so customers are still recorded, but nobody's opt-in is stored.)

alter table public.customers
  add column if not exists marketing_opt_in    boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;

-- A NEW function next to upsert_customer (which stays, so the previous deployment keeps working during the rollout):
-- a 10-argument overload of the same name would make PostgREST's RPC resolution ambiguous. Same body as v1 plus
-- the opt-in, which follows the same "latest order wins" rule as last_order_id (an out-of-order older order never
-- overrides a newer choice). SECURITY INVOKER: only the server's secret key (service_role) may call it.
create or replace function public.upsert_customer_v2(
  p_phone text, p_name text, p_governorate text, p_district text, p_landmark text,
  p_at timestamptz, p_order_id text, p_display_no text, p_total_iqd bigint,
  p_marketing_opt_in boolean
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.customers as c
    (phone, name, governorate, district, landmark, first_order_at, last_order_at,
     orders_count, total_iqd, last_order_id, last_display_no, marketing_opt_in, marketing_opt_in_at)
  values
    (p_phone, p_name, p_governorate, p_district, p_landmark, p_at, p_at,
     1, coalesce(p_total_iqd, 0), p_order_id, p_display_no,
     coalesce(p_marketing_opt_in, false), case when coalesce(p_marketing_opt_in, false) then p_at else null end)
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
    last_display_no = case when excluded.last_order_at >= c.last_order_at then excluded.last_display_no else c.last_display_no end,
    marketing_opt_in    = case when excluded.last_order_at >= c.last_order_at then excluded.marketing_opt_in else c.marketing_opt_in end,
    marketing_opt_in_at = case when excluded.last_order_at >= c.last_order_at then excluded.marketing_opt_in_at else c.marketing_opt_in_at end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default and Supabase default privileges add anon/authenticated.
revoke all on function public.upsert_customer_v2(text, text, text, text, text, timestamptz, text, text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.upsert_customer_v2(text, text, text, text, text, timestamptz, text, text, bigint, boolean) to service_role;
