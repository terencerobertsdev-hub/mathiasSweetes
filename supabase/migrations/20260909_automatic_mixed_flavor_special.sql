create or replace function public.place_order(customer jsonb, items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_order_id uuid;
  computed_subtotal integer;
  requested_payment_method text;
  active_special public.specials%rowtype;
  qualifying_item_count integer := 0;
  requested_special_id bigint;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 30 then raise exception 'Order must contain between 1 and 30 items'; end if;
  if char_length(trim(customer->>'name')) not between 2 and 100 then raise exception 'Valid customer name is required'; end if;
  if char_length(trim(customer->>'email')) not between 5 and 254 then raise exception 'Valid email is required'; end if;
  if char_length(trim(customer->>'phone')) not between 7 and 30 then raise exception 'Valid phone is required'; end if;
  if nullif(customer->>'requested_date', '')::date < current_date or nullif(customer->>'requested_date', '') is null then raise exception 'Valid pickup date is required'; end if;
  if coalesce((customer->>'pickup_acknowledged')::boolean, false) is not true then raise exception 'Local pickup must be acknowledged'; end if;
  requested_payment_method := customer->>'payment_method';
  if requested_payment_method not in ('card', 'cash') then raise exception 'Payment method must be card or cash'; end if;

  if exists (
    select 1 from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
    left join public.products p on p.id = x.product_id and p.is_active
    where x.product_id is null or x.quantity not between 1 and 24 or p.id is null
  ) then raise exception 'Order contains an invalid product or quantity'; end if;

  select * into active_special from public.specials where is_active limit 1;
  requested_special_id := nullif(customer->>'special_id', '')::bigint;
  if requested_special_id is not null and requested_special_id is distinct from active_special.id then
    raise exception 'The special changed while this order was being prepared. Refresh the shop and review the total.';
  end if;
  select coalesce(sum(x.quantity * p.price_in_cents), 0)::integer into computed_subtotal
  from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
  join public.products p on p.id = x.product_id and p.is_active;

  if active_special.id is not null then
    select coalesce(sum(x.quantity), 0)::integer into qualifying_item_count
    from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
    join public.products p on p.id = x.product_id and p.is_active
    where p.price_in_cents = active_special.qualifying_unit_price_in_cents;

    computed_subtotal := computed_subtotal -
      (qualifying_item_count / active_special.qualifying_quantity) *
      ((active_special.qualifying_quantity * active_special.qualifying_unit_price_in_cents) - active_special.bundle_price_in_cents);
  end if;
  if computed_subtotal < 1 then raise exception 'Order total is invalid'; end if;

  insert into public.orders(customer_name,customer_email,customer_phone,requested_date,notes,subtotal_in_cents,pickup_acknowledged,fulfillment_method,pickup_address_snapshot,payment_method)
  values(trim(customer->>'name'),lower(trim(customer->>'email')),nullif(trim(customer->>'phone'),''),nullif(customer->>'requested_date','')::date,
    nullif(trim(customer->>'notes'),''),computed_subtotal,true,'local_pickup',null,requested_payment_method) returning id into new_order_id;

  insert into public.order_items(order_id,product_id,special_id,product_title,unit_price_in_cents,quantity,stripe_price_id)
  select new_order_id,p.id,
    case when active_special.id is not null and p.price_in_cents = active_special.qualifying_unit_price_in_cents then active_special.id end,
    p.title,p.price_in_cents,x.quantity,
    case when active_special.id is not null and p.price_in_cents = active_special.qualifying_unit_price_in_cents then active_special.stripe_price_id end
  from jsonb_to_recordset(items) as x(product_id bigint, quantity integer)
  join public.products p on p.id = x.product_id and p.is_active;
  return new_order_id;
end; $$;

revoke all on function public.place_order(jsonb,jsonb) from public;
grant execute on function public.place_order(jsonb,jsonb) to anon, authenticated;
