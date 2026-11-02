---
description: "创建并安全结束 Session 所有 Git 工作树的原生工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tool-worktree

[English](README.md) | 中文

## 使用本包

可选 bundle 挂载一个 profile 级所有权服务、[工作树服务](../worktree/README.zh.md)及两个工具。将服务和工具移入隔离 preset 时，所有者必须保持全局挂载。关闭 bundle 会注销工具，并保留全部检出目录与所有权数据。

`create_worktree({name?,from?,detached?,sandbox_permissions?,justification?})` 根据部署策略创建并进入拥有所有权的检出目录。结果包含 path、可为 null 的 branch、固定 baseCommit 与 repositoryRoot。from 不得覆盖强制 freshBase。

`finish_worktree({sandbox_permissions?,justification?})` 安全结束当前 Session 的检出目录。状态为 none、removed 或 retained；保留时说明运行中的工作、脏文件、未发布的 detached 提交或异常注册。不强制删除，也不删除分支。

两个工具均公开原生沙箱提权字段，并对选择的更宽模式请求实际审批。省略时保持 Session 原生策略。Host bootstrap 选项不批准后续 finish 操作。PTC 与普通工具调用方获得相同的带类型结果及原生通用展示。

## 模型体验

### 工作树上下文

#### 模型看到什么

两个固定 schema 增加每次请求的工具文本。调用追加有界参数与规范 JSON 结果或错误。服务提供所有权上下文，工作目录服务记录成功的目录变更。

#### Token 影响

所有权上下文和固定工具 schema 增加每次请求的文本，调用追加有界结果或错误。

#### KV Cache 影响

未改变的所有权上下文保留前缀，成功的目录变更追加原生工作目录上下文。

## 已知限制与待办工作

必须有调用 Agent，且它实际拥有保留的服务。合并、发布、依赖安装以及无关或损坏检出目录的恢复不属于这些工具。[服务文档](../worktree/README.zh.md)定义权限、Git 与清理要求。
