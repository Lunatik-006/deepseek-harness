/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { timingSafeEqual } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PeerId, PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionInteractions } from './connect-protocol.ts'
import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge } from './http-bridge.ts'
import { isRemoteAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type { BrowserAuth } from './browser-auth.ts'
import { Peer } from './peer.ts'
import type {
  ConnectionBrowserAdmission,
  NativeDesktopLocalOwnerProvider,
  NativeDesktopOwnerProof,
  NativeRegisteredActorCredential,
  NativeActorApiCredential,
  NativeApiCredentialSeed,
  NativeDesktopBootInjection,
  PeerAdmission,
  ConnectionAdmission,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface PeerRecord {
  readonly peer: PeerScope
  readonly platformActor?: true
  readonly sharedBrowser?: true
  ownsSocket: boolean
}

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: ConnectionFetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
    desktopTransportCapability: DesktopTransportCapability
  }
}

/** Root-owned per-launch state retained while the Connection plugin reloads. */
class DesktopTransportCapability extends Service {
  readonly secret: string | undefined
  browserAdmissionRequired = false
  constructor(ctx: Context) {
    super(ctx, 'desktopTransportCapability')
    this.secret = process.env.DSH_DESKTOP_LOCAL_SECRET
    delete process.env.DSH_DESKTOP_LOCAL_SECRET
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  /** The Peer every authenticated browser connection shares. */
  readonly browserPeer: PeerScope
  private readonly peers = new Map<PeerId, PeerRecord>()
  private readonly owner: Context
  private disposed = false
  private readonly desktopCapability: DesktopTransportCapability
  private readonly desktopLocalSecret: string | undefined
  private desktopLocalOwner: { readonly provider: NativeDesktopLocalOwnerProvider; readonly secret: string } | undefined
  private desktopLocalOwnerRequired = false
  private browserAdmission: ConnectionBrowserAdmission | undefined
  private browserAdmissionRequired: boolean
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()

  readonly allowsRemoteAuthorities: boolean

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
  ) {
    super(ctx, 'connection')
    this.owner = ctx
    this.desktopCapability = ctx.root.get('desktopTransportCapability') ?? new DesktopTransportCapability(ctx.root)
    this.desktopLocalSecret = this.desktopCapability.secret
    this.browserAdmissionRequired = this.desktopCapability.browserAdmissionRequired
    this.browserPeer = new Peer(ctx, { principal: { kind: 'owner' } })
    ctx.effect(() => async () => {
      this.disposed = true
      const peers = [this.browserPeer, ...Array.from(this.peers.values(), record => record.peer)]
      this.peers.clear()
      await Promise.all(peers.map(peer => peer.dispose()))
    }, 'client-connection: Peer scopes')
    this.allowsRemoteAuthorities = trustedHosts.some(isRemoteAuthority)
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /** Apply the Host/Origin fence and require an authenticated live Peer. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    const admission = this.admit(request)
    return 'rejection' in admission ? admission.rejection : undefined
  }

  /** Browser requests share an owner Peer; API HTTP does not depend on an attached socket. */
  admit(request: ConnectionTrustRequest): PeerAdmission {
    const actor = this.verifyRegisteredActorCredential(request)
    if (actor) return { peer: actor.peer }
    const local = this.verifyDesktopLocalOwner(request)
    if (local?.kind === 'api' && local.peerId !== undefined) {
      const record = this.peers.get(local.peerId)
      if (record) return { peer: record.peer }
    }
    if (this.browserAdmission) return this.browserAdmission.admit(request)
    if (this.browserAdmissionRequired || this.desktopLocalOwnerRequired) return { rejection: 403 }
    if (!this.isTrusted(request)) return { rejection: 403 }
    if (this.disposed) return { rejection: 401 }
    const secure = this.owner.get('webServer')?.protocol === 'https:'
    if (this.browserAuth.isAuthenticated(request, secure)) return { peer: this.browserPeer }
    const id = this.browserAuth.authenticateApi(request, secure)
    const record = id === undefined ? undefined : this.peers.get(id)
    return record === undefined ? { rejection: 401 } : { peer: record.peer }
  }

  /** Register one exclusive browser identity provider owned by its installation. */
  registerBrowserAdmission(provider: ConnectionBrowserAdmission): () => void {
    if (this.browserAdmission) throw new Error('browser admission already registered')
    this.browserAdmissionRequired = true
    this.desktopCapability.browserAdmissionRequired = true
    this.browserAdmission = provider
    return () => { if (this.browserAdmission === provider) this.browserAdmission = undefined }
  }

  /** Register the operator's optional mapping from native Desktop proof to one human. */
  registerDesktopLocalOwner(provider: NativeDesktopLocalOwnerProvider): () => void {
    if (process.platform !== 'win32' || this.desktopLocalOwner) throw new Error('Desktop local admission is unavailable or already registered')
    const secret = this.desktopLocalSecret
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Desktop main transport proof is missing')
    if (typeof provider.principal !== 'function' || typeof provider.accepts !== 'function' || typeof provider.acceptsPeer !== 'function' || typeof provider.createApiPeer !== 'function') throw new Error('Invalid Desktop local admission provider')
    const principal = provider.principal()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
    if (principal.kind === 'owner' || !provider.accepts(principal)) throw new Error('Desktop owner must map to a configured non-owner principal')
    const registration = { provider, secret }
    this.desktopLocalOwner = registration
    this.desktopLocalOwnerRequired = true
    return () => { if (this.desktopLocalOwner === registration) this.desktopLocalOwner = undefined }
  }
  private isDesktopLocalTransport(request: ConnectionTrustRequest): boolean {
    const registration = this.desktopLocalOwner
    if (!registration || this.disposed || process.platform !== 'win32') return false
    const socket = request.socket
    const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
    const remote = socket?.remoteAddress
    const local = socket?.localAddress
    if (!socket || remote === undefined || local === undefined || !loopback.has(remote) || !loopback.has(local)
      || !Number.isInteger(socket.localPort)) return false
    const read = (name: string): string | undefined => request.headers instanceof Headers
      ? request.headers.get(name) ?? undefined
      : typeof request.headers[name] === 'string' ? request.headers[name] : undefined
    const names = request.headers instanceof Headers ? [...request.headers.keys()] : Object.keys(request.headers)
    const forwarded = /^(?:forwarded|via|x-real-ip|x-original-host|x-original-url|x-dsh-pocket)$/i
    const proxied = /^(?:x-forwarded-|tailscale-|cf-)/i
    if (names.some(name => forwarded.test(name) || proxied.test(name))) return false
    if (!this.isTrusted(request)) return false
    const actual = read('x-dsh-desktop-owner')
    if (typeof actual !== 'string') return false
    const supplied = Buffer.from(actual)
    const expected = Buffer.from(registration.secret)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
    try {
      const protocol = this.owner.get('webServer')?.protocol === 'https:' ? 'https:' : 'http:'
      const authority = new URL(`${protocol}//${read('host') ?? ''}`)
      const hosts = ['127.0.0.1', 'localhost', '[::1]']
      if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash
        || !hosts.includes(authority.hostname)) return false
      return Number(authority.port || (protocol === 'https:' ? '443' : '80')) === socket.localPort
    } catch { return false }
  }
  /** Verify main transport and the existing signed, audience-bound native cookie. */
  verifyDesktopLocalOwner(request: ConnectionTrustRequest): NativeDesktopOwnerProof | undefined {
    if (!this.isDesktopLocalTransport(request)) return undefined
    const secure = this.owner.get('webServer')?.protocol === 'https:'
    const credential = this.browserAuth.desktopOwnerCredential(request, secure)
    const registration = this.desktopLocalOwner
    if (!credential || !registration) return undefined
    try {
      const principal = registration.provider.principal()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
      if (principal.kind === 'owner' || !registration.provider.accepts(principal)) return undefined
      if (credential.version === 2) {
        const record = this.peers.get(credential.id)
        if (!record || record.peer.signal.aborted || !registration.provider.acceptsPeer(record.peer)) return undefined
      }
      const loginId = `native-desktop:${credential.authority}`
      return Object.freeze({
        kind: credential.version === 2 ? 'api' : 'browser',
        authority: credential.authority,
        expiresAt: credential.expiresAt,
        loginId: credential.version === 2 ? `${loginId}:${credential.id}` : loginId,
        ...(credential.version === 2 ? { peerId: credential.id } : {}),
      })
    } catch { return undefined }
  }
  /** Accept only live version-2 records owned by the registered provider. */
  verifyRegisteredActorCredential(request: ConnectionTrustRequest): NativeRegisteredActorCredential | undefined {
    if (this.disposed || !this.isTrusted(request)) return undefined
    const secure = this.owner.get('webServer')?.protocol === 'https:'
    const credential = this.browserAuth.registeredActorCredential(request, secure)
    if (!credential) return undefined
    const record = this.peers.get(credential.id)
    if (!record?.platformActor || record.peer.signal.aborted) return undefined
    try {
      if (this.browserAdmission?.acceptsPeer?.(record.peer) !== true) return undefined
      return { peer: record.peer, cookie: credential.cookie, expiresAt: credential.expiresAt, sharedBrowser: record.sharedBrowser === true }
    } catch { return undefined }
  }
  /** Issue the existing version-2 cookie for a provider-owned human Peer. */
  createActorApiCredential(peer: PeerScope): NativeActorApiCredential {
    if (this.disposed || peer.signal.aborted) throw new Error('A live human API Peer is required')
    if (this.browserAdmission?.acceptsPeer?.(peer) !== true) throw new Error('The API Peer is not owned by the registered admission provider')
    const server = this.owner.get('webServer')
    const port = server?.port
    if (server === undefined || port === undefined || !Number.isInteger(port) || port <= 0) throw new Error('Native application listener is unavailable')
    const existing = this.peers.get(peer.id)
    if (existing && existing.peer !== peer) throw new Error('Native API Peer identity collision')
    if (!existing) {
      this.peers.set(peer.id, { peer, ownsSocket: false, platformActor: true, sharedBrowser: true })
      peer.signal.addEventListener('abort', () => { if (this.peers.get(peer.id)?.peer === peer) this.peers.delete(peer.id) }, { once: true })
    }
    return this.browserAuth.issueActorApiCredential(`127.0.0.1:${port}`, peer.id, server.protocol === 'https:')
  }
  private publishDesktopLocalPeer(interactions: ConnectionInteractions, credential: NativeApiCredentialSeed): PeerId {
    if (!this.desktopLocalOwner || !Number.isFinite(credential.expiresAt)) throw new Error('Desktop native credential is required')
    const peer = this.desktopLocalOwner.provider.createApiPeer({ ...credential, interactions })
    if (peer.signal.aborted || !this.desktopLocalOwner.provider.acceptsPeer(peer)) throw new Error('Desktop API principal is invalid')
    this.peers.set(peer.id, { peer, ownsSocket: false, platformActor: true })
    peer.signal.addEventListener('abort', () => { if (this.peers.get(peer.id)?.peer === peer) this.peers.delete(peer.id) }, { once: true })
    return peer.id
  }

