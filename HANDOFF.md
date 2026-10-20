# Knowledge Garden Handoff

更新时间：2026-10-20 20:44（Asia/Shanghai）

本文档用于在 DeepSeek Harness 临时接管结束后，让 Codex 不依赖完整聊天记录也能理解当前状态。

## 0. 当前审查分支

- 分支：`codex/auto-private-link-repair`
- 自动链接修复提交：`08118df2`（`fix(publisher): auto-repair inbound links on privatization`）
- 合并提交：`6e40ae1e`，已把 `codex/private-to-public-publish-status` 合并进本分支。
- 部署状态修复提交：`5ed962ab`（`fix(publisher): wait for Pages deployment before reporting success`）。
- `main` 为 `46f14d4f`，尚未合并本分支。
- 分支尚未推送到远端。
- 本次修复位于该分支，等待用户确认后再决定是否合并。

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

## 2. 接手前状态

- 接手时分支：`main`，`HEAD` 为 `a5d90cfa`。
- 在 20:41 左右，用户通过发布器把“每周复盘”的删除和两条入站链接清理发布为 `46f14d4f`；线上 `life/weekly-review` 现为 404，生活领域页为 0 条公开笔记。
- 桌面发布器版本：`0.1.2`。
- 私密笔记真实 Quartz 预览已在 `ea0089ab` 提交。
- 公开/私密本地事务已在 `013db6f9` 提交。
- 线上首页和 CSS Grid 页面均可访问。
- “每周复盘”已移动到本地 `private/life/weekly-review.md`，但公开目录的删除尚未发布，线上旧页面仍在线。
- 未提交的 `apps/publisher/package*.json`（`highlight.js`）和 `.tmp-render-check.png` 是用户原有改动，必须保留。
- 工作区中的 `content/life/weekly-review.md` 删除是用户公开→私密操作，不是误删，必须保留。

## 3. 本次接手完成的工作

### 3.1 验证私密→公开转换链路

新增真实临时 Git 仓库集成测试：

- 从 `private/reading/private-new.md` 移动到 `content/reading/private-new.md`。
- 验证变更扫描把它识别为“新增公开文章”。
- 验证发布器能把该文件 commit 并 push 到测试远端。
- 验证私密源文件被移除，远端不包含私密文件。

测试通过，说明本地转换、变更识别和 Git 发布链路本身正常。

### 3.2 修复“线上还没出现，界面已显示发布成功”

根因：

- 发布器在 Git push 成功后立即把状态显示为“发布成功”。
- GitHub Pages 部署是异步的，而且可能超过部署监视器一次等待窗口。
- 当还没有匹配的部署运行时，旧逻辑把状态标记为 `complete`，显示“发布成功，暂时无法确认部署状态”。
- 用户因此会把“代码已推送”误认为“网站已经上线”。

修复：

- 未确认部署完成时，状态保持为 `deploying`，不再提前进入 `complete`。
- 文案改为“代码已推送，正在等待 GitHub Pages 部署…”。
- 部署历史仍在更新、运行中或暂时无法确认时，不再显示“发布成功”。
- 发布完成后自动复查部署状态，最多追加 3 次、每次间隔 15 秒；加上主进程已有的等待窗口，可覆盖数分钟的 Pages 部署延迟。
- 部署成功后才显示“发布成功，部署已完成”。
- 部署失败或取消时继续显示对应的失败状态。

### 3.3 自动修复隐私切换产生的入站坏链

问题：

- 公开笔记转私密后，其他公开 Markdown 中的 WikiLink 会指向不存在的页面。
- 发布器严格执行站内链接检查，因此下一次发布会被坏链阻断。

修复：

- 公开→私密事务现在会扫描公开 Markdown，自动删除指向该笔记的入站 WikiLink。
- 限定路径（如 `life/weekly-review`）总是删除；不带域名的 `weekly-review` 只在 slug 唯一时删除。
- 私密 Markdown、代码块、行内代码和无关链接不修改。
- 链接文件带 revision 校验并纳入事务 journal；任一文件在事务中被外部修改会安全失败。
- 事务完成后 UI 会显示“已自动清理 N 个页面中的入站链接”。
- 这样后续发布不再需要用户手工查找并删除坏链。

## 4. 修改的文件

