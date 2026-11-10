/**
 * WALKOUT 0.9 · PROXY DE LA PREVISUALIZACIÓN (instrumento, fuera del release). Escucha en 127.0.0.1:3017 del VPS (solo
 * accesible por túnel SSH) y reenvía al contenedor de QA de la build 0.9 (127.0.0.1:3016, sin BD ni secretos).
 * Lo ÚNICO que añade: el panel de previsualización (`/__preview/controls.js`) en la página del walkout, y `/__preview/info`
 * con el BUILD_ID y la huella del asset que está sirviendo la build. Todo lo demás pasa tal cual (bytes del release).
 * Solo GET/HEAD: cualquier otra petición se rechaza (la previsualización no escribe nada).
 */
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const UP = { host: "127.0.0.1", port: 3016 };
const GATE = process.env.GATE_DIR ?? "/gate";
const HERE = new URL(".", import.meta.url).pathname;
const PAGE = "/design-system/pack-walkout";
const START = `${PAGE}?fx=turkey&i=WALKOUT&cele=POINT_SKY&panel=0&reduced=0&stage=3d`;

const info = () => {
  const gltf = fs.readFileSync(`${GATE}/public/walkout/human/rocketbox-player.gltf`);
  const j = JSON.parse(gltf.toString("utf8"));
  return {
    buildId: fs.readFileSync(`${GATE}/.next/BUILD_ID`, "utf8").trim(),
    asset: crypto.createHash("sha256").update(gltf).digest("hex"),
    bin: crypto.createHash("sha256").update(fs.readFileSync(`${GATE}/public/walkout/human/rocketbox-player.bin`)).digest("hex"),
    clips: j.animations.map((a) => a.name),
  };
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end("solo lectura"); return; }
  if (u.pathname === "/" || u.pathname === "/preview") { res.writeHead(302, { location: START }); res.end(); return; }
  if (u.pathname === "/__preview/controls.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(fs.readFileSync(`${HERE}controls.js`)); return; }
  if (u.pathname === "/__preview/info") { try { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(info())); } catch (e) { res.writeHead(500); res.end(String(e)); } return; }
  const inject = u.pathname === PAGE;
  const headers = { ...req.headers, host: `${UP.host}:${UP.port}` };
  if (inject) delete headers["accept-encoding"];   // el HTML sin comprimir para poder añadir el <script>
  const p = http.request({ ...UP, method: req.method, path: req.url, headers }, (r) => {
    if (!inject || !/text\/html/.test(r.headers["content-type"] ?? "")) { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); return; }
    const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => {
      const html = Buffer.concat(chunks).toString("utf8").replace("</body>", `<script src="/__preview/controls.js" defer></script></body>`);
      const h = { ...r.headers, "cache-control": "no-store" }; delete h["content-length"]; delete h["content-encoding"];
      res.writeHead(r.statusCode ?? 200, h); res.end(html);
    });
  });
  p.on("error", (e) => { res.writeHead(502); res.end("QA 0.9 no responde: " + e.message); });
  req.pipe(p);
}).listen(3017, "127.0.0.1", () => console.log("previsualización 0.9 en 127.0.0.1:3017"));
