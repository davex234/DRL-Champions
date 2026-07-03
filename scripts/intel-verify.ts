/**
 * VALIDACIÓN — LIVE ESPORTS INTELLIGENCE.
 *
 * Demuestra con MÉTRICAS la capa de inteligencia sobre el DRL Data Engine: identidad
 * única (anti-duplicados), rating contextual, decisión de ciclo de vida, habilidades
 * derivadas, noticias automáticas, failover de fuentes y end-to-end con el engine real.
 *
 * Uso:  npx tsx scripts/intel-verify.ts
 */
import {
  resolveIdentity, contextualRating, decideCard, deriveAbilities, buildCardNews,
  failoverSource, ratingFromCardStats, rarityFor, abilityLabels,
} from "../src/intel";
import { runEngine } from "../src/engine/dataEngine";
import { mockSource } from "../src/engine/sources/mock";
import type { DataSource } from "../src/engine/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); ok ? pass++ : fail++; };

void (async () => {
console.log("# Validación del Live Esports Intelligence Engine\n");

// ── 1) IDENTIDAD ÚNICA (anti-duplicados multi-fuente) ────────────────────
console.log("## 1. Resolución de identidad");
const tenz = ["TenZ", "Tenz", "TENZ", "Tyson Ngo", "  tenz  "].map((n) => resolveIdentity({ name: n }));
const tenzUnique = new Set(tenz);
console.log("  TenZ/Tenz/TENZ/Tyson Ngo →", [...tenzUnique].join(", "));
check("todas las grafías de TenZ resuelven a UN id", tenzUnique.size === 1, `${tenzUnique.size} id(s)`);
check("Derke / 'Nikita Sirmitev' → mismo id", resolveIdentity({ name: "Derke" }) === resolveIdentity({ name: "Nikita Sirmitev" }));
check("jugadores distintos NO colisionan", resolveIdentity({ name: "Aspas" }) !== resolveIdentity({ name: "TenZ" }));
// dedup sobre una lista mezclada de fuentes
const feed = ["TenZ", "tenz", "Aspas", "ASPAS", "Derke", "Nikita Sirmitev", "Boaster", "Jake Howlett"];
const resolved = feed.map((n) => resolveIdentity({ name: n }));
const uniquePlayers = new Set(resolved).size;
console.log(`  Feed de ${feed.length} nombres → ${uniquePlayers} jugadores únicos`);
check("colapsa duplicados a entidades únicas", uniquePlayers === 4, `${uniquePlayers} (esperado 4)`);

// ── 2) RATING CONTEXTUAL ─────────────────────────────────────────────────
console.log("\n## 2. Rating contextual");
const perf = { acs: 285, kast: 78, kills: 21, deaths: 14, clutches: 3, hsPct: 30 };
const rFinal = contextualRating(perf, { type: "champions", stage: "final" });
const rGroups = contextualRating(perf, { type: "regional", stage: "groups" });
console.log(`  Mismos números → Champions final ${rFinal} vs grupos regional ${rGroups}`);
check("el contexto importa: Champions final > grupos regional", rFinal > rGroups, `${rFinal} > ${rGroups}`);
const star = contextualRating({ acs: 300, kast: 82, kills: 24, deaths: 12, clutches: 5 }, { type: "champions", stage: "final" });
const mid = contextualRating({ acs: 200, kast: 68, kills: 15, deaths: 16, clutches: 1 }, { type: "champions", stage: "final" });
check("una gran actuación puntúa más que una mediocre", star > mid, `${star} > ${mid}`);
check("ratings en rango 1..99", [rFinal, rGroups, star, mid].every((r) => r >= 1 && r <= 99));

// ── 3) DECISIÓN DE CICLO DE VIDA ─────────────────────────────────────────
console.log("\n## 3. Decisión de carta (crear/mejorar/mantener/especial)");
const dNew = decideCard({ rating: 84, won: false, mvp: false, family: "masters", history: { bestRating: null, ownsFamilies: [] } });
const dImprove = decideCard({ rating: 90, won: false, mvp: false, family: "masters", history: { bestRating: 80, ownsFamilies: [] } });
const dKeep = decideCard({ rating: 82, won: false, mvp: false, family: "masters", history: { bestRating: 85, ownsFamilies: [] } });
const dSpecial = decideCard({ rating: 88, won: false, mvp: true, family: "champions-mvp", history: { bestRating: 92, ownsFamilies: [] } });
const dNoDup = decideCard({ rating: 88, won: false, mvp: true, family: "champions-mvp", history: { bestRating: 92, ownsFamilies: ["champions-mvp"] } });
console.log(`  new=${dNew.action} improve=${dImprove.action} keep=${dKeep.action} special=${dSpecial.action} dupMVP=${dNoDup.action}`);
check("sin histórico → crea ('new')", dNew.action === "new");
check("supera su nivel → 'improve'", dImprove.action === "improve");
check("no supera su carta → 'keep' (no duplica)", dKeep.action === "keep");
check("MVP/campeón → 'special'", dSpecial.action === "special");
check("ya posee la edición especial → NO la duplica", dNoDup.action !== "special", dNoDup.action);
check("rareza coherente con el rating", rarityFor(96).tier === "mitica" && rarityFor(60).tier === "comun");

// ── 4) HABILIDADES DERIVADAS ─────────────────────────────────────────────
console.log("\n## 4. Habilidades derivadas de datos");
const clutchPlayer = deriveAbilities({ dmg: 70, scr: 72, com: 68, hs: 65, ast: 60, clu: 96 });
const aggroPlayer = deriveAbilities({ dmg: 95, scr: 88, com: 70, hs: 90, ast: 55, clu: 60 });
console.log("  Clutcher:", clutchPlayer.map((a) => `${a.label}(${a.value})`).join(", "));
console.log("  Agresivo:", aggroPlayer.map((a) => `${a.label}(${a.value})`).join(", "));
check("muchos clutch → habilidad Clutch destacada", clutchPlayer[0].key === "clutch");
check("muy agresivo → Entrada destacada", aggroPlayer.some((a) => a.key === "entry"));

// ── 5) NOTICIAS AUTOMÁTICAS ──────────────────────────────────────────────
console.log("\n## 5. Noticias automáticas");
const news = buildCardNews({ playerNick: "Wo0t", tournamentName: "Masters Toronto", rating: 96, tierLabel: "Mítica", action: "special", abilities: ["Clutch", "Impacto"], family: "masters-mvp", won: false, mvp: true, at: 1 });
console.log(`  "${news.title}"`);
console.log(`  ${news.body}`);
check("la noticia menciona al jugador y la rareza", news.title.includes("Wo0t") && news.rarity === "Mítica");
check("id de noticia determinista (anti-duplicado)", news.id === buildCardNews({ ...{ playerNick: "Wo0t", tournamentName: "Masters Toronto", rating: 96, tierLabel: "Mítica", action: "special", abilities: ["Clutch", "Impacto"], family: "masters-mvp", won: false, mvp: true, at: 2 } }).id);

// ── 6) FAILOVER DE FUENTES ───────────────────────────────────────────────
console.log("\n## 6. Prioridad + failover de fuentes");
const flaky: DataSource = {
  id: "flaky", label: "flaky",
  getTournaments: async () => { throw new Error("fuente caída"); },
  getTeams: async () => { throw new Error("down"); },
  getMatches: async () => { throw new Error("down"); },
  getResult: async () => { throw new Error("down"); },
};
const fo = failoverSource([{ source: flaky, priority: 10 }, { source: mockSource, priority: 1 }]);
const foT = await fo.getTournaments();
console.log(`  Intentos: ${fo.attempts.map((a) => `${a.source}:${a.ok ? "ok" : "fail"}`).join(" → ")}`);
check("la fuente prioritaria falla y se hace FAILOVER a la siguiente", foT.length > 0 && fo.attempts.some((a) => a.source === "flaky" && !a.ok) && fo.attempts.some((a) => a.ok));

// ── 7) END-TO-END con el engine REAL ─────────────────────────────────────
console.log("\n## 7. End-to-end (DRL Data Engine + Intel)");
const report = await runEngine(mockSource, []);
console.log(`  Torneos: ${report.tournaments.length} · cartas generadas: ${report.cards.length}`);
check("el engine genera cartas de torneos finalizados", report.cards.length > 0);
const applied = report.cards.filter((c) => c.status === "applied");
const tType = new Map(report.tournaments.map((t) => [t.id, t.type]));
const e2eNews = applied.map((c) => {
  const type = tType.get(c.tournamentId) ?? "other";
  const rating = ratingFromCardStats(c.player.stats, { type });
  return buildCardNews({ playerNick: c.playerNick, tournamentName: c.tournamentName, rating, tierLabel: rarityFor(rating).label, action: "new", abilities: abilityLabels(c.player.stats), family: c.accolade, won: c.kind === "winner", mvp: c.kind === "mvp" || c.kind === "icon", at: 1 });
});
const uniqueNews = new Set(e2eNews.map((n) => n.id)).size;
console.log(`  Noticias generadas: ${e2eNews.length} (únicas: ${uniqueNews})`);
console.log("  Ejemplos:", e2eNews.slice(0, 3).map((n) => `“${n.title}”`).join(" · "));
check("cada carta aplicada produce una noticia", e2eNews.length > 0 && e2eNews.length === applied.length);
check("sin noticias duplicadas (id determinista)", uniqueNews === e2eNews.length);
// re-ejecución: mismos torneos ya procesados ⇒ no se regeneran
const report2 = await runEngine(mockSource, report.cards.map((c) => c.tournamentId));
check("re-ejecución con torneos procesados ⇒ 0 cartas nuevas (no duplica)", report2.cards.length === 0, `${report2.cards.length}`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);
})();
