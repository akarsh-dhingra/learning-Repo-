// Uses Node's built-in WebSocket client (stable since v22.4) to talk to our hand-rolled server.
const ws = new WebSocket("ws://localhost:8081");
ws.onopen = () => ws.send("hello from the client");
ws.onmessage = (e) => { console.log("server replied:", e.data); ws.close(1000); };
ws.onclose = (e) => console.log("closed with code", e.code);
