/**
 * BUILD DESKTOP — export estático de Next para Tauri, compartiendo el mismo código que
 * la web. Las rutas SERVER-ONLY (route handlers /api + manifest) y el showcase público
 * /colecciones/[slug] (compartir por URL, no jugable) no son exportables: se APARTAN
 * temporalmente, se hace el export y se RESTAURAN siempre. La web no se toca.
 */
import { renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const EXCLUDE = [
  "src/app/api",                 // 5 route handlers (Supabase/admin/esports) — no son el juego
  "src/app/manifest.ts",         // manifest PWA (route dinámica) — innecesario en Tauri
  "src/app/colecciones/[slug]",  // showcase público por URL — no aplica en escritorio
];
const STASH = ".desktop-stash";
const stash = (p) => join(STASH, p);

function moveAside() {
  for (const p of EXCLUDE) {
    if (!existsSync(p)) continue;
    const dest = stash(p);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(p, dest);
  }
}
function restore() {
  for (const p of EXCLUDE) {
    const src = stash(p);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(p), { recursive: true });
    renameSync(src, p);
  }
  if (existsSync(STASH)) rmSync(STASH, { recursive: true, force: true });
}

console.log("[build:desktop] apartando rutas server-only para el export…");
moveAside();
rmSync(".next", { recursive: true, force: true }); // evita types de rutas apartadas (cache)
let code = 1;
try {
  const r = spawnSync("npx next build", {
    stdio: "inherit", shell: true, env: { ...process.env, NEXT_DESKTOP: "1" },
  });
  code = r.status ?? 1;
} finally {
  restore();
  console.log("[build:desktop] rutas restauradas (web intacta).");
}
process.exit(code);
