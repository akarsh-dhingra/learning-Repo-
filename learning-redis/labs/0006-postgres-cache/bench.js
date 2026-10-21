// Fires N requests at random ids twice (cold, then warm) and prints server-side
// latency percentiles. Start the server first: npm start
const N = Number(process.argv[2] ?? 200);
const ids = Array.from({ length: N }, () => 1 + Math.floor(Math.random() * 1_000_000));

async function run(label) {
  const times = [];
  const sources = {};
  for (const id of ids) {
    const r = await fetch(`http://localhost:3000/products/${id}`).then((x) => x.json());
    times.push(r.ms);
    sources[r.source] = (sources[r.source] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  console.log(`${label.padEnd(5)} p50=${p(0.5)}ms  p95=${p(0.95)}ms  p99=${p(0.99)}ms  sources=${JSON.stringify(sources)}`);
}

await run("cold");
await run("warm");
