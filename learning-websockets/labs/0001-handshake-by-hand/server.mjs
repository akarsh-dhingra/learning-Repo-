// A WebSocket server with zero libraries: raw TCP + the RFC 6455 handshake + frame parsing.
// Handles only small (<126 byte), unfragmented text frames. That is enough to see the protocol.
// Run: node server.mjs   then: node client.mjs
import net from "node:net";
import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"; // fixed by RFC 6455 §1.3

export function acceptKey(secWebSocketKey) {
  return crypto.createHash("sha1").update(secWebSocketKey + GUID).digest("base64");
}

// Server → client frames are NOT masked.
function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length > 125) throw new Error("demo only handles payloads ≤ 125 bytes");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]); // 0x81 = FIN + opcode 1 (text)
}

// Client → server frames ARE masked; unmask with XOR.
function decodeFrame(buf) {
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  const len = buf[1] & 0x7f;
  const mask = buf.subarray(2, 6);
  const payload = Buffer.from(buf.subarray(6, 6 + len));
  for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
  return { fin, opcode, masked, len, payload };
}

const server = net.createServer((socket) => {
  let upgraded = false;

  socket.on("data", (buf) => {
    if (!upgraded) {
      const request = buf.toString();
      console.log("── HTTP request from client ──\n" + request);
      const key = request.match(/Sec-WebSocket-Key: (.+)\r\n/i)[1].trim();
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
      );
      upgraded = true; // from here on, the same TCP socket speaks frames, not HTTP
      return;
    }

    const f = decodeFrame(buf);
    console.log("── frame bytes ──", buf.subarray(0, 8).toString("hex").match(/../g).join(" "), "…");
    console.log(`FIN=${f.fin} opcode=${f.opcode} MASK=${f.masked} len=${f.len}`);

    if (f.opcode === 0x8) {
      // Close: echo the client's 2-byte status code back, then end TCP (RFC 6455 §5.5.1)
      console.log("close code:", f.payload.readUInt16BE(0));
      socket.end(Buffer.concat([Buffer.from([0x88, f.payload.length]), f.payload]));
      return;
    }
    if (f.opcode === 0x1) {
      const text = f.payload.toString("utf8");
      console.log("text:", text);
      socket.write(encodeTextFrame(text.toUpperCase()));
    }
  });
});

server.listen(8081, () => console.log("raw WebSocket server on ws://localhost:8081"));