| 文件 | 原因 |
|---|---|
| `apps/publisher/src/renderer/src/publishDeploymentStatus.ts` | 未确认部署完成时返回 `deploying`，不再返回 `complete` |
| `apps/publisher/src/renderer/src/App.tsx` | 更新状态文案；增加部署状态自动复查；取消发布时清理复查定时器 |
| `apps/publisher/tests/unit/publish-deployment-status.test.ts` | 覆盖 pending、running、缺少运行记录等状态 |
| `apps/publisher/tests/unit/main-layout.test.tsx` | 覆盖自动复查，并更新状态文案断言 |
| `apps/publisher/tests/integration/publish.test.ts` | 新增私密→公开并发布的端到端集成测试；覆盖自动清理后发布 |
| `apps/publisher/tests/e2e/app.spec.ts` | 更新发布状态断言，避免继续期待“提前成功”文案 |
| `apps/publisher/src/main/services/noteTransactions.ts` | 公开→私密时计算并执行入站链接清理；返回被修改页面 |
| `apps/publisher/tests/integration/noteTransactions.test.ts` | 覆盖限定/非限定链接、CRLF、代码块和事务回滚 |
| `README.md` | 记录自动链接清理行为 |
| `docs/superpowers/specs/2026-10-20-visibility-roundtrip-design.md` | 更新隐私往返设计 |
| `docs/superpowers/plans/2026-10-20-visibility-roundtrip.md` | 标注新需求覆盖旧计划 |

私密→公开的生产事务代码没有修改，因为验证表明该方向本身正常；本次修复针对公开→私密遗留下来的坏链根因。

## 5. 已执行的测试和结果

- 私密→公开本地事务测试：`1 passed`
- 私密→公开并发布集成测试：`1 passed`
- 自动链接清理定向测试：`7 passed`
- 完整 `noteTransactions.test.ts`：`102 passed`
- 完整 `publish.test.ts`：`58 passed, 1 skipped`
- 部署状态单元测试：`9 passed`
- `main-layout.test.tsx`：`82 passed`
- 两组单元测试合并运行：`91 passed`
- `npm --prefix apps/publisher run typecheck`：通过
- `npm --prefix apps/publisher run build`：通过
- 站点构建和站内链接检查：`FAILURES=0`
- `git diff --check`、相关文件 Prettier：通过
- GitHub Pages E2E：未完成。Playwright 启动 Electron 时失败，报 `Process failed to launch!`；这是本机测试环境/Electron 启动问题，不是断言失败。

尚未运行完整 1600+ 项发布器测试套件，也尚未重新打包或覆盖安装本机应用。

## 6. 当前未提交内容

本次修复已提交到审查分支 `codex/auto-private-link-repair`：

- `08118df2`：自动清理隐私切换产生的入站坏链。
- `5ed962ab`：修正 Pages 部署状态提前显示成功。
- `6e40ae1e`：合并两条修复。

`46f14d4f` 已由用户通过发布器发布到 `main`，包含：

- “每周复盘”的公开删除。
- `content/life/index.md` 和 `content/reading/active-recall.md` 的坏链清理。

工作区仍保留、不得丢弃：

- `apps/publisher/package.json` 和 `apps/publisher/package-lock.json` 中的 `highlight.js` 依赖。
- `.tmp-render-check.png`。

`content/life/weekly-review.md` 已由用户发布删除，私密副本仍在 `private/life/weekly-review.md`。

## 7. 尚未解决的问题

1. 本机正式安装的发布器仍是旧构建；本次修复只在临时打包副本和审查分支中。
2. Electron E2E 启动失败，需要在可正常启动 Electron 的桌面会话中复测。
3. 完整发布器测试套件尚未重跑。
4. 当同名 slug 在不同领域出现、非限定 WikiLink 有歧义时，自动清理会保留该链接而不是猜测目标；极端情况下仍可能被严格链接校验阻挡。
5. 发布器还没有“发布后自动重试整条验证”的产品级回退；当前自动修复发生在公开→私密事务阶段。

## 8. 建议下一步

1. 在正常桌面环境运行完整发布器测试和 Electron E2E。
2. 重新打包并安装包含两项修复的版本；若沿用 `0.1.2`，注意此前同版本覆盖安装曾出现 NSIS 问题。
3. 用真实博客做一次完整私密→公开验证：
   - 新建一篇私密笔记。
   - 转为公开后确认 `content/` 出现文件。
   - 发布审查里只选择该新增笔记。
   - 发布后应显示“代码已推送，正在等待 GitHub Pages 部署…”，随后自动变为“发布成功，部署已完成”。
4. 再验证一次公开→私密：转换后确认其他公开 Markdown 中指向它的入站链接已自动清理，UI 显示清理数量。
5. 保留并最终由用户决定如何处理 `highlight.js` 和临时截图。

## 9. 给 Codex 的注意事项

- 不要丢弃工作区现有未提交改动。
- 自动清理入站 WikiLink 是当前用户明确要求，不要恢复“完全不动其他 Markdown”的旧行为。
- 自动清理只处理公开 Markdown 中指向本次转私密笔记的 WikiLink；不要扩大到私有 Markdown、代码块或无关链接。
- 不要因为本地 Git push 成功就宣称线上页面已上线；必须等待 Pages 部署结果。
- `content/life/weekly-review.md` 的删除是真实用户操作，已发布，线上返回 404。
- 本次修复已提交到审查分支 `codex/auto-private-link-repair`，但未推送、未合并到 `main`。
- 用户确认前不要合并该分支；审查重点是 `08118df2` 和 `5ed962ab`。
