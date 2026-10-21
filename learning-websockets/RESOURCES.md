# WebSockets & Real-time Systems Resources

## Knowledge

### Protocol
- [RFC 6455: The WebSocket Protocol (IETF)](https://www.rfc-editor.org/rfc/rfc6455)
  The spec itself. Use for: the handshake (§1.3, §4), framing (§5.2), masking (§5.3, §10.3), ping/pong (§5.5), close codes (§7.4.1).
- [MDN: The WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  Browser-side API and the "Writing WebSocket servers" guide. Use for: client code, `readyState`, events, `bufferedAmount`.
- [MDN: Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
  Use for: the one-way push alternative when WebSockets are overkill.

### Runtimes & libraries
- [Bun docs: WebSockets](https://bun.com/docs/runtime/http/websockets)
  `Bun.serve` upgrade, handlers, `ws.data`, topics (`subscribe`/`publish`), `send()` backpressure return values, `idleTimeout`, `maxPayloadLength`. Built on uWebSockets. Claims ~7× `ws` throughput.
- [Node.js docs: WebSocket client](https://nodejs.org/en/learn/getting-started/websocket)
  Node has a built-in client (stable since v22.4) but **no built-in server**; use `ws` or socket.io.
- [ws on npm/GitHub](https://github.com/websockets/ws)
  The standard Node WebSocket server library. Use for: `WebSocketServer`, `noServer` + `handleUpgrade`, `bufferedAmount`, ping/pong heartbeat example.
- [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js)
  The C++ engine Bun is built on, usable from Node. Use for: "I need Bun-level throughput but must stay on Node".
- [Socket.IO docs: Using multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/)
  Clear explanation of sticky sessions (only needed for long-polling) and adapters (the cross-node routing layer). Use for: the backplane lesson.

### Production architecture (case studies)
- [Slack Engineering: Real-time Messaging (2023)](https://slack.engineering/real-time-messaging/)
  Gateway servers, channel servers placed by consistent hashing, presence servers, Envoy at the edge, 500 ms global delivery. Use for: the reference architecture of a socket layer.
- [Discord: How Discord Scaled Elixir to 5,000,000 Concurrent Users](https://discord.com/blog/how-discord-scaled-elixir-to-5-000-000-concurrent-users)
  Session process per connection, guild process fans out to sessions. Use for: fan-out and hot rooms (huge guilds).
- [Figma: How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
  One server process per document, WebSocket sync, last-writer-wins per property. Use for: Excalidraw-style collaborative rooms.

### Build-phase sources (lessons 0004–0012)
- [Zod: Basic usage](https://zod.dev/basics) — schemas, `safeParse`. Use for: validating every inbound message (0004).
- [Excalidraw: Building Excalidraw's P2P Collaboration Feature](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature) — relay server, rooms, element versions + versionNonce, E2E encryption. Use for: whiteboard rooms (0005), capstone.
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) — Origin validation, CSWSH. Use for: auth at upgrade (0006).
- [AWS: Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — why full jitter. Use for: reconnect logic (0006).
- [MDN: WebSocket.bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount) — client-side backpressure (0007).
- [Bun docs: Redis client](https://bun.com/docs/runtime/redis) — built-in RedisClient, Pub/Sub (experimental since 1.2.23), `duplicate()`. Use for: backplane (0008).
- [Redis: Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) — at-most-once, ordering, sharded Pub/Sub. [Redis: Lua scripting](https://redis.io/docs/latest/develop/programmability/eval-intro/) — atomic seq + publish. [Redis: client handling](https://redis.io/docs/latest/develop/reference/clients/) — pubsub output-buffer limits (32 MB hard / 8 MB per 60 s soft). Use for: 0008, 0012.
- [nginx: WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) — Upgrade/Connection headers, 60 s read timeout (0008, 0012).
- [Gabriel Gambetta: Fast-Paced Multiplayer](https://www.gabrielgambetta.com/client-server-game-architecture.html) — authoritative server, prediction, interpolation (0009, game track).
- [Wikipedia: Rendezvous hashing](https://en.wikipedia.org/wiki/Rendezvous_hashing) — owner selection (0010).
- [Binance Spot WebSocket Streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md) — diff depth stream, "How to manage a local order book correctly", connection limits (24 h, 5 msg/s, 1024 streams). [Binance WebSocket API](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md) — request id / error format. Use for: 0004, 0011.
- [Coinbase Exchange WebSocket channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels) — level2 `snapshot` + `l2update`. Use for: comparison in 0011.
- [Prometheus exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) and [k6 WebSockets](https://grafana.com/docs/k6/latest/using-k6/protocols/websockets/) — metrics and load testing at scale (0012).

## Wisdom (Communities)

- [r/node](https://www.reddit.com/r/node/) and [Bun Discord](https://bun.com/discord)
  Use for: runtime-specific questions and benchmark sanity checks.
- [r/gamedev](https://www.reddit.com/r/gamedev/) and [r/networking](https://www.reddit.com/r/networking/)
  Use for: tick rates, interest management, netcode questions (metaverse/game use case).
- [r/ExperiencedDevs](https://www.reddit.com/r/ExperiencedDevs/) and [r/systemdesign](https://www.reddit.com/r/systemdesign/)
  Use for: critiques of your socket-layer designs.

## Gaps
- A primary Gather Town engineering source on their spatial server architecture (still not found; lessons 0009–0010 lean on Gambetta, Discord and Figma instead).
