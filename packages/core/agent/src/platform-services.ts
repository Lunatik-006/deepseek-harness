/**
 * Optional platform-served bridges for Agent-scoped project context and native
 * Claude skill invocation.
 *
 * The host declares the seam and the platform composition provides the
 * implementations; a stock host does not mount either service. Every consumer
 * therefore reads them through `ctx.get()` and keeps its ordinary upstream
 * behavior when a bridge is absent. The contract is structural and shared: the
 * same interfaces type the instruction, skill, MCP and LLM call sites.
 *
 * @module @deepseek-ai/dsh-agent/platform-services
 */

import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** Exact execution realm resolved for one Agent scope. */
export interface PlatformProjectContext<Fs = unknown> {
  /** Filesystem bound to the execution realm. */
  readonly fs: Fs
  /** Working directory of the realm. */
  readonly cwd: string
  /** Checkout root project files resolve from. */
  readonly checkoutRoot?: string | undefined
  /** Explicit per-actor configuration root, when the realm owns one. */
  readonly userConfigRoot?: string | undefined
  /** Executor identity when discovery runs in another execution world. */
  readonly executorId?: string | undefined
}

/** Project-level instruction policy of one exact Agent realm. */
export interface PlatformInstructionPolicy {
  readonly platformUserRoot?: string | null | undefined
  readonly platformUserInstruction?: { readonly absolutePath: string; readonly displayPath: string } | null | undefined
}

/** Select the world a project realm resolves in. */
export interface PlatformResolveOptions {
  /** Ask for the execution world rather than the viewing actor's world. */
  readonly actorMode?: 'execution' | undefined
  /** Exclude explicit user roots from the resolved realm. */
  readonly includeUser?: boolean | undefined
}

/** One native Claude-skill invocation routed through the platform bridge. */
export interface PlatformSkillInvocationRequest<Skill> {
  /** Viewing Agent; omitted for a lookup that has no Agent scope. */
  readonly agent?: ScopeKey | undefined
  readonly skill: Skill
  readonly signal: AbortSignal
  readonly origin: 'model' | 'user'
  readonly input?: string | undefined
  readonly messages?: readonly unknown[] | undefined
}

/** Result of one invocation; `handled: false` keeps the upstream skill behavior. */
export interface PlatformSkillInvocationResult {
  readonly handled: boolean
  readonly content?: string | undefined
}

/**
 * Platform project bridge. Optional: read it through `ctx.get('platformProjectConfig')`
 * and fall back to the ordinary upstream behavior when it is absent.
 */
export interface PlatformProjectConfigService {
  /** Resolve one Agent scope to its exact project execution realm. */
  resolve<Fs = unknown>(
    agent: ScopeKey,
    signal?: AbortSignal,
    options?: PlatformResolveOptions,
  ): Promise<PlatformProjectContext<Fs>>
  /** Instruction policy of the same realm the project was resolved in. */
  instructionPolicy(
    agent: ScopeKey,
    signal: AbortSignal,
    context: PlatformProjectContext,
  ): Promise<PlatformInstructionPolicy>
  /** Cache discriminator of the exact actor the scope resolves for. */
  skillCacheDiscriminator(scope: ScopeKey, signal?: AbortSignal): Promise<string>
  /** Run an operation in the exact execution actor of an Agent scope. */
  withExecutionActor<T>(
    agent: ScopeKey,
    operation: () => T,
    options?: { readonly messages?: readonly unknown[] | undefined },
  ): T
  /** Build an MCP transport in the Agent's exact subprocess realm; `undefined` declines. */
  createMcpTransport<T>(agent: ScopeKey, config: unknown): T | undefined
}

/**
 * Platform native-skill dispatcher. Optional: read it through
 * `ctx.get('platformSkillInvocation')` and keep the upstream behavior when absent.
 */
export interface PlatformSkillInvocationService {
  invoke<Skill>(request: PlatformSkillInvocationRequest<Skill>): Promise<PlatformSkillInvocationResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Platform project realm bridge; absent in a stock host composition. */
    readonly platformProjectConfig?: PlatformProjectConfigService | undefined
    /** Platform native-skill dispatcher; absent in a stock host composition. */
    readonly platformSkillInvocation?: PlatformSkillInvocationService | undefined
  }
}
