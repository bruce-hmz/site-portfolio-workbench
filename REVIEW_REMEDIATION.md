# 审查整改记录

日期：2026-09-30。基于用户提供的审查报告，对照 `9be6750` 的代码逐项核验。当前分支：`codex/review-p0-fixes`。

## 本批范围

优先修复五项 P0；验收状态在本批完成时回填。P1/P2 尚未作为已完成项。

| 条目 | 核验与处理方式 | 验收重点 |
| --- | --- | --- |
| P0-1 数据截断 | 当前查询缺少分页，问题成立。未完成任务和待整理记录完整分页；历史记录按需加载；各站点摘要独立取最新有效来源；随手记去向独立于未完成任务列表解析 | 1200 条以上数据、服务端上限小于请求页大小、历史任务回链、按需日志、账号隔离 |
| P0-2 部署基础 | 缺少防收录、响应头及版本固定，问题成立。构建时根据实际配置生成 CSP，补 robots/favicon/静态加载和工具版本 | 无配置构建可用；合法项目 origin 被允许；无占位域名和宽泛放行；构建产物包含响应头 |
| P0-3 认证和渲染失败 | 会话恢复、登录请求缺少失败处理，问题成立。补登录防重复、中文反馈、恢复失败和渲染错误兜底 | rejected Promise、返回 error、认证事件乱序、重复登录、渲染抛错 |
| P0-4 操作与刷新竞态 | 任务重复提交和过期读取覆盖新值均成立。按任务保护提交，丢弃过期请求及其错误/结束状态 | 双击一次写入、失败可重试、响应乱序、保存后旧读取不覆盖 |
| P0-5 对比度 | 多个文字与控件颜色不足，问题成立。修改实际使用的颜色变量，并区分深浅背景 | 正文至少 4.5:1；输入边界和焦点至少 3:1；深色侧栏单独校验 |

## 对报告建议的修正

