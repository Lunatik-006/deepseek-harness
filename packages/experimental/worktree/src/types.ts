/** Public requests and results for creating a Git worktree and entering it. */

/** A new checkout from a locally available Git commit, branch, or tag. */
export interface CreateWorktreeRequest {
  /** New branch name, also used as the relative checkout directory; omission generates a name. */
  name?: string
  /** Local revision to resolve before creation; omission selects HEAD. */
  from?: string
  /** Create a detached checkout instead of a branch. Omission uses the deployment policy. */
  detached?: boolean
}

/** Committed Git baseline and the calling Session's resulting working directory. */
export interface CreatedWorktree {
  /** Canonical absolute checkout directory in the filesystem provider's execution world. */
  path: string
  /** Newly created branch name, or null for a detached checkout. */
  branch: string | null
  /** Resolved commit object name; repository-local replacement refs can change its checked-out content. */
  baseCommit: string
  /** Canonical root of the source checkout. */
  repositoryRoot: string
}
