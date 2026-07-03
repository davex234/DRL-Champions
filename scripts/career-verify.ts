/**
 * VERIFICACIÓN — Manager Career Engine (DRL Champions, Career Fase 1/7).
 *
 *   npx tsx scripts/career-verify.ts [partidos]
 *
 * Comprueba: creación · persistencia · evolución · reputación · licencias · logros ·
 * narrativa · broadcast · determinismo · rendimiento · cero estados imposibles.
 * Motor PURO: no toca stores ni localStorage (sin polyfill).
 */
import {
  createCoach,
  applyMatchResult,
  applySeasonResult,
  careerBroadcast,
  coachAchievementViews,
  claimableReward,
  globalReputationScore,
  attrOverall,
  ATTR_KEYS,
  licenseRank,
  type ManagerCareer,
  type MatchOutcome,
  type SeasonOutcome,
  type CoachCreateInput,
} from "../src/career";

const N = Math.max(4, Number(process.argv[2] ?? 6));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Manager Career Engine — DRL Champions\n");

// Entrada de creación reutilizable (determinista: `now` fijo).
const INPUT: Omit<CoachCreateInput, "now"> & { now: number } = {
  name: "Alex Rivera",
  age: 31,
  country: "España",
  region: "EMEA",
  avatar: "🧑‍🏫",
  bio: "Estratega meticuloso forjado en la liga regional.",
  language: "es",
  style: "tactical",
  specialty: "strategy",
  personality: "analytical",
  personalGoal: "Construir una dinastía mundial",
  team: "Madrid Vipers",
  now: 1_700_000_000_000,
};

const fresh = () => createCoach(INPUT);

// Generadores de resultados deterministas.
const matchOut = (won: boolean, tier: MatchOutcome["tier"] = "regional", mvp = false): MatchOutcome => ({
  won,
  teamName: "Madrid Vipers",
  opponentName: "Rivales FC",
  kills: won ? 16 : 9,
  mvp,
  tier,
});
const seasonOut = (champion: boolean, tier: SeasonOutcome["tier"], perfect = false, mvp = false): SeasonOutcome => ({
  team: "Madrid Vipers",
  competition: tier === "global" ? "Champions" : tier === "continental" ? "Masters" : "Liga Regional",
  tier,
  wins: perfect ? 12 : champion ? 11 : 6,
  losses: perfect ? 0 : champion ? 2 : 7,
  champion,
  finalist: champion,
  mvpAwarded: mvp,
  placement: champion ? 1 : 5,
  fieldSize: 12,
});

/** Aplica una secuencia con `at` determinista (contador). */
function run(
  start: ManagerCareer,
  steps: ({ kind: "match"; o: MatchOutcome } | { kind: "season"; o: SeasonOutcome })[],
): ManagerCareer {
  let c = start;
  let at = INPUT.now;
  for (const s of steps) {
    at += 1000;
    c = s.kind === "match" ? applyMatchResult(c, s.o, at).career : applySeasonResult(c, s.o, at).career;
  }
  return c;
}

// ─────────────────────── 1. Creación ───────────────────────
console.log("## Creación del entrenador");
{
  const c = fresh();
  check("crea un entrenador con identidad", !!c.coach.id && c.coach.name === "Alex Rivera");
  check("edad/país/estilo/especialidad/personalidad presentes",
    c.coach.age === 31 && c.coach.country === "España" && c.coach.style === "tactical" && c.coach.specialty === "strategy" && c.coach.personality === "analytical");
  check("reutiliza Identity para la personalidad (vector 0..100)",
    typeof c.coach.identity.tacticalIQ === "number" && c.coach.identity.tacticalIQ >= 0 && c.coach.identity.tacticalIQ <= 100);
  const allAttrs = ATTR_KEYS.every((k) => c.attributes[k] >= 0 && c.attributes[k] <= 100);
  check("15 atributos en rango 0..100", allAttrs && ATTR_KEYS.length === 15, `OVR ${attrOverall(c.attributes)}`);
  check("empieza en nivel 1, licencia nivel-1, reputación 0",
    c.level === 1 && c.license === "nivel-1" && globalReputationScore(c.reputation) === 0);
  check("objetivos iniciales: uno por horizonte (4)", c.objectives.length === 4);
  check("objetivo vitalicio = objetivo personal", c.objectives.some((o) => o.horizon === "lifetime" && o.text === INPUT.personalGoal));
  check("primer spell de historial abierto en el equipo inicial",
    c.history.spells.length === 1 && c.history.spells[0].team === "Madrid Vipers" && c.history.spells[0].toSeason === null);
  // El sesgo de estilo/especialidad se nota (estratega ⇒ visión táctica/análisis altos).
  check("estilo sesga atributos (táctico ⇒ visión táctica alta)", c.attributes.tacticalVision >= 50, `${c.attributes.tacticalVision}`);
}

