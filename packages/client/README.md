# `@khoralabs/vellum-client`

Library API used by **`apps/vellum/cli`**: load agent identity, talk to the relay server (`RelayClient` from `@khoralabs/relay/client`), call the local **Vellum daemon** control plane over `@khoralabs/vellum-transport`, and read NBC graph state from channel-scoped SQLite (`SqliteVellumReadModel` / `VellumReadModel`).
