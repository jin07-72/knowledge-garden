import { access, realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { PublishBranchRepairReceipt } from "../../shared/contracts"
import { systemCommandRunner, type CommandResult, type CommandRunner } from "../lib/commandRunner"

export type PublishBranchInspection =
  | { readonly status: "ready"; readonly head: string }
  | { readonly status: "repairable"; readonly head: string }
  | { readonly status: "blocked"; readonly reason: string }

export interface PublishBranchRepairService {
  inspect(): Promise<PublishBranchInspection>
  repair(): Promise<PublishBranchRepairReceipt>
  dispose(): Promise<void>
}

export interface PublishBranchRepairDependencies {
  readonly workspace: string
  readonly runner?: CommandRunner
  readonly beforeMutation?: () => Promise<void> | void
  readonly afterRename?: () => Promise<void> | void
}

interface RepairSnapshot {
  readonly branch: "main" | "master"
  readonly head: string
  readonly statusBytes: string
}

const operationMarkers = [
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

class PublishBranchRepairError extends Error {
  constructor(
    readonly code:
      | "PUBLISH_BRANCH_REPAIR_BLOCKED"
      | "PUBLISH_BRANCH_REPAIR_FAILED"
      | "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
    message: string,
  ) {
    super(message)
    this.name = "PublishBranchRepairError"
  }
}

function blocked(reason: string): PublishBranchInspection {
  return { status: "blocked", reason }
}

class GitPublishBranchRepair implements PublishBranchRepairService {
  readonly #workspace: string
  readonly #runner: CommandRunner
  #uncertain = false
  #disposed = false
  #active: Promise<PublishBranchRepairReceipt> | undefined
  #disposal: Promise<void> | undefined

  constructor(private readonly dependencies: PublishBranchRepairDependencies) {
    this.#workspace = resolve(dependencies.workspace)
    this.#runner = dependencies.runner ?? systemCommandRunner
  }

  async #git(args: readonly string[]): Promise<CommandResult> {
    return this.#runner.run({ executable: "git", args, cwd: this.#workspace })
  }

  async #rollback(original: RepairSnapshot): Promise<boolean> {
    try {
      const renamed = await this.#git(["branch", "-m", "main", "master"])
      if (renamed.exitCode !== 0) return false
      const upstream = await this.#git(["branch", "--set-upstream-to=origin/main", "master"])
      if (upstream.exitCode !== 0) return false
      const [branch, head, restoredUpstream, status] = await Promise.all([
        this.#git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        this.#git(["rev-parse", "--verify", "HEAD"]),
        this.#git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
        this.#git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      ])
      return (
        branch.exitCode === 0 &&
        branch.stdout.trim() === "master" &&
        head.exitCode === 0 &&
        head.stdout.trim() === original.head &&
        restoredUpstream.exitCode === 0 &&
        restoredUpstream.stdout.trim() === "origin/main" &&
        status.exitCode === 0 &&
        status.stdout === original.statusBytes
      )
    } catch {
      return false
    }
  }

  async #snapshot(): Promise<RepairSnapshot | PublishBranchInspection> {
    const root = await this.#git(["rev-parse", "--show-toplevel"])
    if (root.exitCode !== 0) return blocked("The workspace is not a Git repository.")
    const [workspaceRoot, reportedRoot] = await Promise.all([
      realpath(this.#workspace),
      realpath(root.stdout.trim()),
    ])
    if (workspaceRoot !== reportedRoot) return blocked("The workspace is not the Git root.")

    const branch = await this.#git(["symbolic-ref", "--quiet", "--short", "HEAD"])
    const branchName = branch.stdout.trim()
    if (branch.exitCode !== 0 || (branchName !== "main" && branchName !== "master")) {
      return blocked("Publication branch repair only supports main or master.")
    }

    const head = await this.#git(["rev-parse", "--verify", "HEAD"])
    const status = await this.#git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    if (head.exitCode !== 0 || status.exitCode !== 0) {
      return blocked("The repository state could not be captured.")
    }
    if (branchName === "main") {
      return { branch: "main", head: head.stdout.trim(), statusBytes: status.stdout }
    }

    const upstream = await this.#git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ])
    if (upstream.exitCode !== 0 || upstream.stdout.trim() !== "origin/main") {
      return blocked("The master branch must track origin/main.")
    }
    const remoteMain = await this.#git([
      "show-ref",
      "--verify",
      "--quiet",
      "refs/remotes/origin/main",
    ])
    if (remoteMain.exitCode !== 0) return blocked("The origin/main remote-tracking ref is missing.")
    const localMain = await this.#git(["show-ref", "--verify", "--quiet", "refs/heads/main"])
    if (localMain.exitCode === 0) return blocked("A local main branch already exists.")
    if (localMain.exitCode !== 1) return blocked("The local main branch could not be inspected.")
    const staged = await this.#git(["diff", "--cached", "--quiet", "--exit-code"])
    if (staged.exitCode === 1) return blocked("Staged changes must be committed or unstaged first.")
    if (staged.exitCode !== 0) return blocked("Staged changes could not be inspected.")

    const commonDirectoryResult = await this.#git(["rev-parse", "--git-common-dir"])
    if (commonDirectoryResult.exitCode !== 0) {
      return blocked("The common Git directory could not be resolved.")
    }
    const commonDirectoryValue = commonDirectoryResult.stdout.trim()
    const commonDirectory = await realpath(
      isAbsolute(commonDirectoryValue)
        ? commonDirectoryValue
        : resolve(this.#workspace, commonDirectoryValue),
    )
    for (const marker of operationMarkers) {
      if (await exists(resolve(commonDirectory, marker))) {
        return blocked("A Git operation is in progress.")
      }
    }

    return { branch: "master", head: head.stdout.trim(), statusBytes: status.stdout }
  }

  async inspect(): Promise<PublishBranchInspection> {
    if (this.#uncertain) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
        "Publication branch repair is in an uncertain state.",
      )
    }
    if (this.#disposed) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_BLOCKED",
        "Publication branch repair has been disposed.",
      )
    }
    const snapshot = await this.#snapshot()
    if ("status" in snapshot) return snapshot
    return snapshot.branch === "main"
      ? { status: "ready", head: snapshot.head }
      : { status: "repairable", head: snapshot.head }
  }

  async #repairOnce(): Promise<PublishBranchRepairReceipt> {
    if (this.#uncertain) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
        "Publication branch repair is in an uncertain state.",
      )
    }
    if (this.#disposed) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_BLOCKED",
        "Publication branch repair has been disposed.",
      )
    }
    const original = await this.#snapshot()
    if ("status" in original || original.branch !== "master") {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_BLOCKED",
        "Publication branch repair is blocked by the current repository state.",
      )
    }

    await this.dependencies.beforeMutation?.()
    const current = await this.#snapshot()
    if (
      "status" in current ||
      current.branch !== "master" ||
      current.head !== original.head ||
      current.statusBytes !== original.statusBytes
    ) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_BLOCKED",
        "The repository changed before branch repair could begin.",
      )
    }

    const renamed = await this.#git(["branch", "-m", "master", "main"])
    if (renamed.exitCode !== 0) {
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_FAILED",
        "The publication branch could not be renamed.",
      )
    }
    try {
      await this.dependencies.afterRename?.()
      const upstream = await this.#git(["branch", "--set-upstream-to=origin/main", "main"])
      if (upstream.exitCode !== 0) throw new Error("upstream update failed")

      const [branch, head, verifiedUpstream, status] = await Promise.all([
        this.#git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        this.#git(["rev-parse", "--verify", "HEAD"]),
        this.#git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
        this.#git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      ])
      if (
        branch.exitCode !== 0 ||
        branch.stdout.trim() !== "main" ||
        head.exitCode !== 0 ||
        head.stdout.trim() !== original.head ||
        verifiedUpstream.exitCode !== 0 ||
        verifiedUpstream.stdout.trim() !== "origin/main" ||
        status.exitCode !== 0 ||
        status.stdout !== original.statusBytes
      ) {
        throw new Error("repair verification failed")
      }
      return { branch: "main", upstream: "origin/main", head: original.head }
    } catch {
      if (!(await this.#rollback(original))) {
        this.#uncertain = true
        throw new PublishBranchRepairError(
          "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
          "Publication branch repair could not be safely recovered.",
        )
      }
      throw new PublishBranchRepairError(
        "PUBLISH_BRANCH_REPAIR_FAILED",
        "Publication branch repair failed and was rolled back.",
      )
    }
  }

  repair(): Promise<PublishBranchRepairReceipt> {
    if (this.#uncertain) {
      return Promise.reject(
        new PublishBranchRepairError(
          "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
          "Publication branch repair is in an uncertain state.",
        ),
      )
    }
    if (this.#disposed) {
      return Promise.reject(
        new PublishBranchRepairError(
          "PUBLISH_BRANCH_REPAIR_BLOCKED",
          "Publication branch repair has been disposed.",
        ),
      )
    }
    if (this.#active) return this.#active
    const operation = this.#repairOnce()
    const tracked = operation.finally(() => {
      if (this.#active === tracked) this.#active = undefined
    })
    this.#active = tracked
    return tracked
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal
    this.#disposed = true
    const active = this.#active
    this.#disposal = active
      ? active.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve()
    return this.#disposal
  }
}

export function createPublishBranchRepair(
  dependencies: PublishBranchRepairDependencies,
): PublishBranchRepairService {
  return new GitPublishBranchRepair(dependencies)
}
