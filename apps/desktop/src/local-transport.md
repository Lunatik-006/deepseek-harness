# Native Desktop admission

`DesktopLocalTransport` belongs to one Electron main invocation. Its capability travels only to the owned backend environment and main-owned loopback HTTP/WebSocket requests. Connection captures it in a root-owned Service, removes the environment entry before agent execution and retains the exclusive-admission requirement across Connection HMR.

The standard token exchange still issues the native signed cookie. An explicitly registered `NativeDesktopLocalOwnerProvider` maps that proof to the installation's configured human. Its bootstrap callback returns ordinary actor-specific global injections, replacing the same names in static boot data before the application renderer starts. The callback must await the installation's actual session-adoption readiness and return its non-owner RemoteAccess baseline. Unregistered installations retain the normal Desktop behavior.

The capability, native cookie, loopback address, forwarding-header exclusion and Host/Origin checks are required together. A request carrying only a cookie or only a header is not native Desktop proof. A reverse proxy uses its own authenticated browser-admission path and cannot acquire the local owner by adding a public header. Optional API cookies use existing version 2, existing HMAC signing and the existing live Peer map; provider withdrawal/revocation does not recreate a Peer.

This change does not create an identity provider, grant model tools a different sandbox policy, change VPN/proxy settings, configure a tunnel or claim VM isolation for a co-located Windows process.
