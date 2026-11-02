/** Creates an isolated checkout and changes the calling Session's working directory. */

import { randomUUID } from 'node:crypto'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from './ownership.ts'
import { PREPARE_DIRECTORY } from './directory.ts'
import { runCommand } from './process.ts'
import type { ProcessConfig } from './process.ts'
import type { CreatedWorktree, CreateWorktreeRequest } from './types.ts'

export type { CreatedWorktree, CreateWorktreeRequest } from './types.ts'

/** Worktree location, generated names, executables, and subprocess resource limits. */
export interface Config {
  /** Require ownership by the retained Agent preset before handling global lifecycle events. */
  presetScoped?: boolean
  /** Default checkout mode; explicit requests may select it independently. */
  detached?: boolean
  /** Prepare a fresh worktree before the first prompt of each new top-level Git-backed Session. Requires freshBase. */
  newSession?: boolean
  /**
   * Run only automatic new-Session Git/directory setup as trusted host commands.
   * Host opt-in gives repository Git hooks and credential helpers host access;
   * the default keeps them confined. Model-requested creation and subsequent
   * agent tools retain the Session sandbox.
   */
  bootstrapSandbox?: 'session' | 'host'
  /** Fetch this configured remote branch successfully before every creation; never use a cached base. */
  freshBase?: {
    /** Configured Git remote name, such as origin. */
    remote: string
    /** Branch on that remote, such as main. */
    branch: string
  }
  /** Relative checkout pool inside the source repository. */
  directory?: string
  /** Prefix for automatically generated branch and checkout names. */
  namePrefix?: string
  /** Executable name or absolute execution-world path of a Git release that honors `GIT_NO_LAZY_FETCH`. */
  gitCommand?: string
  /** Node executable used for sandboxed directory allocation. */
  nodeCommand?: string
  /** Deadline in milliseconds for one command. */
  timeoutMs?: number
  /** Subprocess termination grace in milliseconds. */
  graceMs?: number
  /** Maximum captured bytes per subprocess output stream. */
  maxOutputBytes?: number
}

type ResolvedConfig = Required<Omit<Config, 'freshBase'>> & Pick<Config, 'freshBase'> & ProcessConfig

interface WorktreeSpec {
  branch: string
  revision: string
  detached: boolean
}

type GitRun = (directory: string, args: string[], allowedExitCodes?: number[], env?: NodeJS.ProcessEnv) => ReturnType<typeof runCommand>

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: WorktreeService
  }
  interface Events {
    /** Resolve the project source before Git setup using the actual claimed first-step inputs.
     * @mode waterfall
     * @param payload - exact Agent, operation cancellation and optional admitted native messages.
     */
    'worktree/project-context'(payload: { agent: Agent, signal?: AbortSignal, messages?: readonly UserMessage[] }, next: () => Promise<{ sourceRoot: string, executorId?: string } | undefined>): Promise<{ sourceRoot: string, executorId?: string } | undefined>
  }
}

/** Reject path traversal independently of Git's branch-name grammar. */
function relativePath(value: string): boolean {
  return value.length > 0 && !value.includes('\\') && !value.includes(':')
    && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..')
}

