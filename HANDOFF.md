# Knowledge Garden Handoff

更新时间：2026-10-21 01:18（Asia/Shanghai）

本文档用于在 DeepSeek Harness 临时接管结束后，让 Codex 不依赖完整聊天记录也能理解当前状态。

## 0. 当前状态

- 当前发布准备分支：`codex/editable-domain-metadata`
- 当前发布器源码版本：`0.1.5`
- 当前发布器版本提交：见 `codex/editable-domain-metadata` 当前 HEAD（不在文档内嵌 SHA，避免 amend 后失效）
- `0.1.5` 仍处于发布准备状态：尚未打包、安装、合并或推送；正式安装目录仍是 `0.1.4`。
- 此前 `0.1.4` 的代码修改已合并到本地 `main`，并推送到 `origin/main` 和 `publisher/main`。
- 工作区仍保留用户原有的 `highlight.js` 依赖修改和 `.tmp-render-check.png`，未纳入本次提交。

## 1. 项目目标

Knowledge Garden 是一个公开的个人知识花园：

- 使用 Quartz v5 将 Markdown 构建为静态网站。
- 公开内容位于 `content/`，私密内容位于 Git 忽略的 `private/`。
- 通过 GitHub Actions 部署到 GitHub Pages。
- `apps/publisher` 是 Windows Electron 桌面发布器，负责编辑、预览、公开/私密切换和选择性发布。
- 发布必须经过显式审查和隔离验证；私密内容不得进入 Git 或线上构建树。

主要设计文档：

- `docs/superpowers/specs/2026-09-16-personal-digital-garden-design.md`
- `docs/superpowers/specs/2026-09-18-knowledge-garden-publisher-design.md`
- `docs/superpowers/specs/2026-10-20-visibility-roundtrip-design.md`
- `docs/superpowers/specs/2026-10-20-private-quartz-preview-design.md`
- `docs/superpowers/specs/2026-10-21-configured-online-preview-design.md`

## 2. 本次合并包含的修复

### 2.1 私密/公开转换与自动入站链接修复

- 验证了私密→公开的本地移动、变更扫描、提交和推送链路。
- 公开→私密时，发布器自动删除公开 Markdown 中指向该笔记的入站 WikiLink。
- 限定路径（如 `life/weekly-review`）总是清理；非限定 slug 只在唯一时清理。
- 私密 Markdown、代码块、行内代码和无关链接不修改。
- 链接文件带 revision 校验并纳入事务 journal；外部并发修改会安全失败。
- 事务完成后 UI 显示“已自动清理 N 个页面中的入站链接”。

关键提交：

- `08118df2` `fix(publisher): auto-repair inbound links on privatization`

### 2.2 Pages 部署状态

- 不再在 Git push 后立即显示“发布成功”。
- 未确认部署完成时保持 `deploying`，文案为“代码已推送，正在等待 GitHub Pages 部署…”。
- 自动复查部署状态：最多追加 3 次，每次间隔 15 秒；叠加主进程已有的等待窗口。
- 只有匹配的部署运行成功后才显示“发布成功，部署已完成”。
- 部署失败或取消显示对应失败状态。

关键提交：

- `5ed962ab` `fix(publisher): wait for Pages deployment before reporting success`

### 2.3 软件内“线上公开站”缓存

- 进入“线上公开站”时清空 Electron 默认会话的 HTTP 缓存。
- iframe URL 带唯一 `?refresh=...` 参数，并使用新的 React key 重新挂载。
- 提供“刷新线上站”按钮。
- 新增主进程 `history:clear-cache` IPC，preload 暴露 `history.clearCache()`；主进程调用 `session.defaultSession.clearCache()`。

关键提交：

- `91ab155e` `fix(publisher): refresh cached online site view`
- `d4ff9f10` `fix(publisher): clear HTTP cache before online preview`

### 2.4 线上站刷新提示条样式

- 提示条改为紧凑横向布局。
- 左侧警告图标和两行说明，右侧实心青色主按钮。
- 按钮包含刷新图标、悬停/按下/键盘焦点状态。
- 窄宽度下按钮可自动换行。

关键提交：

- `8b57ac8e` `style(publisher): turn online refresh into primary button`

### 2.5 可见性菜单选中态

- 修复菜单打开时永远聚焦“公开”的问题。
- 打开菜单时聚焦当前选中的可见性选项。
- 选中项增加持久背景和左侧青色强调线，不再只靠右侧勾号表示。
- 私密笔记打开菜单时，“私密”项高亮并获得焦点。

关键提交：

- `cf05d10e` `fix(publisher): highlight selected visibility option`

### 2.6 通用线上预览地址

- “线上公开站”不再硬编码 `jin07-72.github.io/knowledge-garden`。
- 预览使用当前博客已经解析并验证的网站地址：手动配置优先，否则读取 `quartz.config.yaml` 的 `configuration.baseUrl`。
- 没有配置网站地址时不加载 iframe，并提示在“管理博客”中配置。
- 原有缓存清理、refresh 参数、刷新按钮和 iframe sandbox 保持不变。
- 此项修改没有触碰公开/私密转换事务。

