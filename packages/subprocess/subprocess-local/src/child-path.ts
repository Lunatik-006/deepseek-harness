/** Deployment-owned executable directories applied only to local child processes. */

import { delimiter, normalize } from 'node:path'

/**
 * Prepend configured directories after caller overrides, without repeating them.
 * Windows compares PATH keys and directory identities case-insensitively.
 * @param environment - already-scrubbed environment with caller overrides applied.
 * @param directories - absolute deployment directories, in lookup order.
 * @returns an independent environment; neither the caller nor process.env is changed.
 */
export function prependChildPath(environment: Readonly<NodeJS.ProcessEnv>, directories: readonly string[]): NodeJS.ProcessEnv {
  const result = { ...environment }
  if (directories.length === 0) return result
  const key = (value: string): string => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value)
  const prefixes = new Map(directories.map(directory => [key(directory), directory]))
  const pathKeys = Object.keys(result).filter(name => process.platform === 'win32' ? name.toUpperCase() === 'PATH' : name === 'PATH')
  const pathKey = pathKeys[0] ?? 'PATH'
  const path = result[pathKey]
  for (const name of pathKeys) delete result[name]
  const inherited = path === undefined ? [] : path.split(delimiter).filter(directory => !prefixes.has(key(directory)))
  result[pathKey] = [...prefixes.values(), ...inherited].join(delimiter)
  return result
}
