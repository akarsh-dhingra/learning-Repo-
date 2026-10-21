/*
 * Reusable Redis Cluster hash-slot calculator.
 * Implements HASH_SLOT = CRC16(key) mod 16384 with the hash-tag rule from
 * https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
 *
 * Markup:  <div class="slotcalc" data-keys="user:42,{user:42}.cart"></div>
 * Renders one input per comma-separated starter key, showing slot + owning node
 * for an example 3-master split (A: 0–5460, B: 5461–10922, C: 10923–16383).
 * Also exports window.redisHashSlot(key) for other components.
 */
(function () {
  // CRC16-CCITT (XMODEM): poly 0x1021, init 0x0000, as used by Redis Cluster.
  function crc16(bytes) {
    let crc = 0;
    for (const b of bytes) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  function hashedPart(key) {
    const s = key.indexOf("{");
    if (s === -1) return key;
    const e = key.indexOf("}", s + 1);
    if (e === -1 || e === s + 1) return key; // no "}" or empty "{}" → hash whole key
    return key.slice(s + 1, e);
  }

  function hashSlot(key) {
    return crc16(new TextEncoder().encode(hashedPart(key))) % 16384;
  }

  const NODES = [
    { name: "A", from: 0, to: 5460 },
    { name: "B", from: 5461, to: 10922 },
    { name: "C", from: 10923, to: 16383 },
  ];
  const nodeFor = (slot) => NODES.find((n) => slot >= n.from && slot <= n.to).name;

  if (typeof window !== "undefined") window.redisHashSlot = hashSlot;
  if (typeof module !== "undefined") module.exports = { hashSlot, crc16, hashedPart };
  if (typeof document === "undefined") return;

  document.querySelectorAll(".slotcalc").forEach((root) => {
    const starters = (root.dataset.keys || "user:42").split(",");
    root.innerHTML = "";
    for (const k of starters) {
      const row = document.createElement("div");
      row.className = "slotrow";
      const input = document.createElement("input");
      input.value = k;
      input.spellcheck = false;
      input.setAttribute("aria-label", "Redis key");
      const out = document.createElement("output");
      const render = () => {
        const key = input.value;
        const part = hashedPart(key);
        const slot = hashSlot(key);
        out.innerHTML = `hashes <code>${part.replace(/</g, "&lt;")}</code> → slot <strong>${slot}</strong> → node <strong>${nodeFor(slot)}</strong>`;
      };
      input.addEventListener("input", render);
      render();
      row.append(input, out);
      root.appendChild(row);
    }
  });
})();
