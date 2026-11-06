/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PeerId, PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'

/** Correlation id minted by a caller and echoed by the Connection response. */
export type RpcId = Branded<'rpc-id'>

/**
 * Brand one validated string as a Connection correlation id.
 * @param id - validated wire identity.
 * @returns the same string with the correlation-id brand.
 */
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** Carrier-neutral failure returned by one logical RPC endpoint. */
export interface ConnectionRpcFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** Carrier-neutral result returned by one logical RPC endpoint. */
export type ConnectionRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConnectionRpcFailure }

/** One binary value separated from a successful RPC result before transport framing. */
export interface ConnectionRpcAttachment {
  /** Result-relative path occupied by the attachment's `null` placeholder. */
  readonly path: readonly (string | number)[]
  /** Byte view carried outside the JSON response metadata. */
  readonly bytes: Uint8Array
}

/** Successful or failed handler result ready for Connection transport framing. */
export type ConnectionRpcHandlerResult =
  | {
    readonly ok: true
    readonly value: unknown
    /** Binary fields already projected by the handler that owns the result protocol. */
    readonly attachments?: readonly ConnectionRpcAttachment[]
  }
  | { readonly ok: false; readonly error: ConnectionRpcFailure }

/** Historical short name for a generic Connection result. */
export type RpcResult<T> = ConnectionRpcResult<T>

/**
 * Convert a rejected transport operation into a generic failure result.
 * @param error - rejected transport value.
 * @returns an `internal` failure preserving the available message.
 */
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'gateway/internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

/** Narrow request form used by direct fixture adapters. */
export interface RpcRequest<P> {
  readonly rpcId: RpcId
  readonly payload: P
}

/** Narrow response form used by direct fixture adapters. */
export interface RpcResponse<T> {
  readonly rpcId: RpcId
  readonly result: RpcResult<T>
}

/** Full request envelope carried by Connection RPC transports. */
export interface ClientRequest {
  readonly type: 'client-request'
  readonly rpcId: RpcId
  readonly method: string
  readonly payload: unknown
}

/** Full response envelope carried by Connection RPC transports. */
export interface ServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcId
  readonly result: ConnectionRpcResult<unknown>
}

/** Complete Connection RPC envelope union. */
export type RpcMessage = ClientRequest | ServerResponse

/** HTTP request facts consumed by browser trust and authentication. */
export interface ConnectionTrustRequest {
  /** Physical carrier supplies this; HTTP headers do not supply socket facts. */
  readonly socket?: NativeLoopbackSocketFacts
  /** Request headers supplied by either the Fetch or node:http representation. */
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
}

/** HTTP status returned before dispatch, or undefined when the request may proceed. */
export type ConnectionRequestRejection = 401 | 403 | undefined

/** Root/index request facts used by the browser-token exchange. */
export interface ConnectionIndexRequest extends ConnectionTrustRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
}

/** Root/index response operations owned by the browser-token exchange. */
export interface ConnectionIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** Outcome of admitting one request: the Peer it speaks for, or the status refusing it. */
export type PeerAdmission =
  | { readonly peer: PeerScope }
  | { readonly rejection: 401 | 403 }

/** Socket admission claims API ownership until its carrier calls release, including failed upgrades. */
export type ConnectionAdmission =
  | {
    readonly peer: PeerScope
    /** Remove and dispose an API Peer; browser releases leave the shared browser Peer intact. */
    readonly release: () => Promise<void>
  }
  | { readonly rejection: 401 | 403 | 409 }

/**
 * Handler invoked after Connection has decoded the transport envelope.
 * `peer` is the Peer the carrier admitted or the in-process caller supplied.
 */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: PeerScope,
) => Promise<ConnectionRpcHandlerResult>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** HTTP methods supported by exact Fetch routes on the shared API channel. */
export type ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'

/** How the node:http bridge presents one request body to its Fetch route. */
export type ConnectionRequestBodyMode = 'buffered' | 'streaming'

/** One exact, transport-independent Fetch route owned by a Host feature. */
export interface ConnectionFetchRoute {
  /** Absolute path below `/api`; query parameters remain available on the request URL. */
  readonly path: string
  /** Methods this route owns. Other methods continue through normal shared-channel dispatch. */
  readonly methods: readonly ConnectionFetchMethod[]
  /** Buffered requests obey the configured JSON cap; streaming requests arrive with backpressure and no aggregate cap. */
  readonly requestBody: ConnectionRequestBodyMode
  /**
   * Handle one request after the physical carrier has applied its trust and
   * authentication policy. Non-owner Peers additionally require the registered
   * provider's resource authorization for this exact request.
   */
  readonly fetch: (request: Request, peer: PeerScope) => Promise<Response>
}

/** Host registry for exact Fetch routes that cannot use JSON Remote invocation. */
export interface HostConnectionFetch {
  /**
   * Register one exact route on the shared API channel.
   * @param route - path, methods, and Fetch-shaped implementation.
   * @returns asynchronous disposer removing this exact contribution.
   */
  register(route: ConnectionFetchRoute): () => Promise<void>
}

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one authenticated absolute channel prefix.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void>
}

