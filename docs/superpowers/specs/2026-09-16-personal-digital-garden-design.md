# Personal Digital Garden Design

## 1. Purpose

Build a public personal knowledge garden for recording multi-domain learning, organizing durable knowledge, and showing how ideas connect over time. The site should remain easy to maintain: publishing a normal note must require editing only a Markdown file, not page code.

## 2. Confirmed Product Direction

- Product type: topic-oriented digital garden rather than a chronological blog.
- Audience: public internet visitors.
- Content scope: multiple domains, initially reading and thinking, technology and tools, language learning, and life experiments.
- Authoring method: local Markdown files.
- Visual direction: a dark, focused interface with restrained terminal-inspired details.
- Base platform: Quartz, customized rather than rebuilt from scratch.
- Source control and hosting: a public GitHub repository with automated GitHub Pages publication.

## 3. Information Architecture

The main content areas are:

- `reading`: books, courses, learning methods, and reflections.
- `technology`: programming, software, workflows, and tools.
- `language`: vocabulary, grammar, practice notes, and learning resources.
- `life`: observations, personal experiments, and practical lessons.

Each published note includes a title, publication or update date, tags, a short description, and optional links to related notes. Notes can use Quartz-compatible wiki links such as `[[Related Note]]` to create relationships.

Private drafts live outside the published content tree in a local-only directory. That directory is ignored by Git and is never included in the public repository or site build. A draft becomes public only when the author intentionally moves it into the published content tree.

## 4. Page Design

### 4.1 Home Page

The home page acts as a knowledge index rather than a marketing landing page. It contains:

- a prominent global search control with a `Ctrl + K` shortcut;
- an identity line and a short statement explaining the garden;
- four domain cards with note counts;
- recently updated notes;
- lightweight totals such as note and tag counts.

### 4.2 Note Page

Desktop note pages use a three-column reading layout:

- left: site identity and collapsible topic navigation;
- center: the Markdown article, metadata, code blocks, and callouts;
- right: page table of contents, backlinks, and a local relationship graph.

On narrow screens, both side columns collapse. Search remains directly accessible, the article becomes a single readable column, and the table of contents and related notes move below the article.

### 4.3 Visual System

The default appearance is dark and focused:

- near-black blue-gray background;
- soft off-white body text;
- muted borders and secondary text;
- teal for navigation and active links;
- warm coral for selective emphasis;
- monospace details for paths, shortcuts, counts, and metadata;
- restrained radii and animation, with no decorative imagery required.

Typography and spacing prioritize long-form reading. The terminal influence is an accent, not a simulation of a command-line interface.

## 5. Functional Behavior

- Full-text search covers titles, body text, and tags.
- Wiki links create forward links, backlinks, and graph relationships.
- Each note can show a generated table of contents.
- Code blocks use syntax highlighting and remain usable on small screens.
- Empty modules, such as backlinks on an unconnected note, are hidden rather than displayed as blank panels.
- Broken internal links are visually distinguishable during authoring and are checked before publication.
- The site includes a reusable Markdown note template and a small set of representative example notes.

The first version does not include accounts, comments, an online editor, analytics, a database, or server-side APIs.

## 6. Architecture and Data Flow

Quartz reads Markdown from the published content directory and generates a static site. Custom Quartz layout components and theme styles implement the selected interface without replacing Quartz's content graph, search, backlink, and Markdown pipeline.

The publication flow is:

1. Create or edit a Markdown note locally.
2. Preview the garden locally.
3. Commit and push the change to GitHub.
4. GitHub Actions installs dependencies and builds Quartz.
5. The workflow publishes the generated static output to GitHub Pages only after a successful build.

Because GitHub Pages is public, no secret or private content may be committed to the repository. The site requires no runtime credentials.

## 7. Failure Handling

- Invalid required note metadata causes validation or build failure rather than a partial deployment.
- A failed GitHub Actions build leaves the previously successful Pages deployment online.
- Missing optional metadata falls back to safe presentation defaults.
- Empty topic groups and relationship modules are omitted.
- Private-draft paths are excluded by Git ignore rules and by the build content scope.
- Local setup documentation includes the supported start, build, and publishing commands.

## 8. Verification

Before the first publication, verify:

- a clean production build completes successfully;
- representative Markdown, code blocks, callouts, tags, and wiki links render correctly;
- global search returns title, body, and tag matches;
- backlinks and the local graph match known note relationships;
- internal links do not produce unexpected missing pages;
- private draft files do not appear in Git tracking or build output;
- the home page and note page remain usable at representative desktop and mobile widths;
- keyboard search and core navigation work without a mouse;
- the generated site works under the GitHub Pages project path;
- the GitHub Actions workflow publishes only after a successful build.

## 9. Completion Criteria

The first version is complete when the user can copy the note template, write Markdown content, preview it locally, push it to GitHub, and see the public site update automatically without editing application code. The delivered design must include the selected dark visual system, the four content domains, working search, backlinks, a local graph, responsive reading pages, example content, and documented maintenance steps.
