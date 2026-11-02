---
description: "创建、记录所有权并安全结束保留的 Git 工作树。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree

[English](README.md) | 中文

## 概述

创建具名分支或 detached 任务检出目录，同时保留 Session 的原始项目。所有权持久化；结束任务时保留脏文件、运行中的任务、子 Agent 与尚未发布的 detached 提交。

## 使用本包

在所有保留的 preset 树之上，仅挂载一个 profile 级所有权服务。工作树服务与所属执行环境的 filesystem、subprocess、sandbox、sandboxPolicy、workingDirectory 和 systemPrompt 提供方一起挂载。可选工具 bundle 为普通非隔离用法挂载根所有权服务。

```yaml
- name: '@deepseek-ai/dsh-experimental-worktree/ownership'
- name: '@deepseek-ai/dsh-experimental-worktree'
- name: '@deepseek-ai/dsh-experimental-tool-worktree'
```

所有权服务仅打开一个原生 storage domain。各 preset 服务注入该所有者，不得自行打开另一个句柄或创建另一所有者。单个 preset 版本销毁后，所有权、每 Session 操作队列及 fresh-fetch 队列仍然存在。profile 销毁时先中止并等待操作结束，再关闭 domain。

`create(agent,{name?,from?,detached?},signal?,policy?)` 在成功后进入新检出目录。detached 模式的 branch 为 null，且不创建具名分支。名称选择未占用的池路径。未配置 freshBase 时，from 默认为 HEAD；配置后必须成功获取指定远端分支再分配目录，from 不得覆盖该策略。获取与固定提交按执行器及 Git common directory 的规范文件系统标识串行执行。

`newSession:true` 要求 freshBase。空的顶层 Session 立即可用；前置首步操作在项目指令之前为 Git 项目准备目录。非 Git 目录不变。恢复已有所有权时进入记录的检出目录，不再次分配。原始 Session header 保持不变。`presetScoped:true` 要求生命周期处理及公开 create/finish 使用调用 Agent 实际保留的 worktrees 服务。

默认池为 .agents/worktrees；部署可配置其他相对目录及 detached 默认值。自动初始化仅补充缺失的池 .gitignore，不覆盖已有内容，并拒绝未忽略目标检出目录的池。Git hooks 与 filters 正常运行。可配置可执行程序、时限、输出上限及结束宽限期。

## 权限与清理

普通 create 与 finish 保持 Session 原生沙箱策略。工具消费方可通过原生审批请求更宽模式。`bootstrapSandbox:host` 仅明确放行自动首提示准备；此时仓库 hooks 与凭证 helper 拥有 Host 权限。后续工具与 finish 不继承此选项。

`finish(agent,signal?,policy?)` 只移除当前 Session 拥有的干净、已注册工作树，且不使用 force。运行中的 job 或子 Agent、脏文件、未跟踪文件、异常注册以及没有保留分支或远端引用的 detached 提交都会保留目录与所有权。成功清理后返回源项目并释放所有权，具名分支仍保留。初始化失败可留下部分文件或 Git 产物，错误中会注明位置。

## 模型体验

### 工作树上下文

#### 模型看到什么

工具结果记录准确路径、可为 null 的分支与基准提交。稳定的系统上下文说明工作树所有权和清理要求；成功的目录变更使用原生 Session 事件。这些内容增加有界的提示与结果文本；未改变的上下文保留其前缀。

#### Token 影响

所有权上下文和固定工具 schema 增加每次请求的文本，调用追加有界结果或错误。

#### KV Cache 影响

未改变的所有权上下文保留前缀，成功的目录变更追加原生工作目录上下文。

## 已知限制与待办工作

执行环境必须在同一文件系统中提供 Git 与 Node，Git 必须识别 GIT_NO_LAZY_FETCH。本服务不安装项目依赖、不初始化子模块、不复制源修改、不合并变更、不发布提交。原生沙箱已说明的执行限制仍适用。记录的工作树缺失时明确报错；清理不会强制恢复或删除其他路径。
