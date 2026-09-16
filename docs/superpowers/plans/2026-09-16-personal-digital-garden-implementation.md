# Personal Digital Garden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public Quartz-based personal digital garden with a custom dark focus theme, four knowledge domains, Markdown authoring, search, backlinks, graph navigation, local drafts, and automatic GitHub Pages deployment.

**Architecture:** Import the upstream Quartz v5 tree into the existing repository, then keep customization in `quartz.config.yaml`, `quartz/styles/custom.scss`, focused Node validation scripts, and Markdown content. GitHub Actions derives the correct Pages base URL from `GITHUB_REPOSITORY`, validates content, builds the static site, checks internal links, and deploys `public/` only after every check succeeds.

**Tech Stack:** Quartz v5 at upstream commit `3dff48b5df6d84c9544a5ae19c8f2cbb01dc44e5`, Node.js 24, npm, TypeScript/Preact supplied by Quartz, Sass, Markdown, Node's built-in test runner, GitHub Actions, and GitHub Pages.

---

## File Map

- `quartz.config.yaml`: site identity, theme tokens, plugin set, sidebar layout, search, graph, backlinks, and responsive component placement.
- `quartz.ts`: injects the home-only overview component into the loaded Quartz layout.
- `quartz/components/GardenOverview.tsx`: calculates domain and total note counts from the built content graph and renders the four home cards.
- `quartz/components/GardenOverview.test.ts`: verifies domain counting without rendering a full site.
- `quartz/styles/custom.scss`: dark focus visual system, home-domain cards, reading layout refinements, keyboard focus, and mobile behavior.
- `content/index.md`: knowledge-garden home page and the four domain entry cards.
- `content/reading/index.md`: reading and thinking domain landing page.
- `content/reading/active-recall.md`: representative learning-method note with links and a callout.
- `content/technology/index.md`: technology and tools domain landing page.
- `content/technology/css-grid.md`: representative technical note with code.
- `content/language/index.md`: language-learning domain landing page.
- `content/language/spaced-vocabulary.md`: representative language-learning note.
- `content/life/index.md`: life experiments domain landing page.
- `content/life/weekly-review.md`: representative reflection note.
- `templates/note-template.md`: copyable Markdown template for new public notes.
- `private/.gitkeep`: keeps the local-drafts directory visible while its contents remain ignored.
- `.gitignore`: preserves Quartz defaults and excludes private drafts, generated output, and brainstorming artifacts.
- `scripts/content-validation.mjs`: reusable frontmatter and content-tree validation functions.
- `scripts/validate-content.mjs`: command-line validation entrypoint.
- `scripts/content-validation.test.mjs`: tests for missing metadata, private paths, and valid notes.
- `scripts/pages-base-url.mjs`: derives a Pages host/path from a GitHub repository slug.
- `scripts/pages-base-url.test.mjs`: tests project-site and user-site URL derivation.
- `scripts/configure-pages-base-url.mjs`: writes the derived URL into `quartz.config.yaml` during CI.
- `scripts/check-built-links.mjs`: checks generated local links and anchors after the Quartz build.
- `scripts/check-built-links.test.mjs`: fixture-based tests for valid and broken generated links.
- `.github/workflows/deploy.yml`: validation, build, artifact upload, and Pages deployment.
- `README.md`: local authoring, preview, publishing, privacy, and maintenance instructions.

### Task 1: Import and initialize the Quartz v5 baseline

**Files:**
- Create from upstream: `package.json`, `package-lock.json`, `quartz.ts`, `quartz.config.default.yaml`, `quartz/`, and supporting Quartz root files
- Create through Quartz initialization: `quartz.config.yaml`
- Preserve: `docs/superpowers/specs/2026-09-16-personal-digital-garden-design.md`
- Preserve: `docs/superpowers/plans/2026-09-16-personal-digital-garden-implementation.md`

- [ ] **Step 1: Create an isolated execution worktree**

Use the `superpowers:using-git-worktrees` skill. Create the worktree from the current branch and verify the design and plan documents exist before continuing.

- [ ] **Step 2: Fetch the pinned Quartz v5 source**

Run:

```powershell
git remote add quartz-upstream https://github.com/jackyzha0/quartz.git
git fetch --depth 1 quartz-upstream 3dff48b5df6d84c9544a5ae19c8f2cbb01dc44e5
```

Expected: `FETCH_HEAD` resolves to `3dff48b5df6d84c9544a5ae19c8f2cbb01dc44e5`.

- [ ] **Step 3: Merge the Quartz tree without discarding the design history**

Run:

```powershell
git merge --allow-unrelated-histories --no-edit FETCH_HEAD
```

Expected: a clean merge that adds the Quartz v5 source and leaves `docs/superpowers/` unchanged.

