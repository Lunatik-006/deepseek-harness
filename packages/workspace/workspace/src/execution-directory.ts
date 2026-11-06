/**
 * Optional directory identity bridge for configured execution workspaces.
 *
 * The bridge is a platform service, not a filesystem router: it answers only
 * for the workspace roots the execution layer configured, and a managed
 * answer never falls back to the control host's own filesystem.
 * @module @deepseek-ai/dsh-workspace/src/execution-directory
 */

import type { Context } from '@deepseek-ai/cordis'
import { posix, win32 } from 'node:path'

/** A managed root's canonical executor spelling and current availability. */
export interface ExecutionWorkspaceDirectory {
  /** Canonical absolute directory in the execution world (POSIX or Windows spelling). */
  readonly path: string
  /** Whether the execution world currently sees that directory. */
  readonly status: 'ok' | 'missing-dir'
}

/** A configured root cannot currently be verified; ownership of it is still retained. */
export class ExecutionWorkspaceUnavailableError extends Error {
  /** Stable code consumed by header indexing to keep the session in the pending set. */
  readonly code = 'EXECUTION_WORKSPACE_UNAVAILABLE'

  /**
   * @param path - configured root that could not be verified.
   * @param cause - original provider failure, or the managed availability result.
   */
  constructor(path: string, cause?: unknown) {
    super(`Configured execution workspace is unavailable: ${path}`, { cause })
    this.name = 'ExecutionWorkspaceUnavailableError'
  }
}

/** Optional platform service; an absent service means every path is unmanaged. */
export interface ExecutionWorkspaceDirectoryBridge {
  /**
   * Resolve one requested workspace root.
   * @param path - requested original workspace root.
   * @returns `undefined` for an unmanaged path, otherwise its validated executor identity.
   */
  resolveWorkspaceDirectory(path: string): Promise<ExecutionWorkspaceDirectory | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Configured execution directory bridge, mounted by the platform execution service. */
    platformExecution?: ExecutionWorkspaceDirectoryBridge
  }
}

/** The single validation error message for a malformed managed resolution. */
const INVALID_RESOLUTION = 'Invalid configured execution workspace resolution'

/**
 * Resolve a configured root without falling back after a managed failure.
 * @param ctx - native registry or controller context.
 * @param path - requested original workspace root.
 * @returns `undefined` for an unmanaged path, otherwise the validated managed identity.
 * @throws {ExecutionWorkspaceUnavailableError} when the provider rejects or cannot verify the root.
 * @throws {Error} when a managed answer is malformed.
 */
export async function platformExecutionWorkspaceDirectory(
  ctx: Context,
  path: string,
): Promise<ExecutionWorkspaceDirectory | undefined> {
  const execution = ctx.get('platformExecution')
  if (execution === undefined || typeof execution.resolveWorkspaceDirectory !== 'function') return undefined
  let result: ExecutionWorkspaceDirectory | undefined
  try {
    result = await execution.resolveWorkspaceDirectory(path)
  } catch (cause: unknown) {
    throw new ExecutionWorkspaceUnavailableError(path, cause)
  }
  if (result === undefined) return undefined
  return assertDirectory(result)
}

/**
 * Validate one managed answer: it must be a fully qualified, already-normalized
 * non-root path with a known availability status.
 * @param result - untrusted managed resolution.
 * @returns the same identity, narrowed.
 */
function assertDirectory(result: ExecutionWorkspaceDirectory): ExecutionWorkspaceDirectory {
  const candidate: unknown = result
  if (candidate === null || typeof candidate !== 'object') throw new Error(INVALID_RESOLUTION)
  const path: unknown = (candidate as { path?: unknown }).path
  const status: unknown = (candidate as { status?: unknown }).status
  if (typeof path !== 'string') throw new Error(INVALID_RESOLUTION)
  // The provider owns its spelling: POSIX paths stay POSIX, and a Windows drive
  // or UNC path is validated with the Windows rules even on a POSIX control host.
  const api = path.startsWith('/') ? posix : win32
  const fullyQualified = api === posix || /^[a-z]:/i.test(path) || path.startsWith('\\\\')
  if (!fullyQualified
    || !api.isAbsolute(path)
    || path === api.parse(path).root
    || path.includes('\0')
    || api.normalize(path) !== path
    || (status !== 'ok' && status !== 'missing-dir')) {
    throw new Error(INVALID_RESOLUTION)
  }
  return { path, status }
}
