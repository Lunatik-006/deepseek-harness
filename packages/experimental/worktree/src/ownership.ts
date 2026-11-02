/** One profile-owned durable store and operation queues for retained worktree services. */
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const recordSchema = z.object({
  sessionId: z.string().min(1), path: z.string().min(1), executionKey: z.string().min(1),
  branch: z.string().nullable(), baseCommit: z.string().min(1), repositoryRoot: z.string().min(1),
}).strict()
const domainSpec = defineDomain({ name: 'native_worktrees', version: 1, tables: { owned: domainTable(recordSchema) } })
/** A Session-owned checkout in one executor's filesystem. */
export type OwnedWorktree = z.infer<typeof recordSchema>

declare module '@deepseek-ai/cordis' {
  interface Context { worktreeOwnership: WorktreeOwnershipService }
}

/** Owns one native domain handle and serializes mutations across retained preset revisions. */
export class WorktreeOwnershipService extends Service {
  static inject = ['storageDomain']
  private readonly lifetime = new AbortController()
  private readonly ready: Promise<Domain<typeof domainSpec>>
  private domain?: Domain<typeof domainSpec>
  private readonly pending = new Set<Promise<unknown>>()
  private readonly sessions = new Map<string, Promise<unknown>>()
  private readonly fetches = new Map<string, Promise<unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'worktreeOwnership')
    this.ready = ctx.storageDomain.open(domainSpec).then(domain => { this.domain = domain; return domain })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('worktree ownership service disposed'))
      await Promise.allSettled(this.pending)
      await (await this.ready).close()
    })
  }

  async [Service.init](): Promise<void> { await this.ready }

  /** Cancellation shared with every scoped operation owned by this profile service. */
  get signal(): AbortSignal { return this.lifetime.signal }

  /** Read a record after the single native domain handle is ready.
   * @param sessionId - durable native Session identity.
   * @returns saved ownership, or undefined when the Session owns no checkout.
   */
  async get(sessionId: string): Promise<OwnedWorktree | undefined> {
    this.signal.throwIfAborted()
    return (await this.ready).table('owned').get(sessionId)
  }

  /** Read already-loaded ownership for synchronous model-context projection.
   * @param sessionId - durable native Session identity.
   * @returns loaded ownership, or undefined before readiness or without a record.
   */
  peek(sessionId: string): OwnedWorktree | undefined { return this.domain?.table('owned').get(sessionId) }

  /** Commit ownership inside serializeSession after successful Git checkout creation.
   * @param record - checkout identity produced by the owning worktree operation.
   */
  async claim(record: OwnedWorktree): Promise<void> {
    this.signal.throwIfAborted()
    const table = (await this.ready).table('owned'), checked = recordSchema.parse(record)
    if (table.get(checked.sessionId)) throw new Error('This Session already owns a worktree')
    await table.put(checked.sessionId, checked)
  }

  /** Release ownership inside serializeSession after safe Git removal and directory publication.
   * @param sessionId - durable native Session identity whose cleanup succeeded.
   */
  async release(sessionId: string): Promise<void> {
    this.signal.throwIfAborted()
    await (await this.ready).table('owned').delete(sessionId)
  }

  /** Serialize a Session's create, restore, or finish across all retained preset revisions.
   * @param sessionId - durable native Session identity.
   * @param action - operation using this owner's cancellation signal.
   * @returns the operation result; a failed predecessor does not block later cleanup.
   */
  serializeSession<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    return this.serialize(this.sessions, sessionId, action)
  }

  /** Serialize fresh fetch plus base pinning for one executor and Git common directory.
   * @param key - executor identity combined with canonical filesystem target identity.
   * @param action - fetch and resolve operation using this owner's cancellation signal.
   * @returns the pinned base produced by this fetch, never a failed predecessor's value.
   */
  serializeFetch<T>(key: string, action: () => Promise<T>): Promise<T> {
    return this.serialize(this.fetches, key, action)
  }

  private async serialize<T>(queues: Map<string, Promise<unknown>>, key: string, action: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    const previous = queues.get(key) ?? Promise.resolve()
    const operation = previous.catch((_error) => { /* A failed predecessor must not poison later cleanup. */ }).then(() => {
      this.signal.throwIfAborted()
      return action()
    })
    queues.set(key, operation)
    this.pending.add(operation)
    try { return await operation } finally {
      this.pending.delete(operation)
      if (queues.get(key) === operation) queues.delete(key)
    }
  }
}

export default WorktreeOwnershipService
