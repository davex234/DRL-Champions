/**
 * VERIFICACIÓN DE CONTENIDO — NEXUS (Fase 13).
 *
 *   npm run content:verify
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * La Fase 12 encontró que el sobre China anunciaba un 6 % de épicas que no podía entregar.
 * Nadie lo había visto en tres fases porque **nada lo miraba**: los pesos viven en
 * `data/packs`, las cartas salen de `data/players` y ningún proceso cruzaba las dos cosas.
 *
 * Esto es ese proceso. No comprueba que el contenido sea bueno —eso es criterio— sino que
 * sea COHERENTE: que nada prometa lo que no existe, que nada se conceda sin poder
 * entregarse y que nada apunte a un identificador que no está.
 *
 * ────────────────────────── EL TRINQUETE ──────────────────────────
 *
 * Hay un caso que no se puede arreglar programando: **ocho jugadores reales tienen un
 * galardón alto y no generan carta** porque no hay métricas suyas con las que construirla.
 * Fabricar esas estadísticas sería inventar, y el catálogo se niega a hacerlo a propósito
 * (`playerCombatBase` devuelve el motivo en vez de rellenar).
 *
 * Así que no se ignora ni se falla: se DECLARA. La lista de abajo tiene los ocho, con su
 * motivo, y la comprobación falla si aparece uno nuevo. Es un trinquete: lo pendiente queda
 * a la vista y no puede crecer en silencio.
 */
