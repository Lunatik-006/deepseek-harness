---
kind: upgrade-guide
description: "Worktree results can have a null branch and scoped services require one profile-level ownership provider."
---

# Worktree ownership and detached checkouts

English | [中文](guide.zh.md)

## Change

CreatedWorktree.branch changes from string to string | null. Detached mode creates no branch. Worktree services now require worktreeOwnership, backed by one native_worktrees storage domain per profile, and expose safe finish_worktree. Existing checkouts created without ownership records are retained and are not automatically adopted or removed.

## Migration

1. Mount @deepseek-ai/dsh-experimental-worktree/ownership once above all preset-scoped worktree services. The ordinary optional tool bundle already inserts this row; do not add a duplicate.
2. Update result consumers to handle branch === null without inventing a branch name. Keep detached commits on a branch or remote ref before asking finish_worktree to remove their checkout.
3. Add @deepseek-ai/dsh-storage-domain to explicit runtime compositions and keep its operational state across restarts. The ownership provider alone opens and closes the domain; remove per-preset domain handles or global caches.
4. For automatic newSession mode, configure freshBase explicitly. Host bootstrap is a separate trusted setup opt-in, not approval for later tools.
5. Confirm the profile has one ownership provider and each retained worktree service injects it. Existing ownership must resolve its recorded checkout after restart; a detached creation returns a null branch and cleanup reports retained while unpublished work remains.
