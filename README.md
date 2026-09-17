# Knowledge Garden

Knowledge Garden is a public, Markdown-powered Quartz site for publishing connected personal notes.

## Requirements

- Node.js 22 or newer
- npm 10.9.2 or newer
- Git

## Start locally

Install dependencies and Quartz's configured plugins, then start the local preview server:

```sh
npm ci
npx quartz plugin install
npx quartz build --serve
```

Open <http://localhost:8080> in a browser.

## Write a public note

Copy the template into a subfolder of `content/`, using a lowercase filename:

```sh
cp templates/note-template.md content/<subfolder>/<lowercase-name>.md
```

Update every frontmatter field (`title`, `date`, `description`, and `tags`), write the note, and connect it to related notes with `[[wiki links]]`. Validate the content and preview the result:

```sh
npm run validate:content
npx quartz build --serve
```

Only Markdown under `content/` is public site content.

## Keep a note private

Store private drafts under `private/`. This directory is ignored except for the tracked `private/.gitkeep`; never force-add a private note. Quartz only builds `content/`, so private notes are not included in the site.

Before every commit, inspect the working tree and confirm that no private note is listed:

```sh
git status --short
```

## Verify changes

Run the full site verification before publishing:

```sh
npm run verify:site
```

This runs the site utility tests, validates Markdown metadata, checks the Quartz source and formatting, builds the site, and checks generated internal links.

## Publish with GitHub Pages

Push the `main` branch. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source. The Pages workflow runs the verification checks before deploying. Later pushes to `main` publish only after those checks succeed.

## Update Quartz

Keep the `quartz-upstream` remote configured so upstream changes can be reviewed before integration:

```sh
git remote -v
git fetch quartz-upstream
git log --oneline --all --remotes=quartz-upstream -n 20
```

Review the upstream commits before merging or rebasing them into this site, then run `npm run verify:site` again after every update.
