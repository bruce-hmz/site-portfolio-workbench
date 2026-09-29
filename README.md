# Site Portfolio Workbench

独立开发者网站工作台的中文 PRD、技术设计、可点击原型和生产版开发代码。`prototype/` 仍用于本地产品评审，数据保存在浏览器 `localStorage`；`src/` 是开发中的云端应用，使用 Supabase 登录和数据库。随手记只接受文字，口述内容由用户自行转写后粘贴。

## 预览

无需安装依赖。建议在项目目录启动静态服务器，以 `http://localhost:8080` 打开原型；也可直接打开 `prototype/index.html` 体验文字记录。

```bash
python3 -m http.server 8080 --directory prototype
```

示例数据带有“演示”标签，日期按浏览器当前日期生成；新随手记只把文字写入浏览器 `localStorage`，不会发送到外部服务。本地容量不足时会提示未保存。旧版原型若已保存音频字段，当前版本只在本机保留原数据，不再播放、录制或导入正式版；重置演示数据会清除这些旧记录。日历从任务唯一渲染，报告提取是带可编辑预览和人工确认的字段规则演示，不是真实 LLM 接入。

静态界面图：[工作台](prototype/screenshots/dashboard.png) · [网站详情](prototype/screenshots/sites.png) · [日历](prototype/screenshots/calendar.png) · [新站计划池](prototype/screenshots/opportunities.png)。旧版待整理截图含录音文案，当前页面以可点击原型为准。

## 生产版开发状态

