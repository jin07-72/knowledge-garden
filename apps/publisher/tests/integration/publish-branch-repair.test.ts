import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { systemCommandRunner, type CommandRunner } from "../../src/main/lib/commandRunner"
import { createPublishBranchRepair } from "../../src/main/services/publishBranchRepair"
import {
  PublishCommandFailure,
  createBoundedCommandRunnerForTest,
  type BoundedCommandRunner,
} from "../../src/main/services/publish"
import { createTemporaryGitRepository, git, type TemporaryGitRepository } from "../helpers/git"

const repositories: TemporaryGitRepository[] = []
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function put(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, ...path.split("/"))
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents)
}

async function fixture(options: { legacy?: boolean } = {}): Promise<TemporaryGitRepository> {
  const repository = await createTemporaryGitRepository()
  repositories.push(repository)
  await put(repository.root, "README.md", "publisher branch repair\n")
  expect((await git(repository.root, ["add", "README.md"])).exitCode).toBe(0)
  expect((await git(repository.root, ["commit", "-m", "initial"])).exitCode).toBe(0)
  expect((await git(repository.root, ["push", "-u", "origin", "main"])).exitCode).toBe(0)
  if (options.legacy !== false) {
    expect((await git(repository.root, ["branch", "-m", "main", "master"])).exitCode).toBe(0)
  }
  return repository
}

async function currentBranch(root: string): Promise<string> {
  return (await git(root, ["branch", "--show-current"])).stdout.trim()
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()))
})

