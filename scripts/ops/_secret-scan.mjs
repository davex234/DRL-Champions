// F67 · busca VALORES de secretos del servidor (de .env.local) en el bundle del cliente y en ficheros visibles. Nunca imprime valores.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const secretNames = Object.keys(env).filter((k) => !k.startsWith("NEXT_PUBLIC_") && env[k].length >= 16);
const publicNames = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
const roots = { clientBundle: ".next/static", serverBundle: ".next/server", public: "public", docs: "docs", scripts: "scripts", src: "src", logs: "logs" };
const SKIP = new Set(["node_modules", ".git"]);
function* walk(d) { if (!existsSync(d)) return; for (const f of readdirSync(d)) { if (SKIP.has(f)) continue; const p = join(d, f); const s = statSync(p); if (s.isDirectory()) yield* walk(p); else if (s.size < 25e6 && ![".png", ".jpg", ".webp", ".avif", ".mp4", ".woff2", ".ico", ".glb"].includes(extname(p))) yield p; } }
const out = { scannedSecretVars: secretNames, publicVars: publicNames, hits: {} };
for (const [label, root] of Object.entries(roots)) {
  for (const p of walk(root)) {
    let txt; try { txt = readFileSync(p, "utf8"); } catch { continue; }
    for (const k of secretNames) if (txt.includes(env[k])) (out.hits[`${label}:${k}`] ??= []).push(p);
    // Patrones genéricos: JWT con rol service_role, claves privadas, contraseñas de BD en URL.
    if (/-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----/.test(txt)) (out.hits[`${label}:PRIVATE_KEY_BLOCK`] ??= []).push(p);
    if (/postgres(ql)?:\/\/[^:\s]+:[^@\s]{6,}@/.test(txt)) (out.hits[`${label}:DB_URL_WITH_PASSWORD`] ??= []).push(p);
    const jwts = txt.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? [];
    for (const j of jwts) { try { const pl = JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString()); if (pl.role === "service_role") (out.hits[`${label}:SERVICE_ROLE_JWT`] ??= []).push(p); } catch { /* no es JWT */ } }
  }
}
for (const k of Object.keys(out.hits)) out.hits[k] = [...new Set(out.hits[k])].slice(0, 8);
console.log(JSON.stringify(out, null, 2));
