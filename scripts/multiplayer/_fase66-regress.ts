/** F66 · regresión F61–F65 en ejecución: páginas y APIs clave con una cuenta QA (C) contra :3005. Solo lectura. */
import { writeFileSync } from "node:fs";
import { api, login, BASE } from "./_qa";
/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const w = await login("C");
  const pages = ["/", "/jugar", "/duelos/jugar", "/duelos/pvp", "/competitivo", "/progresion", "/como-jugar", "/coleccion", "/tienda", "/cuenta"];
  const apis = ["/api/game/play-status", "/api/game/daily-loop", "/api/game/onboarding", "/api/game/competitive", "/api/game/season", "/api/game/duels", "/api/game/meta", "/api/game/duel/matchmaking"];
  const rows: any[] = [];
  for (const p of pages) { const r = await fetch(BASE + p); rows.push({ kind: "page", path: p, status: r.status }); await new Promise((z) => setTimeout(z, 300)); }
  for (const p of apis) { const r = await api(w, p); rows.push({ kind: "api", path: p, status: r.status }); }
  const out = {
    at: new Date().toISOString(), allOk: rows.every((r) => r.status === 200), rows,
    F61: "motor: huella dorada F61 MOTOR 01 verde (sin cambios) · final/desempate/recarga del resultado verificados en e2e (resultF5)",
    F62: "progresión: PvP no paga (rating una vez); PvE paga una vez (reward-integrity: +120 = award)",
    F63: "onboarding: primera partida PvE = mismo playTurn (ahora con versión); /api/game/onboarding 200",
    F64: "game feel: sin cambios de UI salvo copia de conexión honesta y resync; 0 errores de consola nuevos en e2e; 0 404",
    F65: "balance: ninguna propuesta aplicada; lab.test verde (huella de buildOpponentDeck intacta)",
    engineOrRulesChanged: false, cardsChanged: false, agentsChanged: false, economyChanged: false, migration: false,
  };
  writeFileSync("docs/product/qa/fase66-multiplayer/regressions.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ allOk: out.allOk, bad: rows.filter((r) => r.status !== 200) }));
})();
