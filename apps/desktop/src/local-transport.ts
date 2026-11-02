/** Per-launch native transport proof, retained only by the Electron main owner. */
import { randomBytes } from 'node:crypto'

const HEADER = 'x-dsh-desktop-owner'
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function globalInjection(value: unknown): value is { readonly kind: 'global'; readonly name: string; readonly value: unknown } {
  return record(value) && value.kind === 'global' && typeof value.name === 'string' && 'value' in value
}

/** Main owns the capability; renderers receive only the authenticated boot projection. */
export class DesktopLocalTransport {
  private readonly secret = process.platform === 'win32' ? randomBytes(32).toString('base64url') : undefined
  private active = false

  /** Environment contribution for the owned backend child, never for model tools. */
  get environment(): NodeJS.ProcessEnv {
    return this.secret ? { DSH_DESKTOP_LOCAL_SECRET: this.secret } : {}
  }

  /** Private headers for an already-validated, main-owned native socket. */
  get socketHeaders(): Readonly<Record<string, string>> {
    return this.secret ? { [HEADER]: this.secret } : {}
  }

  /**
   * Add proof only to the owned loopback HTTP transport.
   * @param input - backend URL, never a renderer-controlled remote endpoint.
   * @param init - main-owned Fetch options.
   * @returns copied options with the private header.
   */
  headers(input: string | URL, init: RequestInit = {}): RequestInit {
    const target = new URL(input)
    if (!['http:', 'https:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      throw new Error('Desktop transport proof cannot be sent to a remote endpoint')
    }
    const headers = new Headers(init.headers)
    for (const [name, value] of Object.entries(this.socketHeaders)) headers.set(name, value)
    return { ...init, headers }
  }

  /**
   * Observe the native signed-cookie exchange before deciding whether actor boot is required.
   * @param response - response from the owned backend's launch-token exchange.
   */
  observe(response: Response): void {
    this.active = response.headers.get('x-dsh-desktop-local') === '1'
  }

  /**
   * Merge the registered provider's globals before any renderer receives owner boot data.
   * @param host - owned backend URL.
   * @param cookie - signed native cookie retained by main.
   * @param original - backend's ordinary static injections.
   * @returns provider-specific globals replacing the same names in the static boot.
   */
  async injections(host: string, cookie: string, original: readonly unknown[]): Promise<readonly unknown[]> {
    if (!this.active) return original
    const response = await fetch(new URL('/desktop/bootstrap', host), this.headers(new URL('/desktop/bootstrap', host), {
      redirect: 'error', headers: { cookie },
    }))
    const value: unknown = await response.json()
    if (!response.ok || !Array.isArray(value) || !value.every(globalInjection)) {
      throw new Error('Verified Desktop actor bootstrap is unavailable')
    }
    const names = new Set(value.map(item => item.name))
    return [...original.filter(item => !globalInjection(item) || !names.has(item.name)), ...value]
  }
}