/** Host `ctx.connection` members consumed by transport-independent adapters. */
export interface HostConnectionHandle extends NativeDesktopLocalAdmission {
  /**
   * Register the deployment's sole authenticated browser admission provider.
   * @param provider - the installation's carrier-admission policy.
   * @returns disposer withdrawing the provider.
   */
  registerBrowserAdmission(provider: ConnectionBrowserAdmission): () => void
  /**
   * Resolve per-request globals after authenticating the actual carrier request.
   * @param request - the candidate index carrier.
   * @returns the admitted actor's boot globals, or undefined when no admission is required.
   */
  indexInjections(request: ConnectionTrustRequest): Promise<readonly NativeDesktopBootInjection[] | undefined>
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc
  /** Exact Fetch routes for streaming or browser-native responses. */
  readonly fetch: HostConnectionFetch
  /** The owner Peer every authenticated browser connection shares. */
  readonly browserPeer: PeerScope

  /**
   * Whether this deployment accepts authorities beyond loopback: true only
   * when a validated `trustedHosts` entry names a non-loopback hostname.
   */
  readonly allowsRemoteAuthorities: boolean

  /**
   * Compose exact Fetch routes and the shared-channel RPC interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler for trusted, authenticated requests.
   */
  createSharedFetchHandler(channel: '/api'): ConnectionFetchHandler

  /**
   * Apply Connection's Host/Origin checks and browser authentication to
   * another Web route.
   * @param request - request headers from the HTTP or upgrade request.
   * @returns rejection status, or undefined when the route may accept the request.
   */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection

  /**
   * Admit an HTTP request against its signed browser or API credential and live Peer.
   * @param request - request headers from the HTTP or upgrade request.
   * @returns the credential's Peer, or the rejection status.
   */
  admit(request: ConnectionTrustRequest): PeerAdmission

  /**
   * Create an independent in-process Peer, disposed with the Context that read `ctx.connection`.
   * @param options - fixed principal and optional interaction participation (default `answer`).
   * @returns a new Peer distinct from every other Peer.
   */
  createPeer(options: { readonly principal: Principal; readonly actorPrincipal?: Principal; readonly interactions?: 'answer' | 'none' }): PeerScope

  /**
   * Claim a physical socket for an API Peer; browser sockets share their owner Peer.
   * @param request - authenticated upgrade request headers.
   * @returns the Peer and idempotent release, or 409 for duplicate API ownership.
   * The carrier releases on socket termination or failed upgrade; release removes
   * API admission synchronously without cancelling independent HTTP calls.
   * Provider-owned shared browser records retain their existing Peer lifetime.
   */
  admitConnection(request: ConnectionTrustRequest): ConnectionAdmission

  /**
   * Authenticate one frontend index request, owning a token redirect or 401.
   * The cookie this mints is `Secure` when the mounted Web carrier serves TLS,
   * which only that listener's protocol decides.
   * @param request - root or configured-index HTTP request.
   * @param response - response owned when the result is false.
   * @returns true only when the frontend may serve index.html.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean

  /**
   * Add the fresh process token to an ordinary Web application URL.
   * @param baseUrl - clean application URL whose authority and mount are preserved.
   * @returns tokenized URL for initial login; a mount proxy strips its prefix before {@link authorizeIndex}.
   */
  authenticatedUrl(baseUrl: string): string
}

/** Transport-independent Fetch handler used by HTTP and worker carriers. */
export interface ConnectionFetchHandler {
  /**
   * Resolve body handling before the bridge reads any request bytes.
   * @param request - request method and URL available from node:http headers.
   * @returns the registered route's body handling mode.
   */
  requestBodyMode(request: { readonly method: string; readonly url: URL }): ConnectionRequestBodyMode

  /**
   * Dispatch one already-authenticated request.
   * @param request - Fetch request below the shared channel.
   * @param peer - Peer to dispatch as; required, never defaulted.
   * @returns the registered response, 403 when exact-route resource authorization fails, or 404 when no route owns the request.
   */
  fetch(request: Request, peer: PeerScope): Promise<Response>
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the endpoint-owned success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<ConnectionRpcResult<unknown>>

  /**
   * Open an in-process logical stream when the selected carrier supplies one.
   * Browser transports omit this method; API Gateway owns their WebSocket mux.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `session/follow`.
   * @param payload - channel-owned request payload.
   * @param signal - caller cancellation for this logical stream.
   * @param uplink - Client uplink items the Host method reads through `invocation.uplink()`.
   * @returns decoded stream values from the in-process carrier.
   */
  readonly open?: (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    uplink?: AsyncIterable<unknown>,
  ) => AsyncIterable<unknown>
}

