-- Correctness reads for large workspaces and lazy history.
create or replace function public.load_site_read_summaries(p_site_ids uuid[])
returns table(site_id uuid, latest_log jsonb, latest_report jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_site_ids is null or pg_catalog.cardinality(p_site_ids) > 100 then
    raise exception 'site summary batch must contain at most 100 ids';
  end if;

  return query
  select s.id,
    case when l.id is null then null else pg_catalog.jsonb_build_object(
      'id', l.id, 'site_id', l.site_id, 'text', l.text, 'source_type', l.source_type,
      'source_url', l.source_url, 'observed_through', l.observed_through,
      'finalized_through', l.finalized_through, 'collected_at', l.collected_at,
      'confirmed', l.confirmed, 'capture_id', l.capture_id
    ) end,
    case when r.id is null then null else pg_catalog.jsonb_build_object(
      'id', r.id, 'site_id', r.site_id, 'open_items', r.open_items,
      'confirmed_at', r.confirmed_at, 'source_url', r.source_url
    ) end
  from public.sites s
  left join lateral (
    select l.*
    from public.logs l
    where l.site_id = s.id
      and l.owner_id = auth.uid()
      and l.confirmed
      and l.observed_through is not null
    order by l.collected_at desc, l.id desc
    limit 1
  ) l on true
  left join lateral (
    select r.*
    from public.reports r
    where r.site_id = s.id
      and r.owner_id = auth.uid()
      and r.confirmed_at is not null
    order by r.confirmed_at desc, r.id desc
    limit 1
  ) r on true
  where s.owner_id = auth.uid()
    and s.id = any(p_site_ids)
  order by s.id;
end;
$$;

revoke all on function public.load_site_read_summaries(uuid[]) from public, anon;
grant execute on function public.load_site_read_summaries(uuid[]) to authenticated;
