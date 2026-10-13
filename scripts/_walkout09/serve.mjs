/**
 * WALKOUT 0.9 · servidor del laboratorio (instrumento local, fuera de CI): empaqueta `lab.ts` con esbuild y sirve
 * `public/` + la página en 127.0.0.1:3019. Sin Next, sin BD, sin secretos.
 *   node scripts/_walkout09/serve.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "scripts/_walkout09/.out");
fs.mkdirSync(OUT, { recursive: true });
async function bundle() {
  await build({ entryPoints: [path.join(ROOT, "scripts/_walkout09/lab.ts")], bundle: true, format: "esm", outfile: path.join(OUT, "lab.js"), tsconfig: path.join(ROOT, "tsconfig.json"), logLevel: "warning", sourcemap: false });
}
await bundle();
const TYPES = { ".js": "text/javascript", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".webp": "image/webp", ".png": "image/png", ".html": "text/html" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" ) { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><meta charset=utf-8><body><script type=module src="/lab.js?${Date.now()}"></script>`); return; }
  if (u.pathname === "/rebuild") { try { await bundle(); res.end("ok"); } catch (e) { res.writeHead(500); res.end(String(e)); } return; }
  const LAB = process.env.LAB_ASSET_DIR;   // asset de laboratorio (clips candidatos) en /lab-asset/
  const file = u.pathname === "/lab.js" ? path.join(OUT, "lab.js") : LAB && u.pathname.startsWith("/lab-asset/") ? path.join(LAB, path.basename(u.pathname)) : path.join(ROOT, "public", decodeURIComponent(u.pathname));
  if ((!file.startsWith(ROOT) && !(LAB && file.startsWith(LAB))) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(3019, "127.0.0.1", () => console.log("lab en http://127.0.0.1:3019"));
