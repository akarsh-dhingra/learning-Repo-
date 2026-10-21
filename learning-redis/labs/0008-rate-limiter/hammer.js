// Usage: node hammer.js [fixed|sliding] [requests] [userId]
const [route = "fixed", n = "15", user = "alice"] = process.argv.slice(2);

const line = [];
for (let i = 1; i <= Number(n); i++) {
  const r = await fetch(`http://localhost:3000/${route}`, { headers: { "x-user-id": user } });
  line.push(r.status === 200 ? "200" : `429(${r.headers.get("retry-after")}s)`);
}
console.log(`${route} as ${user}: ${line.join(" ")}`);
