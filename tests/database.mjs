import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function asUser(id, role = 'authenticated') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role ${role};`)
}
async function count(table) {
  return Number((await db.query(`select count(*)::int as total from public.${table}`)).rows[0].total)
}
async function fails(query, params) {
  await assert.rejects(() => db.query(query, params))
}

try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${userA}'), ('${userB}');
  `)
  for (const file of ['supabase/migrations/20260928000000_initial_production.sql', 'supabase/migrations/20260928010000_core_flows.sql', 'supabase/migrations/20260929000000_profile_timezone.sql']) {
    const migration = readFileSync(file, 'utf8')
    await db.exec(migration)
  }

  await asUser(userA)
  await db.query("insert into public.profiles(id, timezone) values ($1, 'America/New_York')", [userA])
  assert.equal((await db.query('select timezone from public.profiles where id = $1', [userA])).rows[0].timezone, 'America/New_York')
  await fails("update public.profiles set timezone = 'Not/AZone' where id = $1", [userA])
  await fails("insert into public.profiles(id, timezone) values ($1, 'Not/AZone')", [userB])
  const siteId = (await db.query("insert into public.sites(name,phase,strategy) values ('A site','机会验证','推进') returning id")).rows[0].id
  const captureId = (await db.query("insert into public.captures(text) values ('记下的需求') returning id")).rows[0].id
  await db.query("insert into public.tasks(site_id,title,type,due_on) values ($1,'首个任务','执行','2026-09-30')", [siteId])
  assert.equal(await count('sites'), 1)
  await fails("update public.sites set name = '无版本更新' where id = $1", [siteId])
  await fails("insert into public.captures(text) values ('   ')")
  await fails("insert into public.sites(owner_id,name,phase,strategy) values ($1,'伪造归属','机会验证','推进')", [userB])

  await asUser(userB)
  assert.equal((await db.query('select timezone from public.profiles where id = $1', [userA])).rows.length, 0)
  assert.equal(await count('sites'), 0)
  assert.equal(await count('tasks'), 0)
  assert.equal(await count('captures'), 0)
  await fails("insert into public.tasks(site_id,title,type,due_on) values ($1,'跨账号任务','执行','2026-09-30')", [siteId])
  await fails('select public.route_capture_to_task($1::uuid,1,$2::uuid,$3::text,$4::date)', [captureId, siteId, '跨账号', '2026-09-30'])

  await asUser(userA)
  const reportArgs = [reportId, siteId, 1, '完成：上线\n证据：用户反馈\n遗留：文案', '上线', '用户反馈', '文案', '联系用户', '2026-10-01', '2026-10-07', null, '2026-09-28', null]
  const reportCall = 'select public.confirm_report($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::text,$8::text,$9::date,$10::date,$11::text,$12::date,$13::date)'
  await db.query(reportCall, reportArgs)
  assert.equal(await count('reports'), 1)
  assert.equal(await count('logs'), 1)
  assert.equal(await count('tasks'), 3)
  assert.equal((await db.query('select version, next_action from public.sites where id = $1', [siteId])).rows[0].version, 2)
  await db.query(reportCall, reportArgs)
  assert.equal(await count('reports'), 1)
  assert.equal(await count('tasks'), 3)
  await fails(reportCall, ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', ...reportArgs.slice(1)])
  assert.equal(await count('reports'), 1)

  await fails('select public.route_capture_to_task($1::uuid,1,$2::uuid,$3::text,$4::date)', [captureId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '失败任务', '2026-10-02'])
  assert.equal((await db.query('select status from public.captures where id = $1', [captureId])).rows[0].status, '待整理')
  await db.query('select public.route_capture_to_task($1::uuid,1,$2::uuid,$3::text,$4::date)', [captureId, siteId, '核对需求', '2026-10-02'])
  assert.equal((await db.query('select status, version from public.captures where id = $1', [captureId])).rows[0].status, '已处理')
  assert.equal(await count('tasks'), 4)
  await fails('select public.route_capture_to_task($1::uuid,1,$2::uuid,$3::text,$4::date)', [captureId, siteId, '重复任务', '2026-10-02'])
  assert.equal(await count('tasks'), 4)

  const logCaptureId = (await db.query("insert into public.captures(text) values ('日志原文') returning id")).rows[0].id
  await db.query('select public.route_capture_to_log($1::uuid,1,$2::uuid,$3::text)', [logCaptureId, siteId, '整理说明'])
  assert.equal(await count('logs'), 2)
  assert.equal((await db.query('select destination_log_id is not null as linked from public.captures where id = $1', [logCaptureId])).rows[0].linked, true)

  const opportunityCaptureId = (await db.query("insert into public.captures(text) values ('新机会原文') returning id")).rows[0].id
  await db.query('select public.route_capture_to_opportunity($1::uuid,1,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text)',
    [opportunityCaptureId, '用户问题', '需求证据', '最小验证', 'MVP范围', '一周', '通过条件', '停止条件'])
  assert.equal(await count('opportunities'), 1)
  assert.equal((await db.query('select destination_opportunity_id is not null as linked from public.captures where id = $1', [opportunityCaptureId])).rows[0].linked, true)

  const opportunityId = (await db.query("insert into public.opportunities(problem,evidence,validation,scope,budget,pass_condition,stop_condition,status) values ('问题','证据','验证动作','MVP','一周','通过','停止','通过') returning id")).rows[0].id
  await db.query('select public.promote_opportunity($1::uuid,1,$2::text,$3::date)', [opportunityId, '新网站', '2026-10-05'])
  assert.equal(await count('sites'), 2)
  assert.equal(await count('tasks'), 5)
  await fails('select public.promote_opportunity($1::uuid,1,$2::text,$3::date)', [opportunityId, '重复网站', '2026-10-05'])
  assert.equal(await count('sites'), 2)

  const strategyCall = 'select (public.set_site_strategy($1::uuid,$2::bigint,$3::text,$4::text,$5::date,$6::text)).version as version'
  await db.query(strategyCall, [siteId, 2, '观察', '等候用户反馈', '2026-10-09', null])
  assert.equal((await db.query("select due_on::text as due_on from public.tasks where site_id = $1 and type = '复盘' and status <> '完成'", [siteId])).rows[0].due_on, '2026-10-09')
  assert.equal(await count('tasks'), 5)
  await fails(strategyCall, [siteId, 2, '观察', '过期版本', '2026-10-10', null])
  await db.query(strategyCall, [siteId, 3, '暂停', '等待上线依赖', null, null])
  assert.equal((await db.query("select count(*)::int as total from public.tasks where site_id = $1 and source = '观察检查' and status <> '完成'", [siteId])).rows[0].total, 0)
  assert.equal((await db.query('select last_decision from public.sites where id = $1', [siteId])).rows[0].last_decision, '策略调整为暂停：等待上线依赖')

  const timelineCall = 'select public.append_site_log($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::date,$7::date,$8::date)'
  await fails(timelineCall, [siteId, 4, '进展', 'javascript:bad', '联系用户', '2026-10-12', '2026-10-01', null])
  await fails(timelineCall, [siteId, 4, '进展', null, '联系用户', '2026-10-12', null, '2026-10-01'])
  assert.equal(await count('logs'), 4)
  assert.equal((await db.query('select version from public.sites where id = $1', [siteId])).rows[0].version, 4)
  await db.query(timelineCall, [siteId, 4, '进展', null, '联系用户', '2026-10-12', '2026-10-01', null])
  assert.equal(await count('logs'), 5)
  assert.equal(await count('tasks'), 6)
  assert.equal((await db.query('select version, next_action from public.sites where id = $1', [siteId])).rows[0].next_action, '联系用户')

  await asUser(userB)
  for (const table of ['sites', 'tasks', 'captures', 'logs', 'reports', 'opportunities']) {
    assert.equal(await count(table), 0, `${table} should be hidden from user B`)
    assert.equal((await db.query(`update public.${table} set owner_id = $1 returning id`, [userB])).rows.length, 0)
    assert.equal((await db.query(`delete from public.${table} returning id`)).rows.length, 0)
  }
  await fails(reportCall, ['ffffffff-ffff-4fff-8fff-ffffffffffff', siteId, 2, ...reportArgs.slice(3)])
  await fails(strategyCall, [siteId, 5, '观察', '跨账号', '2026-10-10', null])
  assert.equal(await count('reports'), 0)

  await asUser('', 'anon')
  for (const table of ['sites', 'tasks', 'captures', 'logs', 'reports', 'opportunities']) {
    await fails(`select * from public.${table}`)
  }
  console.log('database migrations, owner isolation, version checks and atomic flows: passed')
} finally {
  await db.close()
}