/** Creates retained Git worktrees under the mounted filesystem and sandbox providers. */
export class WorktreeService extends Service {
  static inject = ['workingDirectory', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy', 'systemPrompt', 'worktreeOwnership']

  static Config: z<Config> = z.object({
    presetScoped: z.boolean().default(false),
    detached: z.boolean().default(false),
    newSession: z.boolean().default(false),
    bootstrapSandbox: z.union(['session', 'host'] as const).default('session'),
    freshBase: z.object({ remote: z.string().min(1), branch: z.string().min(1) }),
    directory: z.string().default('.agents/worktrees'),
    namePrefix: z.string().default('worktree-'),
    gitCommand: z.string().default('git'),
    nodeCommand: z.string().default('node'),
    timeoutMs: z.number().default(60_000),
    graceMs: z.number().default(3_000),
    maxOutputBytes: z.number().default(65_536),
  })

  private readonly config: ResolvedConfig
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly newSessions = new WeakSet<Agent>()
  private readonly startingSessions = new WeakMap<Agent, Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'worktrees')
    this.config = config as ResolvedConfig
    ctx.systemPrompt.context({
      name: 'worktree:ownership', order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY') + 1,
      required: true, interpolate: false,
      text: ({ agent }) => {
        if (!agent || !this.owns(agent)) return ''
        const owned = this.ctx.worktreeOwnership.peek(agent.session.id)
        return owned ? `This task owns worktree ${owned.path}, based on ${owned.baseCommit}. When the task is delivered and its jobs/children have stopped, call finish_worktree. It preserves dirty files and unpublished detached commits. Do not force-remove this checkout or the source checkout.` : ''
      },
    })
    if (this.config.newSession && this.config.freshBase === undefined) {
      throw new Error('worktree: newSession requires freshBase')
    }
    if (this.config.freshBase !== undefined && (this.config.freshBase.remote.startsWith('-')
      || this.config.freshBase.branch.startsWith('-'))) {
      throw new Error('worktree: freshBase remote and branch must not start with a dash')
    }
    if (!relativePath(this.config.directory)) throw new Error('worktree: directory must be a relative directory without dot segments')
    if (!relativePath(`${this.config.namePrefix}name`) || this.config.namePrefix.startsWith('-')) {
      throw new Error('worktree: namePrefix must produce a relative branch name')
    }
    for (const key of ['gitCommand', 'nodeCommand'] as const) {
      if (this.config[key].trim().length === 0) throw new Error(`worktree: ${key} must not be empty`)
    }
    for (const key of ['timeoutMs', 'graceMs', 'maxOutputBytes'] as const) {
      const value = this.config[key]
      if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
        throw new Error(`worktree: ${key} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
      }
    }
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('worktree service disposed'))
      await Promise.allSettled(this.pending)
    })
    if (this.config.newSession) {
      ctx.inject(['agents'], (agentCtx) => {
        for (const agent of agentCtx.agents.list()) {
          const untouched = !agent.session.snapshotEvents().some(event => event.type === 'turn/start'
            || event.type === 'user/message' || event.type.startsWith('assistant/') || event.type.startsWith('tool/'))
          if (this.owns(agent) && this.isTopLevel(agent) && agent.status === 'idle' && untouched
            && this.ctx.workingDirectory.get(agent.session) === agent.session.header.cwd) this.newSessions.add(agent)
        }
      })
      ctx.on('agent/created', ({ agent, source }) => {
        if (source === 'startup' && this.owns(agent) && this.isTopLevel(agent)
          && !agent.session.snapshotEvents().some(event => event.type.startsWith('assistant/') || event.type.startsWith('tool/'))) this.newSessions.add(agent)
        return undefined
      })
      // Prepare before downstream instruction/rules pre-steps, not merely before system assembly.
      ctx.on('agent/pre-step', async ({ agent, signal, messages }, next) => {
        if (agent !== undefined && this.owns(agent) && this.isTopLevel(agent)
          && this.ctx.workingDirectory.get(agent.session) === agent.session.header.cwd
          && !agent.session.snapshotEvents().some(event => event.type.startsWith('assistant/') || event.type.startsWith('tool/'))) {
          this.newSessions.add(agent)
        }
        if (agent !== undefined && this.owns(agent) && this.newSessions.has(agent)) {
          let starting = this.startingSessions.get(agent)
          if (starting === undefined) {
            starting = this.prepareNewSession(agent, signal, messages)
            this.startingSessions.set(agent, starting)
          }
          try {
            await starting
            this.newSessions.delete(agent)
          } finally {
            if (this.startingSessions.get(agent) === starting) this.startingSessions.delete(agent)
          }
        }
        return next()
      }, { prepend: true })
    }
  }

  /** Exclude inherited histories and delegated Agents from top-level Session preparation. */
  private isTopLevel(agent: Agent): boolean {
    const header = agent.session.header
    return !header.isSeeded && header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0
  }

  private owns(agent: Agent): boolean {
    const selected = this.ctx.get('agentPresets')?.serviceFor(agent, 'worktrees')
    if (selected === undefined) return !this.config.presetScoped
    return (Reflect.get(selected, symbols.original) ?? selected) === (Reflect.get(this, symbols.original) ?? this)
  }

  /** Gate the first prompt while retaining the original project header and sandbox policy. */
  private async prepareNewSession(agent: Agent, signal?: AbortSignal, messages?: readonly UserMessage[]): Promise<void> {
    const control = AbortSignal.any([this.lifetime.signal, this.ctx.worktreeOwnership.signal, ...signal ? [signal] : []])
    const operation = this.ownedOperation(agent, async () => {
      const saved = await this.ctx.worktreeOwnership.get(agent.session.id)
      if (saved) {
        const owned = saved
        if (owned.sessionId !== agent.session.id) throw new Error('Invalid worktree owner')
        const context = await this.ctx.waterfall('worktree/project-context', { agent, signal: control, messages }, () => Promise.resolve(undefined))
        if (owned.executionKey !== (context?.executorId ?? 'local-host')) throw new Error('Recorded worktree belongs to another executor')
        const target = await this.ctx.fs.resolve(owned.path, { signal: control })
        const info = await this.ctx.fs.stat(target, control)
        if (info?.type !== 'directory') throw new Error('The session-owned worktree is missing; finish its registration before starting another')
        await this.ctx.workingDirectory.set(agent, owned.path, control)
        return
      }
      const cwd = await this.ctx.workingDirectory.ensure(agent, control)
      if (!await this.hasGitDirectory(cwd, control)) return
      await this.createCheckout(agent, this.resolve({}), control, true, undefined, messages)
    })
    this.pending.add(operation)
    try {
      await operation
    } finally {
      this.pending.delete(operation)
    }
  }

  /** Skip non-Git chats without converting executable, permission, or repository failures into success. */
  private async hasGitDirectory(cwd: string, signal: AbortSignal): Promise<boolean> {
    let directory = await this.ctx.fs.resolve('.', { cwd, signal })
    while (true) {
      signal.throwIfAborted()
      const path = this.ctx.fs.processPath(directory)
      const marker = await this.ctx.fs.resolve('.git', { cwd: path, signal })
      if (await this.ctx.fs.lstat(this.ctx.fs.processPath(marker), undefined, signal) !== undefined) return true
      const parent = await this.ctx.fs.resolve('..', { cwd: path, signal })
      if (parent.targetKey === directory.targetKey) return false
      directory = parent
    }
  }

  /**
   * Create a fresh named or detached checkout at a pinned revision, then enter it.
   * Existing branches or checkout paths fail. Uncommitted files stay in the source checkout.
   * Repository hooks and filters execute under the selected policy.
   * Repository-local replacement refs still apply; baseCommit reports the resolved object name.
   * The new checkout becomes current only after Git setup succeeds. Failures may retain newly
   * allocated Git/filesystem artifacts; no branch or checkout is removed automatically.
   * @param agent - caller whose current directory selects the source repository and file policy.
   * @param request - optional new name and local revision; defaults are generated name and HEAD.
   * @param signal - cancellation of lookup, creation, and working-directory publication.
   * @param override - approved per-call policy; omission retains the native Session policy.
   * @returns canonical checkout path, nullable branch name, pinned commit, and source repository root.
   */
  async create(agent: Agent, request: CreateWorktreeRequest = {}, signal?: AbortSignal, override?: SandboxExecutionPolicy): Promise<CreatedWorktree> {
    if (!this.owns(agent)) throw new Error('Worktree creation requires the calling Agent retained service')
    const operationSignal = AbortSignal.any([this.lifetime.signal, this.ctx.worktreeOwnership.signal, ...signal ? [signal] : []])
    operationSignal.throwIfAborted()
    return this.ownedOperation(agent, () => this.createCheckout(agent, this.resolve(request), operationSignal, false, override))
  }

  private async ownedOperation<T>(agent: Agent, action: () => Promise<T>): Promise<T> {
    const operation = this.ctx.worktreeOwnership.serializeSession(agent.session.id, action)
    this.pending.add(operation)
    try { return await operation } finally { this.pending.delete(operation) }
  }

  private resolve(request: CreateWorktreeRequest): WorktreeSpec {
    const branch = request.name ?? `${this.config.namePrefix}${randomUUID()}`
    if (!relativePath(branch) || branch.startsWith('-')) throw new Error('worktree name must be a relative Git branch name')
    const revision = request.from ?? 'HEAD'
    if (this.config.freshBase !== undefined && request.from !== undefined) {
      throw new Error('worktree: from cannot override the configured freshBase')
    }
    if (revision.length === 0) throw new Error('worktree from must name a local commit, branch, or tag')
    return { branch, revision, detached: request.detached ?? this.config.detached }
  }

  private async createCheckout(agent: Agent, { branch, revision, detached }: WorktreeSpec, signal: AbortSignal, bootstrap = false, override?: SandboxExecutionPolicy, messages?: readonly UserMessage[]): Promise<CreatedWorktree> {
    if (await this.ctx.worktreeOwnership.get(agent.session.id)) throw new Error('This session already owns a worktree; finish it before creating another')
    const current = await this.ctx.workingDirectory.ensure(agent, signal)
    const context = await this.ctx.waterfall('worktree/project-context', { agent, signal, messages }, () => Promise.resolve(undefined))
    const cwd = context?.sourceRoot ?? current
    const sessionPolicy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    const trustedBootstrap = bootstrap && this.config.bootstrapSandbox === 'host'
    const policy = override ?? (trustedBootstrap ? { ...sessionPolicy, mode: 'danger-full-access' as const } : sessionPolicy)
    const run = this.gitRunner(policy, signal)
    await run(cwd, ['check-ref-format', `refs/heads/${branch}`])
    const rootOutput = await run(cwd, ['rev-parse', '--show-toplevel'])
    const rootTarget = await this.ctx.fs.resolve(rootOutput.stdout.replace(/\r?\n$/, ''), { cwd, signal })
    const repositoryRoot = this.ctx.fs.processPath(rootTarget)
    const baseCommit = this.config.freshBase === undefined
      ? (await run(repositoryRoot, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).stdout.trim()
      : await this.fetchFreshBase(repositoryRoot, run, signal, context?.executorId)
    if (!detached) {
      const existing = await run(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], [0, 1])
      if (existing.exitCode === 0) throw new Error(`worktree branch already exists: ${branch}`)
    }
    const pool = await this.ctx.fs.resolve(this.config.directory, { cwd: repositoryRoot, signal })
    const poolPath = this.ctx.fs.processPath(pool)
    const destination = await this.ctx.fs.resolve(branch, { cwd: poolPath, signal })
    const path = this.ctx.fs.processPath(destination)
    if (await this.ctx.fs.lstat(path, undefined, signal) !== undefined) throw new Error(`worktree path already exists: ${path}`)
    try {
      await runCommand(this.ctx, this.config, policy, repositoryRoot,
        [this.config.nodeCommand, '--input-type=module', '-e', PREPARE_DIRECTORY, poolPath, path, ...bootstrap ? ['ensure-ignore'] : []], signal)
      if (bootstrap && (await run(repositoryRoot, ['check-ignore', '--quiet', '--', path], [0, 1])).exitCode !== 0) {
        throw new Error('Configured worktree pool does not ignore the checkout; preserve its existing .gitignore and configure an ignored pool')
      }
      await run(repositoryRoot, ['--work-tree', repositoryRoot, 'worktree', 'add',
        ...detached ? ['--detach'] : ['--no-track', '-b', branch], '--', path, baseCommit])
      const canonicalPath = this.ctx.fs.processPath(await this.ctx.fs.resolve(path, { signal }))
      const owned = { sessionId: agent.session.id, executionKey: context?.executorId ?? 'local-host', path: canonicalPath, branch: detached ? null : branch, baseCommit, repositoryRoot }
      await this.ctx.worktreeOwnership.claim(owned)
      await this.ctx.workingDirectory.set(agent, canonicalPath, signal)
      return { path: owned.path, branch: owned.branch, baseCommit, repositoryRoot }
    } catch (error) {
      throw new Error(`Could not finish worktree ${branch} at ${path}. Any created checkout and branch are retained. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  /** Fetch and pin one remote branch without accepting a stale ref after a failed fetch. */
  private async fetchFreshBase(repositoryRoot: string, run: GitRun, signal: AbortSignal, executorId = 'local-host'): Promise<string> {
    const fresh = this.config.freshBase
    if (fresh === undefined) throw new Error('worktree: freshBase is not configured')
    const shared = await run(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const common = await this.ctx.fs.resolve(shared.stdout.trim(), { cwd: repositoryRoot, signal })
    const key = `${executorId}:${common.targetKey}`
    return this.ctx.worktreeOwnership.serializeFetch(key, async () => {
      signal.throwIfAborted()
      await run(repositoryRoot, ['check-ref-format', `refs/heads/${fresh.branch}`])
      // Only a named, configured remote is accepted, rather than a caller-supplied URL or path.
      await run(repositoryRoot, ['remote', 'get-url', fresh.remote])
      const ref = `refs/remotes/${fresh.remote}/${fresh.branch}`
      await run(repositoryRoot, ['fetch', '--no-tags', '--no-write-fetch-head', fresh.remote, `refs/heads/${fresh.branch}:${ref}`])
      const base = await run(repositoryRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
      return base.stdout.trim()
    })
  }

  /** Git keeps the repository's actual hooks and filters under the selected per-call policy. */
  private gitRunner(policy: SandboxExecutionPolicy, signal: AbortSignal): GitRun {
    return (directory, args, allowedExitCodes, env) => runCommand(
      this.ctx, this.config, policy, directory,
      [this.config.gitCommand, '-c', 'core.fsmonitor=false', ...args],
      signal, allowedExitCodes, env,
    )
  }

  /**
   * Remove only this Session's clean checkout after its jobs and children have stopped.
   * @param agent - caller owning the recorded checkout and retained worktree service.
   * @param signal - optional cancellation combined with service and profile disposal.
   * @param override - approved per-call policy; omission retains the native Session policy.
   * @returns cleanup status and the reason when unfinished work keeps its checkout.
   */
  async finish(agent: Agent, signal?: AbortSignal, override?: SandboxExecutionPolicy): Promise<{ status: 'none' | 'removed' | 'retained', path?: string, reason?: string }> {
    if (!this.owns(agent)) throw new Error('Worktree cleanup requires the calling Agent retained service')
    const control = AbortSignal.any([this.lifetime.signal, this.ctx.worktreeOwnership.signal, ...signal ? [signal] : []])
    return this.ownedOperation(agent, () => this.finishCheckout(agent, control, override))
  }

  private async finishCheckout(agent: Agent, signal: AbortSignal, override?: SandboxExecutionPolicy): Promise<{ status: 'none' | 'removed' | 'retained', path?: string, reason?: string }> {
    const saved = await this.ctx.worktreeOwnership.get(agent.session.id)
    if (!saved) return { status: 'none' }
    const owned = saved
    if (owned.sessionId !== agent.session.id) throw new Error('Invalid worktree owner')
    const context = await this.ctx.waterfall('worktree/project-context', { agent, signal }, () => Promise.resolve(undefined))
    if (owned.executionKey !== (context?.executorId ?? 'local-host')) throw new Error('Recorded worktree belongs to another executor')
    const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId: agent.session.id }, () => Promise.resolve([]))
    if (activity.some(item => item.kind === 'job' || item.kind === 'subagent')) return { status: 'retained', path: owned.path, reason: 'Background jobs or subagents still run' }
    const root = await this.ctx.fs.resolve(owned.repositoryRoot, { signal })
    const pool = await this.ctx.fs.resolve(this.config.directory, { cwd: owned.repositoryRoot, signal })
    const target = await this.ctx.fs.resolve(owned.path, { signal })
    if (!this.ctx.fs.contains(root, pool) || !this.ctx.fs.contains(pool, target) || pool.targetKey === target.targetKey) throw new Error('Owned worktree is outside its configured pool')
    const standing = this.ctx.sandboxPolicy.resolve({ session: agent.session })
    const policy = override ?? standing
    const run = this.gitRunner(policy, signal)
    const exists = await this.ctx.fs.lstat(owned.path, undefined, signal)
    const registered = await run(owned.repositoryRoot, ['worktree', 'list', '--porcelain', '-z'])
    let found = false
    for (const item of registered.stdout.split('\0\0')) {
      const path = item.split('\0').find(field => field.startsWith('worktree '))?.slice(9)
      if (path && (await this.ctx.fs.resolve(path, { cwd: owned.repositoryRoot, signal })).targetKey === target.targetKey) found = true
    }
    if (!found && exists !== undefined) return { status: 'retained', path: owned.path, reason: 'Directory is no longer a registered worktree' }
    if (exists !== undefined) {
      const status = await run(owned.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      if (status.stdout.length) return { status: 'retained', path: owned.path, reason: 'Uncommitted or untracked files remain' }
      const head = (await run(owned.path, ['rev-parse', 'HEAD'])).stdout.trim()
      if (owned.branch === null && head !== owned.baseCommit) {
        const refs = await run(owned.repositoryRoot, ['for-each-ref', `--contains=${head}`, '--format=%(refname)', 'refs/heads', 'refs/remotes'])
        if (!refs.stdout.trim()) return { status: 'retained', path: owned.path, reason: 'Detached commits have no retained branch or remote ref' }
      }
    }
    if (found) await run(owned.repositoryRoot, ['worktree', 'remove', '--', owned.path])
    await this.ctx.workingDirectory.set(agent, owned.repositoryRoot, signal)
    await this.ctx.worktreeOwnership.release(agent.session.id)
    return { status: 'removed', path: owned.path }
  }

}

export default WorktreeService
