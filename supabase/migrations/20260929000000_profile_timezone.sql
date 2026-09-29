-- Persisted per-account IANA timezone validation for date defaults and calendar views.
create or replace function public.is_valid_iana_timezone(value text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_timezone_names where name = value);
$$;

alter table public.profiles
  add constraint profiles_timezone_iana
  check (public.is_valid_iana_timezone(timezone));

revoke all on function public.is_valid_iana_timezone(text) from public, anon;
grant execute on function public.is_valid_iana_timezone(text) to authenticated;
