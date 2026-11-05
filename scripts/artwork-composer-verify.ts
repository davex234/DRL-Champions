/**
 * VERIFICACIÓN DEL ARTWORK COMPOSER (Artwork Pipeline · Fase 2/6).
 *
 * CardSpec → ArtworkComposition determinista, SOLO referencias (jamás imágenes/Canvas/HTML;
 * el Renderer aún no existe). Ejemplo obligatorio: zekken__mythic de
 * GEN-2026-VALORANT-MASTERS-LONDON-2026, con TODAS las capas en orden, assets resueltos y
 * placeholders. Comprueba: composición completa · orden de capas · placeholders · resolver
 * · badges · iconos · efectos · layout · textos · determinismo · rendimiento · cero capas
 * duplicadas · cero referencias inválidas · compat con Artwork Manager y Card Generator.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards, type CardSpec } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine, playerAsset, teamAsset, countryAsset } from "@/artwork";
import {
  composeArtwork, validateComposition, deriveBadges, deriveEffects,
  LAYER_ORDER, BADGE_KINDS, type ArtworkComposition, type ComposerCtx,
} from "@/artwork-composer";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/* ── Fixture: Masters London 2026 (mismo RawSnapshot compacto que editorial/telegram) ── */
const LONDON: RawSnapshot = {
  tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "finished", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "lln", name: "London Lions", region: "EMEA", active: true },
    { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
    { id: "bbr", name: "Berlin Bears", region: "EMEA" },
  ],
  players: [
    { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
    { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "lc", name: "Sable", team: "London Lions", status: "active" }],
  matches: [
    { id: "l0", stageId: "st-po", teamA: "London Lions", teamB: "Berlin Bears", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "London Lions", round: "Semifinal", matchOrder: 1 },
    { id: "l1", stageId: "st-po", teamA: "London Lions", teamB: "Madrid Wolves", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "London Lions", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "l0m1", matchId: "l0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
    { id: "l0m2", matchId: "l0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "Berlin Bears" },
    { id: "l0m3", matchId: "l0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "London Lions" },
    { id: "l1m1", matchId: "l1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "London Lions" },
    { id: "l1m2", matchId: "l1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "London Lions" },
  ],
  mapStats: [
    { matchMapId: "l0m1", matchId: "l0", player: "zekken", team: "London Lions", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "l1m1", matchId: "l1", player: "zekken", team: "London Lions", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "l0m1", matchId: "l0", player: "Lyncher", team: "London Lions", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "l1m1", matchId: "l1", player: "Wolfrik", team: "Madrid Wolves", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "Berlin Bears", position: 3, wins: 1, losses: 1 },
  ],
  awards: { champion: "London Lions", runnerUp: "Madrid Wolves" },
};

const NOW = 1_700_000_000_000;
const GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

function main(): void {
  console.log("# Verificación del Artwork Composer — DRL Champions (Artwork Fase 2/6)\n");

  // ── FIXTURE: generación REAL del Card Generator (compat garantizada por construcción) ──
  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const gen = generateCards(analyze(importSnapshot(LONDON, ictx).model), { roster: allPlayers(), now: NOW });
  check("fixture: generación obligatoria del Card Generator", gen.generationId === GEN, gen.generationId);
  const mythic = gen.cards.find((c) => c.cardId === "zekken__mythic");
  check("fixture: zekken__mythic existe en la generación", !!mythic);

  // Artwork Manager con el seed + convenciones del torneo (país/equipo/foto de zekken).
  const artwork = new ArtworkEngine();
  artwork.register(playerAsset("zekken"));
  artwork.register(teamAsset("london-lions"));
  artwork.register(countryAsset("us"));
  const ctx: ComposerCtx = {
    nick: "zekken", teamSlug: "london-lions", countryIso: "US",
    tournamentId: gen.tournamentId, tournamentName: gen.tournamentName, generationId: gen.generationId,
    region: "emea", role: "duelist", agent: "jett", collectionName: gen.collection.name,
  };

  // ── 1. COMPOSICIÓN COMPLETA (ejemplo obligatorio) ──
  console.log("## 1. Composición completa — zekken__mythic");
  const comp = composeArtwork(mythic!, artwork, ctx);
  const v = validateComposition(comp);
  check("composición VÁLIDA (capas oficiales, ids únicos, refs presentes, layout en rango)", v.ok,
    v.issues.map((i) => i.code).join(","));
  check("identidad y paleta del spec intactas (jamás recalculadas)",
    comp.cardId === "zekken__mythic" && comp.playerId === "zekken" && comp.generationId === GEN &&
    comp.palette === mythic!.artwork.palette && comp.metadata.ovr === mythic!.ovr && comp.metadata.rarity === mythic!.rarityBucket);
  check("lienzo LÓGICO fraccional (sin píxeles renderizados)",
    comp.canvas.unit === "fraction" && Math.abs(comp.canvas.aspectRatio - 5 / 7) < 1e-9);

  // Salida obligatoria: capas en orden exacto + assets + placeholders.
  console.log("\n   CAPAS (orden oficial de render):");
  for (const l of comp.layers) {
    const els = l.elements.map((e) => `${e.id.split(":").slice(1).join(":")}→${e.ref}${e.isPlaceholder ? "*" : ""}`).join(" · ");
    console.log(`     ${String(LAYER_ORDER.indexOf(l.kind) + 1).padStart(2)}. ${l.kind.padEnd(19)} ${els || "—"}`);
  }
  console.log(`   ASSETS REALES: ${comp.assetsUsed.join(", ")}`);
  console.log(`   PLACEHOLDERS (*): ${comp.placeholdersUsed.join(", ")}\n`);

  // ── 2. ORDEN DE CAPAS + CERO DUPLICADAS ──
  console.log("## 2. Orden de capas");
  check("las 12 capas oficiales, en el orden EXACTO del contrato",
    comp.layers.length === 12 && comp.layers.every((l, i) => l.kind === LAYER_ORDER[i]));
  check("cero capas duplicadas", new Set(comp.layers.map((l) => l.kind)).size === 12);
  check("cero elementos duplicados (id único global)", (() => {
    const ids = comp.layers.flatMap((l) => l.elements.map((e) => e.id));
    return new Set(ids).size === ids.length;
  })());
  const tampered: ArtworkComposition = { ...comp, layers: [...comp.layers].reverse() };
  const dupped: ArtworkComposition = { ...comp, layers: comp.layers.map((l) => l.kind === "texts" ? { ...l, elements: [...l.elements, l.elements[0]] } : l) };
  check("una composición manipulada NO valida (orden roto / elemento duplicado)",
    !validateComposition(tampered).ok && !validateComposition(dupped).ok);
  check("profundidad = capa×100 + prioridad (orden total determinista)",
    comp.layers.every((l, i) => l.elements.every((e) => e.layout.depth === i * 100 + e.layout.priority)));

  // ── 3. RESOLVER + PLACEHOLDERS (compat Artwork Manager) ──
  console.log("\n## 3. Resolver y placeholders");
  const allElements = comp.layers.flatMap((l) => l.elements);
  check("CERO referencias inválidas: toda ref resuelve en el Artwork Manager",
    allElements.every((e) => artwork.resolveRef(e.ref) !== null));
  check("player/team/country resueltos con assets REALES",
    allElements.some((e) => e.ref === "player:zekken" && !e.isPlaceholder) &&
    allElements.some((e) => e.ref === "team:london-lions" && !e.isPlaceholder) &&
    allElements.some((e) => e.ref === "country:us" && !e.isPlaceholder));
  check("recursos faltantes → PLACEHOLDER oficial (torneo, rol, región, badges)",
    comp.placeholdersUsed.includes("placeholder:tournament-logo") &&
    comp.missingCategories.includes("role") && comp.missingCategories.includes("badge"));
  check("nunca null: TODA capa con sujeto tiene elemento (aunque falte el recurso)",
    (["tournament", "team", "player"] as const).every((k) => comp.layers.find((l) => l.kind === k)!.elements.length > 0));
  check("los placeholders reportados coinciden con los elementos placeholder",
    new Set(allElements.filter((e) => e.isPlaceholder).map((e) => e.ref)).size === comp.placeholdersUsed.length);

  // ── 4. BADGES ──
  console.log("## 4. Badges");
  check("zekken__mythic (kind mvp) luce el badge oficial MVP", comp.metadata.badges.includes("mvp"));
  const badgeLayer = comp.layers.find((l) => l.kind === "badges")!;
  check("los badges viven en SU capa, tipados y con asset/placeholder",
    badgeLayer.elements.every((e) => e.type === "badge" && !!e.badge && e.category === "badge"));
  const synthetic = (over: Partial<CardSpec>): CardSpec => ({ ...mythic!, ...over });
  check("mapeo declarativo completo (champion/edition/elite/legend/rookie/perfect/record/collector/regional/event)",
    deriveBadges(synthetic({ kind: "champion", serialized: true })).includes("champion-edition") &&
    deriveBadges(synthetic({ kind: "champion", serialized: false })).includes("champion") &&
    deriveBadges(synthetic({ rarityBucket: "legendary" })).includes("elite") &&
    deriveBadges(synthetic({ badges: ["legend"] })).includes("legend") &&
    deriveBadges(synthetic({ badges: ["debut"] })).includes("rookie") &&
    deriveBadges(synthetic({ badges: ["perfect-run"] })).includes("perfect-tournament") &&
    deriveBadges(synthetic({ badges: ["career-high"] })).includes("record-holder") &&
    deriveBadges(synthetic({ kind: "base", serialized: true, badges: [] })).includes("collector") &&
    deriveBadges(synthetic({ kind: "participation" })).includes("regional") &&
    deriveBadges(synthetic({ kind: "award" })).includes("special-event"));
  check("los 11 badges oficiales existen y el orden derivado es estable",
    BADGE_KINDS.length === 11 &&
    JSON.stringify(deriveBadges(mythic!)) === JSON.stringify(deriveBadges(mythic!)));

  // ── 5. ICONOS ──
  console.log("\n## 5. Iconos");
  const iconLayer = comp.layers.find((l) => l.kind === "icons")!;
  check("país + rol + región + colección + rareza siempre presentes",
    ["icons:country", "icons:role", "icons:region", "icons:collection", "icons:rarity"].every((id) => iconLayer.elements.some((e) => e.id === id)));
  check("agente/mapa solo cuando el contexto los aporta",
    iconLayer.elements.some((e) => e.id === "icons:agent") &&
    !composeArtwork(mythic!, artwork, { ...ctx, agent: undefined }).layers.find((l) => l.kind === "icons")!.elements.some((e) => e.id === "icons:agent"));
  check("el icono de rareza referencia el recurso css del design system",
    iconLayer.elements.find((e) => e.id === "icons:rarity")!.ref === `rarity:${mythic!.rarityBucket}`);

  // ── 6. EFECTOS ──
  console.log("\n## 6. Efectos");
  const effects = deriveEffects(mythic!);
  check("kind mvp ⇒ holographic; sombra SIEMPRE; efectos del bucket aplicados",
    effects.includes("holographic") && effects.includes("shadow") &&
    JSON.stringify(comp.metadata.effects) === JSON.stringify(effects));
  const fxBg = comp.layers.find((l) => l.kind === "background-effects")!;
  const fxFg = comp.layers.find((l) => l.kind === "foreground-effects")!;
  check("los efectos viven en sus capas (bg/fg) tipados",
    [...fxBg.elements, ...fxFg.elements].every((e) => e.type === "effect" && !!e.effect));
  check("legendary ⇒ foil+aura+particles+glow; común ⇒ solo sombra",
    ["foil", "aura", "particles", "glow"].every((e) => deriveEffects(synthetic({ rarityBucket: "legendary", kind: "base", serialized: false, badges: [] })).includes(e as never)) &&
    JSON.stringify(deriveEffects(synthetic({ rarityBucket: "common", kind: "base", serialized: false, badges: [] }))) === JSON.stringify(["shadow"]));

  // ── 7. LAYOUT ──
  console.log("\n## 7. Layout");
  check("todo layout declarativo y en rango (x/y/opacidad 0..1, escala>0, anclaje/alineación)",
    allElements.every((e) => e.layout.x >= 0 && e.layout.x <= 1 && e.layout.y >= 0 && e.layout.y <= 1 &&
      e.layout.opacity >= 0 && e.layout.opacity <= 1 && e.layout.scale > 0 &&
      typeof e.layout.anchor === "string" && typeof e.layout.align === "string" && Number.isFinite(e.layout.rotation)));

  // ── 8. TEXTOS ──
  console.log("\n## 8. Textos");
  const texts = comp.layers.find((l) => l.kind === "texts")!.elements;
  const textOf = (role: string): string | undefined => texts.find((e) => e.text?.role === role)?.text?.content;
  check("player-name · OVR · rarity · collection · tournament · season resueltos del spec/ctx",
    textOf("player-name") === "zekken" && textOf("ovr") === String(mythic!.ovr) &&
    textOf("rarity")?.includes(mythic!.rarityBucket) === true &&
    textOf("tournament") === "Valorant Masters London 2026" && textOf("season") === `S${mythic!.season}`);
  check("edition solo en cartas serializadas",
    (mythic!.serialized ? !!textOf("edition") : textOf("edition") === undefined) &&
    !!composeArtwork(synthetic({ serialized: true, serialLimit: 25 }), artwork, ctx)
      .layers.find((l) => l.kind === "texts")!.elements.find((e) => e.text?.role === "edition"));
  check("los textos solo REFERENCIAN la tipografía (jamás la renderizan)",
    texts.every((e) => e.type === "text" && e.text!.fontRef === e.ref && e.text!.colorToken.startsWith("palette.")));

  // ── 9. CONTENIDO PROHIBIDO ──
  console.log("\n## 9. Solo referencias (nada de imágenes/Canvas/HTML)");
  const json = JSON.stringify(comp);
  check("la composición no contiene HTML, Canvas ni imágenes embebidas",
    !json.includes("<svg") && !json.includes("<img") && !json.includes("<div") &&
    !json.includes("getContext") && !json.includes("<canvas") && !json.includes("data:image"));
  check("toda ref es un id de asset del manager (`<categoría>:<slug>`)",
    allElements.every((e) => /^[a-z-]+:[a-z0-9_.:-]+$/i.test(e.ref)));

  // ── 10. DETERMINISMO ──
  console.log("\n## 10. Determinismo");
  check("misma entrada ⇒ composición byte a byte", JSON.stringify(comp) === JSON.stringify(composeArtwork(mythic!, artwork, ctx)));
  check("huella determinista y sensible a cambios",
    comp.fingerprint === composeArtwork(mythic!, artwork, ctx).fingerprint &&
    comp.fingerprint !== composeArtwork(gen.cards.find((c) => c.cardId !== "zekken__mythic")!, artwork, ctx).fingerprint);

  // ── 11. COMPAT CARD GENERATOR + RENDIMIENTO ──
  console.log("\n## 11. Compatibilidad con el Card Generator y rendimiento");
  const comps = gen.cards.map((c) => composeArtwork(c, artwork, ctx));
  check("TODA carta de la generación compone y valida (cero refs inválidas)",
    comps.every((c) => validateComposition(c).ok) &&
    comps.every((c) => c.layers.flatMap((l) => l.elements).every((e) => artwork.resolveRef(e.ref) !== null)),
    `${comps.length} cartas`);
  check("huellas únicas por carta", new Set(comps.map((c) => c.fingerprint)).size === comps.length);
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) for (const c of gen.cards) composeArtwork(c, artwork, ctx);
  const ms = Date.now() - t0;
  check(`rendimiento: ${gen.cards.length * 200} composiciones en tiempo razonable`, ms < 3000, `${ms} ms`);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main();