  /** Read actor-specific globals only after proving the actual native Desktop request. */
  async desktopBootstrap(request: ConnectionTrustRequest): Promise<readonly NativeDesktopBootInjection[] | undefined> {
    if (!this.verifyDesktopLocalOwner(request)) return undefined
    return this.desktopLocalOwner?.provider.bootstrap?.()
  }

  /** Derive actor globals for the actual authenticated HTTP carrier. */
  async indexInjections(request: ConnectionTrustRequest): Promise<readonly NativeDesktopBootInjection[] | undefined> {
    if (this.verifyDesktopLocalOwner(request)) {
      const globals = await this.desktopBootstrap(request)
      if (!globals) throw new Error('Native Desktop actor bootstrap is required')
      return globals
    }
    if (this.browserAdmission) {
      const admission = this.admit(request)
      if ('rejection' in admission) throw new Error('Authenticated index Peer is required')
      const globals = await this.browserAdmission.bootstrap?.(request, admission.peer)
      if (!globals) throw new Error('Authenticated index bootstrap is required')
      return globals
    }
    if (this.browserAdmissionRequired || this.desktopLocalOwnerRequired) throw new Error('Index admission is unavailable')
    return undefined
  }

  /** Create one in-process Peer owned by the Context that read this service. */
  createPeer(options: {
    readonly principal: Principal
    readonly actorPrincipal?: Principal
    readonly interactions?: ConnectionInteractions
  }): PeerScope {
    return new Peer(this.ctx, options)
  }