describe("publish branch repair", () => {
  it("rejects an injected runner without the bounded capability", () => {
    const runner: CommandRunner = {
      run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    }

    expect(() =>
      createPublishBranchRepair({
        workspace: String.raw`C:\garden`,
        runner: runner as unknown as BoundedCommandRunner,
      }),
    ).toThrow(TypeError)
  })

  it("inspects an eligible legacy master branch as repairable", async () => {
    const repository = await fixture()
    await put(repository.root, "README.md", "unstaged publisher branch repair\n")
    await put(repository.root, "notes/untracked.md", "exact untracked note\0bytes\n")

    const service = createPublishBranchRepair({ workspace: repository.root })
    const head = (await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()

    await expect(service.inspect()).resolves.toEqual({ status: "repairable", head })
  })

  it("repairs master while preserving HEAD and exact untracked note bytes", async () => {
    const repository = await fixture()
    const note = Buffer.from("exact untracked note\0bytes\r\n", "utf8")
    await mkdir(join(repository.root, "notes"), { recursive: true })
    await writeFile(join(repository.root, "notes", "untracked.md"), note)
    const head = (await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()
    const status = (
      await git(repository.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    ).stdout

    const receipt = await createPublishBranchRepair({ workspace: repository.root }).repair()

    expect(receipt).toEqual({ branch: "main", upstream: "origin/main", head })
    expect((await git(repository.root, ["branch", "--show-current"])).stdout.trim()).toBe("main")
    expect(
      (
        await git(repository.root, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      ).stdout.trim(),
    ).toBe("origin/main")
    expect((await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head)
    expect(
      (await git(repository.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
        .stdout,
    ).toBe(status)
    expect(await readFile(join(repository.root, "notes", "untracked.md"))).toEqual(note)
  })

  it("reports main as ready", async () => {
    const repository = await fixture({ legacy: false })
    const head = (await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toEqual({ status: "ready", head })
  })

  it("blocks branches other than main and master", async () => {
    const repository = await fixture({ legacy: false })
    expect((await git(repository.root, ["branch", "-m", "main", "feature"])).exitCode).toBe(0)

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it("blocks repair when a local main branch already exists", async () => {
    const repository = await fixture()
    expect((await git(repository.root, ["branch", "main", "HEAD"])).exitCode).toBe(0)

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it.each([
    [
      "wrong",
      async (repository: TemporaryGitRepository) => {
        expect(
          (await git(repository.root, ["update-ref", "refs/remotes/origin/master", "HEAD"]))
            .exitCode,
        ).toBe(0)
        expect(
          (await git(repository.root, ["branch", "--set-upstream-to=origin/master", "master"]))
            .exitCode,
        ).toBe(0)
      },
    ],
    [
      "missing",
      async (repository: TemporaryGitRepository) => {
        expect((await git(repository.root, ["branch", "--unset-upstream"])).exitCode).toBe(0)
      },
    ],
  ])("blocks repair when the master upstream is %s", async (_case, arrange) => {
    const repository = await fixture()
    await arrange(repository)

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it("blocks repair when origin/main is missing", async () => {
    const repository = await fixture()
    expect(
      (await git(repository.root, ["update-ref", "-d", "refs/remotes/origin/main"])).exitCode,
    ).toBe(0)

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it("blocks staged changes while allowing unstaged and untracked files", async () => {
    const repository = await fixture()
    await put(repository.root, "staged.md", "staged\n")
    expect((await git(repository.root, ["add", "staged.md"])).exitCode).toBe(0)

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it.each([
    ["merge", "MERGE_HEAD", false],
    ["rebase-merge", "rebase-merge", true],
    ["rebase-apply", "rebase-apply", true],
    ["cherry-pick", "CHERRY_PICK_HEAD", false],
    ["revert", "REVERT_HEAD", false],
    ["bisect", "BISECT_LOG", false],
  ])("blocks an in-progress %s operation", async (_operation, marker, directory) => {
    const repository = await fixture()
    const commonDirectory = (
      await git(repository.root, ["rev-parse", "--git-common-dir"])
    ).stdout.trim()
    const markerPath = join(repository.root, commonDirectory, marker)
    if (directory) await mkdir(markerPath)
    else await writeFile(markerPath, "operation marker\n")

    await expect(
      createPublishBranchRepair({ workspace: repository.root }).inspect(),
    ).resolves.toMatchObject({ status: "blocked" })
  })

  it("blocks an operation marker stored in a linked worktree Git directory", async () => {
    const repository = await fixture()
    const linked = join(dirname(repository.root), "linked-workspace")
    expect((await git(repository.root, ["switch", "--detach"])).exitCode).toBe(0)
    expect((await git(repository.root, ["worktree", "add", linked, "master"])).exitCode).toBe(0)
    const markerValue = (await git(linked, ["rev-parse", "--git-path", "MERGE_HEAD"])).stdout.trim()
    const marker = isAbsolute(markerValue) ? markerValue : resolve(linked, markerValue)
    await writeFile(marker, "linked worktree merge marker\n")

    await expect(createPublishBranchRepair({ workspace: linked }).inspect()).resolves.toMatchObject(
      {
        status: "blocked",
      },
    )
  })

  it("fails closed when an operation marker cannot be accessed", async () => {
    const repository = await fixture()
    const service = createPublishBranchRepair({
      workspace: repository.root,
      fileSystemAccess: async () => {
        throw Object.assign(new Error("access denied"), { code: "EACCES" })
      },
    })

    await expect(service.inspect()).resolves.toMatchObject({ status: "blocked" })
  })

  it("rejects a workspace below the exact Git root", async () => {
    const repository = await fixture()
    const nested = join(repository.root, "nested")
    await mkdir(nested)

    await expect(createPublishBranchRepair({ workspace: nested }).inspect()).resolves.toMatchObject(
      {
        status: "blocked",
      },
    )
  })

  it("blocks a status race before mutation without renaming the branch", async () => {
    const repository = await fixture()
    const service = createPublishBranchRepair({
      workspace: repository.root,
      beforeMutation: () => put(repository.root, "raced.md", "changed before mutation\n"),
    })

    await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })
    expect(await currentBranch(repository.root)).toBe("master")
  })

  it("blocks a HEAD race before mutation without renaming the branch", async () => {
    const repository = await fixture()
    const service = createPublishBranchRepair({
      workspace: repository.root,
      beforeMutation: async () => {
        await put(repository.root, "README.md", "changed concurrently\n")
        expect((await git(repository.root, ["add", "README.md"])).exitCode).toBe(0)
        expect((await git(repository.root, ["commit", "-m", "concurrent change"])).exitCode).toBe(0)
      },
    })

    await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })
    expect(await currentBranch(repository.root)).toBe("master")
  })

  it("rolls back to the verified master state when a post-rename step fails", async () => {
    const repository = await fixture()
    await put(repository.root, "untracked.md", "preserve me\n")
    const head = (await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()
    const status = (
      await git(repository.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    ).stdout
    const service = createPublishBranchRepair({
      workspace: repository.root,
      afterRename: () => {
        throw new Error("injected post-rename failure")
      },
    })

    await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_FAILED" })
    expect(await currentBranch(repository.root)).toBe("master")
    expect((await git(repository.root, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head)
    expect(
      (
        await git(repository.root, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      ).stdout.trim(),
    ).toBe("origin/main")
    expect(
      (await git(repository.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
        .stdout,
    ).toBe(status)
  })

  it.each(["rejects", "returns nonzero"] as const)(
    "recovers when the initial rename succeeds but its runner %s",
    async (outcome) => {
      const repository = await fixture()
      let injected = false
      const runner: CommandRunner = {
        async run(request) {
          if (
            !injected &&
            request.args.join("\0") === ["branch", "-m", "master", "main"].join("\0")
          ) {
            injected = true
            const result = await systemCommandRunner.run(request)
            expect(result.exitCode).toBe(0)
            if (outcome === "rejects") throw new Error("ambiguous rename result")
            return { ...result, exitCode: 1, stderr: "ambiguous rename result" }
          }
          return systemCommandRunner.run(request)
        },
      }
      const service = createPublishBranchRepair({
        workspace: repository.root,
        runner: createBoundedCommandRunnerForTest(runner),
      })

      await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_FAILED" })
      expect(await currentBranch(repository.root)).toBe("master")
      await expect(service.inspect()).resolves.toMatchObject({ status: "repairable" })
    },
  )

  it("does not classify changed upstream configuration as an unchanged rename failure", async () => {
    const repository = await fixture()
    let injected = false
    const rename = ["branch", "-m", "master", "main"]
    const runner: CommandRunner = {
      async run(request) {
        if (!injected && request.args.join("\0") === rename.join("\0")) {
          injected = true
          const changed = await systemCommandRunner.run({
            ...request,
            args: ["branch", "--unset-upstream", "master"],
          })
          expect(changed.exitCode).toBe(0)
          return { exitCode: 1, stdout: "", stderr: "misreported rename failure" }
        }
        return systemCommandRunner.run(request)
      },
    }
    const service = createPublishBranchRepair({
      workspace: repository.root,
      runner: createBoundedCommandRunnerForTest(runner),
    })

    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    expect(await currentBranch(repository.root)).toBe("master")
    await expect(service.inspect()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
  })

  it("persists uncertainty without probing after unconfirmed rename termination", async () => {
    const repository = await fixture()
    const requests: string[][] = []
    const rename = ["branch", "-m", "master", "main"]
    const runner: CommandRunner = {
      run(request) {
        requests.push([...request.args])
        if (request.args.join("\0") === rename.join("\0")) {
          return Promise.reject(new PublishCommandFailure("termination not confirmed", true))
        }
        return systemCommandRunner.run(request)
      },
    }
    const service = createPublishBranchRepair({
      workspace: repository.root,
      runner: createBoundedCommandRunnerForTest(runner),
    })

    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    expect(requests.at(-1)).toEqual(rename)
    const requestCount = requests.length
    await expect(service.inspect()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    expect(requests).toHaveLength(requestCount)
  })

  it("persists uncertainty when rollback cannot be confirmed", async () => {
    const repository = await fixture()
    const runner: CommandRunner = {
      run(request) {
        if (
          request.args.length === 4 &&
          request.args[0] === "branch" &&
          request.args[1] === "-m" &&
          request.args[2] === "main" &&
          request.args[3] === "master"
        ) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "injected rollback failure" })
        }
        return systemCommandRunner.run(request)
      },
    }
    const service = createPublishBranchRepair({
      workspace: repository.root,
      runner: createBoundedCommandRunnerForTest(runner),
      afterRename: () => {
        throw new Error("injected post-rename failure")
      },
    })

    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    await expect(service.inspect()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
    await expect(service.repair()).rejects.toMatchObject({
      code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    })
  })

  it("shares one repair flight across concurrent callers", async () => {
    const repository = await fixture()
    const entered = deferred()
    const release = deferred()
    let hookCalls = 0
    const service = createPublishBranchRepair({
      workspace: repository.root,
      beforeMutation: async () => {
        hookCalls += 1
        entered.resolve()
        await release.promise
      },
    })

    const first = service.repair()
    await entered.promise
    const second = service.repair()
    try {
      expect(second).toBe(first)
    } finally {
      release.resolve()
      await Promise.allSettled([first, second])
    }
    const [firstReceipt, secondReceipt] = await Promise.all([first, second])
    expect(secondReceipt).toBe(firstReceipt)
    expect(hookCalls).toBe(1)
  })

  it("disposal waits for the active repair and prevents later operations", async () => {
    const repository = await fixture()
    const entered = deferred()
    const release = deferred()
    const service = createPublishBranchRepair({
      workspace: repository.root,
      beforeMutation: async () => {
        entered.resolve()
        await release.promise
      },
    })
    const repair = service.repair()
    await entered.promise
    let disposeSettled = false
    const disposal = service.dispose().then(() => {
      disposeSettled = true
    })

    await Promise.resolve()
    expect(disposeSettled).toBe(false)
    await expect(service.inspect()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })
    await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })

    release.resolve()
    await expect(repair).resolves.toMatchObject({ branch: "main" })
    await disposal
    await expect(service.inspect()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })
    await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_BLOCKED" })
  })
})