- [ ] **Step 4: Verify the runtime requirement before installation**

Run:

```powershell
node --version
npm --version
```

Expected: Node.js `v22` or newer and npm `10.9.2` or newer. If the bundled workspace runtime is needed, load it through the Codex workspace dependency tool and use its returned Node path for all later commands.

- [ ] **Step 5: Install the pinned dependency tree**

Run:

```powershell
npm ci
```

Expected: exit code `0` with no lockfile modification.

- [ ] **Step 6: Initialize Quartz non-interactively**

Run:

```powershell
npx quartz create --template obsidian --strategy new --baseUrl localhost:8080
```

Expected: `quartz.config.yaml` exists, link resolution is `shortest`, and the referenced plugins are installed.

- [ ] **Step 7: Establish a green baseline**

Run:

```powershell
npm test
npm run check
npx quartz build
```

Expected: all three commands exit `0`, and `public/index.html` exists.

- [ ] **Step 8: Commit the baseline**

```powershell
git add -- package.json package-lock.json quartz.ts quartz.config.yaml quartz quartz.config.default.yaml .github .gitattributes .gitignore .node-version .npmrc .prettierignore .prettierrc globals.d.ts index.d.ts LICENSE.txt README.md tsconfig.json
git commit -m "chore: initialize Quartz v5"
```

### Task 2: Add test-driven content validation and private-draft boundaries

**Files:**
- Create: `scripts/content-validation.mjs`
- Create: `scripts/validate-content.mjs`
- Create: `scripts/content-validation.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `private/.gitkeep`

- [ ] **Step 1: Write failing validation tests**

Create `scripts/content-validation.test.mjs`:

```js
import assert from "node:assert/strict"
import { test } from "node:test"
import { validateNote, isPrivatePath } from "./content-validation.mjs"

const valid = `---
title: Active Recall
date: 2026-09-16
description: A practical review method.
tags:
  - learning
---

# Active Recall
`

test("accepts a complete published note", () => {
  assert.deepEqual(validateNote("content/reading/active-recall.md", valid), [])
})

test("reports every missing required field", () => {
  assert.deepEqual(validateNote("content/reading/incomplete.md", "# Draft"), [
    "content/reading/incomplete.md: missing frontmatter",
  ])
})

test("reports malformed tags", () => {
  const note = `---
title: Note
date: 2026-09-16
description: Description
tags: learning
---`
  assert.deepEqual(validateNote("content/reading/note.md", note), [
    "content/reading/note.md: tags must be a non-empty array",
  ])
})

test("recognizes the local private tree", () => {
  assert.equal(isPrivatePath("private/unfinished.md"), true)
  assert.equal(isPrivatePath("content/reading/published.md"), false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test scripts/content-validation.test.mjs
```

Expected: FAIL because `scripts/content-validation.mjs` does not exist.

- [ ] **Step 3: Implement the validation module**

Create `scripts/content-validation.mjs`:

```js
import YAML from "yaml"

export function isPrivatePath(filePath) {
  return filePath.replaceAll("\\", "/").startsWith("private/")
}

export function validateNote(filePath, source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return [`${filePath}: missing frontmatter`]

  let data
  try {
    data = YAML.parse(match[1]) ?? {}
  } catch (error) {
    return [`${filePath}: invalid YAML frontmatter (${error.message})`]
  }

  const errors = []
  for (const field of ["title", "date", "description"]) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      errors.push(`${filePath}: missing ${field}`)
    }
  }
  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    errors.push(`${filePath}: tags must be a non-empty array`)
  }
  return errors
}
```

- [ ] **Step 4: Implement the command-line validator**

Create `scripts/validate-content.mjs`:

```js
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { validateNote } from "./content-validation.mjs"

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : []
  }))
  return nested.flat()
}

const files = await markdownFiles("content")
const errors = []
for (const file of files) {
  const portablePath = relative(".", file).replaceAll("\\", "/")
  errors.push(...validateNote(portablePath, await readFile(file, "utf8")))
}