  /** Claim API socket ownership synchronously; callers release on termination or failed upgrade. */
  admitConnection(request: ConnectionTrustRequest): ConnectionAdmission {
    const admission = this.admit(request)
    if ('rejection' in admission) return admission
    const record = this.peers.get(admission.peer.id)
    if (record === undefined) return { ...admission, release: () => Promise.resolve() }
    if (record.sharedBrowser) return { ...admission, release: () => Promise.resolve() }
    if (record.ownsSocket) return { rejection: 409 }
    record.ownsSocket = true
    let released: Promise<void> | undefined
    return {
      peer: record.peer,
      release: () => {
        if (released !== undefined) return released
        this.peers.delete(record.peer.id)
        released = record.peer.dispose()
        return released
      },
    }
  }

  private isTrusted(request: ConnectionTrustRequest): boolean {
    const carrier = this.owner.get('webServer')
    return isTrustedApiRequest(request, this.trustedHosts, carrier?.host, carrier?.protocol ?? 'http:')
  }

  private publishPeer(interactions: ConnectionInteractions): PeerId {
    const peer = new Peer(this.owner, { principal: { kind: 'owner' }, interactions })
    this.peers.set(peer.id, { peer, ownsSocket: false })
    return peer.id
  }

  /**
   * Authenticate and publish a credential before sending the connect redirect.
   * @param request - launch-token request on /connect.
   * @param response - response owned to completion.
   */
  authorizeConnect(request: ConnectionIndexRequest, response: ConnectionIndexResponse): void {
    if (!this.isTrusted(request) || this.disposed) {
      response.writeHead(this.disposed ? 401 : 403)
      response.end(this.disposed ? 'unauthorized' : 'forbidden')
      return
    }
    if (this.browserAdmission || this.browserAdmissionRequired || this.desktopLocalOwnerRequired) {
      if (!this.isDesktopLocalTransport(request)) {
        response.writeHead(403); response.end('native Desktop transport required'); return
      }
      this.browserAuth.authorizeConnect(request, response,
        this.owner.get('webServer')?.protocol === 'https:',
        (interactions, credential) => this.publishDesktopLocalPeer(interactions, credential))
      return
    }
    this.browserAuth.authorizeConnect(request, response,
      this.owner.get('webServer')?.protocol === 'https:', interactions => this.publishPeer(interactions))
  }

