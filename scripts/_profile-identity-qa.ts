/**
 * QA EN NAVEGADOR · PERFIL = IDENTIDAD (instrumento, fuera de CI) — arnés `/design-system/profile-identity`.
 *
 *   BASE_URL=http://127.0.0.1:3087 npx tsx scripts/_profile-identity-qa.ts --serve   (arranca SU next start con NEXUS_QA_HARNESS=1)
 *
 * 1440/1024/390 × normal/reducido: propio clasificado, propio vacío, propio en colocación, ajeno amigo, ajeno desconocido,
 * ajeno vacío y nombre largo. Comprueba: sin desbordamiento, UNA tarjeta compacta (sin dashboard), las acciones de cuenta
 * solo en el propio y CERRAR SESIÓN visible, acciones sociales solo en el ajeno, rango/equipo solo si existen, táctil 44,
 * consola limpia. Escribe docs/product/qa/profile-identity/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3087";
const OUT = join(process.cwd(), "docs/product/qa/profile-identity");
mkdirSync(join(OUT, "shots"), { recursive: true });
const checks: { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ w, motion, scene, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const SCENES = ["own", "own-empty", "own-placement", "public-friend", "public-stranger", "public-empty", "long"];
const DASH = "Nivel de cuenta|Partidas|Victorias|Derrotas|Empates|% de victorias|Temporada actual|Colección|Historial|Insignias|Expón tus cartas|Elegir cartas|Cartas destacadas|Momentos";

async function pass(w: number, motion: "normal" | "reduced") {
  const c: Client = await openBrowser("QA", w, { reduced: motion === "reduced", label: `pi-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      c.tab.takeErrors();
      await c.tab.goto(`${BASE}/design-system/profile-identity?scene=${scene}`, 1500);
      for (let i = 0; i < 60; i++) { if (await c.tab.js<boolean>(`document.querySelector('[data-qa-scene]')?.dataset.qaScene === ${JSON.stringify(scene)} && !!document.querySelector('[data-testid="profile-card"]')`).catch(() => false)) break; await sleep(150); }
      await sleep(700);
      const f = await c.tab.js<any>(`(() => {
        const card = document.querySelector('[data-testid="profile-card"]'); const b = card.getBoundingClientRect();
        const acts = [...card.querySelectorAll('[data-action]')].map((a) => { const r = a.getBoundingClientRect(); return { a: a.dataset.action, t: a.textContent.trim(), h: r.height, bottom: r.bottom }; });
        return { overflow: document.documentElement.scrollWidth - innerWidth, vh: innerHeight, cardH: b.height, cardBottom: b.bottom + scrollY, text: card.textContent,
          own: card.dataset.view === 'SELF', rank: !!card.querySelector('[data-testid="profile-rank"]'), team: !!card.querySelector('[data-testid="favorite-team"]'),
          member: !!card.querySelector('[data-testid="member-since"]'), social: !!card.querySelector('[data-testid="profile-social"]'), acts,
          nameOverflow: (() => { const h = card.querySelector('[data-field="player-name"]'); return h ? h.scrollWidth - h.clientWidth : 0; })() };
      })()`);
      check(w, motion, scene, "sin desbordamiento horizontal (también el nombre)", f.overflow <= 0 && f.nameOverflow <= 1, { o: f.overflow, n: f.nameOverflow });
      check(w, motion, scene, "una tarjeta de identidad, sin dashboard", !new RegExp(DASH, "i").test(f.text), f.text.match(new RegExp(DASH, "i")));
      check(w, motion, scene, "tarjeta compacta (≤ 1,35 pantallas incluso en 390)", f.cardH <= f.vh * 1.35, { cardH: f.cardH, vh: f.vh });
      check(w, motion, scene, "miembro desde visible", f.member);
      // 0068 · el TAG bajo el nombre, sin desbordar (también con nombre largo en 390) y con nombre accesible.
      const tg = await c.tab.js<any>(`(() => { const t = document.querySelector('[data-testid="account-tag"]'); const n = document.querySelector('[data-field="player-name"]'); if (!t || !n) return null; const a = t.getBoundingClientRect(), b = n.getBoundingClientRect(); return { below: a.top >= b.bottom - 1, right: a.right <= innerWidth, left: a.left >= 0, label: t.getAttribute('aria-label'), mono: getComputedStyle(t).fontFamily }; })()`);
      check(w, motion, scene, "tag bajo el nombre, dentro de pantalla y con nombre accesible", !!tg && tg.below && tg.right && tg.left && /^Identificador de cuenta #[2-9A-Z]{7}\./.test(tg.label), tg);
      const own = scene.startsWith("own") || scene === "long";
      const names = f.acts.map((a: any) => a.a);
      if (own) {
        check(w, motion, scene, "propio: EDITAR · CUENTA · TROFEOS · CERRAR SESIÓN (en ese orden), sin sociales", JSON.stringify(names.filter((n: string) => ["edit", "account", "trophy-room", "sign-out"].includes(n))) === JSON.stringify(["edit", "account", "trophy-room", "sign-out"]) && !f.social, names);
        check(w, motion, scene, "acciones táctiles ≥ 44 px", f.acts.filter((a: any) => ["edit", "account", "trophy-room", "sign-out"].includes(a.a)).every((a: any) => a.h >= 44), f.acts);
      } else {
        check(w, motion, scene, "ajeno: acciones sociales F85 y NINGUNA de cuenta", f.social && !names.some((n: string) => ["edit", "account", "sign-out", "trophy-room"].includes(n)), names);
      }
      const expectRank = scene === "own" || scene === "own-placement" || scene === "public-friend" || scene === "public-stranger";
      if (scene === "own-empty" || scene === "public-empty") check(w, motion, scene, "sin rango ni equipo: no se pinta nada vacío", !f.rank && !f.team);
      if (scene === "own" || scene === "public-friend") check(w, motion, scene, "rango (emblema + rango + rating) y equipo favorito", f.rank && f.team);
      if (scene === "own-placement") check(w, motion, scene, "colocación X/5 sin rango", f.rank && /Colocación 3\/5/.test(f.text));
      void expectRank;
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e));
      check(w, motion, scene, "consola limpia", errs.length === 0, errs);
      await c.tab.shot(join(OUT, "shots", `${scene}-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3087";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/profile-identity`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  try { for (const motion of ["normal", "reduced"] as const) for (const w of [1440, 1024, 390]) await pass(w, motion); }
  finally { stop(); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nPROFILE IDENTITY QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