- 仅过滤已完成任务仍可能超过 API 上限；仅加 `limit(300)` 或“达到 1000 条”横幅也不能保证数据完整。分页应使用稳定排序，按实际返回行数和总量推进；历史记录必须能继续读取。接口页大小配置可低于客户端请求值，不能把短页一概当成结束。[Supabase range 文档](https://supabase.com/docs/reference/javascript/using-modifiers-range)
- 站点新鲜度不能取全局最近几百条日志后再分组，否则低频站点的最新有效来源仍会丢失。来源日志与纯决策日志继续分别处理。
- Cloudflare Pages 在部署时解释 `_headers`，普通 Vite 预览不会自动应用这些规则。本地生成或测试文件通过不等于线上响应头验收通过。[Cloudflare 文档](https://developers.cloudflare.com/pages/configuration/headers/)
- 查询时区目录的函数不应仅为 CHECK 约束而标成 `IMMUTABLE`，其结果依赖目录数据。该项保留 `STABLE`；固定 search_path、限定对象名以及升级时区数据后的约束复核属于后续专项。[PostgreSQL 函数波动性文档](https://www.postgresql.org/docs/current/xfunc-volatility.html)
- 初始时区继续采用已确认的 `Asia/Shanghai` 并允许用户保存自己的设置；“自动取浏览器时区”会改变已有产品决定，本批不采用。
- 浏览器验收遵循用户指定的 huashu-chrome；报告中建议的 Playwright 不是当前执行方式。

## 后续批次

1. P1：移动端与键盘/读屏体验、按需刷新与日期格式化开销、报告多行提取和用户文案、CI。
2. P1：数据库类型生成、格式化/静态检查工具、文件拆分。大规模格式化单独进行，以保留本次修复 diff 的可读性。
3. P2：索引与长度边界、时区约束专项、CSS 清理、任务类型入口、截图更新。
4. staging：真实登录、A/B 隔离、分页上限、CSP/缓存/SPA 回退、移动端与 Lighthouse；使用 [测试环境验收计划](STAGING_ACCEPTANCE.md) 记录实际结果。

## P1 首批进度

2026-09-30 P1-1/2 移动端与无障碍、P1-4/5 日期性能与资源分包的本地实现和定向验证已完成。当前 UI/build 结果独立记录于本文末尾；P0 的 41 项通过仍只代表历史阶段，不计入当前批次。

### P1 执行中断与恢复条件

- 移动端 owner `01a0f148-0bb3-75b3-8a8d-b1664e6ae7af`（gpt-6-luna xhigh）在实现后、最终验收前返回：`You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 7:23 PM.` 分类 quota；工具未注明时区；当时未额外重试，也未猜测重置时区。已保存代码和阶段日志保留。
- 13:08 UTC 续接时，账户工具显示普通使用可用、当前窗口已更新（primary used 4%，secondary used 32%）。这是新恢复候选，不等于 Luna 已恢复；该状态变化仅消费一次原 owner 恢复尝试，额外恢复尝试计数 1。仍由原移动端 owner 收口 UI/构建/文档，性能 owner `01a0f14e-b545-78e1-8217-12bae732664f` 保留资源 hash 检查交接点。两批进程登记分别为 `3695d3f9171a4ae5933a12c6d1b4638a` 和 `ce628e1462754f8cba3be547111f593d`；当时的进程检查未发现移动端批次活动进程。

## 验证状态

以下验证表是 P0 阶段当时的历史记录；41 项测试和 544.23 kB 构建体积不是当前合并工作树的测试总数或构建结果。P1 整改的最新验证见本文末尾的独立批次记录。

五项 P0 的本地代码修复与必要回归已完成。尚无真实 Supabase 测试环境配置；没有应用远程迁移或部署。验证当时，本轮改动保存在 `codex/review-p0-fixes`，尚未提交或推送；后续提交状态以 Git 记录为准。

| 检查 | 实际结果与边界 |
| --- | --- |
| `pnpm test:ui` | 6 个测试文件、41 项通过。包括 1200 条以上数据、较小服务端上限、历史深链接、已完成任务去向、认证失败、防重复、过期刷新，以及已展开历史在写入后的刷新。最后成功日志为 2026-09-30 01:53 UTC，晚于当前相关源文件和测试的修改时间。 |
| `pnpm test:db` | 四份原始迁移在 PGlite 通过；验证 owner 隔离、事务与版本约束，新增摘要来源排序、纯决策不刷新来源、B/anon 访问限制。最后成功日志为 01:38 UTC，迁移修改时间为 01:23 UTC。不代表真实 PostgREST/Auth 验收。 |
| `pnpm build` | TypeScript 与 Vite 通过，最后成功日志为 01:53 UTC；产物包含 `_headers`、robots 和 favicon。主 JS 544.23 kB、gzip 158.46 kB，仍有超过 500 kB 的提示，分包保留在 P1。 |
| Chrome 本地烟测 | 2026-09-30 07:29 UTC 使用 huashu-chrome 在 `127.0.0.1:4187/sites` 检查当前 `dist`。临时服务器按产物 `_headers` 模拟响应头；严格 CSP 下 React 缺配置提示页可加载，CSS 实际生效（白色卡片，说明文字 `rgb(95, 102, 95)`）。HTML 有 noindex、favicon 与模块资源；实际本地响应有 CSP、nosniff、禁收录，JS 资源有 immutable。仅验收无配置页面，未验收登录后的交互或 Cloudflare。 |

父 Agent 已定点检查分页推进与稳定排序、任务锁与请求失效控制、历史组件更新、摘要 SQL 的 invoker/RLS 边界、构建头和实际颜色规则。没有仅凭执行者的“完成”或退出码判断通过；已有测试日志和当前源码一致，本次没有重复运行完整测试。

仍待云端验收：受邀登录及邮件回调、真实 API 行数限制、A/B 账号隔离、双连接并发、跨设备状态、Cloudflare CSP/缓存/路由回退。移动端与登录后视觉/键盘验收也未在本轮完成，按 `STAGING_ACCEPTANCE.md` 和 P1 范围继续。

### 执行中断与交接

- 2026-09-30 01:16 UTC 核实：原认证/竞态与数据分页执行者（gpt-5.6-luna）均已因配额中断并关闭，部分代码保存，未完成验收。实际错误：`You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 4th, 2026 8:06 PM.` 工具未注明重置时间的时区。
- 分类：quota；原调用额外重试 0 次；重置事件未消费。不在重置前重复原调用。部署/对比度执行者已完成并关闭，聚焦测试 8/8；全项目构建仍待集成修复。
- 本轮配置已明确改用 gpt-6-luna；选择器返回 `adaptive_luna_xhigh`，准备一次新配置的实际交接验证。选择成功不视为恢复。目标包：完成认证/竞态与分页组件集成、回归测试、构建；父 Agent 负责验收，原执行者已停止写入。
- 新配置交接已实际启动：`01a0efe2-c333-7ec2-994b-86383674417f`（gpt-6-luna，xhigh）为唯一集成 owner。已观察到其保存的 App、分页与历史组件改动；本次配置变化恢复事件已消费，原模型配额状态不因此推断已恢复。测试与最终验收尚待交付。运行登记批次为 `a57da1e7729842d59f46cd86c8812183`。
- 07:17 UTC 续接时该集成 owner 返回 `not_found`；实际登记日志已保留最终成功的 41 项测试、数据库检查和构建。父完成独立证据复核，并对该批次执行 check/cleanup/check，登记范围为 `CLEAN`。
- 新复核 owner `01a0f12d-24c1-7783-9327-28df94126143`（gpt-6-luna，xhigh）已实际启动；多次原生等待返回 `timed_out: true`，未收到开工或交接反馈。发出一次监督中断后仍无反馈，关闭时工具返回 `previous_status: running`。分类 `unknown`（进度反馈缺失），没有配额错误、retry-after 或可核实的配额重置条件；额外启动重试 0 次，无新恢复事件可消费。
- 关闭后核实该 owner 已留下临时服务器脚本，并于 07:27 UTC 登记启动；其会话结束后进程已停止，但缺少完成报告。父执行独立 cleanup/check，批次 `b654d9e4edf64890b1366972d4f0c579` 确认为 `CLEAN`；该启动不算完成验收。
- 父临时接管仅限一个收尾包：读取已有构建/测试证据、用现成脚本完成无配置构建的本地浏览器烟测、更新本记录及 README、清理本次服务和标签页；没有修改程序实现或重新跑整套测试。接管已收口；后续 P1 实现仍需交给配置的 Luna。烟测登记批次 `d0ffba7f509c4cffb5a032eece700bb3` 已执行 check/cleanup/check，最终为 `CLEAN`，无保留服务；本次标签页 `936107904` 已关闭，临时服务器脚本已删除，验证日志保留。最终 `git diff --check` 通过。

## P1-1 / P1-2 移动端与无障碍（当前批次）

范围仅含移动布局与键盘/读屏语义；不包含同批性能工作包。实现内容：窄屏底部导航、账号/时区折叠区、独立七日横滚、触控和输入尺寸、页面标题/路由焦点/跳转主内容、具名导航、日历日期与任务列表语义、表单字段错误关系及新增/改期/分流/转站焦点恢复。Dashboard 的 `todayInTimeZone()` 每次 render 调用一次，保留日期函数 API。

测试增加业务 fixture 的五页 axe 扫描，以及已展开的改期、随手记分流、机会转站表单扫描，并覆盖导航当前页、文档标题、skip link、表单打开/取消焦点和错误字段关系。深链接焦点分别由通用聚焦器（站点/机会及待整理 capture）和历史组件（日志/已处理 capture）负责；覆盖异步首次定位、编辑状态经刷新保留焦点、新导航重定位，以及待整理/已处理 capture 的归属。日历改期输入在窄屏最大宽度受容器约束。axe 在 jsdom 中关闭 `color-contrast`（不具备真实渲染颜色）；已有 `tests/contrast.test.ts` 继续执行。该套检查不构成全面 WCAG 认证，也不证明真实设备布局或读屏表现。

集成验证已完成：`pnpm test:ui` 排除独立的 `tests/bundling.test.ts`；`pnpm test:bundle` 由性能 owner 在隔离输出目录运行。数据库未改动，本批不重跑数据库验证。已执行一次普通 Vite preview 的缺配置页与模块加载烟测（见下表）；它不应用 `_headers`、不提供假登录。真实 390px/横屏、登录后界面、Cloudflare 响应头/CSP、读屏及 staging 项目仍待执行，见 `STAGING_ACCEPTANCE.md`。

### P1-1/2 与 P1-4/5 集成验证（2026-09-30）

| 检查 | 实际结果与边界 |
| --- | --- |
| `pnpm test:ui` | 8 个文件、59 项通过；最终进程记录 `d013208d3a204e52ad9c34c45b50a804`，完整输出 `.codex-adaptive-agents/processes/3695d3f9171a4ae5933a12c6d1b4638a/d013208d3a204e52ad9c34c45b50a804/stdout.log`。含异步首次定位、编辑字段经刷新保留焦点、新 hash 重定位，以及待整理 capture 深链接和其编辑焦点刷新回归；axe 使用五页业务 fixture 并覆盖展开表单。初次运行发现通用聚焦器重复认领日志历史目标，已修正 owner；新增待整理 capture 用例后全套 59 项通过。 |
| `pnpm build` | 最终 `tsc -b && vite build` 通过，Vite 转换 93 个模块，581 ms；进程记录 `091ad46c78b54e38869acb651f3f944f`，完整输出 `.codex-adaptive-agents/processes/3695d3f9171a4ae5933a12c6d1b4638a/091ad46c78b54e38869acb651f3f944f/stdout.log`。产物 entry 为 `index-BPbkWBuI.js`；React 与 Supabase vendor 文件名和 hash 仍与性能 owner 的独立 production 证据一致。 |
| `pnpm test:bundle` | 性能 owner 在隔离目录的两个 Node 子进程执行 production 构建，1 个文件、1 项通过；最终记录 `25edb5b1d0994959b7e09ea32f370fba`。React `vendor-react-BR3yfjLk.js` 为 260,242 B，SHA-256 `25b1ac9e25a1f05b01cedfafce192a2df47a9d92a22d44f5350b35d69bc4a5d0`；Supabase `vendor-supabase-NXRyLVor.js` 为 223,381 B，SHA-256 `ce4bc640c269cbdccf0b0a4c90d64b7197e9c2679fd6fd391fc46176612656c0`。两者文件名、大小和磁盘 hash 与主 `dist` 实际产物一致。测试专用入口转换使 App entry hash/字节数变化，vendor 未变化。静态 `imports`/`dynamicImports` 输出图无环；Supabase Auth SDK 内 `webauthn.js` 与 `webauthn.errors.js` 存在源码循环，但两者同属 Supabase chunk，不构成 chunk 间环。详细证据 `.codex-adaptive-agents/p1-performance/result.md`、`bundling-evidence.json`。 |
| 日期 benchmark | 性能 owner 以 Node.js `v24.18.0`、Darwin arm64 执行 3 轮，每轮 1000 次调用：基线每轮构造 2000 个 formatter、44.06–55.01 ms；缓存后每轮构造 1 个、1.57–1.72 ms。仅作为该机器上的实测样本，不设跨设备门槛；`todayInTimeZone` 仍按每次调用时刻计算并保留原函数 API。benchmark 进程记录 `cba938cc6e5b48dbb74c38d2b5b8648f`；日期回归为 2 个文件、6 项通过，记录 `b6d51d25722c4e00ae31b04fdfb1f375`。 |
| huashu-chrome 本地 smoke | 通过普通 Vite preview 检查 `http://127.0.0.1:4187/sites`：缺配置提示正常显示，H1“把下次开工放回上下文”，robots 为 `noindex,nofollow`。Chrome Performance 资源记录：entry `index-BPbkWBuI.js` decoded 65,186 B、Supabase 223,381 B、React 260,242 B、CSS `index-BnPJVt0G.css` 16,223 B，均已加载；`.auth-card` 为白色 `rgb(255,255,255)`，当时 viewport 无横向溢出。仅覆盖无配置页和模块加载；preview 未应用 `_headers`，不证明 Cloudflare/CSP、登录后体验或移动端/读屏。tab `936107945` 已关闭。preview 会话未保留完成报告，初次 process-check 为 UNVERIFIED；父控独立 cleanup 后再次检查为 CLEAN，无活动或保留进程。性能 run `ce628e1462754f8cba3be547111f593d` 也经 check-cleanup-check 为 CLEAN；仅证明登记范围已清理，不以此代替功能验收。 |
| `git diff --check` | 当前最终差异检查通过。无数据库变更，未重跑 `pnpm test:db`。 |

axe 的 jsdom 扫描关闭 `color-contrast`；`tests/contrast.test.ts` 仍参与 UI suite。自动化与本次无配置页烟测不验证真实 390px/横屏布局、登录后体验、Cloudflare headers/CSP、触控命中或读屏器。相应浏览器/真机及 staging 清单继续待执行，详见 `STAGING_ACCEPTANCE.md`。
