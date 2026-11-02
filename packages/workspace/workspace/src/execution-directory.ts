/** Optional directory identity bridge for configured execution workspaces. */
import type { Context } from '@deepseek-ai/cordis'
import { posix, win32 } from 'node:path'

/** A managed root's canonical executor spelling and current availability. */
export interface ExecutionWorkspaceDirectory {
  readonly path: string
  readonly status: 'ok' | 'missing-dir'
}

/** Optional platform service; undefined means that the path is unmanaged. */
export interface ExecutionWorkspaceDirectoryBridge {
  resolveWorkspaceDirectory(path: string): Promise<ExecutionWorkspaceDirectory | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformExecution: ExecutionWorkspaceDirectoryBridge
  }
}

/**
 * Resolve a configured root without falling back after a managed failure.
 * @param ctx - current native registry/controller context.
 * @param path - requested original workspace root.
 * @returns undefined for unmanaged paths, otherwise a validated executor identity.
 */
export async function platformExecutionWorkspaceDirectory(ctx: Context, path: string): Promise<ExecutionWorkspaceDirectory | undefined> {
  const execution = ctx.get('platformExecution')
  if (typeof execution?.resolveWorkspaceDirectory !== 'function') return undefined
  const result = await execution.resolveWorkspaceDirectory(path)
  if (result === undefined) return undefined
  if (!result || typeof result.path !== 'string') throw new Error('Invalid configured execution workspace resolution')
  const api = result.path.startsWith('/') ? posix : win32
  const fullyQualified = api === posix || /^[a-z]:/i.test(result.path) || result.path.startsWith('\\\\')
  if (!fullyQualified || !api.isAbsolute(result.path) || result.path === api.parse(result.path).root
    || result.path.includes('\0') || api.normalize(result.path) !== result.path
    || !['ok', 'missing-dir'].includes(result.status)) {
    throw new Error('Invalid configured execution workspace resolution')
  }
  return result
}
