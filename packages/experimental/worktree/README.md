---
description: "Create, own and safely finish retained Git worktrees."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree

English | [中文](README.zh.md)

## Summary

Create a named branch or detached task checkout while preserving the original Session project. Ownership is durable, and finishing keeps dirty files, active jobs, active children and unpublished detached commits.

## Use this package

Mount exactly one profile-level ownership service above all retained preset trees. Mount the worktree service with the filesystem, subprocess, sandbox, sandboxPolicy, workingDirectory and systemPrompt providers of its execution world. The optional tool bundle includes the root owner for ordinary unscoped use.

```yaml
- name: '@deepseek-ai/dsh-experimental-worktree/ownership'
- name: '@deepseek-ai/dsh-experimental-worktree'
- name: '@deepseek-ai/dsh-experimental-tool-worktree'
```

The owner opens one native storage domain. Each preset-scoped service injects that owner; it must not open its own handle or create another owner. Ownership, per-Session mutations and fresh-fetch queues survive individual preset revision disposal. Profile disposal aborts and drains operations before closing the domain.

`create(agent,{name?,from?,detached?},signal?,policy?)` enters a successful checkout. `branch` is null for detached mode. Names select unused pool paths; detached mode creates no named branch. Without freshBase, from defaults to HEAD. With freshBase, a configured remote branch must fetch successfully before allocation, and from cannot override it. Fetch and commit pinning are serialized by executor and canonical Git common-directory identity.

`newSession:true` requires freshBase. Empty top-level Sessions remain immediate; the prepended first-step operation prepares Git-backed Sessions before downstream project instructions. Non-Git directories stay unchanged. Restored ownership selects its recorded checkout instead of allocating another. The original Session header is preserved. `presetScoped:true` requires the calling Agent's actual retained worktrees service for lifecycle handling and public create/finish operations.

The default pool is .agents/worktrees; deployments can select another relative directory and detached default. Automatic setup initializes a missing pool .gitignore without overwriting existing content and refuses a pool that does not ignore its checkout. Git hooks and filters remain active. Process executables, deadlines, output limits and termination grace are configurable.

## Permissions and cleanup

Normal create and finish calls retain the Session's native sandbox policy. The tool consumer can request a wider mode through native approval. `bootstrapSandbox:host` is an explicit opt-in only for automatic first-prompt setup; repository hooks and credential helpers then receive Host access. Subsequent tools and finish do not inherit that opt-in.

`finish(agent,signal?,policy?)` removes only that Session's owned clean registered worktree without force. Active jobs or children, dirty or untracked files, unexpected registration and detached commits without retained branch/remote refs keep the checkout and ownership. Successful cleanup returns to the source project and releases ownership. Branches are retained. Failed setup can retain partial filesystem or Git artifacts identified by its error.

## Model Experience

### Worktree context

#### What the model sees

The tool result records the exact path, nullable branch and baseline commit. A stable system context names the owned checkout and cleanup requirements; successful directory changes use native Session events. These additions contribute bounded prompt/result text; unchanged context retains its prefix.

#### Token effect

Ownership context and fixed tool schemas add per-request text; calls append bounded results or errors.

#### KV Cache effect

Unchanged ownership context preserves its prefix; successful directory changes append native working-directory context.

## Known Limitations and Deferred Work

Execution requires Git and Node in the same filesystem world. Git must honor GIT_NO_LAZY_FETCH. This service does not install project dependencies, initialize submodules, copy source edits, merge changes or publish commits. The selected native sandbox's documented enforcement limits remain applicable. Missing owned worktrees fail visibly; cleanup does not force-recover or delete unrelated paths.
