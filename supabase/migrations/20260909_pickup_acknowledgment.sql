alter table public.orders
  add column if not exists pickup_acknowledged boolean not null default false,
  add column if not exists fulfillment_method text not null default 'local_pickup',
  add column if not exists pickup_address_snapshot text;

create or replace function public.place_order(customer jsonb, items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_order_id uuid;
  item_count integer;
  computed_subtotal integer;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 30 then
    raise exception 'Order must contain between 1 and 30 items';
  end if;
  if char_length(trim(customer->>'name')) not between 2 and 100 then
    raise exception 'Valid customer name is required';
  end if;
  if char_length(trim(customer->>'email')) not between 5 and 254 then
    raise exception 'Valid email is required';
  end if;
  if char_length(trim(customer->>'phone')) not between 7 and 30 then
    raise exception 'Valid phone is required';
  end if;
  if nullif(customer->>'requested_date', '')::date < current_date then
    raise exception 'Pickup date cannot be in the past';
  end if;
  if nullif(customer->>'requested_date', '') is null then
    raise exception 'Pickup date is required';
  end if;
  if coalesce((customer->>'pickup_acknowledged')::boolean, false) is not true then
    raise exception 'Local pickup must be acknowledged';
  end if;

  select sum(x.quantity)::integer into item_count
  from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
  join public.products p on p.id = x.product_id and p.is_active
  where x.quantity between 1 and 24;

  if item_count is null or
    (select count(*) from jsonb_to_recordset(items) as y(product_id bigint, quantity integer)) <>
    (select count(*) from jsonb_to_recordset(items) as y(product_id bigint, quantity integer)
      join public.products p on p.id = y.product_id and p.is_active
      where y.quantity between 1 and 24) then
    raise exception 'Order contains an invalid product or quantity';
  end if;

  computed_subtotal := (item_count / 4) * 1000 + (item_count % 4) * 300;
  insert into public.orders(
    customer_name, customer_email, customer_phone, requested_date, notes,
    subtotal_in_cents, pickup_acknowledged, fulfillment_method, pickup_address_snapshot
  ) values (
    trim(customer->>'name'), lower(trim(customer->>'email')),
    nullif(trim(customer->>'phone'), ''), nullif(customer->>'requested_date', '')::date,
    nullif(trim(customer->>'notes'), ''), computed_subtotal, true, 'local_pickup',
    null
  ) returning id into new_order_id;

  insert into public.order_items(order_id, product_id, product_title, unit_price_in_cents, quantity)
  select new_order_id, p.id, p.title, p.price_in_cents, x.quantity
  from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
  join public.products p on p.id = x.product_id and p.is_active;

  return new_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;
