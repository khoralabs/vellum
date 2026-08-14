# Shared-uplink channel fabric

Custodial implementor of `ChannelFabric`: many local DIDs share **one** relay WebSocket per `channelId`.

## Routing

1. Local write → other local endpoints (short-circuit; **no** self-delivery) **and** the shared uplink (so remotes/late joiners see traffic).
2. Uplink inbound that matches a recent local send (relay echo) → **suppressed** (peers already got the short-circuit; avoids double delivery).
3. Other uplink inbound → fan-in to **all** local endpoints.
4. Owned-init filtering for any residual cases stays in `connectObpOverByteChannel` / `filterEchoedInits`.

## Relay sequence (`getRelaySequenceDelta`)

Counts uplink sends + non-echo uplink receives (not local short-circuit-only frames) for control-file `lastBlobId` estimates.

## HostInclusion

Ctor-only (`createSharedUplinkChannelFabric({ inclusion })`). Used in `onSessionReady` to skip default MLS welcome when `isOnHost(peerDid)` is true. **Not** used for relay membership / `ensureAttached`.
