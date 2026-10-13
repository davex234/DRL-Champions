// F67 · arranque en frío medido: lanza `next start` (proceso nuevo), mide hasta /api/health 200, /api/ready y la portada.
import { spawn } from "node:child_process";
import { openSync, writeFileSync, mkdirSync } from "node:fs";
const log = process.argv[2]; const errlog = process.argv[3];
const t0 = Date.now();
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3005"], { detached: true, stdio: ["ignore", openSync(log, "a"), openSync(errlog, "a")], windowsHide: true });
child.unref();
const wait = async (url, okFn) => { for (let i = 0; i < 600; i++) { try { const r = await fetch(url); if (okFn(r)) return { ms: Date.now() - t0, status: r.status, body: await r.text() }; } catch { /* aún no escucha */ } await new Promise((z) => setTimeout(z, 100)); } return null; };
const health = await wait("http://127.0.0.1:3005/api/health", (r) => r.status === 200);
const ready = await wait("http://127.0.0.1:3005/api/ready", (r) => r.status === 200 || r.status === 503);
const home = await wait("http://127.0.0.1:3005/", (r) => r.status === 200);
const out = { pid: child.pid, at: new Date().toISOString(), healthMs: health?.ms, readyMs: ready?.ms, readyStatus: ready?.status, ready: ready ? JSON.parse(ready.body) : null, homeMs: home?.ms, homeStatus: home?.status };
mkdirSync("docs/product/qa/fase67-production", { recursive: true });
writeFileSync(process.argv[4] ?? "docs/product/qa/fase67-production/startup.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