关键提交：

- `561d25b3` `fix(publisher): use configured online preview address`
- `8df7abbf` `chore(publisher): release 0.1.3`

### 2.7 可关闭的启动检查提示

- 主界面上的非阻塞启动检查提示增加右上角叉键。
- 点击叉键只隐藏本次会话中的提示，软件仍可继续使用；重启后会重新检查并再次提示仍存在的问题。
- 阻塞式本地安全检查页面不提供绕过按钮。
- 点击“重新检查”后如果预览端口仍被占用，会明确显示“重新检查完成：预览端口仍被占用。”
- 后续修复动作再次检查时会先清除旧的端口占用结论，避免在端口已经释放后继续显示过期提示。
- 没有修改端口探测、预览服务、发布流程或私密/公开转换事务。

### 2.8 可编辑的领域描述与标签（`0.1.5` 待发布）

- “管理领域”可编辑自定义领域的描述和标签；保存后原子更新 `content/<slug>/index.md` 的 YAML frontmatter。
- 描述和标签均可留空；清空后对应 `description` / `tags` 键会从 YAML 中删除，管理器显示“未填写描述”和“无标签”，不会写入占位值。
- 标签支持中英文逗号分隔、去除首尾空白并按首次出现顺序去重；重启应用后从领域入口页重新读取并显示持久化值。
- 元数据更新只允许作用于已验证的公开领域入口页，不修改领域内公开笔记、`private/` 内容或私密目录结构，也不触发发布。
- 写入使用领域事务、revision/identity 校验和回滚证据；并发修改、路径替换或恢复不确定时安全失败，不越过工作区边界。

## 3. 当前内容状态

- 最新内容提交（合并前）：`f2965202`
- `content/life/weekly-review.md` 当前为公开状态，线上页面返回 200。
- `private/` 当前只有 `.gitkeep`，没有私密笔记。
- `content/technology/css-grid.md` 为公开。
- 线上主页、CSS Grid、每周复盘页面当前均可访问。

## 4. 修改的主要文件

