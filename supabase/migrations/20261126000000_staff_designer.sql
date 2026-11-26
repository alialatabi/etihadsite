-- Staff designer accounts (owner request 2026-11-26). Shop staff log in at /team/login and use the AI sticker
-- designer with their own daily limit; their designs are saved in the admin gallery with the staff name.
--
-- APPLY THIS BEFORE DEPLOYING the code that reads public.staff_accounts. Without it: customers keep working
-- (a generation insert that fails on an unknown column is retried without instructions / staff_id), the staff
-- login says the feature is not ready, and /admin/staff shows the same notice.
--
-- Server (secret key) only: RLS on with NO policies, nothing for anon / authenticated.

create table if not exists public.staff_accounts (
  id                  text primary key,
  name                text not null,
  phone               text not null unique,
  password_hash       text not null,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz,
  password_changed_at timestamptz not null default now()
);

alter table public.staff_accounts enable row level security;
revoke all on public.staff_accounts from anon, authenticated;

-- The inline check of 20261121000000_ai_designer.sql is named ai_usage_kind_check by Postgres.
-- Staff use is counted under its own kinds, so a staff flood never uses up the customers' daily budget.
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check
  check (kind in ('image', 'brief', 'staff_image', 'staff_brief'));

-- instructions: the Arabic design instructions as confirmed. staff_id: who made it (null for a customer).
-- No foreign key on staff_id: accounts are never hard-deleted, and old rows stay valid.
alter table public.ai_generations
  add column if not exists instructions text,
  add column if not exists staff_id     text;

create index if not exists ai_generations_staff_id_idx on public.ai_generations (staff_id);

notify pgrst, 'reload schema';
