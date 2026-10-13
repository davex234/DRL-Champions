/**
 * QA EN NAVEGADOR · DUEL GAMEPLAY UX 2.0 (instrumento, fuera de CI) — capturas A–G sobre los arneses (sin red, sin BD).
 *
 *   BASE_URL=http://127.0.0.1:3087 npx tsx scripts/_duelux2-shots.ts --serve   (arranca SU propio next start con NEXUS_QA_HARNESS=1)
 *
 *   A · PvE sin reloj (fase50 start)          B · carta comprometida del rival boca abajo (fase50 rival-played)
 *   C · revelación tras responder (fase50 turn-win: giro; reducido: fundido sin giro)
 * (fase50 = la arena completa como la compone `/duelos/jugar`, con las fixtures de la Fase 45. El arnés fase26 arrastra
 * mazos QA inválidos —deuda previa— y no construye partida.)
 *   D · rol en texto (respaldo) en los reversos   E · victoria con recibo FIXTURE   F · derrota   G · cero recompensas
 * Tablero en 1440/1024/390, resultado en 1440/1024/390; normal y reducido. Escribe docs/product/qa/duel-ux-2/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3087";
const OUT = join(process.cwd(), "docs/product/qa/duel-ux-2");
mkdirSync(join(OUT, "shots"), { recursive: true });
const checks: { id: string; w: number; motion: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, motion: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ id, w, motion, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w} ${motion}] ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};

const BOARD = `(() => {
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
  const com = q('[data-testid="rival-committed"]');
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    timer: qa('[data-testid="turn-timer"], [role="timer"]').length,
    committed: com ? { hidden: com.dataset.hidden, label: com.getAttribute('aria-label'), imgs: com.querySelectorAll('img:not([data-hint-art])').length, hint: (com.querySelector('[data-testid="rival-committed-hint"] img[data-hint-art]') || {}).src || null, hintOk: (() => { const i = com.querySelector('img[data-hint-art]'); return i ? i.complete && i.naturalWidth > 0 : null; })(), role: (com.querySelector('[data-testid="role-mark"]') || {}).textContent || null, text: [...com.querySelectorAll('*')].filter((n) => !n.closest('[data-testid="role-mark"]') && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => n.textContent.trim()).join(' ') } : null,
    topSrcs: qa('[data-testid="rival-hint"] img[data-hint-art]').map((i) => i.src),
    rivalStats: qa('[data-state]').map((e) => e.dataset.state).filter((s) => /hidden|declared|revealed/.test(s)),
    roleMarks: qa('[data-testid="role-mark"]').map((e) => ({ kind: e.dataset.roleKind, role: e.dataset.role, text: e.textContent.trim() })),
    flip: !!q('[data-testid="reveal-flip"]'),
    turnLabel: /TURNO\\s*\\d+\\s*\\/\\s*10/i.test(document.body.innerText),
  };
})()`;

const RESULT = `(() => {
  const box = document.querySelector('[data-scene="result"]');
  const rw = document.querySelector('[data-testid="quick-result-rewards"]');
  const b = rw ? rw.getBoundingClientRect() : null;
  return {
    overflow: document.documentElement.scrollWidth - innerWidth, vh: innerHeight,
    quick: !!document.querySelector('[data-result="quick"]'),
    rewards: rw ? { text: rw.textContent.trim(), top: b.top, bottom: b.bottom, kinds: [...rw.querySelectorAll('[data-reward-item]')].map((e) => e.dataset.rewardItem), packArt: [...rw.querySelectorAll('img[data-pack-art]')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })) } : null,
    actions: box ? [...box.querySelectorAll('[data-testid="result-actions"] a, [data-testid="result-actions"] button')].map((a) => { const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), bottom: r.bottom }; }) : [],
    kind: document.querySelector('[data-result="quick"]')?.dataset.kind ?? null,
  };
})()`;

async function settle(c: Client, url: string, ready: string, ms: number) {
  await c.tab.goto(url, 1500);
  for (let i = 0; i < 80; i++) { if (await c.tab.js<boolean>(ready).catch(() => false)) break; await sleep(150); }
  await sleep(ms);
}

async function boardPass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `ux2-board-${w}-${motion}` });
  const reduced = motion === "reduced";
  try {
    for (const [id, scene] of [["A", "start"], ["B", "rival-played"], ["C", "turn-win"]] as const) {
      c.tab.takeErrors();
      await settle(c, `${BASE}/design-system/fase50?scene=${scene}`, `document.querySelector('[data-synthetic]')?.dataset.scene === ${JSON.stringify(scene)} && !!document.querySelector('[data-testid="rival-panel"]')`, id === "C" ? (reduced ? 900 : 1600) : 900);
      const f = await c.tab.js<any>(BOARD);
      check(id, w, motion, "sin desbordamiento horizontal", f.overflow <= 0, f.overflow);
      check(id, w, motion, "PvE: ningún reloj de decisión en pantalla", f.timer === 0, f.timer);
      if (id === "A") {
        check(id, w, motion, "atacando: aún no hay carta rival comprometida", f.committed === null, f.committed);
        check("D", w, motion, "rol en TEXTO (respaldo) en los reversos del rival", f.roleMarks.length > 0 && f.roleMarks.every((r: any) => r.kind === "text" && r.text.length >= 2 && r.text.length <= 4), f.roleMarks);
      }
      if (id === "B") {
        check(id, w, motion, "la carta comprometida va BOCA ABAJO (sin cara ni nombre de la carta)", !!f.committed && f.committed.hidden === "true" && f.committed.imgs === 0 && f.committed.text === "", f.committed);
        check(id, w, motion, "AJUSTE · el reverso lleva la pista (mismo asset que arriba, cargado) y el rol", !!f.committed && !!f.committed.hint && f.committed.hintOk === true && f.topSrcs.includes(f.committed.hint) && !!f.committed.role, { c: f.committed, top: f.topSrcs.length });
        check(id, w, motion, "stats del rival: declarada pero oculta", f.rivalStats.includes("declared-hidden") && !f.rivalStats.includes("revealed"), f.rivalStats);
      }
      if (id === "C") check(id, w, motion, reduced ? "reducido: revelación SIN giro (fundido)" : "revelación con giro corto", reduced ? !f.flip : f.flip, f.flip);
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e));
      check(id, w, motion, "consola limpia", errs.length === 0, errs);
      await c.tab.shot(join(OUT, "shots", `${id}-${scene}-${w}-${motion}.png`)).catch(() => null);
      if (id === "A") await c.tab.shot(join(OUT, "shots", `D-roles-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function resultPass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `ux2-result-${w}-${motion}` });
  try {
    for (const [id, scene] of [["E", "win-rewards"], ["E2", "rewards-types"], ["F", "loss-rewards"], ["G", "zero"]] as const) {
      c.tab.takeErrors();
      await settle(c, `${BASE}/design-system/quick-result?scene=${scene}`, `document.querySelector('[data-qa-scene]')?.dataset.qaScene === ${JSON.stringify(scene)} && !!document.querySelector('[data-scene="result"]')`, motion === "reduced" ? 500 : 1500);
      // Las imágenes del recibo (sobre, carta) se esperan hasta decodificar.
      await c.tab.js(`Promise.all([...document.querySelectorAll('[data-testid="quick-result-rewards"] img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); }))`).catch(() => null);
      const f = await c.tab.js<any>(RESULT);
      check(id, w, motion, "sin desbordamiento horizontal", f.overflow <= 0, f.overflow);
      check(id, w, motion, "resultado mínimo con sus DOS botones", f.quick && f.actions.length === 2, f.actions);
      if (id === "G") check(id, w, motion, "cero recompensas → NO hay sección", f.rewards === null, f.rewards);
      else {
        check(id, w, motion, "«Recompensas obtenidas» desde el recibo", !!f.rewards && /Recompensas obtenidas/i.test(f.rewards.text), f.rewards);
        // E2 junta TODOS los tipos a la vez (una partida rápida real solo da créditos/XP/puntos): ahí solo se informa.
        if (id !== "E2") check(id, w, motion, "botones en la primera pantalla", f.actions.every((a: any) => a.bottom <= f.vh), { a: f.actions, vh: f.vh });
        else console.log(`INFO [E2 ${w} ${motion}] botones bottom=${f.actions[0]?.bottom} vh=${f.vh}`);
        if (id === "E2") {
          check(id, w, motion, "sobre (arte REAL cargado ×2), carta e insignia", ["pack", "card", "cosmetic"].every((k) => f.rewards.kinds.includes(k)) && f.rewards.packArt.length > 0 && f.rewards.packArt.every((p: any) => p.ok) && f.rewards.text.includes("×2"), f.rewards);
        } else check(id, w, motion, "créditos + XP de cuenta", f.rewards.kinds.includes("credits") && f.rewards.kinds.includes("accountXp"), f.rewards.kinds);
        if (id === "F") check(id, w, motion, "tono de derrota", f.kind === "loss", f.kind);
      }
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e));
      check(id, w, motion, "consola limpia", errs.length === 0, errs);
      await c.tab.shot(join(OUT, "shots", `${id}-${scene}-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3087";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/quick-result`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  try {
    for (const motion of ["normal", "reduced"] as const) for (const w of [1440, 1024, 390]) { await boardPass(w, motion); await resultPass(w, motion); }
  } finally { stop(); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nDUEL UX 2.0 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
