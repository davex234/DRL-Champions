/**
 * UPDATE-SERVER — servidor estático local para PROBAR el updater oficial de Tauri sin
 * desplegar nada. Sirve `dist/update/<canal>/` resolviendo el canal por la cabecera
 * `X-DRL-Channel` (igual que el servidor de producción), con soporte de Range (descargas
 * reanudables) y CORS. NO es el servidor de producción: es la réplica para QA local.
 *
 * Uso:  node scripts/update-server.mjs [--port 8787] [--root dist/update]
 * Luego apunta temporalmente el endpoint del updater a http://localhost:8787/latest.json
 * (ver docs/UPDATER.md → "Probar el updater en local").
 */
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync, createReadStream } from "node:fs";
import { join, extname } from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PORT = Number(arg("port", "8787"));
const ROOT = join(process.cwd(), arg("root", "dist/update"));
const CHANNELS = ["stable", "beta", "developer", "nightly"];

const MIME = {
  ".json": "application/json",
  ".exe": "application/octet-stream",
  ".msi": "application/octet-stream",
  ".gz": "application/gzip",
  ".zip": "application/zip",
  ".appimage": "application/octet-stream",
  ".sig": "text/plain",
};

function resolveChannel(req, url) {
  const h = (req.headers["x-drl-channel"] || "").toString();
  if (CHANNELS.includes(h)) return h;
  const q = url.searchParams.get("channel");
  if (q && CHANNELS.includes(q)) return q;
  return "stable";
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Accept-Ranges", "bytes");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // Health-check del launcher (estado de servidores).
  if (url.pathname === "/health") return res.writeHead(200).end("ok");

  const channel = resolveChannel(req, url);
  // /latest.json y /files.json se resuelven dentro del canal; el resto = nombre de artefacto.
  let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (rel === "" || rel === "latest.json") rel = "latest.json";
  const filePath = join(ROOT, channel, rel);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    console.log(`[update-server] 404 ${channel} ${rel}`);
    return res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found", channel, rel }));
  }

  const stat = statSync(filePath);
  const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    console.log(`[update-server] 206 ${channel} ${rel} (${start}-${end})`);
    return createReadStream(filePath, { start, end }).pipe(res);
  }

  res.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size });
  console.log(`[update-server] 200 ${channel} ${rel} (${stat.size} B)`);
  if (rel.endsWith(".json")) return res.end(readFileSync(filePath));
  return createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`[update-server] sirviendo ${ROOT} en http://localhost:${PORT}`);
  console.log(`[update-server] canales: ${CHANNELS.join(", ")} (cabecera X-DRL-Channel o ?channel=)`);
  console.log(`[update-server] manifiesto: http://localhost:${PORT}/latest.json`);
});