生产 SPA 位于 `src/`，原型仍保留在 `prototype/`，两者不共享本地演示数据。启动生产壳前复制 `.env.example` 为 `.env.local`，填写 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`：

```bash
pnpm install
pnpm dev
```

缺少任一变量时，登录页会显示配置错误，并且不会创建 Supabase client、读取或伪造云端数据。登录使用 `signInWithOtp` 的 `shouldCreateUser: false`，Supabase 项目仍需由运营者关闭公开注册并通过 Auth Users 邀请账号。

已落地的本地代码包含五个页面：今日工作台、网站与详情、任务日历、新站计划池、待整理。网站可编辑阶段、目标、最近决策和资产链接；任务支持新建、完成与确认改期；随手记只保存文字，并可人工转为日志、任务或机会。收尾报告先生成可编辑的规则预览，确认后才提交。时间线追加、策略切换、报告确认、随手记分流和机会转站均通过数据库事务写入相关记录。

站点卡提供交接包和数据新鲜度提示。新鲜度只取有观察截止日期的最新日志，策略决策日志不会把旧数据标成新数据。随手记入口只在待整理页显示；未提交文字在同一登录会话内切页保留。后台刷新保留已打开的编辑表单，版本变化时要求用户核对最新状态。

三份 migration 位于 `supabase/migrations/`：依次执行 `20260928000000_initial_production.sql`、`20260928010000_core_flows.sql`、`20260929000000_profile_timezone.sql`。它们包含 owner 约束、复合外键、RLS、版本检查、事务函数，以及使用 `pg_timezone_names` 校验 profile IANA timezone 的约束。**这些迁移尚未应用到真实 Supabase 项目，也未部署站点。**

### 本地验证

```bash
pnpm build
pnpm test:ui
pnpm test:db
```

- `build`：TypeScript 与 Vite 构建通过；目前主 JS 包仍有超过 500 kB 的体积提示。
- `test:ui`：包含 jsdom 交互测试和聚焦日期测试，覆盖后台刷新保留草稿、时区保存成功/失败、UTC+14 date-only 显示、DST 附近的 timestamp 今日判断和账户时区默认日期。
- `test:db`：使用开发依赖 PGlite 执行原始迁移 SQL，模拟 `auth.users`、`auth.uid()` 和 A/B/anon 角色。覆盖六张业务表隔离、跨 owner 关联拒绝、版本约束、三个分流去向、重复确认/转站防重、策略与复盘任务同事务、时间线及非法输入回滚。
- 生产版真实 Chrome 目前只验收过未配置环境变量时的提示页。jsdom 测试不等于浏览器视觉验收；PGlite 测试不覆盖真实 Supabase Auth、PostgREST、邮件、双连接并发或跨设备登录。

2026-09-29 使用 huashu-chrome 在独立本地 origin 验收可点击原型：随手记表单仅在待整理页显示、切页保留未提交文字；保存后人工转任务，日历出现对应任务，完成后从日历移除；报告六项预览确认后回填下一行动、来源日志和执行/复盘任务；机会通过后转站，已关联项禁用重复转入。重新加载后，已完成任务、报告字段与来源 URL、两类任务及机会关联均保留。该验收使用本地演示数据，不代表生产云端流程已通过。

### 接入测试环境

1. 准备独立的 staging Supabase 项目，在该项目按顺序应用三份迁移。不要将开发中的迁移直接应用到生产数据。
2. 在 Auth 关闭公开注册，通过 Users 邀请测试账号；配置本站登录回调 URL。开发时 URL 要与实际使用的 `localhost` 或 `127.0.0.1` origin 一致。
3. 在本地 `.env.local` 填写项目 URL 和 publishable key，启动 `pnpm dev`。不要把 service role key 放入前端配置。
4. 用两个测试账号逐项验证真实登录、读写隔离、刷新恢复、版本冲突、失败回滚和五个页面的关键交互，再执行 staging 部署验收。

尚未交付：真实 Supabase/staging 应用 migration 与登录验收、原型文字导入、生产数据导出/删除策略、完整结构化阶段复盘、生产备份恢复与部署。这些仍是完整 pilot 的剩余范围。staging 验收计划见 [`STAGING_ACCEPTANCE.md`](STAGING_ACCEPTANCE.md)。

## 原型评审路径

1. 在「今日工作台」点击任务标题进入对应站点详情，完成一个任务，或打开页面内改期表单确认/取消。
2. 进入「网站与详情」，选择站点，在收尾报告里粘贴内容，编辑六项提取预览（含下一行动日期）、检查日期后确认回填。
3. 追加时间线，观察下一行动和日历事件更新。
4. 生成并复制交接包；试用策略改为「观察」或「暂停」，查看条件要求。
5. 在「日历」使用上一周/下一周导航，点击任务后可在页面内完成或改期；再在「新站计划池」录入机会，编辑状态为“通过”后在页面内填写名称并确认创建一个新网站，也可取消。已关联机会不能再次转入。
6. 进入「待整理」，点「+ 随手记」输入或粘贴文字，刷新后仍可在此查看。选择写入站点日志、填写站点与日期转为任务，或预填新站机会并补全必填字段；取消分流后原始文字仍待整理，处理后仍可回看原文。录入表单只在「待整理」页显示。

观察策略保存会维护该站点唯一的“观察检查”复盘任务；报告确认预览包含“下一行动日期”和可选原始 URL，确认后会写入执行任务和复盘任务。所有日历事件仍直接来自 `state.tasks`。

任务与日历事件共用同一个日期表单和 `state.tasks` 数据源。重置演示使用页面内二次确认；所有确认弹层支持键盘焦点和 `Esc` 关闭，不使用原生 `prompt` 或 `confirm`。

## 文件

- `PRD.md`：产品范围、实体、流程、状态和验收标准。
- [`TECHNICAL_DESIGN.md`](TECHNICAL_DESIGN.md)：首个生产版本的技术选型、架构、ownership/RLS、迁移和交付 gates；不代表已经实现或部署。
- `src/`：生产版开发代码；`App.tsx` 承载导航与数据状态，`Flows.tsx` 承载录入和确认表单。
- `supabase/migrations/`：数据库结构与事务函数；当前只在本地测试运行时验证。
- `tests/`：数据库隔离/事务与表单交互回归测试。
- `prototype/index.html`：页面结构和演示数据容器。
- `prototype/styles.css`：编辑式运营台视觉和响应式布局。
- `prototype/app.js`：页面切换、文字随手记与分流、规则提取和 `localStorage` 持久化。
