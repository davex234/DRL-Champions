/**
 * LOGOS EN PRODUCCIÓN (instrumento; 2026-10-15). SOLO LECTURA y SIN SESIÓN.
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_team-logos-prod-check.ts
 *
 * Los 41 logos de `HINT_TEAM_LOGOS`: 200, `image/png` y sha256 = el fichero del repositorio (el README los fija); los
 * arneses `/design-system` siguen en 404; una identidad sin logo (GEN) no tiene fichero (404, la pantalla usa la etiqueta).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HINT_TEAM_LOGOS, hintTeamLogoSrc } from "../src/data/teamLogos";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let fail = 0;
const check = (id: string, ok: boolean, detail = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} · ${id}${detail ? ` — ${detail}` : ""}`); };

(async () => {
  for (const id of [...HINT_TEAM_LOGOS].sort()) {
    const src = hintTeamLogoSrc(id)!;
    const r = await fetch(`${BASE}${src}`, { cache: "no-store" });
    const body = Buffer.from(await r.arrayBuffer());
    const want = sha(readFileSync(join(process.cwd(), "public", src)));
    check(`logo ${id}`, r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("image/png") && sha(body) === want, `${r.status} ${r.headers.get("content-type")} ${sha(body).slice(0, 12)}`);
  }
  for (const p of ["/design-system/colecciones-equipos?scene=room-all", "/design-system/colecciones-equipos?scene=detail-empty&team=paper-rex", "/hints/teams/gen.png"]) {
    const r = await fetch(`${BASE}${p}`, { cache: "no-store", redirect: "manual" });
    check(`404 ${p}`, r.status === 404, String(r.status));
  }
  console.log(`\nRESULTADO · ${BASE} · ${fail === 0 ? "OK" : `${fail} FAIL`}`);
  process.exit(fail ? 1 : 0);
})();