if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else {
  console.log(`Validated ${files.length} Markdown files.`)
}
```

- [ ] **Step 5: Wire validation into npm scripts**

Add these entries to `package.json` under `scripts`:

```json
"test:site": "node --test scripts/*.test.mjs",
"validate:content": "node scripts/validate-content.mjs",
"verify:site": "npm run test:site && npm run validate:content && npm run check && npx quartz build && node scripts/check-built-links.mjs"
```

The final command references the link checker added in Task 6; until then, run the first three commands individually.

- [ ] **Step 6: Protect private drafts and brainstorming artifacts**

Append to `.gitignore`:

```gitignore
# Local-only drafts and design previews
private/*
!private/.gitkeep
.superpowers/

# Generated site output
public/
```

Create an empty `private/.gitkeep`.

- [ ] **Step 7: Run the focused tests**

Run:

```powershell
node --test scripts/content-validation.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 8: Commit the validation boundary**

```powershell
git add -- scripts/content-validation.mjs scripts/validate-content.mjs scripts/content-validation.test.mjs package.json .gitignore private/.gitkeep
git commit -m "test: validate published notes and protect drafts"
```

### Task 3: Configure Quartz features, layout, and dark focus theme

**Files:**
- Modify: `quartz.config.yaml`
- Modify: `quartz.ts`
- Create: `quartz/components/GardenOverview.tsx`
- Create: `quartz/components/GardenOverview.test.ts`
- Modify: `quartz/styles/custom.scss`

- [ ] **Step 1: Write the failing domain-count test**

Create `quartz/components/GardenOverview.test.ts`:

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { countDomains } from "./GardenOverview"

test("counts published notes by domain and excludes domain indexes", () => {
  const files = [
    { slug: "index" },
    { slug: "reading/index" },
    { slug: "reading/active-recall" },
    { slug: "technology/css-grid" },
    { slug: "technology/devtools" },
  ]

  assert.deepEqual(countDomains(files), {
    reading: 1,
    technology: 2,
    language: 0,
    life: 0,
    total: 3,
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npx tsx --test quartz/components/GardenOverview.test.ts
```

Expected: FAIL because `GardenOverview.tsx` does not exist.

- [ ] **Step 3: Implement the dynamic home overview**

Create `quartz/components/GardenOverview.tsx`:

```tsx
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"

const domains = [
  { slug: "reading", number: "01", title: "读书与思考", detail: "书籍、课程、学习方法与观点" },
  { slug: "technology", number: "02", title: "技术与工具", detail: "编程、软件与效率工作流" },
  { slug: "language", number: "03", title: "语言学习", detail: "词汇、语法、输入与输出练习" },
  { slug: "life", number: "04", title: "生活实验", detail: "观察、复盘与实践记录" },
] as const

type SlugData = { slug?: string }

export function countDomains(files: SlugData[]) {
  const result = { reading: 0, technology: 0, language: 0, life: 0, total: 0 }
  for (const file of files) {
    const slug = file.slug ?? ""
    for (const domain of domains) {
      if (slug.startsWith(`${domain.slug}/`) && slug !== `${domain.slug}/index`) {
        result[domain.slug] += 1
        result.total += 1
      }
    }
  }
  return result
}

const GardenOverview: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
  const counts = countDomains(allFiles)
  return (
    <section class="garden-overview" aria-label="知识领域">
      <p class="garden-stats">{counts.total} notes · 4 domains</p>
      <div class="domain-grid">
        {domains.map((domain) => (
          <a class="domain-card" href={resolveRelative(fileData.slug!, `${domain.slug}/index` as FullSlug)}>
            <span>{domain.number}</span>
            <strong>{domain.title}</strong>
            <small>{domain.detail} · {counts[domain.slug]} notes</small>
          </a>
        ))}
      </div>
    </section>
  )
}

export default (() => GardenOverview) satisfies QuartzComponentConstructor
```

- [ ] **Step 4: Inject the overview only on the root index**

Replace `quartz.ts` with:

```ts
import { ConditionalRender } from "./quartz/components"
import GardenOverview from "./quartz/components/GardenOverview"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"

const config = await loadQuartzConfig()
export default config

const loadedLayout = await loadQuartzLayout()
const homeOverview = ConditionalRender({
  component: GardenOverview(),
  condition: ({ fileData }) => fileData.slug === "index",
})

for (const pageLayout of [loadedLayout.defaults, loadedLayout.byPageType.content]) {
  if (!pageLayout) continue
  pageLayout.afterBody = [homeOverview, ...(pageLayout.afterBody ?? [])]
}

export const layout = loadedLayout
```

- [ ] **Step 5: Run the count test**

Run:

```powershell
npx tsx --test quartz/components/GardenOverview.test.ts
```

Expected: 1 test passes.

- [ ] **Step 6: Replace the site identity and theme configuration**

In `quartz.config.yaml`, set the `configuration` block to:

```yaml
configuration:
  pageTitle: Knowledge Garden
  pageTitleSuffix: " · Personal Notes"
  enableSPA: true
  enablePopovers: true
  analytics: null
  locale: zh-CN
  baseUrl: localhost:8080
  ignorePatterns:
    - private
    - templates
    - .obsidian
  theme:
    fontOrigin: local
    cdnCaching: false
    typography:
      header: Schibsted Grotesk
      body: Source Sans Pro
      code: IBM Plex Mono
    colors:
      lightMode:
        light: "#101318"
        lightgray: "#252b34"
        gray: "#566170"
        darkgray: "#c2ccd6"
        dark: "#f0f4f8"
        secondary: "#8bd5ca"
        tertiary: "#f5a97f"
        highlight: "rgba(139, 213, 202, 0.12)"
        textHighlight: "rgba(245, 169, 127, 0.26)"
      darkMode:
        light: "#101318"
        lightgray: "#252b34"
        gray: "#566170"
        darkgray: "#c2ccd6"
        dark: "#f0f4f8"
        secondary: "#8bd5ca"
        tertiary: "#f5a97f"
        highlight: "rgba(139, 213, 202, 0.12)"
        textHighlight: "rgba(245, 169, 127, 0.26)"
```

- [ ] **Step 7: Configure the required plugins and layout**

Keep the parsing and emitter plugins generated by the Obsidian template. Ensure these component plugins have the following layout values:

```yaml
  - source: "@quartz-community/table-of-contents"
    enabled: true
    order: 50
    layout:
      position: right
      priority: 20
  - source: "@quartz-community/explorer"
    enabled: true
    layout:
      position: left
      priority: 50
  - source: "@quartz-community/graph"
    enabled: true
    layout:
      position: right
      priority: 10
  - source: "@quartz-community/search"
    enabled: true
    layout:
      position: left
      priority: 20
      group: toolbar
      groupOptions:
        grow: true
  - source: "@quartz-community/backlinks"
    enabled: true
    layout:
      position: right
      priority: 30
  - source: "@quartz-community/tag-list"
    enabled: true
    layout:
      position: beforeBody
      priority: 30
  - source: "@quartz-community/page-title"
    enabled: true
    layout:
      position: left
      priority: 10
  - source: "@quartz-community/darkmode"
    enabled: false
  - source: "@quartz-community/recent-notes"
    enabled: true
    options:
      title: 最近更新
      limit: 4
      showTags: true
      hideTagPages: true
      hideFolderPages: true
    layout:
      position: afterBody
      priority: 20
```

Keep `remove-draft`, `content-index`, `content-page`, `folder-page`, `tag-page`, `article-title`, `content-meta`, `breadcrumbs`, `footer`, `favicon`, and `note-properties` enabled. Disable comments, encrypted pages, and analytics because they are outside the approved first version.

- [ ] **Step 8: Add the global dark-focus stylesheet**

Replace `quartz/styles/custom.scss` with:

```scss
@use "./variables.scss" as *;

:root {
  color-scheme: dark;
}

body {
  background:
    radial-gradient(circle at 85% 8%, rgba(139, 213, 202, 0.06), transparent 28rem),
    var(--light);
}

a,
button,
input,
[tabindex] {
  &:focus-visible {
    outline: 2px solid var(--secondary);
    outline-offset: 3px;
    border-radius: 0.3rem;
  }
}

.page-title a::before {
  content: "~/";
  color: var(--secondary);
  font-family: var(--codeFont);
  margin-right: 0.15rem;
}

.page-title a {
  letter-spacing: -0.03em;
}

.sidebar {
  border-color: var(--lightgray);
}

.center article {
  max-width: 72ch;
}

.center article h1,
.center article h2,
.center article h3 {
  letter-spacing: -0.025em;
}

.center article code,
.search-button,
.content-meta {
  font-family: var(--codeFont);
}

.garden-kicker {
  color: var(--secondary);
  font-family: var(--codeFont);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.garden-stats {
  color: var(--gray);
  font-family: var(--codeFont);
  font-size: 0.8rem;
}

body:not([data-slug="index"]) .recent-notes {
  display: none;
}

.garden-hero {
  margin: 1.25rem 0 2.25rem;
  font-size: clamp(2.2rem, 7vw, 4.7rem);
  line-height: 0.98;
  letter-spacing: -0.065em;
  max-width: 10ch;
}

.garden-hero::after {
  content: "_";
  color: var(--tertiary);
}

.domain-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  margin: 2rem 0;
}

.domain-card {
  display: block;
  min-height: 8rem;
  padding: 1.15rem;
  color: var(--dark);
  text-decoration: none;
  border: 1px solid var(--lightgray);
  border-radius: 0.65rem;
  background: rgba(24, 29, 36, 0.82);
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
}

.domain-card:hover {
  transform: translateY(-2px);
  border-color: var(--secondary);
  background: rgba(37, 43, 52, 0.9);
}

.domain-card span {
  display: block;
  margin-bottom: 1.8rem;
  color: var(--secondary);
  font-family: var(--codeFont);
  font-size: 0.75rem;
}

.domain-card strong {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 1.05rem;
}

.domain-card small {
  color: var(--gray);
}

@media all and ($mobile) {
  .domain-grid {
    grid-template-columns: 1fr;
  }

  .garden-hero {
    font-size: clamp(2.3rem, 14vw, 3.6rem);
  }

  .center article {
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 9: Verify configuration and theme compilation**

Run:

```powershell
npm run check
npx quartz build
```

Expected: exit code `0`; `public/index.css` contains `.domain-grid`, `public/index.html` contains `4 domains`, and no remote font request is emitted.

- [ ] **Step 10: Commit the visual foundation**

```powershell
git add -- quartz.config.yaml quartz.ts quartz/components/GardenOverview.tsx quartz/components/GardenOverview.test.ts quartz/styles/custom.scss
git commit -m "feat: add dark focus Quartz theme"
```

### Task 4: Build the four-domain content model and homepage

**Files:**
- Create: `content/index.md`
- Create: `content/reading/index.md`
- Create: `content/reading/active-recall.md`
- Create: `content/technology/index.md`
- Create: `content/technology/css-grid.md`
- Create: `content/language/index.md`
- Create: `content/language/spaced-vocabulary.md`
- Create: `content/life/index.md`
- Create: `content/life/weekly-review.md`
- Create: `templates/note-template.md`

- [ ] **Step 1: Create the home page**

Create `content/index.md`:

```markdown
---
title: Knowledge Garden
date: 2026-09-16
description: A public record of connected learning across books, technology, language, and life.
tags:
  - index
---

<p class="garden-kicker">Personal Knowledge Base</p>
<h1 class="garden-hero">把知识连接起来</h1>

这里保存正在生长的理解，而不只是已经写完的答案。使用左侧目录浏览主题，或按 `Ctrl + K` 搜索全部笔记。
```

- [ ] **Step 2: Create the four domain index pages**

Use this exact frontmatter and pattern, changing title, description, tag, and links for each domain:

```markdown
---
title: 读书与思考
date: 2026-09-16
description: 书籍、课程、学习方法与观点的长期整理。
tags:
  - reading
---

# 读书与思考

这个区域用来沉淀输入后的理解，并把方法连接到实际练习。

## 起始笔记

- [[active-recall|主动回忆：让复习真正发生]]
```

Create equivalent pages for `technology`, `language`, and `life`, linking to their representative note.

- [ ] **Step 3: Create a linked learning-method note**

Create `content/reading/active-recall.md`:

```markdown
---
title: 主动回忆：让复习真正发生
date: 2026-09-16
description: 用主动提取代替重复阅读，并把回忆结果转化为下一轮学习计划。
tags:
  - learning
  - review
---

# 主动回忆：让复习真正发生

主动回忆的关键不是再次看到答案，而是在答案缺席时尝试提取它。

> [!tip] 核心原则
> 先回忆，后校验。回忆失败本身就是下一次复习的线索。

## 最小实践

1. 合上材料，用一句话解释刚刚学到的概念。
2. 写下不能确定的部分。
3. 重新打开材料，只校验这些缺口。
4. 把仍然模糊的内容安排进下一次复习。

这套方法可以与 [[language/spaced-vocabulary|间隔重复词汇练习]] 和 [[life/weekly-review|每周复盘]] 组合使用。
```

- [ ] **Step 4: Create the technical note with a code block**

Create `content/technology/css-grid.md`:

````markdown
---
title: CSS Grid 的二维布局心智模型
date: 2026-09-16
description: 从轨道、网格线和空间分配理解 CSS Grid，而不是背属性。
tags:
  - css
  - frontend
---

# CSS Grid 的二维布局心智模型

Grid 先定义行与列组成的轨道，再把元素放进这些轨道。它适合同时控制横向和纵向关系。

```css
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
```

当屏幕变窄时，将列数改为一列，比压缩内容宽度更利于阅读。
````

- [ ] **Step 5: Create the language and life notes**

Create `content/language/spaced-vocabulary.md` with a practical spaced-review sequence and a link back to `[[reading/active-recall|主动回忆]]`. Create `content/life/weekly-review.md` with sections for observations, decisions, and next actions, plus a link back to the active-recall note. Both files must use the same required frontmatter fields and at least two tags.

- [ ] **Step 6: Create the reusable note template**

Create `templates/note-template.md`:

```markdown
---
title: 新笔记标题
date: 2026-09-16
description: 用一句话说明这篇笔记解决什么问题。
tags:
  - topic
---

# 新笔记标题

## 问题

说明为什么记录这个主题。

## 核心理解

写下可以复述和应用的结论。

## 例子或实践

给出一个真实例子、代码或练习。

## 关联笔记

- [[相关笔记名称]]
```

- [ ] **Step 7: Validate and build the content**

Run:

```powershell
npm run validate:content
npx quartz build
```

Expected: validation reports 9 Markdown files and the build exits `0` without unresolved links among the representative notes.

- [ ] **Step 8: Commit the content model**

```powershell
git add -- content templates/note-template.md
git commit -m "feat: add four-domain knowledge garden content"
```

### Task 5: Derive the GitHub Pages URL safely

**Files:**
- Create: `scripts/pages-base-url.mjs`
- Create: `scripts/pages-base-url.test.mjs`
- Create: `scripts/configure-pages-base-url.mjs`

- [ ] **Step 1: Write failing URL derivation tests**

Create `scripts/pages-base-url.test.mjs`:

```js
import assert from "node:assert/strict"
import { test } from "node:test"
import { pagesBaseUrl } from "./pages-base-url.mjs"

test("derives a project Pages URL", () => {
  assert.equal(pagesBaseUrl("octocat/knowledge-garden"), "octocat.github.io/knowledge-garden")
})

test("derives a user Pages URL without a duplicate path", () => {
  assert.equal(pagesBaseUrl("octocat/octocat.github.io"), "octocat.github.io")
})

test("rejects an invalid repository slug", () => {
  assert.throws(() => pagesBaseUrl("missing-separator"), /owner\/repository/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
node --test scripts/pages-base-url.test.mjs
```

Expected: FAIL because `scripts/pages-base-url.mjs` does not exist.

- [ ] **Step 3: Implement URL derivation**

Create `scripts/pages-base-url.mjs`:

```js
export function pagesBaseUrl(repositorySlug) {
  const [owner, repository, extra] = repositorySlug.split("/")
  if (!owner || !repository || extra) {
    throw new Error("GITHUB_REPOSITORY must use owner/repository format")
  }

  const host = `${owner}.github.io`
  return repository.toLowerCase() === host.toLowerCase() ? host : `${host}/${repository}`
}
```

- [ ] **Step 4: Implement the CI configuration writer**

Create `scripts/configure-pages-base-url.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises"
import YAML from "yaml"
import { pagesBaseUrl } from "./pages-base-url.mjs"

const repositorySlug = process.env.GITHUB_REPOSITORY
if (!repositorySlug) throw new Error("GITHUB_REPOSITORY is required")

const configPath = new URL("../quartz.config.yaml", import.meta.url)
const config = YAML.parse(await readFile(configPath, "utf8"))
config.configuration.baseUrl = pagesBaseUrl(repositorySlug)
await writeFile(configPath, YAML.stringify(config), "utf8")
console.log(`Configured baseUrl: ${config.configuration.baseUrl}`)
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
node --test scripts/pages-base-url.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit the Pages configuration utility**

```powershell
git add -- scripts/pages-base-url.mjs scripts/pages-base-url.test.mjs scripts/configure-pages-base-url.mjs
git commit -m "test: derive GitHub Pages base URL"
```

### Task 6: Add generated-link verification

**Files:**
- Create: `scripts/check-built-links.mjs`
- Create: `scripts/check-built-links.test.mjs`

- [ ] **Step 1: Write fixture-based failing tests**

Create `scripts/check-built-links.test.mjs`:

```js
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkBuiltLinks } from "./check-built-links.mjs"

async function fixture(html) {
  const root = await mkdtemp(join(tmpdir(), "garden-links-"))
  await mkdir(join(root, "reading"), { recursive: true })
  await writeFile(join(root, "index.html"), html)
  await writeFile(join(root, "reading", "index.html"), "<h1 id=\"notes\">Notes</h1>")
  return root
}

test("accepts an existing internal page and anchor", async () => {
  const root = await fixture('<a href="./reading/#notes">Reading</a>')
  assert.deepEqual(await checkBuiltLinks(root), [])
})

test("reports a missing internal page", async () => {
  const root = await fixture('<a href="./missing/">Missing</a>')
  assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./missing/"])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
node --test scripts/check-built-links.test.mjs
```

Expected: FAIL because `scripts/check-built-links.mjs` does not exist.

- [ ] **Step 3: Implement the built-link checker**

Create `scripts/check-built-links.mjs` with these exported behaviors:

```js
import { access, readFile, readdir } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : []
  }))).flat()
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

export async function checkBuiltLinks(root) {
  const failures = []
  for (const file of await filesUnder(root)) {
    const html = await readFile(file, "utf8")
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1])
    for (const href of hrefs) {
      if (/^(?:https?:|mailto:|tel:|javascript:)/.test(href) || href.startsWith("#")) continue
      const [pathPart] = href.split("#")
      if (!pathPart || /\.(?:css|js|png|jpe?g|gif|svg|webp|xml|ico|woff2?)$/i.test(pathPart)) continue
      const rawTarget = resolve(dirname(file), pathPart)
      const candidates = pathPart.endsWith("/")
        ? [join(rawTarget, "index.html")]
        : [rawTarget, `${rawTarget}.html`, join(rawTarget, "index.html")]
      if (!(await Promise.any(candidates.map(async (candidate) => {
        if (await exists(candidate)) return true
        throw new Error("missing")
      })).catch(() => false))) {
        failures.push(`${relative(root, file).replaceAll("\\", "/")} -> ${href}`)
      }
    }
  }
  return failures
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = await checkBuiltLinks("public")
  if (failures.length) {
    console.error(failures.join("\n"))
    process.exitCode = 1
  } else {
    console.log("Generated internal links are valid.")
  }
}
```

- [ ] **Step 4: Run the focused tests and a real build check**

Run:

```powershell
node --test scripts/check-built-links.test.mjs
npx quartz build
node scripts/check-built-links.mjs
```

Expected: 2 tests pass, the build exits `0`, and the checker prints `Generated internal links are valid.`

- [ ] **Step 5: Commit the link checker**

```powershell
git add -- scripts/check-built-links.mjs scripts/check-built-links.test.mjs
git commit -m "test: verify generated internal links"
```

### Task 7: Add GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the deployment workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy knowledge garden

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Install Quartz plugins
        run: npx quartz plugin install
      - name: Configure Pages URL
        run: node scripts/configure-pages-base-url.mjs
      - name: Test site utilities
        run: npm run test:site
      - name: Validate Markdown content
        run: npm run validate:content
      - name: Check Quartz source
        run: npm run check
      - name: Build Quartz
        run: npx quartz build
      - name: Check generated links
        run: node scripts/check-built-links.mjs
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: public

  deploy:
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the workflow shape locally**

Run:

```powershell
node -e "const fs=require('fs'); const YAML=require('yaml'); const workflow=YAML.parse(fs.readFileSync('.github/workflows/deploy.yml','utf8')); if(!workflow.jobs?.build || !workflow.jobs?.deploy) process.exit(1); console.log('Workflow jobs:', Object.keys(workflow.jobs).join(', '))"
```

Expected: `Workflow jobs: build, deploy`.

- [ ] **Step 3: Test the CI URL mutation on a disposable config copy**

Run in the worktree after copying `quartz.config.yaml` to `quartz.config.backup.yaml`:

```powershell
Copy-Item -LiteralPath 'quartz.config.yaml' -Destination 'quartz.config.backup.yaml'
$env:GITHUB_REPOSITORY='octocat/knowledge-garden'
node scripts/configure-pages-base-url.mjs
Select-String -Path 'quartz.config.yaml' -Pattern 'octocat.github.io/knowledge-garden'
Move-Item -Force -LiteralPath 'quartz.config.backup.yaml' -Destination 'quartz.config.yaml'
Remove-Item Env:GITHUB_REPOSITORY
```

Expected: the `Select-String` command finds the derived base URL, and the original config is restored.

- [ ] **Step 4: Commit the deployment workflow**

```powershell
git add -- .github/workflows/deploy.yml
git commit -m "ci: deploy knowledge garden to GitHub Pages"
```

### Task 8: Document authoring, privacy, and publishing

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the upstream README with user-facing instructions**

Write `README.md` with these exact operational sections:

```markdown
# Knowledge Garden

A public, Markdown-powered personal knowledge garden built with Quartz.

## Requirements

- Node.js 22 or newer
- npm 10.9.2 or newer
- Git

## Start locally

```powershell
npm ci
npx quartz plugin install
npx quartz build --serve
```

Open `http://localhost:8080`.

## Write a public note

1. Copy `templates/note-template.md` into one of the folders under `content/`.
2. Rename it with a short lowercase filename.
3. Update every frontmatter field.
4. Add `[[wiki links]]` to related notes.
5. Run `npm run validate:content` and preview locally.

## Keep a note private

Store unfinished or private Markdown files under `private/`. Git ignores everything there except the empty `.gitkeep` marker, and Quartz only builds files under `content/`.

Before every commit, run:

```powershell
git status --short
```

Confirm no private note appears in the output.

## Verify the site

```powershell
npm run verify:site
```

This runs utility tests, validates Markdown metadata, checks Quartz source, builds the site, and verifies generated internal links.

## Publish

Push the `main` branch to the public GitHub repository. In **Settings → Pages**, select **GitHub Actions** as the source. Every later push rebuilds and publishes the site only after verification succeeds.

## Update Quartz

Keep the `quartz-upstream` remote and review upstream changes before merging them. Always run `npm run verify:site` after an update.
```

Use an outer four-backtick fence when writing the real file so the nested PowerShell examples remain intact.

- [ ] **Step 2: Check that every documented command exists**

Run:

```powershell
npm run
```

Expected: the output includes `test:site`, `validate:content`, and `verify:site`.

- [ ] **Step 3: Commit the documentation**

```powershell
git add -- README.md
git commit -m "docs: explain authoring and publishing workflow"
```

### Task 9: Perform complete local verification and visual inspection

**Files:**
- Modify only if verification finds a defect in an already-listed implementation file

- [ ] **Step 1: Run the full automated verification from a clean state**

Run:

```powershell
git status --short
npm run verify:site
```

Expected: only intentional uncommitted verification fixes appear, all tests pass, content validation succeeds, Quartz source checks pass, the production build succeeds, and generated links are valid.

- [ ] **Step 2: Start one retained local preview**

Run:

```powershell
npx quartz build --serve
```

Expected: the preview serves at `http://localhost:8080` and stays running for browser inspection.

- [ ] **Step 3: Inspect the desktop homepage and note page**

Open the retained preview and verify:

- the home page uses the near-black palette, teal navigation, coral accent, terminal-style identity, four domain cards, and recent links;
- `Ctrl + K` opens search and finds `主动回忆`, `CSS Grid`, and the `learning` tag;
- the reading note shows explorer navigation on the left and table of contents, graph, and backlinks on the right;
- wiki links navigate to the expected notes;
- keyboard focus is visible on links, search, and controls;
- the browser console has no uncaught errors.

- [ ] **Step 4: Inspect representative responsive widths**

Check at approximately `390 × 844`, `768 × 1024`, and `1440 × 900`:

- 390px: one-column domain cards, no horizontal page scroll, readable code blocks, sidebars collapsed;
- 768px: article remains readable and auxiliary navigation does not overlap it;
- 1440px: three-column note layout is visible with a center article near 72 characters wide.

- [ ] **Step 5: Verify the privacy boundary**

Create `private/privacy-check.md` with harmless temporary text, then run:

```powershell
git status --short --untracked-files=all
npx quartz build
rg -n "privacy-check" public
```

Expected: `private/privacy-check.md` does not appear in Git status, the build succeeds, and `rg` returns no match. Remove only this exact temporary file after the check.

- [ ] **Step 6: Fix and re-run verification if needed**

For each defect, add or tighten the narrowest relevant test first, reproduce the failure, apply the smallest fix, and re-run `npm run verify:site` plus the affected browser check.

- [ ] **Step 7: Commit any verification fixes**

```powershell
git add -- quartz.config.yaml quartz/styles/custom.scss content scripts README.md .github/workflows/deploy.yml .gitignore package.json package-lock.json
git commit -m "fix: resolve final garden verification issues"
```

Skip this commit if verification required no changes.

### Task 10: Publish the repository and verify GitHub Pages

**Files:**
- No planned source changes

- [ ] **Step 1: Normalize the primary branch**

Run:

```powershell
git branch -M main
git status --short
git log --oneline --decorate -8
```

Expected: branch is `main`, the tracked tree is clean, and the implementation commits are present.

- [ ] **Step 2: Create or connect the public GitHub repository**

Use the authenticated GitHub web interface to create a public repository named `knowledge-garden` without initializing it with a README, license, or `.gitignore`, then use the repository's **Code → HTTPS → copy** control. Run:

```powershell
$gardenRemote = (Get-Clipboard).Trim()
if ($gardenRemote -notmatch '^https://github\.com/[^/]+/knowledge-garden(?:\.git)?$') { throw 'Clipboard does not contain the verified knowledge-garden HTTPS URL.' }
if (git remote get-url origin 2>$null) { git remote set-url origin $gardenRemote } else { git remote add origin $gardenRemote }
git remote -v
```

Expected: both fetch and push URLs exactly match the copied `knowledge-garden` repository URL.

- [ ] **Step 3: Push the verified branch**

Run:

```powershell
git push -u origin main
```

Expected: the push succeeds and the GitHub repository shows the same `main` commit.

- [ ] **Step 4: Enable GitHub Pages through Actions**

In the repository's **Settings → Pages**, select **GitHub Actions** as the source. Open the latest `Deploy knowledge garden` workflow run and wait for both `build` and `deploy` to succeed.

- [ ] **Step 5: Verify the deployed public site**

Open the Pages URL reported by the deployment and repeat these focused checks:

- home page loads without missing styles or assets under the repository subpath;
- one domain page and one note page open successfully;
- search returns a known note;
- one wiki link, the table of contents, backlinks, and graph work;
- the deployed repository contains no file from `private/` other than `.gitkeep`.

- [ ] **Step 6: Record the final handoff**

Report the public Pages URL, repository URL, local preview command, note template path, full verification result, and any limitation that still requires the user's observation. Do not claim the deployment succeeded until the GitHub Actions run and the live Pages URL have both been observed.
