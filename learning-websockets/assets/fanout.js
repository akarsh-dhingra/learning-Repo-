/*
 * Reusable fan-out calculator: how many messages a room-based socket layer must deliver.
 *
 * Markup:
 *   <div class="fanout" data-users="50" data-rate="10" data-bytes="100" data-visible="100"></div>
 *
 * Inbound  = users × rate
 * Outbound = inbound × recipients, where recipients = users × visible% (sender included)
 */
(function () {
  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + " B" : n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? (n / 1e3).toFixed(1) + " k" : Math.round(n).toString();
  const bw = (bps) => { const bits = bps * 8; return bits >= 1e9 ? (bits / 1e9).toFixed(2) + " Gbit/s" : (bits / 1e6).toFixed(1) + " Mbit/s"; };

  document.querySelectorAll(".fanout").forEach((el) => {
    const d = el.dataset;
    const fields = [
      ["users", "Users in the room", 2, 2000, +d.users || 50],
      ["rate", "Msgs/sec per user", 1, 60, +d.rate || 10],
      ["bytes", "Bytes per message", 20, 2000, +d.bytes || 100],
      ["visible", "% of room each user sees", 1, 100, +d.visible || 100],
    ];
    el.innerHTML = fields.map(([k, label, min, max, v]) =>
      `<label><span>${label}</span><input type="range" name="${k}" min="${min}" max="${max}" value="${v}"><output></output></label>`
    ).join("") + `<div class="result" aria-live="polite"></div>`;

    const update = () => {
      const v = {};
      el.querySelectorAll("input").forEach((i) => { v[i.name] = +i.value; i.nextElementSibling.textContent = i.value + (i.name === "visible" ? "%" : ""); });
      const inbound = v.users * v.rate;
      const recipients = Math.max(1, Math.round(v.users * v.visible / 100));
      const outbound = inbound * recipients;
      el.querySelector(".result").innerHTML =
        `inbound  = ${v.users} × ${v.rate} = <b>${fmt(inbound)} msg/s</b><br>` +
        `each message goes to ≈ ${recipients} sockets<br>` +
        `outbound = ${fmt(inbound)} × ${recipients} = <b>${fmt(outbound)} msg/s</b><br>` +
        `egress   ≈ <b>${bw(outbound * v.bytes)}</b> (payload only)`;
    };
    el.addEventListener("input", update);
    update();
  });
})();
