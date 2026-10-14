import { access, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import type { PublishBranchRepairReceipt } from "../../shared/contracts"
import type { CommandResult } from "../lib/commandRunner"
import {
  boundedCommandRunnerCapability,
  createSystemBoundedCommandRunner,
  type BoundedCommandRunner,
} from "./publish"

const branchRepairCommandRunner = createSystemBoundedCommandRunner({ commandDeadlineMs: 30_000 })
const branchRepairOutputBytes = 2 * 1024 * 1024

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
  readonly runner?: BoundedCommandRunner
  readonly beforeMutation?: () => Promise<void> | void
  readonly afterRename?: () => Promise<void> | void
  readonly fileSystemAccess?: (path: string) => Promise<void>
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

async function markerState(
  path: string,
  fileSystemAccess: (path: string) => Promise<void>,
): Promise<"present" | "absent" | "inaccessible"> {
  try {
    await fileSystemAccess(path)
    return "present"
  } catch (caught) {
    if (
      typeof caught === "object" &&
      caught !== null &&
      "code" in caught &&
      caught.code === "ENOENT"
    ) {
      return "absent"
    }
    return "inaccessible"
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

function terminationUncertain(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "terminationUncertain" in caught &&
    caught.terminationUncertain === true
  )
}

class GitPublishBranchRepair implements PublishBranchRepairService {
  readonly #workspace: string
  readonly #runner: BoundedCommandRunner
  #uncertain = false
  #disposed = false
  #active: Promise<PublishBranchRepairReceipt> | undefined
  #disposal: Promise<void> | undefined

  constructor(private readonly dependencies: PublishBranchRepairDependencies) {
    if (
      dependencies.runner !== undefined &&
      dependencies.runner[boundedCommandRunnerCapability] !== true
    ) {
      throw new TypeError("Publish branch repair requires a bounded command runner.")
    }
    this.#workspace = resolve(dependencies.workspace)
    this.#runner = dependencies.runner ?? branchRepairCommandRunner
  }

  async #git(args: readonly string[]): Promise<CommandResult> {
    return this.#runner.run({
      executable: "git",
      args,
      cwd: this.#workspace,
      maxOutputBytes: branchRepairOutputBytes,
    })
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

  async #stateAfterAmbiguousRename(
    original: RepairSnapshot,
  ): Promise<"renamed" | "unchanged" | "ambiguous"> {
    try {
      const [branch, head, status, upstream, main, master] = await Promise.all([
        this.#git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        this.#git(["rev-parse", "--verify", "HEAD"]),
        this.#git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        this.#git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
        this.#git(["show-ref", "--verify", "--quiet", "refs/heads/main"]),
        this.#git(["show-ref", "--verify", "--quiet", "refs/heads/master"]),
      ])
      if (
        branch.exitCode !== 0 ||
        head.exitCode !== 0 ||
        head.stdout.trim() !== original.head ||
        status.exitCode !== 0 ||
        status.stdout !== original.statusBytes ||
        upstream.exitCode !== 0 ||
        upstream.stdout.trim() !== "origin/main"
      ) {
        return "ambiguous"
      }
      const mainState = main.exitCode === 0
      const masterState = master.exitCode === 0
      const mainAbsent = main.exitCode === 1
      const masterAbsent = master.exitCode === 1
      if (branch.stdout.trim() === "main" && mainState && masterAbsent) return "renamed"
      if (branch.stdout.trim() === "master" && masterState && mainAbsent) return "unchanged"
      return "ambiguous"
    } catch {
      return "ambiguous"
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

    for (const marker of operationMarkers) {
      const markerResult = await this.#git(["rev-parse", "--git-path", marker])
      if (markerResult.exitCode !== 0) {
        return blocked("The Git operation state could not be resolved.")
      }
      const markerValue = markerResult.stdout.trim()
      const unresolvedMarker = isAbsolute(markerValue)
        ? markerValue
        : resolve(this.#workspace, markerValue)
      let markerDirectory: string
      try {
        markerDirectory = await realpath(dirname(unresolvedMarker))
      } catch {
        return blocked("The Git operation state could not be inspected.")
      }
      const state = await markerState(
        resolve(markerDirectory, basename(unresolvedMarker)),
        this.dependencies.fileSystemAccess ?? access,
      )
      if (state === "present") {
        return blocked("A Git operation is in progress.")
      }
      if (state === "inaccessible") {
        return blocked("The Git operation state could not be inspected.")
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

    let renameFailed = false
    try {
      const renamed = await this.#git(["branch", "-m", "master", "main"])
      renameFailed = renamed.exitCode !== 0
    } catch (caught) {
      if (terminationUncertain(caught)) {
        this.#uncertain = true
        throw new PublishBranchRepairError(
          "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
          "Publication branch rename termination could not be confirmed.",
        )
      }
      renameFailed = true
    }
    if (renameFailed) {
      const state = await this.#stateAfterAmbiguousRename(original)
      if (state === "renamed") {
        if (!(await this.#rollback(original))) {
          this.#uncertain = true
          throw new PublishBranchRepairError(
            "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
            "Publication branch repair could not be safely recovered.",
          )
        }
      } else if (state === "ambiguous") {
        this.#uncertain = true
        throw new PublishBranchRepairError(
          "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
          "Publication branch repair could not confirm the repository state.",
        )
      }
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
