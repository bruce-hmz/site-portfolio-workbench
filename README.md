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
pnpm install --frozen-lockfile
pnpm dev
```

缺少任一变量时，登录页会显示配置错误，并且不会创建 Supabase client、读取或伪造云端数据。登录使用 `signInWithOtp` 的 `shouldCreateUser: false`，Supabase 项目仍需由运营者关闭公开注册并通过 Auth Users 邀请账号。

运行版本固定为 Node.js `24.18.0`（`.node-version`）与 pnpm `10.31.0`（`packageManager`）。生产构建要求 Supabase URL 为不含路径、查询或凭据的 HTTPS origin；本地开发可以连接 HTTP 的本地 Supabase。

构建会在 `dist/_headers` 生成 Cloudflare Pages 响应头，CSP 的连接来源仅包含本站与构建时配置的 Supabase origin。更换 Supabase 项目后需重新构建。`robots.txt`、robots meta 与响应头均禁止收录，但访问控制仍由 Auth 和 RLS 提供。普通 `vite preview` 不会应用 `_headers`；其他托管平台需配置等效响应头，线上 CSP、缓存与 SPA 回退仍需单独验收。

已落地的本地代码包含五个页面：今日工作台、网站与详情、任务日历、新站计划池、待整理。网站可编辑阶段、目标、最近决策和资产链接；任务支持新建、完成与确认改期；随手记只保存文字，并可人工转为日志、任务或机会。收尾报告先生成可编辑的规则预览，确认后才提交。时间线追加、策略切换、报告确认、随手记分流和机会转站均通过数据库事务写入相关记录。

生产界面已加入窄屏底部五页导航、可折叠日期/账号设置、七日独立横向滚动日历、44×44 CSS px 触控目标，以及移动编辑输入的 16px 字号；键盘辅助包括跳转主要内容、页面标题/当前导航语义和表单展开/取消焦点管理。44px 是本产品本批标准，参考 [W3C Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)，不代表全面 WCAG 认证。jsdom/axe 检查不覆盖真实布局、颜色渲染或读屏器行为；设备与浏览器验收仍见 [`STAGING_ACCEPTANCE.md`](STAGING_ACCEPTANCE.md)。

站点卡提供交接包和数据新鲜度提示。新鲜度只取有观察截止日期的最新日志，策略决策日志不会把旧数据标成新数据。随手记入口只在待整理页显示；未提交文字在同一登录会话内切页保留。后台刷新保留已打开的编辑表单，版本变化时要求用户核对最新状态。

工作台完整分页读取网站、未完成任务、待整理文字和机会；已处理文字及站点日志在展开历史时分页读取。分页按实际返回条数推进，支持低于请求页大小的服务端上限；异常空页、重复记录或总数变化会明确报错。站点卡独立读取各站点最近采集的有效来源及最新报告，历史深链接按记录 ID 读取并继续受 RLS 限制。

四份 migration 位于 `supabase/migrations/`：依次执行 `20260928000000_initial_production.sql`、`20260928010000_core_flows.sql`、`20260929000000_profile_timezone.sql`、`20260930000000_workspace_reads.sql`。前三份包含 owner 约束、复合外键、RLS、版本检查、事务函数，以及使用 `pg_timezone_names` 校验 profile IANA timezone 的约束；第四份增加按当前账号隔离的站点来源与报告摘要读取。**这些迁移尚未应用到真实 Supabase 项目，也未部署站点。** 当前审查修复与验证进度见 [`REVIEW_REMEDIATION.md`](REVIEW_REMEDIATION.md)。

### 本地验证

```bash
pnpm build
pnpm test:ui
pnpm test:bundle
pnpm test:db
```

- `build`：TypeScript 与 Vite 生产构建；当前整改构建结果以 `REVIEW_REMEDIATION.md` 的本批记录为准。
- `test:ui`：jsdom 中运行交互、日期、数据读取、部署配置、颜色对比和 axe 无障碍用例；业务 fixture 覆盖五页及展开日历改期、随手记分流和机会转站表单。axe 的 `color-contrast` 规则关闭，因为 jsdom 不提供渲染颜色；`tests/contrast.test.ts` 保留已有 CSS 对比度断言。测试只提供 DOM/交互证据，不等于视觉、真实键盘/读屏或云端验收。`tests/bundling.test.ts` 从该命令排除，避免重复 Vite 构建。
- `test:bundle`：Node 环境单独运行 `tests/bundling.test.ts`，核对生产包分组及输出，由性能整改 owner 独立执行；它不计入 `test:ui`。
- `test:db`：使用开发依赖 PGlite 执行原始迁移 SQL，模拟 `auth.users`、`auth.uid()` 和 A/B/anon 角色。覆盖六张业务表隔离、跨 owner 关联拒绝、版本约束、三个分流去向、重复确认/转站防重、策略与复盘任务同事务、时间线及非法输入回滚，以及站点摘要的来源排序和账号隔离。
- 2026-09-30 本批集成结果：`pnpm test:ui` 8 个文件、59 项通过；`pnpm build` 的 TypeScript 与 Vite 生产构建通过，转换 93 个模块。P0 原有 41 项记录仍是历史阶段结果，不作为当前总测试数。
- `pnpm test:bundle` 在隔离目录由两个 Node 子进程执行 production 构建，1 个文件、1 项通过。React vendor 为 260,242 B（SHA-256 `25b1ac9e25a1f05b01cedfafce192a2df47a9d92a22d44f5350b35d69bc4a5d0`），Supabase vendor 为 223,381 B（SHA-256 `ce4bc640c269cbdccf0b0a4c90d64b7197e9c2679fd6fd391fc46176612656c0`）；文件名、大小和 hash 与主 `dist` 磁盘产物一致。测试专用入口转换会改变 App entry，两个 vendor chunk 保持不变；输出 chunk imports 图没有环。Supabase Auth SDK 内部仍有 `webauthn.js` 与 `webauthn.errors.js` 的源码循环，二者位于同一个 Supabase chunk。
- 日期性能检查：Node.js `v24.18.0`、Darwin arm64，3 轮各 1000 次调用；未缓存时每轮构造 2000 个 formatter、耗时 44.06–55.01 ms，缓存后每轮构造 1 个、耗时 1.57–1.72 ms。耗时仅记录本机样本，不设跨设备门槛；`todayInTimeZone()` 仍按每次传入/当前时刻计算日期，函数 API 和默认时区不变。
- 2026-09-30 使用 huashu-chrome 对 P1 构建进行本地普通 `vite preview` 页面/模块烟测（未应用 `_headers`）：`/sites` 正常呈现缺配置提示，H1 为“把下次开工放回上下文”，robots 标记 `noindex,nofollow`。Chrome Performance 记录 entry `index-BPbkWBuI.js` decoded 65,186 B、Supabase vendor 223,381 B、React vendor 260,242 B，CSS `index-BnPJVt0G.css` 16,223 B，均已加载；账号提示卡为白色 `rgb(255,255,255)`，当时 viewport 未见横向溢出。只验收无配置页；不证明 Cloudflare 响应头/CSP、登录后交互、移动布局或读屏。检查 tab `936107945` 已关闭；随后 preview 进程停止与登记批次 check-cleanup-check 由父控处理，结果待核实。

2026-09-29 使用 huashu-chrome 在独立本地 origin 验收可点击原型：随手记表单仅在待整理页显示、切页保留未提交文字；保存后人工转任务，日历出现对应任务，完成后从日历移除；报告六项预览确认后回填下一行动、来源日志和执行/复盘任务；机会通过后转站，已关联项禁用重复转入。重新加载后，已完成任务、报告字段与来源 URL、两类任务及机会关联均保留。该验收使用本地演示数据，不代表生产云端流程已通过。

### 接入测试环境

1. 准备独立的 staging Supabase 项目，在该项目按顺序应用全部四份迁移。不要将开发中的迁移直接应用到生产数据。
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