/** Loopback socket facts of the actual carrier; node:http supplies them, never a JSON or HTTP field. */
export interface NativeLoopbackSocketFacts {
  /** Address of the accepted peer. */
  readonly remoteAddress?: string | undefined
  /** Port of the accepted peer. */
  readonly remotePort?: number | undefined
  /** Address of the local listener. */
  readonly localAddress?: string | undefined
  /** Port of the local listener the request reached. */
  readonly localPort?: number | undefined
}
/** Trust request for the native Desktop carrier, with the socket facts only node:http can attest. */
export interface NativeDesktopTrustRequest extends ConnectionTrustRequest {
  /** node:http supplies this; no JSON or HTTP header supplies socket facts. */
  readonly socket?: NativeLoopbackSocketFacts
}
/** Server-owned credential facts bound to one authority before a live Peer credential is issued. */
export interface NativeApiCredentialSeed {
  /** Authority the credential is audience-bound to. */
  readonly authority: string
  /** Absolute expiry instant in epoch milliseconds. */
  readonly expiresAt: number
}
/** Signed cookie set a provider-owned actor Peer authenticates with. */
export interface NativeActorApiCredential {
  /** Cookie header value for the owning main process. */
  readonly cookie: string
  /** Set-Cookie value for the exchange response. */
  readonly setCookie: string
  /** Absolute expiry instant in epoch milliseconds. */
  readonly expiresAt: number
}
/** A live provider-owned actor credential resolved from a request. */
export interface NativeRegisteredActorCredential {
  /** Live Peer the credential speaks for. */
  readonly peer: PeerScope
  /** Cookie header value the request carried. */
  readonly cookie: string
  /** Absolute expiry instant in epoch milliseconds. */
  readonly expiresAt: number
  /** Whether the Peer is the shared browser identity rather than an API socket owner. */
  readonly sharedBrowser: boolean
}
/** Verified native Desktop owner proof returned by {@link NativeDesktopLocalAdmission.verifyDesktopLocalOwner}. */
export type NativeDesktopOwnerProof = NativeApiCredentialSeed & {
  /** Carrier class the proof came from. */
  readonly kind: 'browser' | 'api'
  /** Stable login record id for the auditor. */
  readonly loginId: string
  /** Live API Peer id carried by a version-2 credential. */
  readonly peerId?: PeerId
}
/** Installation-selected mapping from the native Desktop transport to its owner Peer. */
export interface NativeDesktopLocalOwnerProvider {
  /** Trusted server installation chooses the mapped principal, never the request. */
  principal(): Principal
  /** Whether the mapped principal is the one this installation admits. */
  accepts(principal: Principal): boolean
  /** Whether the Peer is one this provider owns; authority is decided by Peer, not a principal string. */
  acceptsPeer(peer: PeerScope): boolean
  /** Create the published API Peer from the same owner authority. */
  createApiPeer(request: NativeApiCredentialSeed & { readonly interactions: 'answer' | 'none' }): PeerScope
  /** Server-owned actor globals, ready before the native renderer starts. */
  bootstrap?(): Promise<readonly NativeDesktopBootInjection[]> | readonly NativeDesktopBootInjection[]
}
/** One ordinary global boot contribution; authentication data never goes here. */
export interface NativeDesktopBootInjection {
  readonly kind: 'global'
  readonly name: string
  readonly value: unknown
}
/** Native Desktop admission surface: prove the owned loopback carrier and publish its actor Peer. */
export interface NativeDesktopLocalAdmission {
  /** Register the installation's sole Desktop owner provider; Windows only, single shot. */
  registerDesktopLocalOwner(provider: NativeDesktopLocalOwnerProvider): () => void
  /** Verify the actual native transport and its signed cookie; returns nothing unless every proof holds. */
  verifyDesktopLocalOwner(request: NativeDesktopTrustRequest): NativeDesktopOwnerProof | undefined
  /** Server-private issuer/validator, intentionally not Remote endpoints. */
  createActorApiCredential(peer: PeerScope): NativeActorApiCredential
  /** Resolve a registered actor credential to its live Peer without reviving anything. */
  verifyRegisteredActorCredential(request: ConnectionTrustRequest): NativeRegisteredActorCredential | undefined
  /** Private native carrier route; absent or invalid proof has no projection. */
  desktopBootstrap(request: ConnectionTrustRequest): Promise<readonly NativeDesktopBootInjection[] | undefined>
}


/** One optional server-owned authentication provider; withdrawal never restores owner admission. */
export interface ConnectionBrowserAdmission {
  admit(request: ConnectionTrustRequest): PeerAdmission
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean
  /** Include the current principal's RemoteAccess baseline and application state. */
  bootstrap?(
    request: ConnectionTrustRequest,
    peer: PeerScope,
  ): Promise<readonly NativeDesktopBootInjection[]> | readonly NativeDesktopBootInjection[]
  /** Accept only the exact live Peer instances owned by this provider. */
  acceptsPeer?(peer: PeerScope): boolean
  /** Authorize an additional RPC channel before decoding its request body. */
  authorizeChannel?(peer: PeerScope, channel: string): boolean
  /** Authorize one native exact Fetch route by its actual request and resource. */
  authorizeFetch?(request: Request, peer: PeerScope): Promise<boolean> | boolean
}