  /**
   * Authenticate an index request; native TLS listeners mint Secure cookies.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean {
    if (this.desktopLocalOwner && this.isDesktopLocalTransport(request)) {
      return this.browserAuth.authorizeIndex(request, {
        writeHead: (status, headers) => response.writeHead(status, { ...headers, 'x-dsh-desktop-local': '1' }),
        end: body => response.end(body),
      }, this.owner.get('webServer')?.protocol === 'https:')
    }
    if (this.browserAdmission) return this.browserAdmission.authorizeIndex(request, response)
    if (this.browserAdmissionRequired) { response.writeHead(403); response.end('access unavailable'); return false }
    return this.browserAuth.authorizeIndex(request, response, this.ctx.get('webServer')?.protocol === 'https:')
  }

  /** Add this process's launch token to the clean application URL. */
  authenticatedUrl(baseUrl: string): string {
    return this.browserAuth.authenticatedUrl(baseUrl)
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
  ): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: (request, peer) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) {
          // Exact routes bypass Gateway; the provider must authorize each resource.
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
          if (peer.principal.kind !== 'owner') {
            return Promise.resolve(this.browserAdmission?.authorizeFetch?.(request, peer) ?? false)
              .then(allowed => allowed ? route.fetch(request, peer) : new Response('forbidden', { status: 403 }))
          }
          return route.fetch(request, peer)
        }
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return interceptor.fetchHandler.fetch(request, peer)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      requestBody: route.requestBody,
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        const admission = this.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (this.browserAdmission && this.browserAdmission.authorizeChannel?.(admission.peer, channel) !== true) {
          res.writeHead(403); res.end('channel denied'); return
        }
        await bridge(req, res, fetchHandler, admission.peer)
      },
    }
    return owner.effect(
      () => {
        const server = owner.get('webServer')
        if (!server) throw new Error('client-connection: RPC channel requires an active Web carrier')
        return server.register(route)
      },
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request, peer: PeerScope): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal, peer)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: Awaited<ReturnType<ConnectionRpcHandler>>): Response {
  if (!result.ok) {
    const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
    return Response.json(body)
  }
  const { attachments, ...success } = result
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result: success }
  if (attachments === undefined || attachments.length === 0) return Response.json(body)
  const parts = new FormData()
  const attachmentMetadata = attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    // FileSystem bytes may have SharedArrayBuffer backing, which BlobPart excludes.
    parts.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes' as const, part }
  })
  parts.set('metadata', JSON.stringify({ ...body, attachments: attachmentMetadata }))
  return new Response(parts)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
