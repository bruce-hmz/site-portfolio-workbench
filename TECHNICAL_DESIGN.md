# 独立开发者网站工作台技术设计

日期：2026-09-28  
状态：已进入本地实现；D0–D3 的基础与核心流程已有代码和测试，真实 Supabase 与部署 gates 尚未通过。当前交付范围见 [README](README.md)。

## 1. 决策摘要

首个生产版本采用 React + TypeScript + Vite 的 SPA，使用 React Router 声明式路由；认证和文字数据采用 Supabase Auth、Postgres 与 RLS，通过 `supabase-js` 访问；静态站点部署到 Cloudflare Pages；包管理器使用 pnpm。

原型仍是五个视图的静态本地演示，继续使用浏览器 `localStorage`，不登录、不发网络请求、不与生产数据库同步。技术设计描述的是原型之后的首个生产版本，不能把生产能力回写成当前原型已经具备的能力。

身份和数据归属从首个生产迁移开始设计：每张业务表都有 `owner_id`，每条跨实体关系同时受 owner 和实体 ID 约束，RLS 是数据库边界。pilot 是 invite-only/known-account：关闭 Supabase Auth 的 “Allow new users to sign up”，只允许已存在或由运营者在 Supabase Auth > Users 中邀请的账号登录。产品体验仍按单用户 pilot 设计，不提前增加 workspace、team、成员邀请或共享权限模型。将来需要多人协作时，再在已有 owner 边界之上增加显式 workspace/member 模型。

首个生产版本提供登录、跨设备云同步和 owner 隔离。随手记只接受并保存文字；用户自行把口述内容转成文字后粘贴，不提供录音、音频上传、语音转写、实时协作、离线优先、自动提醒或 SEO 页面。

## 2. 技术选型与取舍

| 领域 | 选择 | 选择理由 | 放弃/代价 |
| --- | --- | --- | --- |
| UI 与构建 | React + TypeScript + Vite | 适合五个视图的交互式 SPA，类型可约束实体和 RPC 输入，Vite 构建简单 | 需要自行组合认证、数据加载和部署约定 |
| 路由 | React Router declarative mode | 路由结构清晰，足够承载五个视图和登录保护 | 不使用其 data/framework mode，数据边界由 Supabase client hooks/queries 管理 |
| 认证 | Supabase Auth | P0 使用受邀账号的 email magic link/OTP，与 Postgres `auth.uid()`、RLS 直接衔接 | 依赖 Auth 邮件发送和回调配置；pilot 不开放公开注册 |
| 关系数据 | Supabase Postgres | 事务、FK、复合约束、RLS 和 SQL RPC 适合跨实体一致性 | 需要维护 migration SQL、权限 grants 和数据库测试 |
| 客户端 SDK | `@supabase/supabase-js` | 官方 JavaScript 客户端，统一 Auth 和 Postgres 调用 | 需要在边界检查返回的 `error`，不能把 SDK 返回当作成功 |
| 托管 | Cloudflare Pages | 适合无服务端渲染需求的静态 SPA，预览和生产环境清晰 | 需要正确配置 SPA fallback 和环境变量 |
| 包管理 | pnpm | 锁文件和 workspace 约定适合后续应用开发 | 团队需统一 pnpm 版本 |

不选择 Next.js：P0 没有 SEO、服务端渲染或服务端业务逻辑要求，静态 SPA 更小、更符合工作台用途。未来若出现公开 SEO 页面或必须在服务端持有的集成，再单独评估迁移，不为当前假设预留框架复杂度。

