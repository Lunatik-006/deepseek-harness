---
kind: upgrade-guide
description: "工作树结果的分支可为 null，隔离服务需要一个 profile 级所有权提供方。"
---

# 工作树所有权与 detached 检出

[English](guide.md) | 中文

## 变更

CreatedWorktree.branch 从 string 变为 string | null。detached 模式不创建分支。工作树服务现在需要 worktreeOwnership，它为每个 profile 使用一个 native_worktrees storage domain，并提供安全的 finish_worktree。没有所有权记录的既有检出目录保持不变，不自动接管或移除。

## 迁移

1. 在全部 preset 级工作树服务之上，仅挂载一个 @deepseek-ai/dsh-experimental-worktree/ownership。普通可选工具 bundle 已插入该行，不要重复添加。
2. 更新结果消费方，处理 branch === null，不生成虚构分支名。请求 finish_worktree 移除 detached 检出目录之前，将其提交保留在分支或远端引用中。
3. 在显式运行时组合中加入 @deepseek-ai/dsh-storage-domain，并在重启时保留其运行数据。仅所有权提供方打开和关闭 domain；移除各 preset 的独立句柄与全局缓存。
4. 自动 newSession 模式必须显式配置 freshBase。Host bootstrap 是独立的受信准备选项，不批准后续工具操作。
5. 确认 profile 只有一个所有权提供方，且每个保留的工作树服务均注入它。重启后已有所有权应恢复记录的目录；detached 创建返回 null 分支，尚有未发布工作时清理返回 retained。
