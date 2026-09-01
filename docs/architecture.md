# Architecture

TrunkScope separates timing-sensitive RF work from the appliance control plane.

```text
SDR hardware -> radiod -> call/event contract -> control plane -> PostgreSQL/audio
                                                |             -> AI/geocoding jobs
                                                +-> private WS / public delayed HLS
                                                +-> web PWA / Discord / push
```

## Native RF boundary

`radiod` is the only process allowed to open SDR devices. It discovers hardware,
owns streams, channelizes wideband IQ, decodes control channels, allocates voice
channels, demodulates NFM, and reports health. Proven GPL components such as OP25,
GNU Radio, and mbelib sit behind a `DecoderBackend` interface.

The checked-in simulator implements the same event model. Development and CI never
require a receiver; captured IQ fixtures will be added to native integration tests.

## Control plane

The Rust service validates versioned configuration, consumes RF events, persists
calls, applies publication policy, and fans events out to authenticated clients.
Downstream processing is asynchronous. A transcription or geocoder outage must not
interrupt RF capture or recording.

## Policy boundary

All resources are private by default. Public publication is an explicit allowlist
decision evaluated before playlists, API responses, notifications, AI retrieval,
or audio URLs are created. Encrypted calls are metadata-only.

## Storage

PostgreSQL is authoritative for configuration and metadata. Audio uses a storage
adapter: local files initially, S3-compatible object storage optionally. Database
records refer to immutable audio object keys rather than host paths.
