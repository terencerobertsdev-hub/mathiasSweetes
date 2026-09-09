alter table public.orders
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz;

create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  order_id uuid references public.orders(id) on delete set null,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

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
declare
  inserted_count integer;
begin
  if p_event_id !~ '^evt_' or p_checkout_session_id !~ '^cs_' then
    raise exception 'Invalid Stripe identifiers';
  end if;
  if p_payment_status not in ('paid', 'unpaid', 'no_payment_required', 'failed') then
    raise exception 'Invalid payment status';
  end if;

  insert into public.stripe_webhook_events(event_id, event_type, order_id)
  values (p_event_id, p_payment_status, p_order_id)
  on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;

  update public.orders
  set stripe_checkout_session_id = p_checkout_session_id,
      stripe_payment_intent_id = p_payment_intent_id,
      payment_status = p_payment_status,
      status = case when p_payment_status in ('paid', 'no_payment_required') then 'paid' else status end,
      paid_at = case when p_payment_status in ('paid', 'no_payment_required') then coalesce(paid_at, now()) else paid_at end
  where id = p_order_id
    and subtotal_in_cents = p_amount_total;

  if not found then raise exception 'Order total did not match the Stripe payment'; end if;
  return true;
end;
$$;

revoke all on function public.record_stripe_payment(text, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(text, uuid, text, text, text, integer) to service_role;
