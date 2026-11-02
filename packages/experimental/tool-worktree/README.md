---
description: "Native tools for creating and safely finishing Session-owned Git worktrees."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tool-worktree

English | [中文](README.zh.md)

## Use this package

The optional bundle mounts one profile-level ownership service, the [worktree service](../worktree/README.md) and both tools. Keep the owner global when moving service/tool rows into isolated preset scopes. Turning the bundle off unregisters tools and retains all checkouts and ownership data.

`create_worktree({name?,from?,detached?,sandbox_permissions?,justification?})` creates and enters an owned checkout under deployment policy. Its result includes path, nullable branch, pinned baseCommit and repositoryRoot. Required freshBase cannot be overridden with from.

`finish_worktree({sandbox_permissions?,justification?})` safely finishes the calling Session's checkout. Its status is none, removed or retained; retained results explain running work, dirty files, unpublished detached commits or unexpected registration. No force deletion or branch deletion is performed.

Both tools expose native sandbox escalation fields and request actual approval for the chosen wider mode. Omitting them keeps the native Session policy. Host bootstrap opt-in does not approve later finish operations. PTC and ordinary tool callers receive the same typed result and native generic presentation.

## Model Experience

### Worktree context

#### What the model sees

The two fixed schemas contribute per-request tool text. Calls append bounded arguments and canonical JSON results or errors. The service supplies ownership context and the working-directory service records successful directory changes.

#### Token effect

Ownership context and fixed tool schemas add per-request text; calls append bounded results or errors.

#### KV Cache effect

Unchanged ownership context preserves its prefix; successful directory changes append native working-directory context.

## Known Limitations and Deferred Work

A calling Agent owning the retained service is required. Merging, publishing, dependency installation and recovery of unrelated or broken checkouts remain outside these tools. The [service documentation](../worktree/README.md) defines permission, Git and cleanup requirements.