| 文件                                                               | 原因                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/publisher/src/main/services/noteTransactions.ts`             | 公开→私密时自动清理入站 WikiLink                                                           |
| `apps/publisher/src/renderer/src/App.tsx`                          | 部署状态复查、链接清理提示、清缓存回调、传递当前博客网站地址、启动诊断会话级隐藏和重试反馈 |
| `apps/publisher/src/renderer/src/components/FirstRun.tsx`          | 启动检查提示的可选关闭按钮和重试状态反馈                                                   |
| `apps/publisher/src/renderer/src/publishDeploymentStatus.ts`       | 未确认部署时返回 `deploying`                                                               |
| `apps/publisher/src/renderer/src/components/PreviewPane.tsx`       | 使用当前博客网站地址、未配置提示、cache-busting、清缓存、刷新按钮布局                      |
| `apps/publisher/src/renderer/index.html`                           | 允许经过主进程验证的 HTTP(S) 网站作为 iframe 目标                                          |
| `apps/publisher/src/renderer/src/components/VisibilityMenu.tsx`    | 打开菜单时聚焦当前选中项                                                                   |
| `apps/publisher/src/renderer/src/app.css`                          | 刷新按钮、提示条、选中可见性样式                                                           |
| `apps/publisher/src/main/index.ts`                                 | 注入 `session.defaultSession.clearCache()`                                                 |
| `apps/publisher/src/main/ipc.ts`                                   | 新增清缓存 IPC                                                                             |
| `apps/publisher/src/preload/gardenApi.ts`                          | 暴露 `history.clearCache()`                                                                |
| `apps/publisher/src/shared/contracts.ts`                           | 新增 IPC 通道和 API 类型                                                                   |
| `apps/publisher/src/shared/ipcSchemas.ts`                          | 新增清缓存通道 schema                                                                      |
| `apps/publisher/tests/integration/noteTransactions.test.ts`        | 自动链接清理、CRLF、事务回滚测试                                                           |
| `apps/publisher/tests/integration/publish.test.ts`                 | 私密→公开发布、清理后发布测试                                                              |
| `apps/publisher/tests/unit/main-layout.test.tsx`                   | 部署状态、缓存、可见性高亮、刷新按钮测试                                                   |
| `apps/publisher/tests/unit/renderer-security.test.tsx`             | 缓存回调和新 PreviewPane 属性                                                              |
| `apps/publisher/tests/unit/ipc.test.ts`                            | 新 IPC/preload 通道                                                                        |
| `apps/publisher/tests/unit/app-smoke.test.tsx`                     | 新 history API mock                                                                        |
| `README.md`                                                        | 记录自动链接清理行为                                                                       |
| `docs/superpowers/specs/2026-10-20-visibility-roundtrip-design.md` | 更新隐私往返设计                                                                           |
| `docs/superpowers/plans/2026-10-20-visibility-roundtrip.md`        | 标注新需求覆盖旧计划                                                                       |
| `apps/publisher/src/main/services/domains.ts`                      | 原子更新领域入口页描述和标签，保留其余 frontmatter 与正文                                  |
| `apps/publisher/src/renderer/src/components/DomainManager.tsx`     | 编辑、清空并展示领域描述和标签                                                             |
| `apps/publisher/tests/e2e/app.spec.ts`                             | 覆盖填写、清空、重启持久化及笔记/private 隔离                                              |
| `apps/publisher/package.json`、`package-lock.json`                 | 发布器 patch 版本更新为 `0.1.5`                                                            |

## 5. 验证结果

已执行：

- 本次 `0.1.5` 定向单元测试：`ipc-schemas`、`domains`、`ipc`、`publisher-services`、`domain-manager`、`main-layout`，共 `6` 个文件、`431 passed`。
- 本次 `npm run typecheck`：通过。
- 本次对变更文件执行 Prettier：通过。
- 本次 `git diff --check`：通过。
- 本次 `npm run build`：通过（仅生成已忽略的 `apps/publisher/out/`，未打包或安装）。
- 本次定向 Electron E2E：将 `TEMP` / `TMP` 指向工作树内已忽略的 `apps/publisher/.garden-publisher/e2e-temp` 后，`npm run test:e2e -- --grep "manages custom domains"` 为 `1 passed`；对照测试 `--grep "recovers a corrupt registry"` 也为 `1 passed`。
- E2E 启动诊断：本机原始 Electron 44.4.2 在 Chromium Windows sandbox 初始化时以 `0x80000003` 退出，且 Codex 运行边界外的系统临时目录对 Electron 写入返回 `EPERM`。测试启动器仅在 Windows E2E 进程加入 `--no-sandbox`，并使用工作树内临时目录；正式打包应用的 sandbox 配置未修改。

- 完整 `noteTransactions.test.ts`：`102 passed`
- 完整 `publish.test.ts`：`58 passed, 1 skipped`
- UI/security/IPC/App smoke 合并运行：`198 passed`
- `first-run.test.tsx` 与 `main-layout.test.tsx`：`94 passed`
- `publish-deployment-status.test.ts`：`9 passed`
- `npm --prefix apps/publisher run typecheck`：通过
- `npm --prefix apps/publisher run build`：通过
- 站点构建和站内链接检查：`FAILURES=0`
- Prettier、`git diff --check`：通过
- 通用线上地址 UI 回归：`90 passed`
- 可见性事务与隔离发布回归：`161 passed, 1 skipped`
- 完整发布器测试套件（单工作线程）：`1650 passed, 16 skipped`
- Windows `0.1.4` 安装包：生成成功
- 正式安装目录已更新为 `0.1.4`，可执行文件 SHA256：`A057E25944607119C4E571F74DE5A136C6098224289FFB2E065E9C0D4AC8C6A3`

尚未完成：

- `0.1.5` 尚未打包或安装，也尚未合并、推送；这些步骤由后续发布操作完成。

## 6. 本机运行方式

- 正式 `0.1.4` 安装目录：`C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher`
- 更新前的完整 `0.1.3` 目录保留在 `C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher Backup 0.1.3`，可用于回滚。
- 审查补丁前的完整 `0.1.4` 目录保留在 `C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher Backup 0.1.4-pre-review-20261021-104628`。
- 桌面和开始菜单中旧的 **Fixed** 快捷方式仍指向正式安装目录。
- 旧便携目录仍保留，但常用快捷方式不再启动它。

## 7. 尚未解决的问题

1. Electron E2E 仍需复测。
2. 非限定 WikiLink 在跨领域 slug 冲突时会保留而不是猜测目标；极端情况下仍可能被严格链接检查阻挡。
3. 外部浏览器自身缓存无法由应用清除；应用只能清理 Electron 会话缓存，外部浏览器仍需强制刷新。

## 8. 建议下一步

1. 在正常桌面环境运行完整测试和 Electron E2E。
2. 用真实博客再验证一次：
   - 私密→公开并发布，确认线上新增。
   - 公开→私密并发布，确认线上 404 和入站链接自动清理。
   - 软件“线上公开站”刷新后显示最新内容。
3. 保留并最终由用户决定如何处理 `highlight.js` 和 `.tmp-render-check.png`。

## 9. 给 Codex 的注意事项

- 本次代码修改已合并并推送，不要重复合并或回退。
- 不要丢弃工作区中的 `apps/publisher/package*.json` 修改和 `.tmp-render-check.png`。
- 用户要求本次发布保留现有自动清理入站 WikiLink 行为，不在通用线上地址修复中改动它。
- 自动清理只处理公开 Markdown 中指向本次转私密笔记的 WikiLink；不要扩大到私有 Markdown、代码块或无关链接。
- 不要因为 Git push 成功就宣称线上页面已上线；必须等待 Pages 部署运行成功。
- 外部浏览器缓存不属于应用控制范围；应用已清理 Electron 会话缓存并提供带 refresh 参数的线上站。
- 正式安装目录和常用快捷方式均已更新至 `0.1.4`。
