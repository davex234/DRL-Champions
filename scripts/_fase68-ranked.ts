/**
 * FASE 68 · CLOSED BETA — RANKED LONGITUDINAL con dos navegadores reales (instrumento `_`, fuera de CI).
 * Dos personas QA juegan N partidas RANKED por la INTERFAZ: cola desde /competitivo, partida, resultado con su delta,
 * «Buscar otro rival», historial y página competitiva. Sin caos (eso fue F66): experiencia de varias partidas seguidas.
 *
 *   npx tsx scripts/_fase68-ranked.ts <P1> <P2> [--matches=3] [--tag=r1]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  api, clickText, clickTid, collectErrors, creds, goto, loginUi, net, openBrowser, playOneUi, q, RAW, screen, shot, sleep, token, waitFor,
  type Client,
} from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [P1, P2] = process.argv.slice(2, 4);
const N = Number(process.argv.find((a) => a.startsWith("--matches="))?.slice(10) ?? 3);
const TAG = process.argv.find((a) => a.startsWith("--tag="))?.slice(6) ?? "r1";
const T0 = Date.now();
const notes: any[] = [];
const note = (kind: string, text: string, data?: any) => { notes.push({ t: Math.round((Date.now() - T0) / 1000), kind, text, data }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${kind} ${text} ${data ? JSON.stringify(data).slice(0, 300) : ""}`); };
const check = (name: string, ok: boolean, data?: any) => { note("check", `${ok ? "PASS" : "FAIL"} ${name}`, data); return ok; };

const mm = (t: string, body?: unknown) => api(t, "/api/game/duel/matchmaking", body);
const pvp = (t: string, id: string, extra = "") => api(t, `/api/game/duel/pvp?matchId=${id}${extra}`);
const rating = async (t: string) => { const j = (await api(t, "/api/game/competitive")).json; return { rating: j?.self?.rating?.rating ?? null, games: j?.self?.rating?.gamesPlayed ?? null, wins: j?.self?.rating?.wins ?? null, losses: j?.self?.rating?.losses ?? null }; };

async function queueFromUi(c: Client, first: boolean) {
  if (first) {
    await goto(c, "/competitivo", 3000);
    await shot(c, "01-competitivo-antes");
    const ok = await clickTid(c, "ranked-play-cta") || await clickText(c, "Buscar partida|Jugar ranked|Buscar rival");
    await sleep(2500);
    return ok;
  }
  return clickText(c, "^Buscar otro rival$");
}

(async () => {
  const [t1, t2] = [await token(P1), await token(P2)];
  const A = await openBrowser(P1, 1440, { label: `${P1}${P2}-${TAG}-rankedA` });
  const B = await openBrowser(P2, 390, { reduced: true, label: `${P1}${P2}-${TAG}-rankedB` });
  const ev: any = { accounts: { [P1]: creds(P1).userId.slice(0, 8), [P2]: creds(P2).userId.slice(0, 8) }, matches: [] };
  try {
    await Promise.all([loginUi(A, P1), loginUi(B, P2)]);
    // Estado limpio: fuera de colas y sin PvP vivo (solo lo que el propio jugador podría hacer: cancelar).
    for (const t of [t1, t2]) await mm(t, { action: "cancel" });
    ev.start = { [P1]: await rating(t1), [P2]: await rating(t2) };
    const seen: string[] = [];
    for (let i = 1; i <= N; i++) {
      const r0 = { a: await rating(t1), b: await rating(t2) };
      const tq = Date.now();
      const qa = await queueFromUi(A, i === 1); const qb = await queueFromUi(B, i === 1);
      let matchId: string | null = null;
      for (let k = 0; k < 45 && !matchId; k++) {
        const e = (await mm(t1)).json?.entry;
        const cand = e?.state === "MATCHED" ? e.matchId : null;
        if (cand && !seen.includes(cand) && (await pvp(t2, cand)).status === 200) matchId = cand; else await sleep(2000);
      }
      const queueMs = Date.now() - tq;
      if (!matchId) { note("bug", `partida ${i}: no hubo emparejamiento`, { qa, qb, a: (await mm(t1)).json, b: (await mm(t2)).json }); await shot(A, `zz-sin-emparejar-${i}`); await shot(B, `zz-sin-emparejar-${i}`); break; }
      seen.push(matchId);
      if (i === 1) { await sleep(2500); await shot(A, "02-emparejado"); await shot(B, "02-emparejado"); }
      // Jugar por la interfaz.
      let guard = 0, played = { a: 0, b: 0 }, stuck = 0;
      while (guard++ < 120) {
        const [sa, sb] = [(await pvp(t1, matchId)).json?.snapshot, (await pvp(t2, matchId)).json?.snapshot];
        if (!sa || ["FINISHED", "ABANDONED", "EXPIRED"].includes(sa.lifecycle)) break;
        const actor = sa.isYourTurn ? A : sb?.isYourTurn ? B : null;
        if (!actor) { await sleep(700); continue; }
        const r = await playOneUi(actor);
        if (r === "played") { if (actor === A) played.a++; else played.b++; stuck = 0; } else { stuck++; if (stuck > 6) { note("bug", `partida ${i}: ${actor.persona} no puede jugar (${r})`, await screen(actor)); await shot(actor, `zz-atasco-${i}`); break; } }
        await sleep(1100);
      }
      // Resultado en las dos interfaces.
      const shownA = await waitFor(A.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return !!document.querySelector('[data-testid="pvp-outcome"]'); })()`, 45000);
      const shownB = await waitFor(B.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return !!document.querySelector('[data-testid="pvp-outcome"]'); })()`, 45000);
      await sleep(1500);
      const [fa, fb] = [(await pvp(t1, matchId, "&outcome=1")).json, (await pvp(t2, matchId, "&outcome=1")).json];
      const r1 = { a: await rating(t1), b: await rating(t2) };
      const ui = async (c: Client) => c.tab.js<any>(`(() => ({ delta: document.querySelector('[data-testid="rating-delta"]')?.innerText?.trim() ?? null, rating: document.querySelector('[data-testid="pvp-rating"]')?.innerText?.replace(/\\s+/g,' ').trim().slice(0, 120) ?? null, outcome: document.querySelector('[data-testid="pvp-outcome"]')?.innerText?.replace(/\\s+/g,' ').slice(0, 80) ?? null, again: !!document.querySelector('[data-testid="ranked-again"]'), nan: /NaN|undefined|null/.test(document.querySelector('[data-testid="pvp-outcome"]')?.innerText ?? '') }))()`);
      const [ua, ub] = [await ui(A), await ui(B)];
      const m: any = {
        i, matchId: matchId.slice(0, 8), queueMs, played, shown: { a: shownA, b: shownB },
        lifecycle: fa?.snapshot?.lifecycle, result: fa?.snapshot?.match?.result ? { winner: fa.snapshot.match.result.winner, score: `${fa.snapshot.match.result.scoreA}-${fa.snapshot.match.result.scoreB}` } : null,
        outcome: { a: fa?.outcome ?? null, b: fb?.outcome ?? null }, rating: { before: r0, after: r1 }, ui: { a: ua, b: ub },
      };
      const dA = r1.a.rating - r0.a.rating, dB = r1.b.rating - r0.b.rating;
      m.deltas = { a: dA, b: dB };
      check(`partida ${i}: resultado en las dos interfaces`, shownA && shownB, m.shown);
      check(`partida ${i}: Elo movido una vez y coherente con el resultado`, r1.a.games === r0.a.games + 1 && r1.b.games === r0.b.games + 1 && (fa?.outcome?.delta ?? dA) === dA && (fb?.outcome?.delta ?? dB) === dB, { dA, dB, oa: fa?.outcome?.delta, ob: fb?.outcome?.delta });
      // El bloque dice «ANTES 1000 → DESPUÉS 1021 +21»: el delta es la ÚLTIMA cifra con signo.
      const signed = (s: string | null) => { const m = s ? [...s.replace("−", "-").matchAll(/([+-]\d+)/g)].pop() : null; return m ? Number(m[1]) : NaN; };
      check(`partida ${i}: la interfaz enseña el delta real (también negativo)`, signed(ua?.delta) === dA && signed(ub?.delta) === dB && !ua?.nan && !ub?.nan, { ua: ua?.delta, dA, ub: ub?.delta, dB });
      if (dA < 0 || dB < 0) { const loser = dA < 0 ? A : B; await shot(loser, `03-derrota-${i}`); }
      if (i === 1) { await shot(A, "04-resultado"); await shot(B, "04-resultado"); }
      ev.matches.push(m);
      note("step", `partida ${i}: ${m.result?.score} Δ ${dA}/${dB} cola ${queueMs} ms`);
    }
    // Historial y página competitiva tras las partidas.
    for (const [c, t] of [[A, t1], [B, t2]] as const) {
      await goto(c, "/duelos/competitivo/historial", 3500);
      const h = await screen(c);
      const hist = (await api(t, "/api/game/competitive")).json;
      const recent = (hist?.self?.recent ?? hist?.recent ?? hist?.history ?? []) as any[];
      const ids = ev.matches.map((m: any) => m.matchId);
      const onScreen = ids.filter((id: string) => h.links.some((l: string) => l?.includes(id)) || h.text.includes(id));
      (ev.history ??= {})[c.persona] = { h: h.h, links: h.links.filter((l: string) => /partida|replay/.test(l ?? "")).slice(0, 8), recentApi: recent.length, onScreenIds: onScreen.length };
      await shot(c, "05-historial");
      await goto(c, "/competitivo", 3500);
      const cp = await screen(c);
      const r = await rating(t);
      (ev.competitive ??= {})[c.persona] = { rating: r, text: cp.text.slice(0, 300), hasRatingNumber: cp.text.includes(String(r.rating)), namedRanks: /(Hierro|Bronce|Plata|Oro|Platino|Diamante|Ascendente|Inmortal|Radiante)\b/.test(cp.text) };
      check(`${c.persona}: /competitivo enseña su Elo real`, (ev.competitive[c.persona]).hasRatingNumber, { rating: r.rating });
      await shot(c, "06-competitivo-despues");
      await collectErrors(c);
    }
    ev.network = { a: await net(A), b: await net(B) };
    ev.consoleErrors = { a: A.errors, b: B.errors };
  } finally { await A.browser.close(); await B.browser.close(); }
  ev.end = { [P1]: await rating(t1), [P2]: await rating(t2) };
  ev.notes = notes; ev.durationSec = Math.round((Date.now() - T0) / 1000);
  ev.checks = { pass: notes.filter((n) => n.kind === "check" && n.text.startsWith("PASS")).length, fail: notes.filter((n) => n.kind === "check" && n.text.startsWith("FAIL")).map((n) => n.text) };
  writeFileSync(join(RAW, `${P1}${P2}-${TAG}-ranked.json`), JSON.stringify(ev, null, 2));
  console.log(`→ raw/${P1}${P2}-${TAG}-ranked.json`, JSON.stringify(ev.checks));
})().catch((e) => { console.error("RANKED FALLÓ", e); process.exit(1); });
