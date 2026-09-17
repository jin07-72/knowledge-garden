# Knowledge Garden

Knowledge Garden 是一个公开的、由 Markdown 驱动的 Quartz 知识花园（a public, Markdown-powered Quartz site），用来发布相互连接的个人笔记。

## Requirements / 环境要求

- Node.js 22+
- npm 10.9.2+
- Git

## Start locally / 本地启动

在项目目录安装依赖和 Quartz 配置的插件，然后启动本地预览服务器：

```sh
npm ci
npx quartz plugin install
npx quartz build --serve
```

在浏览器打开 <http://localhost:8080>。`npx quartz build --serve` 会持续运行并占用当前终端；需要执行其他命令时请打开第二个终端，回到运行窗口按 Ctrl+C 才能停止预览服务器。

## Write a public note / 编写公开笔记

把模板复制到 `content/` 下已有的子文件夹，并使用全小写文件名。Windows PowerShell 示例：

```powershell
Copy-Item templates/note-template.md content/technology/my-first-note.md
```

上例把模板复制为 `content/technology/my-first-note.md`；`my-first-note.md` 是可按主题改名的全小写文件名，`technology` 也可以换成其他 `content/` 子文件夹。然后更新顶部 `---` 之间的 frontmatter（笔记的元数据）：`title`、`date`、`description`、`tags` 每一项都要填写；在正文中使用 `[[wiki links]]` 格式（例如 `[[笔记标题]]`）添加 wiki link，把相关笔记连接起来。先验证内容，再预览：

```sh
npm run validate:content
npx quartz build --serve
```

预览服务器启动后会一直运行；请在第二个终端执行验证等其他命令，完成后在运行预览的终端按 Ctrl+C 停止。`content/` 下的 Markdown 笔记、图片等附件以及其他非 Markdown 文件都可能被发布到网站。

## Keep a note private / 保持笔记私密

所有私密材料（包括草稿、附件和其他文件）只放在被忽略的 `private/` 下。该目录只有 `private/.gitkeep` 被跟踪；不要使用 `git add -f` 强制添加私密文件。Quartz 的内容输入目录是 `content/`，也就是说 Quartz only builds `content/`；因此 `private/` 不会被构建进网站。但公开 GitHub 仓库中任何已经提交的文件（无论位于哪个目录）都对仓库访问者可见，不能把密钥或其他敏感材料提交到仓库。

每次提交前检查工作区，确认没有私密笔记或附件出现在列表中：

```sh
git status --short
```

## Verify changes / 验证改动

发布前运行完整的网站验证：

```sh
npm run verify:site
```

该命令会运行网站工具测试、验证 Markdown 元数据、检查 Quartz 源码和格式、构建网站，并检查生成页面中的内部链接。

## Publish with GitHub Pages / 发布到 GitHub Pages

将 `main` 分支推送到 GitHub，然后在仓库中打开 **Settings → Pages**，将发布来源设为 **GitHub Actions**。Pages 工作流会先运行验证，再部署网站；之后推送到 `main` 也只有在这些检查成功后才会发布。

## Update Quartz / 更新 Quartz

目标是 Quartz 的 `v5` 分支。全新 clone 后先检查远程仓库；如果输出中还没有 `quartz-upstream`，只在缺少时添加：

```sh
git remote -v
```

如果输出中还没有 `quartz-upstream`，再执行一次添加命令（已有该 remote 时不要重复添加）：

```sh
git remote add quartz-upstream https://github.com/jackyzha0/quartz.git
```

然后获取并检查目标 `v5` 分支：

```sh
git fetch quartz-upstream v5
git log --oneline HEAD..quartz-upstream/v5
```

如果 `quartz-upstream` 已存在，不要重复执行 `git remote add`；保留这个 remote，直接执行 fetch 和 log。逐条检查 `HEAD..quartz-upstream/v5` 中的上游改动，确认影响后再手动合并或挑选需要的提交，不要盲目 merge。每次更新 Quartz 后都重新运行 `npm run verify:site`。
