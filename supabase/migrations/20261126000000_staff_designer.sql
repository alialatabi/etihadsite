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
-- Defensive: drop EVERY check constraint on ai_usage that mentions `kind`, whatever its real name, so the old
-- 2-value check can never survive next to the new one (it would reject every staff row).
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.ai_usage'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_kind_check
  check (kind in ('image', 'brief', 'staff_image', 'staff_brief'));

-- instructions: the Arabic design instructions as confirmed. staff_id: who made it (null for a customer).
-- No foreign key on staff_id: accounts are never hard-deleted, and old rows stay valid.
alter table public.ai_generations
  add column if not exists instructions text,
  add column if not exists staff_id     text;

create index if not exists ai_generations_staff_id_idx on public.ai_generations (staff_id);

notify pgrst, 'reload schema';
