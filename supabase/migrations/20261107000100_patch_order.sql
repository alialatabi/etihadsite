-- Atomic partial update of an order (status / notified) without read-modify-write races
-- between serverless instances. SECURITY INVOKER: runs with the caller's rights, and only
-- the server's secret key may call it.
create or replace function public.patch_order(p_id text, p_patch jsonb)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.orders
     set record = record || (p_patch - 'orderId' - 'createdAt' - 'files' - 'price' - 'offer' - 'spec' - 'layout' - 'customer' - 'design' - 'displayNo')
   where order_id = p_id
  returning record;
$$;

revoke all on function public.patch_order(text, jsonb) from public, anon, authenticated;
grant execute on function public.patch_order(text, jsonb) to service_role;

-- Only what the server stores: raw design bytes, their meta, and sheet PDFs.
update storage.buckets
   set allowed_mime_types = array['application/octet-stream', 'application/json', 'application/pdf']
 where id = 'etihad';
