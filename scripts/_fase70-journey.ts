/**
 * FASE 70 · recorrido final compacto de la RC (fuera de CI). SOLO cuenta QA (creds() rechaza la del usuario).
 *   F68_OUT=docs/product/qa/fase70-rc npx tsx scripts/_fase70-journey.ts [persona=K]
 * login → portada → sobre (tienda) → colección → equipo → PvE (arranca y juega 2 jugadas) → progresión → competitivo
 * → Coach → perfil público → logout → login. Sin grind, sin compras. Escribe fase70-rc/journey.json (sin secretos).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, logoutUi, goto, sleep, screen, shot, clickTid, clickText, waitFor, playOneUi, collectErrors, token, api, creds, OUT } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = process.argv[2] ?? "K";
const steps: { id: string; ok: boolean; detail: string }[] = [];
const step = (id: string, ok: boolean, detail = "") => { steps.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`); };

(async () => {
  mkdirSync(join(OUT, "screenshots"), { recursive: true });
  const c = await openBrowser(P, 1440, { label: `f70-${P}` });
  const me = creds(P);
  try {
    step("login", await loginUi(c, P));
    const t = await token(P);
    const visit = async (id: string, path: string, re: RegExp) => {
      await goto(c, path, 3000);
      const s = await screen(c);
      step(id, s.url.startsWith(path.split("?")[0]) && re.test(s.text) && s.broken.length === 0 && !s.hScroll, `${s.url} h=${JSON.stringify(s.h.slice(0, 2))} broken=${s.broken.length}`);
      await shot(c, id);
      return s;
    };
    await visit("home", "/", /\S/);
    await visit("pack-store", "/tienda", /sobre/i);
    await visit("collection", "/coleccion", /\S/);
    await visit("team", "/duelos/mazos", /\S/);

    // PvE: partida rápida real → dificultad → 2 jugadas; el servidor debe tener la partida activa y avanzar.
    // F71 · JUGAR → DUELOS → PARTIDA RÁPIDA (los submodos viven en /duelos).
    await goto(c, "/jugar", 2500);
    await clickTid(c, "play-area-cta-DUELS"); await sleep(2500);
    await clickTid(c, "duel-mode-cta-QUICK"); await sleep(3000);
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 8000)) { await clickText(c, "^Comenzar duelo$"); await sleep(2500); }
    const plays = [await playOneUi(c), (await sleep(4000), await playOneUi(c))];
    const act = (await api(t, "/api/game/duel", { action: "active" })).json;
    step("pve", plays.includes("played") && !!act?.view, `plays=${plays.join(",")} active=${!!act?.view}`);
    await shot(c, "pve");

    await visit("progression", "/progresion", /\S/);
    await visit("competitive", "/competitivo", /\S/);
    await visit("coach", "/entrenador", /\S/);
    const prof = await visit("public-profile", `/jugador/${me.userId}`, /\S/);
    step("profile-no-private", !/@example\.invalid/i.test(prof.text), "el perfil no muestra el email");

    step("logout", await logoutUi(c));
    step("relogin", await loginUi(c, P));
    await collectErrors(c);
    step("console-errors", c.errors.length === 0, `errores=${c.errors.length} ${c.errors.slice(0, 3).map((e) => e.text.slice(0, 80)).join(" | ")}`);
  } catch (e) {
    step("exception", false, String((e as Error).message).slice(0, 200));
  } finally {
    await c.browser.close().catch(() => null);
    const pass = steps.filter((s) => s.ok).length;
    writeFileSync(join(OUT, "journey.json"), JSON.stringify({ persona: P, at: new Date().toISOString(), pass, total: steps.length, steps }, null, 2) + "\n");
    console.log(`JOURNEY ${pass}/${steps.length}`);
    process.exit(0);
  }
})();
