/*
 * Reusable WebSocket frame decoder (RFC 6455 §5.2).
 *
 * Markup:
 *   <div class="framedec" data-hex="81 05 48 65 6c 6c 6f"></div>
 *
 * Renders a textarea of hex bytes, preset buttons, and a live breakdown of
 * FIN / RSV / opcode / MASK / payload length / masking key / unmasked payload.
 */
(function () {
  const OPCODES = {
    0x0: "continuation", 0x1: "text", 0x2: "binary",
    0x8: "close", 0x9: "ping", 0xa: "pong",
  };
  const PRESETS = [
    ["server text 'Hello'", "81 05 48 65 6c 6c 6f"],
    ["client text 'Hello' (masked)", "81 85 37 fa 21 3d 7f 9f 4d 51 58"],
    ["client close 1000 (masked)", "88 82 a6 f1 ad 20 a5 19"],
    ["server ping 'Hi'", "89 02 48 69"],
    ["126 = 16-bit length", "82 7e 01 00"],
  ];

  function parseHex(s) {
    const clean = s.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
    const out = [];
    for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
    return out;
  }

  function decode(b) {
    if (b.length < 2) return { err: "Need at least 2 bytes: every frame has a 2-byte header." };
    const r = {
      fin: (b[0] & 0x80) >> 7,
      rsv: (b[0] & 0x70) >> 4,
      opcode: b[0] & 0x0f,
      mask: (b[1] & 0x80) >> 7,
      len7: b[1] & 0x7f,
    };
    let i = 2;
    r.len = r.len7;
    if (r.len7 === 126) {
      if (b.length < 4) return { ...r, err: "Length 126 means the next 2 bytes hold the real length." };
      r.len = (b[2] << 8) | b[3]; i = 4;
    } else if (r.len7 === 127) {
      if (b.length < 10) return { ...r, err: "Length 127 means the next 8 bytes hold the real length." };
      r.len = 0; for (let k = 2; k < 10; k++) r.len = r.len * 256 + b[k]; i = 10;
    }
    r.headerEnd = i;
    if (r.mask) {
      if (b.length < i + 4) return { ...r, err: "MASK=1, so a 4-byte masking key follows the length." };
      r.key = b.slice(i, i + 4); i += 4;
    }
    const raw = b.slice(i, i + r.len);
    r.payload = r.mask ? raw.map((x, k) => x ^ r.key[k % 4]) : raw;
    r.truncated = raw.length < r.len;
    return r;
  }

  const hex = (arr) => arr.map((x) => x.toString(16).padStart(2, "0")).join(" ");

  function render(el, r) {
    const bitsEl = el.querySelector(".bits");
    const dl = el.querySelector("dl");
    if (r.err && r.fin === undefined) { bitsEl.innerHTML = ""; dl.innerHTML = `<dt>error</dt><dd class="err">${r.err}</dd>`; return; }
    bitsEl.innerHTML =
      `<span class="f">FIN ${r.fin}</span><span>RSV ${r.rsv.toString(2).padStart(3, "0")}</span>` +
      `<span class="f">opcode ${r.opcode.toString(2).padStart(4, "0")}</span>` +
      `<span class="f">MASK ${r.mask}</span><span>len ${r.len7.toString(2).padStart(7, "0")}</span>`;
    const op = OPCODES[r.opcode] ?? "reserved";
    let rows =
      `<dt>FIN</dt><dd>${r.fin ? "1: final fragment of this message" : "0: more fragments follow"}</dd>` +
      `<dt>opcode</dt><dd>0x${r.opcode.toString(16)}: ${op}${r.opcode >= 8 ? " (control frame)" : ""}</dd>` +
      `<dt>MASK</dt><dd>${r.mask ? "1: masked, so this came from a client" : "0: unmasked, so this came from a server"}</dd>` +
      `<dt>length</dt><dd>${r.len} byte${r.len === 1 ? "" : "s"}${r.len7 >= 126 ? ` (7-bit field said ${r.len7}, so read the extended length)` : ""}</dd>`;
    if (r.err) rows += `<dt>error</dt><dd class="err">${r.err}</dd>`;
    else {
      if (r.mask) rows += `<dt>mask key</dt><dd>${hex(r.key)}</dd>`;
      let shown = hex(r.payload);
      if (r.opcode === 0x1 || r.opcode === 0x9 || r.opcode === 0xa) {
        try { shown += ` → "${new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(r.payload))}"`; } catch { shown += " (not valid UTF-8)"; }
      }
      if (r.opcode === 0x8 && r.payload.length >= 2) shown += ` → status code ${(r.payload[0] << 8) | r.payload[1]}`;
      rows += `<dt>payload</dt><dd>${shown || "(empty)"}${r.truncated ? ' <span class="err">(truncated: fewer bytes than length)</span>' : ""}</dd>`;
    }
    dl.innerHTML = rows;
  }

  document.querySelectorAll(".framedec").forEach((el) => {
    el.innerHTML =
      `<div class="presets"></div><textarea spellcheck="false" aria-label="Frame bytes in hex"></textarea>` +
      `<div class="bits" aria-hidden="true"></div><dl></dl>`;
    const ta = el.querySelector("textarea");
    const presets = el.querySelector(".presets");
    PRESETS.forEach(([label, h]) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { ta.value = h; update(); });
      presets.appendChild(b);
    });
    const update = () => render(el, decode(parseHex(ta.value)));
    ta.value = el.dataset.hex || PRESETS[0][1];
    ta.addEventListener("input", update);
    update();
  });
})();
