create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  email_consent boolean not null default true,
  sms_consent boolean not null default false,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  constraint newsletter_name_length check (char_length(name) between 1 and 80),
  constraint newsletter_email_length check (char_length(email) between 5 and 254),
  constraint newsletter_sms_requires_phone check (not sms_consent or phone is not null)
);

alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from anon, authenticated;

drop policy if exists "Admins can view newsletter subscribers" on public.newsletter_subscribers;
create policy "Admins can view newsletter subscribers" on public.newsletter_subscribers
for select to authenticated using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create or replace function public.subscribe_to_newsletter(subscriber jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare subscriber_id uuid; normalized_phone text;
begin
  if char_length(trim(subscriber->>'name')) not between 1 and 80 then raise exception 'Valid name required'; end if;
  if char_length(trim(subscriber->>'email')) not between 5 and 254 or position('@' in subscriber->>'email') < 2 then raise exception 'Valid email required'; end if;
  normalized_phone := nullif(trim(subscriber->>'phone'), '');
  if coalesce((subscriber->>'sms_consent')::boolean, false) and normalized_phone is null then raise exception 'Phone required for SMS consent'; end if;
  insert into public.newsletter_subscribers(name,email,phone,email_consent,sms_consent,unsubscribed_at)
  values(trim(subscriber->>'name'),lower(trim(subscriber->>'email')),normalized_phone,true,coalesce((subscriber->>'sms_consent')::boolean,false),null)
  on conflict(email) do update set name=excluded.name,phone=excluded.phone,email_consent=true,sms_consent=excluded.sms_consent,unsubscribed_at=null
  returning id into subscriber_id;
  return subscriber_id;
end; $$;

revoke all on function public.subscribe_to_newsletter(jsonb) from public;
grant execute on function public.subscribe_to_newsletter(jsonb) to anon, authenticated;
