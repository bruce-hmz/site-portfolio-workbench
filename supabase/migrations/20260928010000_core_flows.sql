-- Atomic workbench flows. Apply only after 20260928000000_initial_production.sql.
-- Each function runs as the caller, so table RLS and composite owner FKs remain active.

create unique index tasks_one_open_review_per_site
on public.tasks(owner_id, site_id, type)
where type = '复盘' and status <> '完成';

create or replace function public.confirm_report(
  p_report_id uuid, p_site_id uuid, p_expected_site_version bigint,
  p_raw_text text, p_completed text, p_evidence text, p_open_items text,
  p_next_step text, p_next_action_date date, p_review_date date,
  p_source_url text, p_observed_through date, p_finalized_through date
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if p_report_id is null or p_site_id is null or p_next_action_date is null or p_review_date is null
     or p_observed_through is null or nullif(pg_catalog.btrim(p_raw_text), '') is null
     or nullif(pg_catalog.btrim(p_completed), '') is null or nullif(pg_catalog.btrim(p_evidence), '') is null
     or nullif(pg_catalog.btrim(p_open_items), '') is null or nullif(pg_catalog.btrim(p_next_step), '') is null then
    raise exception 'report fields and dates are required';
  end if;
  if p_finalized_through is not null and (p_observed_through is null or p_finalized_through > p_observed_through) then
    raise exception 'finalized date exceeds observed date or observed date is missing';
  end if;
  if p_source_url is not null and p_source_url <> '' and p_source_url !~ '^https?://[^[:space:]/?#]+' then
    raise exception 'source URL must use http or https';
  end if;
  if exists (select 1 from public.reports where owner_id = auth.uid() and id = p_report_id) then
    return p_report_id;
  end if;

  update public.sites set next_action = pg_catalog.btrim(p_next_step), next_checkpoint = p_review_date,
    version = version + 1
  where owner_id = auth.uid() and id = p_site_id and version = p_expected_site_version;
  if not found then raise exception 'site missing or version conflict'; end if;

  insert into public.reports(id, site_id, raw_text, completed, evidence, open_items,
    next_step, next_action_date, review_date, source_url, confirmed_at)
  values (p_report_id, p_site_id, p_raw_text, p_completed, p_evidence, p_open_items,
    p_next_step, p_next_action_date, p_review_date, nullif(p_source_url, ''), now());

  insert into public.logs(site_id, text, source_type, source_url, observed_through,
    finalized_through, collected_at, confirmed)
  values (p_site_id, p_raw_text, '收尾报告 · 人工确认', nullif(p_source_url, ''),
    p_observed_through, p_finalized_through, now(), true);

  insert into public.tasks(site_id, title, type, due_on, source)
  values (p_site_id, p_next_step, '执行', p_next_action_date, '报告确认');

  insert into public.tasks(site_id, title, type, due_on, source)
  values (p_site_id, '阶段复盘', '复盘', p_review_date, '报告确认')
  on conflict (owner_id, site_id, type) where type = '复盘' and status <> '完成'
  do update set due_on = excluded.due_on, source = excluded.source,
    status = '待处理', version = public.tasks.version + 1;
  return p_report_id;
end;
$$;

create or replace function public.route_capture_to_log(
  p_capture_id uuid, p_expected_version bigint, p_site_id uuid, p_text text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_capture public.captures%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if nullif(pg_catalog.btrim(p_text), '') is null then raise exception 'log text is required'; end if;
  select * into v_capture from public.captures
    where owner_id = auth.uid() and id = p_capture_id for update;
  if not found or v_capture.status <> '待整理' or v_capture.version <> p_expected_version then
    raise exception 'capture missing, processed or version conflict';
  end if;
  insert into public.logs(site_id, text, source_type, capture_id)
  values (p_site_id, p_text, '随手记整理', p_capture_id) returning id into v_id;
  update public.captures set status = '已处理', processed_at = now(),
    destination_log_id = v_id, version = version + 1
  where id = p_capture_id and owner_id = auth.uid();
  return v_id;
end;
$$;

create or replace function public.route_capture_to_task(
  p_capture_id uuid, p_expected_version bigint, p_site_id uuid, p_title text, p_due_on date
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_capture public.captures%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if nullif(pg_catalog.btrim(p_title), '') is null or p_due_on is null then raise exception 'task title and date are required'; end if;
  select * into v_capture from public.captures
    where owner_id = auth.uid() and id = p_capture_id for update;
  if not found or v_capture.status <> '待整理' or v_capture.version <> p_expected_version then
    raise exception 'capture missing, processed or version conflict';
  end if;
  insert into public.tasks(site_id, title, type, due_on, source, capture_id)
  values (p_site_id, p_title, '执行', p_due_on, '随手记整理', p_capture_id) returning id into v_id;
  update public.captures set status = '已处理', processed_at = now(),
    destination_task_id = v_id, version = version + 1
  where id = p_capture_id and owner_id = auth.uid();
  return v_id;
end;
$$;

create or replace function public.route_capture_to_opportunity(
  p_capture_id uuid, p_expected_version bigint, p_problem text, p_evidence text,
  p_validation text, p_scope text, p_budget text, p_pass_condition text, p_stop_condition text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_capture public.captures%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if nullif(pg_catalog.btrim(p_problem), '') is null or nullif(pg_catalog.btrim(p_evidence), '') is null
    or nullif(pg_catalog.btrim(p_validation), '') is null or nullif(pg_catalog.btrim(p_scope), '') is null
    or nullif(pg_catalog.btrim(p_budget), '') is null or nullif(pg_catalog.btrim(p_pass_condition), '') is null
    or nullif(pg_catalog.btrim(p_stop_condition), '') is null then
    raise exception 'opportunity fields are required';
  end if;
  select * into v_capture from public.captures
    where owner_id = auth.uid() and id = p_capture_id for update;
  if not found or v_capture.status <> '待整理' or v_capture.version <> p_expected_version then
    raise exception 'capture missing, processed or version conflict';
  end if;
  insert into public.opportunities(problem, evidence, validation, scope, budget,
    pass_condition, stop_condition, capture_id)
  values (p_problem, p_evidence, p_validation, p_scope, p_budget,
    p_pass_condition, p_stop_condition, p_capture_id) returning id into v_id;
  update public.captures set status = '已处理', processed_at = now(),
    destination_opportunity_id = v_id, version = version + 1
  where id = p_capture_id and owner_id = auth.uid();
  return v_id;
end;
$$;

create or replace function public.promote_opportunity(
  p_opportunity_id uuid, p_expected_version bigint, p_site_name text, p_first_due_on date
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_opportunity public.opportunities%rowtype; v_site_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if nullif(pg_catalog.btrim(p_site_name), '') is null or p_first_due_on is null then
    raise exception 'site name and first due date are required';
  end if;
  select * into v_opportunity from public.opportunities
    where owner_id = auth.uid() and id = p_opportunity_id for update;
  if not found or v_opportunity.version <> p_expected_version
    or v_opportunity.status <> '通过' or v_opportunity.site_id is not null then
    raise exception 'opportunity missing, unapproved, promoted or version conflict';
  end if;
  insert into public.sites(name, phase, strategy, current_goal, last_decision, next_action, next_checkpoint)
  values (p_site_name, '机会验证', '推进', v_opportunity.problem,
    '机会已通过，开始最小验证', v_opportunity.validation, p_first_due_on)
  returning id into v_site_id;
  insert into public.tasks(site_id, title, type, due_on, source)
  values (v_site_id, v_opportunity.validation, '执行', p_first_due_on, '机会转入网站');
  update public.opportunities set site_id = v_site_id, version = version + 1
  where owner_id = auth.uid() and id = p_opportunity_id;
  return v_site_id;
end;
$$;

create or replace function public.set_site_strategy(
  p_site_id uuid, p_expected_version bigint, p_strategy text,
  p_condition text, p_condition_due_on date, p_archive_reason text
) returns public.sites language plpgsql security invoker set search_path = '' as $$
declare v_site public.sites%rowtype;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if p_strategy not in ('推进', '观察', '低频维护', '暂停', '归档') then raise exception 'invalid strategy'; end if;
  if p_strategy = '观察' and (nullif(pg_catalog.btrim(p_condition), '') is null or p_condition_due_on is null) then
    raise exception 'observation requires condition and check date';
  end if;
  if p_strategy = '暂停' and nullif(pg_catalog.btrim(p_condition), '') is null then
    raise exception 'pause requires restart condition';
  end if;
  if p_strategy = '归档' and nullif(pg_catalog.btrim(p_archive_reason), '') is null then
    raise exception 'archive requires reason';
  end if;
  update public.sites set strategy = p_strategy,
    last_decision = '策略调整为' || p_strategy || case
      when p_strategy in ('观察', '暂停') then '：' || pg_catalog.btrim(p_condition)
      when p_strategy = '归档' then '：' || pg_catalog.btrim(p_archive_reason) else '' end,
    strategy_condition = case when p_strategy in ('观察', '暂停') then pg_catalog.btrim(p_condition) else null end,
    strategy_condition_due_on = case when p_strategy = '观察' then p_condition_due_on else null end,
    archive_reason = case when p_strategy = '归档' then pg_catalog.btrim(p_archive_reason) else null end,
    next_checkpoint = case when p_strategy = '观察' then p_condition_due_on
                           when p_strategy in ('暂停', '归档') then null else next_checkpoint end,
    version = version + 1
  where owner_id = auth.uid() and id = p_site_id and version = p_expected_version
  returning * into v_site;
  if not found then raise exception 'site missing or version conflict'; end if;
  if p_strategy = '观察' then
    insert into public.tasks(site_id, title, type, due_on, source)
    values (p_site_id, '观察条件检查', '复盘', p_condition_due_on, '观察检查')
    on conflict (owner_id, site_id, type) where type = '复盘' and status <> '完成'
    do update set title = excluded.title, due_on = excluded.due_on,
      source = excluded.source, status = '待处理', version = public.tasks.version + 1;
  else
    update public.tasks set status = '完成', version = version + 1
    where owner_id = auth.uid() and site_id = p_site_id and type = '复盘'
      and source = '观察检查' and status <> '完成';
  end if;
  insert into public.logs(site_id, text, source_type, confirmed)
  values (p_site_id, v_site.last_decision, '策略决策', true);
  return v_site;
end;
$$;

create or replace function public.append_site_log(
  p_site_id uuid, p_expected_version bigint, p_text text, p_source_url text,
  p_next_action text, p_next_action_date date, p_observed_through date, p_finalized_through date
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_log_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if nullif(pg_catalog.btrim(p_text), '') is null or nullif(pg_catalog.btrim(p_next_action), '') is null
    or p_next_action_date is null then raise exception 'log text, next action and date are required'; end if;
  if p_finalized_through is not null and (p_observed_through is null or p_finalized_through > p_observed_through) then
    raise exception 'finalized date exceeds observed date or observed date is missing';
  end if;
  if p_source_url is not null and p_source_url <> '' and p_source_url !~ '^https?://[^[:space:]/?#]+' then
    raise exception 'source URL must use http or https';
  end if;
  update public.sites set next_action = pg_catalog.btrim(p_next_action), version = version + 1
  where owner_id = auth.uid() and id = p_site_id and version = p_expected_version;
  if not found then raise exception 'site missing or version conflict'; end if;
  insert into public.logs(site_id, text, source_type, source_url, observed_through,
    finalized_through, collected_at, confirmed)
  values (p_site_id, p_text, '手动时间线', nullif(p_source_url, ''),
    p_observed_through, p_finalized_through, now(), true) returning id into v_log_id;
  insert into public.tasks(site_id, title, type, due_on, source)
  values (p_site_id, p_next_action, '执行', p_next_action_date, '时间线追加');
  return v_log_id;
end;
$$;

revoke all on function public.confirm_report(uuid,uuid,bigint,text,text,text,text,text,date,date,text,date,date) from public, anon;
revoke all on function public.route_capture_to_log(uuid,bigint,uuid,text) from public, anon;
revoke all on function public.route_capture_to_task(uuid,bigint,uuid,text,date) from public, anon;
revoke all on function public.route_capture_to_opportunity(uuid,bigint,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.promote_opportunity(uuid,bigint,text,date) from public, anon;
revoke all on function public.set_site_strategy(uuid,bigint,text,text,date,text) from public, anon;
revoke all on function public.append_site_log(uuid,bigint,text,text,text,date,date,date) from public, anon;
grant execute on function public.confirm_report(uuid,uuid,bigint,text,text,text,text,text,date,date,text,date,date) to authenticated;
grant execute on function public.route_capture_to_log(uuid,bigint,uuid,text) to authenticated;
grant execute on function public.route_capture_to_task(uuid,bigint,uuid,text,date) to authenticated;
grant execute on function public.route_capture_to_opportunity(uuid,bigint,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.promote_opportunity(uuid,bigint,text,date) to authenticated;
grant execute on function public.set_site_strategy(uuid,bigint,text,text,date,text) to authenticated;
grant execute on function public.append_site_log(uuid,bigint,text,text,text,date,date,date) to authenticated;