// ─────────────────────── 2. Persistencia ───────────────────────
console.log("\n## Persistencia (plano y clonable)");
{
  const c = run(fresh(), [
    { kind: "match", o: matchOut(true) },
    { kind: "season", o: seasonOut(true, "regional") },
  ]);
  const round = JSON.parse(JSON.stringify(c)) as ManagerCareer;
  check("round-trip JSON preserva el estado EXACTO", JSON.stringify(round) === JSON.stringify(c));
  check("no contiene tipos no serializables (Set/Map/función)",
    !JSON.stringify(c).includes("[object") && typeof (c as unknown as Record<string, unknown>).reset !== "function");
}

// ─────────────────────── 3. Evolución (aprende) ───────────────────────
console.log("\n## Evolución del entrenador");
{
  const c0 = fresh();
  const ovr0 = attrOverall(c0.attributes);
  const c = run(c0, [
    ...Array.from({ length: 40 }, () => ({ kind: "match" as const, o: matchOut(true, "continental", true) })),
    { kind: "season", o: seasonOut(true, "continental", false, true) },
    { kind: "season", o: seasonOut(true, "global", false, true) },
  ]);
  check("xp crece con resultados", c.xp > c0.xp, `xp ${c.xp}`);
  check("sube de nivel", c.level > c0.level, `nivel ${c0.level}→${c.level}`);
  check("los atributos MEJORAN con la experiencia", attrOverall(c.attributes) > ovr0, `OVR ${ovr0}→${attrOverall(c.attributes)}`);
  check("estadísticas vitalicias acumulan (nunca se pierden)",
    c.stats.matchesPlayed === 40 && c.stats.wins >= 40 && c.stats.titles === 2 && c.stats.seasonsCoached === 2);
  check("crecimiento con rendimientos decrecientes (atributos ≤ 100)", ATTR_KEYS.every((k) => c.attributes[k] <= 100));
}

// ─────────────────────── 4. Reputación ───────────────────────
console.log("\n## Reputación mundial");
{
  // Mismo nº de títulos, distinto ámbito: el global pesa más en lo global.
  const reg = run(fresh(), [{ kind: "season", o: seasonOut(true, "regional") }]);
  const glob = run(fresh(), [{ kind: "season", o: seasonOut(true, "global") }]);
  check("ganar regional sube sobre todo lo local/regional", reg.reputation.local >= reg.reputation.global);
  check("ganar global sube más la reputación global que ganar regional",
    glob.reputation.global > reg.reputation.global, `${reg.reputation.global.toFixed(1)} → ${glob.reputation.global.toFixed(1)}`);
  const score0 = globalReputationScore(fresh().reputation);
  check("la reputación global agregada crece", globalReputationScore(glob.reputation) > score0);
  // Tiers progresan con palmarés.
  const elite = run(fresh(), Array.from({ length: 8 }, () => ({ kind: "season" as const, o: seasonOut(true, "global", false, true) })));
  check("alcanza un tier de reputación alto tras dominar", globalReputationScore(elite.reputation) >= 60, `${globalReputationScore(elite.reputation)}`);
}

