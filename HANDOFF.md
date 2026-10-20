# Knowledge Garden Handoff

更新时间：2026-10-20 22:48（Asia/Shanghai）

本文档用于在 DeepSeek Harness 临时接管结束后，让 Codex 不依赖完整聊天记录也能理解当前状态。

## 0. 当前状态

- 当前分支：`main`
- 当前 HEAD：`a1c6c47e`（`merge: publisher visibility, cache, and deployment fixes`）
- 合并来源：`codex/auto-private-link-repair`
- `main` 比 `origin/main` 领先 11 个提交，尚未推送远端。
- 本次代码修改已全部合并到本地 `main`。
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

## 3. 当前内容状态

- 最新内容提交（合并前）：`f2965202`
- `content/life/weekly-review.md` 当前为公开状态，线上页面返回 200。
- `private/` 当前只有 `.gitkeep`，没有私密笔记。
- `content/technology/css-grid.md` 为公开。
- 线上主页、CSS Grid、每周复盘页面当前均可访问。

## 4. 修改的主要文件

| 文件 | 原因 |
|---|---|
| `apps/publisher/src/main/services/noteTransactions.ts` | 公开→私密时自动清理入站 WikiLink |
| `apps/publisher/src/renderer/src/App.tsx` | 部署状态复查、链接清理提示、清缓存回调 |
| `apps/publisher/src/renderer/src/publishDeploymentStatus.ts` | 未确认部署时返回 `deploying` |
| `apps/publisher/src/renderer/src/components/PreviewPane.tsx` | 线上站 cache-busting、清缓存、刷新按钮布局 |
| `apps/publisher/src/renderer/src/components/VisibilityMenu.tsx` | 打开菜单时聚焦当前选中项 |
| `apps/publisher/src/renderer/src/app.css` | 刷新按钮、提示条、选中可见性样式 |
| `apps/publisher/src/main/index.ts` | 注入 `session.defaultSession.clearCache()` |
| `apps/publisher/src/main/ipc.ts` | 新增清缓存 IPC |
| `apps/publisher/src/preload/gardenApi.ts` | 暴露 `history.clearCache()` |
| `apps/publisher/src/shared/contracts.ts` | 新增 IPC 通道和 API 类型 |
| `apps/publisher/src/shared/ipcSchemas.ts` | 新增清缓存通道 schema |
| `apps/publisher/tests/integration/noteTransactions.test.ts` | 自动链接清理、CRLF、事务回滚测试 |
| `apps/publisher/tests/integration/publish.test.ts` | 私密→公开发布、清理后发布测试 |
| `apps/publisher/tests/unit/main-layout.test.tsx` | 部署状态、缓存、可见性高亮、刷新按钮测试 |
| `apps/publisher/tests/unit/renderer-security.test.tsx` | 缓存回调和新 PreviewPane 属性 |
| `apps/publisher/tests/unit/ipc.test.ts` | 新 IPC/preload 通道 |
| `apps/publisher/tests/unit/app-smoke.test.tsx` | 新 history API mock |
| `README.md` | 记录自动链接清理行为 |
| `docs/superpowers/specs/2026-10-20-visibility-roundtrip-design.md` | 更新隐私往返设计 |
| `docs/superpowers/plans/2026-10-20-visibility-roundtrip.md` | 标注新需求覆盖旧计划 |

## 5. 验证结果

已执行：

- 完整 `noteTransactions.test.ts`：`102 passed`
- 完整 `publish.test.ts`：`58 passed, 1 skipped`
- UI/security/IPC/App smoke 合并运行：`198 passed`
- `main-layout.test.tsx`：`82 passed`
- `publish-deployment-status.test.ts`：`9 passed`
- `npm --prefix apps/publisher run typecheck`：通过
- `npm --prefix apps/publisher run build`：通过
- 站点构建和站内链接检查：`FAILURES=0`
- Prettier、`git diff --check`：通过

尚未完成：

- 完整 1600+ 项发布器测试套件未重跑。
- Electron E2E 曾因本机 Electron 启动失败而无法完成断言验证。
- 未生成正式新版安装包，未覆盖原安装目录。
- `main` 尚未 push 到远端。

## 6. 本机运行方式

- 原安装版：`C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher`
- 当前包含全部修复的便携版：`C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher Fixed`
- 桌面快捷方式：`Knowledge Garden Publisher (Fixed).lnk`
- 开始菜单快捷方式：`Knowledge Garden Publisher Fixed.lnk`

原安装版仍是旧构建，不应再使用；应使用 **Fixed** 版本。

## 7. 尚未解决的问题

1. 正式安装包尚未更新；当前修复运行在便携副本中。
2. Electron E2E 需要在可正常启动 Electron 的桌面环境复测。
3. 完整发布器测试套件尚未重跑。
4. 非限定 WikiLink 在跨领域 slug 冲突时会保留而不是猜测目标；极端情况下仍可能被严格链接检查阻挡。
5. 外部浏览器自身缓存无法由应用清除；应用只能清理 Electron 会话缓存，外部浏览器仍需强制刷新。

## 8. 建议下一步

1. 将本地 `main` 推送到远端前，先审阅 `a1c6c47e` 及其父提交。
2. 在正常桌面环境运行完整测试和 Electron E2E。
3. 升级发布器版本并生成正式安装包，覆盖原安装目录，移除对便携副本的依赖。
4. 用真实博客再验证一次：
   - 私密→公开并发布，确认线上新增。
   - 公开→私密并发布，确认线上 404 和入站链接自动清理。
   - 软件“线上公开站”刷新后显示最新内容。
5. 保留并最终由用户决定如何处理 `highlight.js` 和 `.tmp-render-check.png`。

## 9. 给 Codex 的注意事项

- 本次代码修改已合并到本地 `main`，不要重复合并或回退。
- `main` 尚未推送；推送前先确认用户意图。
- 不要丢弃工作区中的 `apps/publisher/package*.json` 修改和 `.tmp-render-check.png`。
- 自动清理入站 WikiLink 是当前用户明确要求，不要恢复“完全不动其他 Markdown”的旧行为。
- 自动清理只处理公开 Markdown 中指向本次转私密笔记的 WikiLink；不要扩大到私有 Markdown、代码块或无关链接。
- 不要因为 Git push 成功就宣称线上页面已上线；必须等待 Pages 部署运行成功。
- 外部浏览器缓存不属于应用控制范围；应用已清理 Electron 会话缓存并提供带 refresh 参数的线上站。
- 正式安装版仍可能是旧构建；确认用户启动的是 Fixed 版本。
