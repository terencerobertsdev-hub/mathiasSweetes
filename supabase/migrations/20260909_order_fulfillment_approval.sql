alter table public.orders
  add column if not exists pickup_time_confirmed text,
  add column if not exists address_released_at timestamptz,
  add column if not exists address_released_by uuid references auth.users(id);

create table if not exists public.pickup_address_access_log (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  released_at timestamptz not null default now()
);

alter table public.pickup_address_access_log enable row level security;
revoke all on public.pickup_address_access_log from anon, authenticated;

create policy "Admins can view pickup access logs"
on public.pickup_address_access_log for select
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create or replace function public.approve_pickup_release(
  p_order_id uuid,
  p_admin_user_id uuid,
  p_pickup_time text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if char_length(trim(p_pickup_time)) not between 5 and 100 then raise exception 'Invalid pickup time'; end if;
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then raise exception 'Administrator required'; end if;

  update public.orders
  set pickup_time_confirmed = trim(p_pickup_time), address_released_at = now(), address_released_by = p_admin_user_id
  where id = p_order_id and status = 'paid' and address_released_at is null;
  if not found then raise exception 'Paid order unavailable or already released'; end if;

  insert into public.pickup_address_access_log(order_id, admin_user_id) values (p_order_id, p_admin_user_id);
  return true;
end;
$$;

revoke all on function public.approve_pickup_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_pickup_release(uuid, uuid, text) to service_role;