// ─────────────────────── 5. Licencias (por resultados) ───────────────────────
console.log("\n## Licencias");
{
  const c0 = fresh();
  // Carrera dominante larga: ha de escalar hasta lo más alto.
  const longCareer = run(c0, [
    ...Array.from({ length: 1500 }, () => ({ kind: "match" as const, o: matchOut(true, "global", true) })),
    ...Array.from({ length: 60 }, () => ({ kind: "season" as const, o: seasonOut(true, "global", true, true) })),
  ]);
  check("la licencia sube con los resultados (no por tiempo)", licenseRank(longCareer.license) > licenseRank(c0.license), `${c0.license} → ${longCareer.license}`);
  check("una carrera legendaria alcanza la licencia Legend", longCareer.license === "legend", longCareer.license);
  // Monotonía: aunque caiga una mala temporada, la licencia no baja.
  const after = run(longCareer, [{ kind: "season", o: seasonOut(false, "regional") }]);
  check("la licencia NUNCA retrocede (monótona)", licenseRank(after.license) >= licenseRank(longCareer.license));
  check("requisitos coherentes: nivel ≥ 70 y ≥ 20 títulos para Legend", longCareer.level >= 70 && longCareer.stats.titles >= 20, `nivel ${longCareer.level}, ${longCareer.stats.titles} títulos`);
}

// ─────────────────────── 6. Logros ───────────────────────
console.log("\n## Logros");
{
  const c = run(fresh(), [
    { kind: "match", o: matchOut(true) },
    { kind: "season", o: seasonOut(true, "regional") }, // primer título
  ]);
  const views = coachAchievementViews(c);
  check("expone vistas de logros con progreso", views.length >= 6 && views.every((v) => v.current <= v.goal));
  check("'Primer título' se completa tras ganar una competición", views.find((v) => v.id === "first-title")?.complete === true);
  check("hay recompensa reclamable y no reclamada", claimableReward(c, "first-title") > 0);
  // Temporada perfecta desbloquea su logro.
  const perfect = run(fresh(), [{ kind: "season", o: seasonOut(true, "global", true) }]);
  check("'Temporada perfecta' se completa con campeón sin derrotas", coachAchievementViews(perfect).find((v) => v.id === "perfect-season")?.complete === true);
  // Reclamar marca el logro y deja de ser reclamable.
  const claimedIds = [...c.claimedAchievements, "first-title"];
  const c2 = { ...c, claimedAchievements: claimedIds };
  check("un logro ya reclamado no vuelve a conceder", claimableReward(c2, "first-title") === 0);
}

// ─────────────────────── 7. Narrativa ───────────────────────
console.log("\n## Narrativa de carrera");
{
  // First victory / first trophy emergen como eventos.
  const after1 = applyMatchResult(fresh(), matchOut(true), INPUT.now + 1);
  check("primer partido ganado ⇒ evento 'first_victory'", after1.events.some((e) => e.type === "first_victory"));
  const afterTitle = applySeasonResult(after1.career, seasonOut(true, "regional"), INPUT.now + 2);
  check("primera competición ganada ⇒ evento 'first_trophy'", afterTitle.events.some((e) => e.type === "first_trophy"));
  // Perfect season event.
  const perfect = applySeasonResult(fresh(), seasonOut(true, "global", true), INPUT.now + 3);
  check("temporada perfecta ⇒ evento 'perfect_season'", perfect.events.some((e) => e.type === "perfect_season"));
  // Coach legend al obtener la licencia Legend.
  const legend = run(fresh(), [
    ...Array.from({ length: 1500 }, () => ({ kind: "match" as const, o: matchOut(true, "global", true) })),
    ...Array.from({ length: 60 }, () => ({ kind: "season" as const, o: seasonOut(true, "global", true, true) })),
  ]);
  check("la carrera legendaria registró el evento 'coach_legend'", legend.events.some((e) => e.type === "coach_legend"));
  check("cada evento tiene magnitud 1..100 y detalle", legend.events.every((e) => e.magnitude >= 1 && e.magnitude <= 100 && e.detail.length > 0));
}

// ─────────────────────── 8. Broadcast ───────────────────────
console.log("\n## Broadcast (datos para mostrar)");
{
  const c = run(fresh(), [
    { kind: "match", o: matchOut(true, "continental", true) },
    { kind: "season", o: seasonOut(true, "continental", false, true) },
  ]);
  const bc = careerBroadcast(c);
  check("el perfil expone identidad + OVR + nivel + licencia", bc.name === "Alex Rivera" && bc.overall === attrOverall(c.attributes) && bc.level === c.level && bc.license.id === c.license);
  const rows = bc.attrFamilies.flatMap((f) => f.rows);
  check("las familias de atributos cubren los 15 atributos", rows.length === 15);
  check("expone reputación (ámbitos + score + tier)", bc.reputationScore === globalReputationScore(c.reputation) && typeof bc.reputationTier === "string");
  check("expone palmarés, objetivos y logros", bc.titles.length === 1 && bc.objectives.length >= 4 && bc.achievements.length >= 6);
  check("expone etiquetas de personalidad (reusa Identity)", bc.personalityTags.length >= 1);
}

