-- Al-Ittihad Print: storage for the `supabase` StorageAdapter (src/lib/storage/supabase.ts).
-- Only the server (service/secret key) touches these. RLS is ON with NO policies, so the
-- public anon/publishable key can read or write nothing.

create table if not exists public.orders (
  order_id   text primary key check (order_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_at timestamptz not null,
  record     jsonb not null
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.orders   enable row level security;
alter table public.settings enable row level security;
revoke all on public.orders, public.settings from anon, authenticated;

-- Private bucket for designs (uploads/<id>.bin + .json) and sheet PDFs (orders/<id>.pdf).
insert into storage.buckets (id, name, public, file_size_limit)
values ('etihad', 'etihad', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