官方依据：[React](https://react.dev/)、[Vite](https://vite.dev/guide/)、[React Router declarative routing](https://reactrouter.com/start/declarative/routing)、[Supabase Auth](https://supabase.com/docs/guides/auth)、[Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)、[Supabase Auth users and invitations](https://supabase.com/docs/guides/auth/users)、[Supabase JavaScript client](https://supabase.com/docs/reference/javascript/introduction)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Cloudflare Pages](https://developers.cloudflare.com/pages/)、[pnpm](https://pnpm.io/).

## 3. 架构流

```text
浏览器 SPA
  ├─ React views / Router / form state
  ├─ auth session listener ───────────────┐
  └─ repository layer (`supabase-js`)     │
       ├─ normal CRUD ── PostgREST ───────┤── Supabase project
       └─ atomic flows ── SQL RPC ─────────┘       ├─ Auth
                                                  └─ Postgres + RLS

Cloudflare Pages ── static assets and SPA fallback
```

启动时恢复 Auth session；没有 session 时只显示登录/说明页，不查询业务数据。登录入口只接受已邀请账号，并只提供 email magic link/OTP；关闭 “Allow new users to sign up” 后，未知邮箱不能自行创建账号。运营者通过 Supabase Auth > Users 的 Send invitation 建立 pilot 账号，这是管理员在 Auth Dashboard 中执行的操作，不由浏览器直接调用。浏览器只使用 publishable/anon key，service role key 不进入浏览器端代码或构建产物；P0 不需要在浏览器配置它。登录后按 `auth.uid()` 查询当前用户的数据。页面首次进入、浏览器重新获得焦点和手动刷新时重新取数；客户端不维护第二份可写的业务缓存。网络错误保留当前表单输入并显示失败状态，不能显示“已保存”。

日期字段使用 `date`（例如 `due_on`、复盘日），时间戳使用 UTC `timestamptz`。用户 profile 保存 IANA timezone；日/周视图用该 timezone 将任务日期渲染为本地日历。数据库排序和审计时间使用 UTC，不能把浏览器本地字符串当作服务端时间。

## 4. 实体与 ownership

| 实体/表 | 关键字段 | 所有权与关系 |
| --- | --- | --- |
| `profiles` | `id`、`timezone`、`created_at` | `id = auth.users.id`；用户自己的 profile |
| `sites` | `id`、`owner_id`、名称、阶段、策略、目标、决策、下一行动、`next_checkpoint`、`strategy_condition`、`strategy_condition_due_on`、`archive_reason` | `(owner_id, id)` 唯一；用户拥有站点；review/pause/archive 条件可持久化 |
| `tasks` | `id`、`owner_id`、`site_id`、标题、类型、`due_on`、状态、来源、可选 `capture_id` | `(owner_id, site_id)` FK 到 `sites`；日历由任务派生，不建 calendar 表 |
| `logs` | `id`、`owner_id`、`site_id`、原文、来源、`observed_at`、`observed_through`、`finalized_through`、`collected_at`、可选 `capture_id`、确认信息 | `(owner_id, site_id)` FK；保留原文和唯一来源新鲜度权威 |
| `reports` | `id`、`owner_id`、`site_id`、原文、六项结构化字段、确认时间 | `(owner_id, site_id)` FK；确认前是草稿/预览，确认后成为记录 |
| `opportunities` | `id`、`owner_id`、机会字段、状态、可选 `site_id`、可选 `capture_id` | `(owner_id, site_id)` FK；通过后只能关联一次 |
| `captures` | `id`、`owner_id`、非空文字、状态、`destination_log_id`、`destination_task_id`、`destination_opportunity_id`、创建及处理时间 | owner 直接拥有；文字用 `CHECK (length(btrim(text)) > 0)` 校验；三个 destination ID 是 nullable composite FK；无音频字段 |

所有业务表使用 UUID 主键，并建立 `UNIQUE (owner_id, id)`，子表使用复合 FK，例如 `tasks (owner_id, site_id) REFERENCES sites (owner_id, id)`。`logs`、`tasks`、`opportunities` 的可选 `capture_id` 都建立 `(owner_id, capture_id) REFERENCES captures (owner_id, id)`，并在各表对非空 `capture_id` 建唯一索引，避免同一目标重复回链。`captures` 的三个 destination 字段分别建立 `(owner_id, destination_log_id) REFERENCES logs (owner_id, id)`、`(owner_id, destination_task_id) REFERENCES tasks (owner_id, id)` 和 `(owner_id, destination_opportunity_id) REFERENCES opportunities (owner_id, id)`；这些互相回链的 FK 设为 `DEFERRABLE INITIALLY DEFERRED`，由同一 RPC 事务同时写入。`status = '已处理'` 时 CHECK 要求三个字段恰好一个非 NULL，`status = '待整理'` 时要求三个字段全为 NULL。这样 destination 不再依赖不可由数据库校验的 polymorphic kind+ID，也不能跨 owner 建立关系。外部来源 URL 是普通文本字段，生产版本仍只保存用户提供的 URL，不自动抓取。

来源新鲜度字段的唯一权威是 `logs`：`observed_through` 是已观察数据覆盖到的日期，`finalized_through` 是已人工确认数据覆盖到的日期，`collected_at` 是本次采集/录入完成的 UTC 时间；确认报告必须创建带这些字段的 log。站点卡取该站点最新有效 log 的这些字段；当最新 `collected_at` 距当前时间超过 14 天且没有新 log 时显示“需要刷新”，不自动推断策略。`sites` 不复制这些字段，也不维护独立 freshness snapshot。观察必须持久化等待条件和 `strategy_condition_due_on`；暂停必须持久化重启条件；归档必须持久化 `archive_reason`。复盘、暂停和归档的决定更新这些站点字段并保留对应 log，确保刷新或换设备后条件仍可见。

## 5. Auth 与 RLS 模式

登录只建立身份，不在客户端传入或信任 `owner_id`。插入时由数据库默认值或受控函数取 `auth.uid()`；更新、删除和读取都要求 `owner_id = auth.uid()`。应用表默认启用 RLS，并为 `authenticated` 建立最小的 `select/insert/update/delete` policy；不为 `anon` 开放业务表。

典型模式如下，实际 migration 需为每张表分别写 policy 并验证索引：

```sql
alter table public.sites enable row level security;

create policy "owner can read sites"
on public.sites for select to authenticated
using (owner_id = (select auth.uid()));

create policy "owner can insert sites"
on public.sites for insert to authenticated
with check (owner_id = (select auth.uid()));
```

子表 policy 除 owner 外还用复合 FK 保证 `site_id` 属于当前 owner。任何 `security definer` 函数必须固定 `search_path`、显式校验 `auth.uid()`、只暴露必要字段，并撤销不需要的默认 execute 权限。普通 CRUD 走 RLS；有多个写入必须同成败的流程走 security-invoker SQL RPC，向 `authenticated` 显式授予 execute。

数据库用 pgTAP 验证用户 A、用户 B 和匿名请求的读写结果；浏览器 smoke 验证 A 登录后看不到 B 的站点、任务、机会、日志、报告和随手记，退出后不能继续读取。API 输入和数据库约束都拒绝空白随手记。

## 6. 原子流程

以下流程不能由客户端连续发多次 CRUD 来模拟事务：

1. **确认报告**：校验六项字段、日期和来源 URL；写入 report 确认状态与 log，更新 site 的下一行动/检查点，创建或更新执行任务和复盘任务。全部成功才提交。
2. **处理随手记**：校验 capture 仍为待整理、目标属于当前 owner；写入 log 或 task 或 opportunity，并在同一事务中写入目标表的 `capture_id` 和 capture 的对应 `destination_*_id`，更新 processed 状态。失败时 capture 保持待整理且三个 destination 字段仍为空。
3. **转入新站点**：校验 opportunity 状态为通过且未关联；创建 site、首个执行 task，并回写 opportunity.site_id。失败时不产生半个站点。

这些函数默认以调用者身份执行（security invoker），在函数内部再次检查当前 owner 和目标状态；函数返回明确结果。客户端只在 RPC 成功返回后刷新相关查询。不要在客户端用“先写 A、再写 B”的成功提示替代数据库事务。

## 7. 跨设备同步与冲突

同步模型是服务端为准的普通 CRUD。页面进入、reload、窗口 focus 和登录 session 变化时 refetch；P0 不做 realtime、不做离线队列、不做离线优先，也不承诺两个设备即时更新。提交后以数据库返回行刷新本地视图。

P0 对可编辑业务行使用乐观版本检查，避免静默覆盖：每张可编辑表有 `version bigint not null default 1`，更新 SQL/RPC 必须使用读取时的版本作为前置条件，并在同一 UPDATE 中执行 `version = version + 1`。例如 `UPDATE ... SET ..., version = version + 1 WHERE owner_id = auth.uid() AND id = $id AND version = $expected_version RETURNING *`；返回行数为 0 就是 stale conflict，客户端必须显示“其他设备已更新”、重新取数并让用户重新确认，不能显示成功。任务完成/改期、站点策略、报告草稿和 capture 状态都遵循该规则；报告确认与 capture 分流还依靠状态条件和 RPC 原子性，重复提交返回已处理/冲突而不是重复创建。对不需要编辑的追加日志使用数据库生成时间和唯一 ID，不做静默合并。没有必要为单人 pilot 引入 CRDT 或离线队列。

## 8. 环境、备份与迁移

至少有相互隔离的 staging 和 production Supabase project，以及对应的 Cloudflare Pages 环境变量。Auth 回调 URL、数据库和密钥不得跨环境复用；浏览器端只使用 publishable/anon key，service role key 不进入构建产物。

数据库结构用版本化 migration SQL 提交并按 staging → 验证 → production 顺序执行。每次发布前生成数据库备份并确认恢复路径；提供用户可理解的文字数据导出与删除方案后，才把生产数据保留策略作为完成项。当前原型的 reset 只重置浏览器演示数据，不连接这些备份或删除流程。

## 9. 原型到生产的迁移

原型字段先做显式映射，不直接把 `localStorage` JSON 当数据库 schema：

| 原型 | 生产映射 | 处理规则 |
| --- | --- | --- |
| `sites` | `sites` | 生成 UUID，写入当前登录用户 `owner_id` |
| `tasks` | `tasks` | `date` → `due_on`；保留类型、状态、来源 |
| `logs` | `logs` | `date` → `observed_at`；嵌入的 report 字段拆到 `reports` 或作为确认记录 |
| `opportunities` | `opportunities` | `siteId` 转为同 owner 的复合关系 |
| `captures` | `captures` | 只迁移非空文字及处理去向；旧版原型可能含音频字段，保留本机原记录，不导入音频；只有音频而无文字的记录要求用户先自行转写 |
| `selectedSite`、视图和周起始日 | 客户端 UI 状态 | 不进入业务表 |

迁移工具必须逐条校验必填字段、日期、枚举和关系，失败项保留原始 JSON 供重试。迁移只提交文字，旧版音频字段不进入生产数据库；遇到仅有音频的旧记录时提示用户自行转写，不能把它报告为已迁移。

## 10. 交付里程碑与 gates

| 阶段 | 交付 | Gate |
| --- | --- | --- |
| D0 设计冻结 | migration 草案、字段映射、环境变量清单 | 评审确认 ownership、RPC 边界和原型/生产范围 |
| D1 基础壳 | Vite SPA、Router、Auth callback、staging Pages | 登录/登出、未登录不查业务数据、刷新可恢复 session |
| D2 数据基础 | 表、复合 FK、RLS、普通 CRUD、任务派生日历、版本前置条件 | pgTAP 通过 A/B/anon 隔离；任务跨视图一致；站点策略和任务更新的旧版本会被拒绝并触发 stale-conflict UI |
| D3 核心事务 | 三个 RPC、报告/随手记/机会流程 | RPC 失败无半成品，重复提交不重复创建 |
| D4 文字迁移 | 确定是否导入原型文字；需要时实现导入工具 | 只处理文字；旧版音频字段不进入生产库，原浏览器记录未被静默清除 |
| D5 pilot | staging 浏览器 smoke、生产备份/恢复演练、生产 Pages | smoke、RLS、备份恢复和部署检查通过后才发布 |

验证范围包括 migration dry run、RLS pgTAP、浏览器登录/刷新/跨设备 refetch smoke、文字随手记空白校验、报告确认和 capture 分流失败路径。当前已安装本地依赖并实现核心流程，未创建远程资源或部署应用。本地使用 PGlite 执行迁移及角色隔离/事务测试，使用 jsdom 执行表单回归测试；这些结果不能替代 staging 的真实 Auth、PostgREST、多连接并发和浏览器验收。

### 当前实现与设计差距

- 五个页面和报告确认、随手记分流、机会转站已接入事务函数。策略切换和时间线追加也使用事务，确保关联任务与日志同时保存。
- 网站支持基础资料、资产链接及策略编辑。只统计有 `observed_through` 的来源日志来判断数据新鲜度；策略决策日志仍保留在时间线，不作为数据覆盖日期。
- `profiles.timezone` 已接入设置、Dashboard、日历和日期默认值；缺失 profile 行使用 schema 同样的 `Asia/Shanghai` fallback。初始来源固定为现有 schema 默认值，用户在现有 shell 的小型时区设置表单中编辑，不从浏览器自动推断。date-only 字段按日期值渲染，timestamp 只有在计算“今天”时应用账户时区。
- 当前每个站点只维护一个未完成的复盘任务；报告确认和观察策略会更新这个检查点，并保留各自的来源日志。
- D4 文字迁移、完整结构化阶段复盘、数据导出/删除，以及 D5 的备份恢复和发布验收尚未完成。D0–D3 的本地代码存在不代表其生产 gates 已通过。

## 11. 明确假设与待决策

### 已采用的假设

- 首个生产 pilot 是单用户体验，但每个业务实体从第一版就有 `owner_id`。
- 暂不需要 workspace/team、成员邀请、共享链接或多人编辑；pilot 的账号邀请由运营者在 Supabase Auth Users 中完成。
- Supabase project 与 Cloudflare Pages 各自按 staging/production 分开。
- 用户 timezone 影响日/周视图，服务端时间和审计统一 UTC。
- 正常字段编辑使用版本条件更新，版本冲突必须提示并重载；原子流程使用条件状态和 RPC 防重复。
- 原型五个视图和现有人工确认交互作为生产功能边界输入，不能视作生产已完成。

### 发布前必须决定

- 需要配置的运营事项是 Auth 邮件发送、magic link/OTP 回调 URL、过期时间、发件人和失败文案；P0 登录方式固定为受邀账号的 email magic link/OTP，pilot 关闭公开 signup。
- 生产是否允许用户导入原型 `localStorage`，以及导入失败项的下载格式和重试入口。
- 是否需要账号删除；若需要，关联文字数据采用硬删除还是延迟清理。
- staging/production 的域名、Auth 邮件发送配置、备份保留周期和恢复演练责任人。
- 已决定：用户 timezone 的初始来源是现有 schema 的 `Asia/Shanghai` 默认值；用户可编辑并持久化，产品不自动采用浏览器时区。既有 `due_on` 是 date-only 值，改变 timezone 不会改写其日历日期。

这些决策不改变当前原型验收；它们是生产发布 gate 的输入，未决定前不得声称生产数据生命周期或账号流程已经完成。
