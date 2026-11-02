import {posix,win32} from 'node:path'

/** Process-path dialect only; display URIs are resolved by the filesystem provider. */
function api(path:string) {return /^[A-Za-z]:[\\/]|^\\\\/.test(path)?win32:path.startsWith('/')?posix:process.platform==='win32'?win32:posix}
export const sep='/'
export const basename=(path:string,suffix?:string):string=>api(path).basename(path,suffix)
export const dirname=(path:string):string=>api(path).dirname(path)
export const isAbsolute=(path:string):boolean=>win32.isAbsolute(path)||posix.isAbsolute(path)
export const join=(...paths:string[]):string=>api(paths[0]??process.cwd()).join(...paths)
export const resolve=(...paths:string[]):string=>api(paths.find(path=>/^[A-Za-z]:[\\/]|^\\\\|^\//.test(path))??process.cwd()).resolve(...paths)
export const relative=(from:string,to:string):string=>{const selected=api(from);return selected.relative(from,to).split(selected.sep).join('/')}