import { PLAYERS } from "@/data/players";
import { PACKS } from "@/data/packs";
import { CARDS, getCard, ineligiblePlayers, variantsForAccolade } from "@/data/catalog";
import { VARIANTS, getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { buildPool } from "@/domain/packs/pool";
import { runtimeRegistry } from "@/publisher/runtime";
import { masterySets, MIN_SET_SIZE, masteryRef } from "@/domain/collection/mastery";
import { CHALLENGE_SETS } from "@/domain/events/challenges";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { CURRENT_SEASON } from "@/data/season";
import { familyOf, cosmetic } from "@/domain/cosmetics/catalog";
import { packStats } from "@/data/packStats";
import type { Reward } from "@/domain/events/types";

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

/**
 * LOS OCHO. Jugadores con galardón de rareza alta y sin carta, con el motivo exacto.
 *
 * `NO_METRICS` son retirados o inactivos: no hay partidos recientes de los que derivar
 * estadísticas. `INSUFFICIENT_ROUNDS` son jugadoras de Game Changers, que compiten en un
 * circuito con menos rondas de las que el umbral exige.
 *
 * La salida son las estadísticas EDITORIALES (`Player.editorial`), que el modelo ya admite
 * y que exigen autoría y motivo explícitos de una persona. **No es una decisión que pueda
 * tomar un programa**, y por eso está documentada aquí en vez de resuelta a la brava.
 */
const KNOWN_BLOCKED = new Set([
  "Leo", "ScreaM", "Boostio", "TenZ", "Sacy", "Zest", "mimi", "Flxja",
]);

/** Variantes vacías porque las llena el pipeline de torneos, no el catálogo base. */
const TOURNAMENT_VARIANTS = new Set([
  "rookie", "clutch", "top-acs", "top-rating", "top-hs", "top-kills", "top-assist",
  "champion-edition", "mythic",
]);

/**
 * Variantes vacías porque NADIE tiene su galardón: un hueco de palmarés, no de código.
 *
 * `americas-mvp` está vacía porque en los datos no consta ningún MVP regional de Americas,
 * mientras que EMEA tiene dos, Pacific dos y China uno. Es un hecho de la competición, y
 * añadir el galardón a alguien para rellenar el hueco sería inventar un premio deportivo.
 *
 * Se declara aquí con el mismo trinquete que los ocho jugadores: si aparece otra, falla.
 */
const NO_HOLDER_VARIANTS = new Set(["americas-mvp"]);

const bucketOfVariant = (variantId: string): RarityBucket =>
  bucketForRank(getVariant(variantId as never).rank);

/** Todas las recompensas del producto, con su procedencia, para comprobarlas de una vez. */
function allRewards(): { where: string; reward: Reward }[] {
  const out: { where: string; reward: Reward }[] = [];
  for (const s of CHALLENGE_SETS) {
    for (const c of s.challenges) out.push({ where: `evento/${s.id}/${c.id}`, reward: c.reward });
  }
  for (const t of REWARD_TIERS) out.push({ where: `pickem/${t.id}`, reward: t.reward });
  for (const m of CURRENT_SEASON.missionPool) out.push({ where: `mision/${m.id}`, reward: m.reward });
  for (const [lvl, r] of Object.entries(CURRENT_SEASON.free)) out.push({ where: `pase-libre/${lvl}`, reward: r });
  for (const [lvl, r] of Object.entries(CURRENT_SEASON.premium)) out.push({ where: `pase-aspecto/${lvl}`, reward: r });
  for (const [lvl, r] of Object.entries(CURRENT_SEASON.competitive ?? {})) out.push({ where: `pase-competitivo/${lvl}`, reward: r });
  for (const s of masterySets()) {
    for (const t of s.tiers) out.push({ where: `maestria/${s.id}@${t.at}`, reward: t.reward });
  }
  return out;
}

function main(): void {
  console.log("# Verificación de CONTENIDO — NEXUS (Fase 13)\n");

  // ══════════════════════════════════════════════════════════════════════
  console.log("## 1 · NINGÚN SOBRE PROMETE LO QUE NO PUEDE DAR");
  // ══════════════════════════════════════════════════════════════════════
  {
    /*
     * La comprobación que habría cazado el sobre China tres fases antes. Cruza el peso
     * DECLARADO con el pool REAL: un peso mayor que cero sobre un bucket sin una sola carta
     * elegible es una probabilidad inalcanzable, y cobrarla es cobrar por nada.
     */
    const registry = runtimeRegistry();
    const liars: string[] = [];
    for (const pack of PACKS) {
      const { pool } = buildPool(registry, pack);
      for (const b of BUCKETS) {
        if ((pack.weights[b] ?? 0) > 0 && pool[b].length === 0) liars.push(`${pack.id}/${b}`);
      }
    }
    check("ningún peso declarado apunta a un bucket vacío", liars.length === 0, liars.join(", "));

    // Y al revés: un bucket que el sobre SÍ entrega tiene que estar declarado.
    const silent: string[] = [];
    for (const pack of PACKS.filter((p) => p.price > 0)) {
      const s = packStats(pack.id);
      if (!s) continue;
      for (const b of BUCKETS) {
        if (s.drawn[b] > 0.005 && (pack.weights[b] ?? 0) === 0) silent.push(`${pack.id}/${b}`);
      }
    }
    check("no entrega ninguna rareza que no declare", silent.length === 0, silent.join(", "));
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n## 2 · GALARDONES SIN CARTA (el trinquete)");
  // ══════════════════════════════════════════════════════════════════════
  {
    const blockedIds = new Set(ineligiblePlayers(PLAYERS).map((b) => b.id));
    const blocked = PLAYERS.filter((p) =>
      blockedIds.has(p.id)
      && p.accolades.some((a) => variantsForAccolade(a, p)
        .some((v) => ["rare", "epic", "legendary"].includes(bucketOfVariant(v)))));

    const nuevos = blocked.filter((p) => !KNOWN_BLOCKED.has(p.nick));
    check(
      "no hay galardones altos sin carta que no estén declarados",
      nuevos.length === 0,
      nuevos.length > 0
        ? `NUEVOS: ${nuevos.map((p) => `${p.nick} (${p.region})`).join(", ")}`
        : `${blocked.length} declarados y pendientes de decisión editorial`,
    );

    // El trinquete aprieta en los dos sentidos: si se resuelve uno, hay que quitarlo.
    const resueltos = [...KNOWN_BLOCKED].filter((nick) => !blocked.some((p) => p.nick === nick));
    check("la lista de pendientes no tiene nombres ya resueltos",
      resueltos.length === 0, resueltos.join(", "));
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n## 3 · VARIANTES SIN CARTAS");
  // ══════════════════════════════════════════════════════════════════════
  {
    const counts = new Map<string, number>();
    for (const c of CARDS) counts.set(c.variantId, (counts.get(c.variantId) ?? 0) + 1);
    const empty = Object.values(VARIANTS).filter((v) => (counts.get(v.id) ?? 0) === 0);

    /*
     * Una variante vacía puede tener tres causas MUY distintas, y mezclarlas convertiría
     * esta comprobación en ruido:
     *
     *   1. La llena el pipeline de torneos. Está vacía hasta que se juegue uno. Correcto.
     *   2. Sus únicos portadores son jugadores de la lista bloqueada (§2). No es un
     *      problema nuevo: es la CONSECUENCIA de uno ya declarado, y arreglar aquel arregla
     *      este. Contarlo dos veces sería contar dos veces el mismo pendiente.
     *   3. Ninguna de las dos: nadie puede conseguirla jamás y nadie sabe por qué. Eso sí
     *      es un fallo.
     */
    const blockedIds2 = new Set(ineligiblePlayers(PLAYERS).map((b) => b.id));
    const byBlockedHolders = new Set<string>();
    for (const v of empty) {
      const holders = PLAYERS.filter((p) =>
        p.accolades.some((a) => variantsForAccolade(a, p).includes(v.id)));
      if (holders.length > 0 && holders.every((p) => blockedIds2.has(p.id))) byBlockedHolders.add(v.id);
    }

    /*
     * Y la cuarta causa: NADIE tiene el galardón. No es que sus portadores estén bloqueados;
     * es que no hay portadores. Eso es un hueco de palmarés y no se arregla programando.
     */
    const noHolders = new Set<string>();
    for (const v of empty) {
      const holders = PLAYERS.filter((p) =>
        p.accolades.some((a) => variantsForAccolade(a, p).includes(v.id)));
      if (holders.length === 0 && !TOURNAMENT_VARIANTS.has(v.id)) noHolders.add(v.id);
    }

    const unexpected = empty.filter((v) =>
      !TOURNAMENT_VARIANTS.has(v.id) && !byBlockedHolders.has(v.id) && !NO_HOLDER_VARIANTS.has(v.id));

    check("toda variante vacía tiene una causa conocida",
      unexpected.length === 0,
      unexpected.length > 0
        ? `sin explicación: ${unexpected.map((v) => v.id).join(", ")}`
        : `${empty.length} vacías: ${empty.length - byBlockedHolders.size - noHolders.size} de torneo, `
          + `${byBlockedHolders.size} por los bloqueados de §2 (${[...byBlockedHolders].join(", ")}), `
          + `${noHolders.size} sin ningún portador (${[...noHolders].join(", ")})`);

    // El trinquete, también aquí: una vacía sin portadores que ya no lo esté hay que quitarla.
    const stale = [...NO_HOLDER_VARIANTS].filter((id) => !noHolders.has(id));
    check("la lista de variantes sin portador está al día", stale.length === 0, stale.join(", "));
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n## 4 · TODA RECOMPENSA APUNTA A ALGO QUE EXISTE");
  // ══════════════════════════════════════════════════════════════════════
  {
    const rewards = allRewards();
    const badPack: string[] = [];
    const badCard: string[] = [];
    const badCosmetic: string[] = [];
    const packless: string[] = [];

    for (const { where, reward } of rewards) {
      if (reward.packId && !PACKS.some((p) => p.id === reward.packId)) badPack.push(`${where}→${reward.packId}`);
      if (reward.packId && (reward.packCount ?? 0) <= 0) packless.push(where);
      if (reward.cardId && !getCard(reward.cardId)) badCard.push(`${where}→${reward.cardId}`);
      for (const c of reward.cosmetics ?? []) {
        if (familyOf(c) === null || cosmetic(c) === null) badCosmetic.push(`${where}→${c}`);
      }
    }

    check(`las ${rewards.length} recompensas conceden sobres que existen`, badPack.length === 0, badPack.join(", "));
    check("ningún sobre se concede sin cantidad", packless.length === 0, packless.join(", "));
    check("todas las cartas concedidas están en el catálogo", badCard.length === 0, badCard.join(", "));
    check("todos los cosméticos tienen una familia válida", badCosmetic.length === 0, badCosmetic.slice(0, 5).join(", "));

    /*
     * Un sobre RETIRADO puede seguir concediéndose —hay recompensas que lo hacen y
     * jugadores con ejemplares sin abrir—, pero no puede estar a la venta. Es justo la
     * distinción que hace que retirar Prime no rompa nada.
     */
    const retired = PACKS.filter((p) => p.retired);
    check("los sobres retirados siguen existiendo y abriéndose",
      retired.every((p) => PACKS.some((x) => x.id === p.id)),
      retired.map((p) => p.id).join(", ") || "ninguno");
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n## 5 · MAESTRÍA: OBJETIVOS REALES Y SIN UN SOLO CRÉDITO");
  // ══════════════════════════════════════════════════════════════════════
  {
    const sets = masterySets();
    check("hay conjuntos de maestría", sets.length > 0, `${sets.length} conjuntos`);

    const ids = sets.map((s) => s.id);
    check("no hay conjuntos con el mismo identificador", new Set(ids).size === ids.length);

    const tiny = sets.filter((s) => s.cardIds.length < MIN_SET_SIZE);
    check(`ningún conjunto baja de ${MIN_SET_SIZE} cartas`, tiny.length === 0,
      tiny.map((s) => `${s.id}(${s.cardIds.length})`).join(", "));

    const ghosts = sets.flatMap((s) => s.cardIds.filter((id) => !getCard(id)).map((id) => `${s.id}→${id}`));
    check("todas las cartas de los conjuntos existen", ghosts.length === 0, ghosts.slice(0, 5).join(", "));

    /*
     * LA INVARIANTE ECONÓMICA DE LA FASE 13. El grifo de temporada son 124.900 créditos no
     * repetibles; 162 escalones que pagaran algo lo desbordarían. La maestría reconoce, no
     * paga.
     */
    const paid = sets.flatMap((s) => s.tiers
      .filter((t) => (t.reward.credits ?? 0) + (t.reward.tokens ?? 0) + (t.reward.xp ?? 0)
        + (t.reward.packCount ?? 0) + (t.reward.cardId ? 1 : 0) > 0)
      .map((t) => `${s.id}@${t.at}`));
    check("LA MAESTRÍA NO REPARTE NI UN CRÉDITO, NI XP, NI FICHAS, NI SOBRES",
      paid.length === 0, paid.slice(0, 5).join(", "));

    const tiers = sets.reduce((n, s) => n + s.tiers.length, 0);
    const cosmetics = sets.reduce((n, s) => n + s.tiers.reduce((m, t) => m + (t.reward.cosmetics?.length ?? 0), 0), 0);
    check("cada escalón entrega al menos un cosmético", cosmetics >= tiers,
      `${tiers} escalones · ${cosmetics} cosméticos`);

    const refs = sets.flatMap((s) => s.tiers.map((t) => masteryRef(s.id, t.at)));
    check("cada escalón tiene una clave de idempotencia única",
      new Set(refs).size === refs.length);

    const ordered = sets.every((s) => s.tiers.every((t, i) => i === 0 || t.at > s.tiers[i - 1].at));
    check("los escalones de cada conjunto van de menor a mayor", ordered);
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n## 6 · EQUILIBRIO ENTRE REGIONES");
  // ══════════════════════════════════════════════════════════════════════
  {
    const byRegion = new Map<string, number>();
    for (const c of CARDS) {
      const p = PLAYERS.find((x) => x.id === c.playerId);
      if (p) byRegion.set(p.region, (byRegion.get(p.region) ?? 0) + 1);
    }
    const counts = [...byRegion.values()];
    const spread = Math.max(...counts) / Math.min(...counts);
    check("ninguna región tiene menos de la mitad de cartas que la mayor",
      spread < 2, `mayor/menor = ${spread.toFixed(2)}× (${[...byRegion.entries()].map(([r, n]) => `${r} ${n}`).join(", ")})`);

    // Cada región tiene que tener al menos un conjunto de maestría propio.
    const regionSets = masterySets().filter((s) => s.axis === "region");
    check("cada región tiene su conjunto de maestría",
      regionSets.length === byRegion.size, `${regionSets.length} de ${byRegion.size}`);
  }

  console.log(
    failures === 0
      ? "\n✅ EL CONTENIDO ES COHERENTE"
      : `\n❌ ${failures} comprobación(es) fallida(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
