# Mission: The real-time socket layer (WebSockets, from bytes to production)

## Why
Own the socket layer of real-time products like Gather Town (spatial presence), a crypto exchange (CEX market-data and order updates), a multiplayer/metaverse game, and Excalidraw (collaborative rooms). That means writing the server code with confidence *and* designing how it scales in production.

## Success looks like
- Explain the WebSocket protocol from memory: the HTTP upgrade handshake, frames, masking, ping/pong and close codes, and why it beats polling for these apps
- Pick a runtime with evidence: run a Node (`ws`) vs Bun benchmark, explain the result, and know its limits
- Build a rooms server (Excalidraw-style) with auth at upgrade, heartbeats, reconnect/resume and backpressure handling
- Scale it horizontally: load balancer + pub/sub backplane (Redis) across several nodes, and say where it breaks
- Do fan-out math and interest management for a Gather Town / game-style app, and design snapshot + delta feeds with sequence numbers for a CEX order book
- Give a system-design answer for "design the real-time layer of X" covering connections, fan-out, presence, ordering, failure and ops limits

## Constraints
- Comfortable with Node.js backends, SQL/Mongo and Docker basics; skip beginner backend material
- Node v24 and Bun 1.4 on an Apple M4 laptop; labs must run locally
- Learns by building: every lesson is mostly implementation (build-along + automated checks), with just enough theory to make the design decision. Backend-engineer depth, not protocol-internals depth (refined 2026-10-21, see learning-records/0002)

## Out of scope (for now)
- CRDT/OT algorithms in depth (covered only as far as the socket layer needs them)
- WebRTC media/voice (Gather Town's A/V); only mentioned where it touches signaling
- Managed real-time services (Ably, Pusher) except as a comparison
