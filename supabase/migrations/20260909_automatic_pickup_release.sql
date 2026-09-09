alter table public.pickup_address_access_log
  alter column admin_user_id drop not null,
  add column if not exists release_method text not null default 'stripe_payment';

create or replace function public.record_stripe_payment(
  p_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_payment_status text,
  p_amount_total integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare inserted_count integer;
begin
  if p_event_id !~ '^evt_' or p_checkout_session_id !~ '^cs_' then raise exception 'Invalid Stripe identifiers'; end if;
  if p_payment_status not in ('paid', 'unpaid', 'no_payment_required', 'failed') then raise exception 'Invalid payment status'; end if;

  insert into public.stripe_webhook_events(event_id, event_type, order_id)
  values (p_event_id, p_payment_status, p_order_id) on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;

  update public.orders
  set stripe_checkout_session_id = p_checkout_session_id,
      stripe_payment_intent_id = p_payment_intent_id,
      payment_status = p_payment_status,
      status = case when p_payment_status in ('paid', 'no_payment_required') then 'paid' else status end,
      paid_at = case when p_payment_status in ('paid', 'no_payment_required') then coalesce(paid_at, now()) else paid_at end,
      address_released_at = case when p_payment_status in ('paid', 'no_payment_required') then coalesce(address_released_at, now()) else address_released_at end,
      pickup_time_confirmed = case when p_payment_status in ('paid', 'no_payment_required') then coalesce(pickup_time_confirmed, requested_date::text) else pickup_time_confirmed end
  where id = p_order_id and subtotal_in_cents = p_amount_total;
  if not found then raise exception 'Order total did not match the Stripe payment'; end if;

  if p_payment_status in ('paid', 'no_payment_required') then
    insert into public.pickup_address_access_log(order_id, admin_user_id, release_method)
    values (p_order_id, null, 'stripe_payment');
  end if;
  return true;
end;
$$;

revoke all on function public.record_stripe_payment(text, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(text, uuid, text, text, text, integer) to service_role;
