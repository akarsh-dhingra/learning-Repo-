// A local order book kept in sync from snapshot + diffs — the algorithm exchanges document
// (Binance: "How to manage a local order book correctly"). Runs in the browser AND in tests.
//
//   const book = new LocalBook({ fetchSnapshot: () => fetch("/depth?symbol=BTC-USD").then(r => r.json()) });
//   socket.on("depth", (diff) => book.onDiff(diff));   // start feeding diffs FIRST…
//   book.sync();                                        // …then fetch the snapshot
export class LocalBook {
  constructor({ fetchSnapshot, onChange = () => {} }) {
    this.fetchSnapshot = fetchSnapshot;
    this.onChange = onChange;
    this.bids = new Map(); // price string → qty string
    this.asks = new Map();
    this.lastUpdateId = 0;
    this.synced = false;
    this.buffer = [];
    this.stats = { applied: 0, ignored: 0, gaps: 0, syncs: 0 };
  }

  onDiff(diff) {
    if (!this.synced) { this.buffer.push(diff); return; }        // still syncing: keep everything
    if (diff.u <= this.lastUpdateId) { this.stats.ignored++; return; } // old news
    if (diff.U > this.lastUpdateId + 1) {                         // we missed something: the book is now WRONG
      this.stats.gaps++;
      this.synced = false;
      this.buffer = [diff];
      this.sync();
      return;
    }
    this.apply(diff);
  }

  async sync() {
    this.synced = false;
    this.stats.syncs++;
    for (;;) {
      const snap = await this.fetchSnapshot();
      const firstU = this.buffer[0]?.U;
      // Snapshot older than the first diff we buffered? There's a hole between them: fetch again.
      if (firstU !== undefined && snap.lastUpdateId < firstU - 1) { await new Promise((r) => setTimeout(r, 50)); continue; }
      this.bids = new Map(snap.bids);
      this.asks = new Map(snap.asks);
      this.lastUpdateId = snap.lastUpdateId;
      const pending = this.buffer.filter((d) => d.u > snap.lastUpdateId); // drop what the snapshot already contains
      this.buffer = [];
      this.synced = true;
      for (const d of pending) this.onDiff(d);
      this.onChange(this);
      return;
    }
  }

  apply(diff) {
    for (const [p, q] of diff.b) Number(q) === 0 ? this.bids.delete(p) : this.bids.set(p, q);
    for (const [p, q] of diff.a) Number(q) === 0 ? this.asks.delete(p) : this.asks.set(p, q);
    this.lastUpdateId = diff.u;
    this.stats.applied++;
    this.onChange(this);
  }

  top(n = 10) {
    const sort = (m, desc) => [...m].sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0])).slice(0, n);
    return { bids: sort(this.bids, true), asks: sort(this.asks, false) };
  }
}
