/** F66 · diagnóstico: B (390 px) defendiendo en el turno 1 — ¿puede jugar? Captura + DOM. */
import { join } from "node:path";
import { launch, sleep } from "../lib/cdp";
import { api, creds, login, mm, pvpGet, validDeck, legalMove, uuid } from "./_qa";
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "http://127.0.0.1:3005"; const OUT = join(process.cwd(), "docs/product/qa/fase66-multiplayer/screenshots");
(async () => {
  const A = await login("A"), B = await login("B");
  for (const w of [A, B]) await mm(w, { action: "cancel" });
  const b = await launch({ args: ["--mute-audio"] }); const tab = b.tab;
  await tab.resize(Number(process.argv[2] ?? 390), 844, 1); await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const c = creds("B"); const esc = JSON.stringify;
  await tab.goto(`${BASE}/cuenta`, 2500);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  await sleep(4000);
  let matchId: string | null = null; let tries = 0;
  while (!matchId && tries++ < 6) {
    const [dA, dB] = await Promise.all([validDeck(A), validDeck(B)]);
    await tab.goto(`${BASE}/duelos/pvp?buscar=${dB!.id}`, 2500);
    await mm(A, { action: "enqueue", deckId: dA!.id });
    for (let i = 0; i < 20 && !matchId; i++) { const [x, y] = await Promise.all([mm(A), mm(B)]); if (x.json?.entry?.state === "MATCHED" && y.json?.entry?.state === "MATCHED" && x.json.entry.matchId === y.json.entry.matchId) matchId = x.json.entry.matchId; else await sleep(1000); }
    const s = (await pvpGet(A, matchId!)).json.snapshot;
    if (!s.isYourTurn) { console.log("B abre: se abandona y se repite"); await api(B, "/api/game/duel/pvp", { action: "abandon", matchId }); matchId = null; await sleep(2000); }
  }
  const sA = (await pvpGet(A, matchId!)).json.snapshot;
  console.log("A ataca:", (await api(A, "/api/game/duel/pvp", { action: "play", matchId, actionId: uuid(), expectedVersion: sA.stateVersion, ...legalMove(sA)! })).status);
  for (const t of [3000, 8000, 15000]) {
    await sleep(t === 3000 ? 3000 : t - 3000);
    const d = await tab.js<any>(`(() => { const q = (s) => document.querySelector(s); const hand = q('[aria-label="Tu mano"]'); return { scenes: [...document.querySelectorAll('[data-scene]')].map(e => e.getAttribute('data-scene')), hand: !!hand, handBtns: hand ? hand.querySelectorAll('button').length : 0, enabled: hand ? [...hand.querySelectorAll('button')].filter(x => !x.disabled).length : 0, buttons: [...document.querySelectorAll('button')].map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 25), text: document.body.innerText.slice(0, 300) }; })()`);
    console.log(t, JSON.stringify(d));
    await tab.shot(join(OUT, `diag-defender-${process.argv[2] ?? 390}-${t}.png`));
  }
  const sB = (await pvpGet(B, matchId!)).json.snapshot; console.log("B isYourTurn", sB.isYourTurn, "phase", sB.match.phase);
  await api(B, "/api/game/duel/pvp", { action: "abandon", matchId });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