// ─────────────────────── 9. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  check("misma entrada ⇒ entrenador idéntico", JSON.stringify(fresh()) === JSON.stringify(fresh()));
  const steps = [
    ...Array.from({ length: 30 }, () => ({ kind: "match" as const, o: matchOut(true, "continental", true) })),
    { kind: "season" as const, o: seasonOut(true, "global", false, true) },
    { kind: "match" as const, o: matchOut(false) },
    { kind: "season" as const, o: seasonOut(false, "regional") },
  ];
  const a = run(fresh(), steps);
  const b = run(fresh(), steps);
  check("misma secuencia de resultados ⇒ mismo estado final", JSON.stringify(a) === JSON.stringify(b));
}

// ─────────────────────── 10. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  const careers: ManagerCareer[] = [];
  // Una batería de carreras heterogéneas.
  for (let i = 0; i < N; i++) {
    const seq: ({ kind: "match"; o: MatchOutcome } | { kind: "season"; o: SeasonOutcome })[] = [];
    const rngWin = (n: number) => (i + n) % 3 !== 0;
    for (let m = 0; m < 50; m++) seq.push({ kind: "match", o: matchOut(rngWin(m), m % 3 === 0 ? "global" : "regional", m % 5 === 0) });
    for (let s = 0; s < 8; s++) seq.push({ kind: "season", o: seasonOut(rngWin(s), s % 2 === 0 ? "continental" : "regional", false, s % 3 === 0) });
    careers.push(run(fresh(), seq));
  }
  let bad = 0;
  const reasons: string[] = [];
  for (const c of careers) {
    for (const k of ATTR_KEYS) if (c.attributes[k] < 0 || c.attributes[k] > 100 || Number.isNaN(c.attributes[k])) { bad++; reasons.push(`attr ${k}`); }
    for (const v of [c.reputation.local, c.reputation.regional, c.reputation.continental, c.reputation.global]) if (v < 0 || v > 100 || Number.isNaN(v)) { bad++; reasons.push("rep"); }
    if (c.level < 1 || c.xp < 0 || Number.isNaN(c.xp)) { bad++; reasons.push("xp/level"); }
    const s = c.stats;
    if (s.wins < 0 || s.losses < 0 || s.titles < 0 || s.matchesPlayed < 0 || s.currentWinStreak < 0 || s.bestWinStreak < s.currentWinStreak) { bad++; reasons.push("stats"); }
    if (s.seasonsCoached < 0 || s.titles > s.seasonsCoached) { bad++; reasons.push("titles>seasons"); }
    if (c.history.titles.length !== s.titles) { bad++; reasons.push("titles-mismatch"); }
    if (c.objectives.some((o) => o.target < o.base)) { bad++; reasons.push("objective"); }
  }
  check("CERO estados imposibles en todas las carreras", bad === 0, bad === 0 ? `${careers.length} carreras` : reasons.slice(0, 5).join(" · "));
}

// ─────────────────────── 11. Rendimiento ───────────────────────
console.log("\n## Rendimiento");
{
  const t0 = Date.now();
  let c = fresh();
  let at = INPUT.now;
  const TX = 5000;
  for (let i = 0; i < TX; i++) {
    at += 1;
    c = i % 10 === 9 ? applySeasonResult(c, seasonOut(i % 3 === 0, "global", false, true), at).career : applyMatchResult(c, matchOut(i % 2 === 0, "continental", i % 4 === 0), at).career;
  }
  const ms = Date.now() - t0;
  check("rendimiento aceptable", ms / TX < 1, `${(ms / TX).toFixed(3)} ms/transición (${TX})`);
  check("la carrera sobrevive a miles de transiciones sin corromperse", c.level >= 1 && attrOverall(c.attributes) <= 100);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
