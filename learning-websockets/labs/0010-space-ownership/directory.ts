// The directory (a.k.a. matchmaker / router): a plain HTTP service that tells clients WHICH node owns a space.
// Clients then connect straight to that node. No WebSocket traffic ever flows through the directory.
// Run: PORT=9000 bun directory.ts   (./start-cluster.sh does this for you)
import { liveNodes, ownerOf, onlineIn } from "./cluster";

const PORT = Number(process.env.PORT ?? 9000);
const SPACE_RE = /^[a-z0-9-]{1,40}$/i;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const space = url.searchParams.get("space") ?? "";

    if (url.pathname === "/assign") {
      if (!SPACE_RE.test(space)) return Response.json({ error: "bad space" }, { status: 400 });
      const owner = ownerOf(space, await liveNodes());
      if (!owner) return Response.json({ error: "no live nodes" }, { status: 503 });
      return Response.json({ space, node: owner.id, url: `${owner.url}/?space=${space}` });
    }

    if (url.pathname === "/nodes") return Response.json(await liveNodes());

    if (url.pathname === "/presence") {
      if (!SPACE_RE.test(space)) return Response.json({ error: "bad space" }, { status: 400 });
      return Response.json({ space, online: await onlineIn(space) });
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

console.log(`directory on http://localhost:${server.port}  (open /?space=office)`);
