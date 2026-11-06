import { posix,win32 } from 'node:path'

/** Process-path dialect only; display URIs are resolved by the filesystem provider. */
function api(path:string) {return /^[A-Za-z]:[\\/]|^\\\\/.test(path)?win32:path.startsWith('/')?posix:process.platform==='win32'?win32:posix}
/** Separator normalized display paths use. */
export const sep='/'
/**
 * Dialect-aware `basename`.
 * @param path - process path in either dialect.
 * @param suffix - optional suffix to strip.
 * @returns the final path segment.
 */
export const basename=(path:string,suffix?:string):string=>api(path).basename(path,suffix)
/**
 * Dialect-aware `dirname`.
 * @param path - process path in either dialect.
 * @returns the containing directory.
 */
export const dirname=(path:string):string=>api(path).dirname(path)
/**
 * Whether a path is absolute in either dialect.
 * @param path - candidate process path.
 * @returns true for a drive-letter, UNC or POSIX root.
 */
export const isAbsolute=(path:string):boolean=>win32.isAbsolute(path)||posix.isAbsolute(path)
/**
 * Dialect-aware `join`.
 * @param paths - segments to join.
 * @returns the joined process path.
 */
export const join=(...paths:string[]):string=>api(paths[0]??process.cwd()).join(...paths)
/**
 * Dialect-aware `resolve` against the first absolute operand or the process cwd.
 * @param paths - segments to resolve.
 * @returns the resolved process path.
 */
export const resolve=(...paths:string[]):string=>api(
  paths.find(path=>/^[A-Za-z]:[\\/]|^\\\\|^\//.test(path))??process.cwd(),
).resolve(...paths)
/**
 * Dialect-aware `relative`, normalized to display separators.
 * @param from - base process path.
 * @param to - target process path.
 * @returns the relative display path.
 */
export const relative=(from:string,to:string):string=>{const selected=api(from);return selected.relative(from,to).split(selected.sep).join('/')}
