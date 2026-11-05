import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEAM_PACK_AUDIT, TEAM_LOOKALIKES, TEAM_PACKS_OUTSIDE_TARGETS, teamPackAudit, cardsForTeamValue,
  rosterDiscrepancies, derivedBlockers, deriveStatus, teamPackEconomics, proposedTeamPack, teamCardsInCatalog,
  teamBoostOdds, TEAM_BOOST_WEIGHT, BOOST_MIN_LIFT, BOOST_GUARANTEE_AT,
  type TeamPackAuditEntry,
} from "./teamPackCatalog";
import { isTeamPackCard } from "./teamIdentities";
import { isDraft, isPurchasable, isPubliclyOpenable } from "@/domain/packs/lifecycle";
import { PLAYERS } from "./players";
import { PACKS, getPack } from "./packs";
import { PACK_ART_AVAILABLE } from "./packArtwork";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack";
import { buildPool } from "@/domain/packs/pool";
import { freshPity } from "@/domain/packs/pity";
import { composeDistribution, type PoolDef } from "@/domain/packs/distribution";
import type { PackDef } from "@/domain/packs/types";

/** Los 24 equipos del encargo de la Fase 20.2, por región. */
const REQUESTED: Record<string, string[]> = {
  EMEA: ["Team Heretics", "Fnatic", "Team Liquid", "Karmine Corp", "Gentle Mates", "FUT"],
  Americas: ["G2 Esports", "Leviatán", "NRG", "100 Thieves", "LOUD", "Sentinels"],
  Pacific: ["Paper Rex", "T1", "Nongshim RedForce", "Gen.G", "DRX", "Global Esports"],
  China: ["Edward Gaming", "TYLOO", "Bilibili Gaming", "Xi Lai Gaming", "Trace Esports", "JD Gaming"],
};

const exists = (e: TeamPackAuditEntry): boolean => PACKS.some((p) => p.id === e.packId);
const sorted = <T,>(xs: T[]): T[] => [...xs].sort();

test("CATÁLOGO · los 24 equipos del encargo están auditados, una vez cada uno, en su región", () => {
  assert.equal(TEAM_PACK_AUDIT.length, 24);
  for (const [region, names] of Object.entries(REQUESTED)) {
    assert.deepEqual(
      sorted(TEAM_PACK_AUDIT.filter((e) => e.region === region).map((e) => e.requested)),
      sorted(names), `región ${region}`,
    );
  }
  for (const k of ["requested", "canonical", "packId"] as const) {
    const vals = TEAM_PACK_AUDIT.map((e) => e[k]);
    assert.equal(new Set(vals).size, vals.length, `${k} duplicado`);
  }
});

test("MAPEO CANÓNICO · cada identificador existe en Player.team y pertenece a UN solo equipo", () => {
  const owner = new Map<string, string>();
  for (const e of TEAM_PACK_AUDIT) {
    for (const id of e.identifiers) {
      assert.ok(PLAYERS.some((p) => p.team === id), `«${id}» (${e.requested}) no es un valor de Player.team`);
      assert.ok(!owner.has(id), `«${id}» está en ${owner.get(id)} y en ${e.requested}`);
      assert.ok(!(id in TEAM_LOOKALIKES), `«${id}» está declarado como parecido, no como el equipo`);
      owner.set(id, e.requested);
    }
    if (e.packTeam) assert.ok(e.identifiers.includes(e.packTeam), `${e.requested}: packTeam fuera de sus identificadores`);

    // La región declarada es la de la mayoría de sus jugadores con cartas; si el equipo no tiene ninguna
    // (catálogo diseñado: BLG, TE, JDG), la de sus jugadores.
    const conCartas = e.identifiers.filter((i) => cardsForTeamValue(i) > 0);
    const base = conCartas.length ? conCartas : e.identifiers;
    const regiones = new Map<string, number>();
    for (const p of PLAYERS.filter((x) => base.includes(x.team))) regiones.set(p.region, (regiones.get(p.region) ?? 0) + 1);
    const mayoritaria = [...regiones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    assert.equal(mayoritaria, e.region, `${e.requested}: región`);
  }
  for (const l of Object.keys(TEAM_LOOKALIKES)) assert.ok(PLAYERS.some((p) => p.team === l), `parecido «${l}» inexistente`);
});

test("MAPEO CANÓNICO · ninguna etiqueta compartida mezcla equipos sin declararlo", () => {
  const porTag = new Map<string, Set<string>>();
  for (const p of PLAYERS) {
    const s = porTag.get(p.teamTag ?? "") ?? new Set<string>();
    s.add(p.team);
    porTag.set(p.teamTag ?? "", s);
  }
  for (const [tag, equipos] of porTag) {
    if (equipos.size < 2) continue;
    const e = TEAM_PACK_AUDIT.find((x) => x.identifiers.some((i) => equipos.has(i)));
    if (!e) continue;
    for (const t of equipos) {
      assert.ok(e.identifiers.includes(t) || t in TEAM_LOOKALIKES,
        `la etiqueta ${tag} agrupa «${t}» con ${e.requested} sin que esté declarado`);
    }
  }
  // Y el caso que justifica la lista de parecidos: misma etiqueta, otro equipo.
  const gozen = PLAYERS.find((p) => p.team === "G2 Gozen");
  assert.equal(gozen?.teamTag, "G2");
  assert.ok(!teamPackAudit("G2 Esports")!.identifiers.includes("G2 Gozen"));
});

test("GEN.G / GEN · el detector lo encuentra desde los datos, y el catálogo NO lo da por resuelto", () => {
  assert.ok(cardsForTeamValue("Gen.G") > 0 && cardsForTeamValue("GEN") > 0, "los dos valores tienen cartas");

  // Por qué agrupar por etiqueta no lo habría visto: las etiquetas son distintas.
  const tags = (t: string) => new Set(PLAYERS.filter((p) => p.team === t).map((p) => p.teamTag));
  assert.deepEqual([...tags("Gen.G")], ["GENG"]);
  assert.deepEqual([...tags("GEN")], ["GEN"]);

  // Lo ve el cruce semilla ↔ VLR 2026.
  const d = rosterDiscrepancies();
  assert.ok(d.some((x) => x.catalogTeam === "Gen.G" && x.vlrTeam === "GEN"), "t3xture: Gen.G en catálogo, GEN en VLR");
  assert.ok(d.some((x) => x.catalogTeam === "Gen.G" && x.vlrTeam === "T1"), "Meteor: Gen.G en catálogo, T1 en VLR");

  const e = teamPackAudit("GEN");
  assert.equal(e, teamPackAudit("Gen.G"), "los dos valores resuelven al mismo equipo auditado");
  assert.equal(e!.status, "BLOCKED");
  assert.equal(e!.packTeam, null, "no se elige un canónico sin decisión de producto");
  assert.ok(e!.blockers.includes("IDENTITY_SPLIT"));
  assert.ok(!PACKS.some((p) => p.team === "Gen.G" || p.team === "GEN"), "no existe un sobre de Gen.G");
});

test("DECLARADO = MEDIDO · los bloqueos y el estado de cada equipo salen de los datos", () => {
  for (const e of TEAM_PACK_AUDIT) {
    assert.deepEqual(
      sorted(e.blockers.filter((b) => b !== "IDENTITY_UNPROVEN")),
      sorted(derivedBlockers(e)),
      `${e.requested}: los bloqueos declarados no son los que imponen los datos`,
    );
    assert.equal(e.status, deriveStatus(e.blockers, exists(e)), `${e.requested}: estado`);
    if (e.blockers.includes("IDENTITY_UNPROVEN")) assert.equal(e.packTeam, null, `${e.requested}: identidad sin probar`);
    if (!exists(e) && e.blockers.includes("IDENTITY_SPLIT")) assert.equal(e.packTeam, null, `${e.requested}: identidad dividida`);
  }
  // La regla de estado, sola.
  assert.equal(deriveStatus([], true), "READY");
  assert.equal(deriveStatus(["ARTWORK_PENDING"], false), "PARTIAL");
  assert.equal(deriveStatus(["IDENTITY_SPLIT"], true), "PARTIAL");
  assert.equal(deriveStatus(["IDENTITY_SPLIT", "PRODUCT_NOT_CREATED"], false), "BLOCKED");
  assert.equal(deriveStatus(["IDENTITY_UNPROVEN"], true), "BLOCKED");
});

test("TEAM PACK EXISTENTE · el producto coincide con su auditoría y conserva sus valores de la Fase 20", () => {
  const auditados = new Set([...TEAM_PACK_AUDIT.map((e) => e.packId), ...Object.keys(TEAM_PACKS_OUTSIDE_TARGETS)]);
  for (const p of PACKS.filter((x) => x.team)) assert.ok(auditados.has(p.id), `${p.id} no está auditado`);

  for (const e of TEAM_PACK_AUDIT.filter(exists)) {
    const p = getPack(e.packId)!;
    assert.equal(p.team, e.packTeam, `${p.id}: team`);
    assert.equal(p.restrictRegion, e.region, `${p.id}: región`);
    assert.ok(!p.retired, `${p.id} retirado`);
    assert.ok(!p.guaranteedMin && !p.guarantees?.length, `${p.id}: una garantía convertiría el sesgo en promesa`);
  }
  for (const e of TEAM_PACK_AUDIT.filter((x) => x.status === "READY")) {
    assert.ok(exists(e) && PACK_ART_AVAILABLE.has(e.packId), `${e.requested} READY sin producto o sin artwork`);
  }

  // Preservación: los cuatro Team Packs vivos no se han tocado.
  const fase20: [string, string][] = [["team-heretics", "Team Heretics"], ["team-fnatic", "Fnatic"], ["team-navi", "NAVI"], ["team-g2", "G2"]];
  for (const [id, team] of fase20) {
    const p = getPack(id)!;
    assert.equal(p.team, team, `${id}: team`);
    assert.equal(p.price, 3500, `${id}: precio (3.000 → 3.500 en la F57.6, con su regional)`);
    assert.equal(p.cardCount, 5, `${id}: cartas`);
    assert.deepEqual(p.weights, { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 }, `${id}: pesos`);
  }
});

test("PRECIO · la economía de un Team Pack se DERIVA del regional de su región, y se sabe quién usa 3.500/5/35-40-18-6-1", () => {
  for (const region of ["EMEA", "Americas", "Pacific", "China"] as const) {
    const r = getPack(region.toLowerCase())!;
    assert.deepEqual(teamPackEconomics(region), { price: r.price, cardCount: r.cardCount, weights: r.weights });
  }
  assert.equal(teamPackEconomics("China").weights.epic, 0, "China no promete épicas que no tiene");
  assert.equal(teamPackEconomics("China").weights.legendary, 0);
  assert.throws(() => teamPackEconomics("Marte" as never), /no se puede derivar/);

  // Los cuatro Team Packs vivos cumplen la regla.
  for (const p of PACKS.filter((x) => x.team)) {
    assert.deepEqual({ price: p.price, cardCount: p.cardCount, weights: p.weights }, teamPackEconomics(p.restrictRegion!), p.id);
  }

  // Inventario de §6: exactamente estos productos usan la economía heredada del regional.
  // F57.6: el regional de EMEA/Americas/Pacific (y con él su familia) pasa de 3.000 a 3.500.
  const heredada = PACKS.filter((p) => p.price === 3500 && p.cardCount === 5
    && JSON.stringify(p.weights) === JSON.stringify({ common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 }))
    .map((p) => p.id);
  // Fase 20.5: los Team Packs de EMEA/Americas/Pacific heredan 3.000/5/35-40-18-6-1 del regional;
  // los de China (blg/te/jdg/tyl/xlg) usan 0 épicas/legendarias, así que no entran en esta lista.
  assert.deepEqual(sorted(heredada), sorted([
    "emea", "americas", "pacific", "team-heretics", "team-fnatic", "team-navi", "team-g2",
    // Ola 1
    "team-loud", "team-liquid",
    // Ola 2 (EMEA/Americas/Pacific; TYL y XLG son China y quedan fuera)
    "team-karmine", "team-m8", "team-fut", "team-100t", "team-prx", "team-ns", "team-ge",
    // Ola 3 (Americas)
    "team-lev",
  ]));
});

test("EQUIPO AUSENTE · lo que no está auditado no se inventa, y sin identidad no hay propuesta", () => {
  assert.equal(teamPackAudit(""), undefined);
  assert.equal(teamPackAudit("   "), undefined);
  assert.equal(teamPackAudit("MIBR"), undefined, "MIBR existe en el catálogo pero no es objetivo");
  assert.equal(teamPackAudit("Natus Vincere"), undefined);
  assert.equal(teamPackAudit("Equipo Que No Existe"), undefined);
  assert.equal(teamPackAudit("gen.g")?.requested, "Gen.G", "la búsqueda no distingue mayúsculas");

  for (const e of TEAM_PACK_AUDIT.filter((x) => !x.packTeam)) assert.equal(proposedTeamPack(e), null, e.requested);

  // Toda identidad decidida CON cartas tiene cartas elegibles en SU sobre (regla del sesgo: el equipo
  // IMPRESO, `isTeamPackCard`), y no son casi todo el pool.
  const registry = new CardRegistry();
  for (const e of TEAM_PACK_AUDIT.filter((x) => x.packTeam && !x.blockers.includes("NO_TEAM_CARDS"))) {
    const pack = getPack(e.packId) ?? proposedTeamPack(e)!;
    const flat = buildPool(registry, pack).flat;
    const suyas = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), e.packTeam)).length;
    assert.ok(suyas > 0, `${e.requested}: ninguna carta elegible`);
    assert.ok(flat.length > suyas * 2, `${e.requested}: el pool es casi solo del equipo (${suyas}/${flat.length})`);
  }
  // Y el equipo SIN cartas no se vende: si el producto existe, es DRAFT; no se inventan cartas para él.
  const sinCartas = TEAM_PACK_AUDIT.filter((x) => x.blockers.includes("NO_TEAM_CARDS"));
  assert.deepEqual(sorted(sinCartas.map((x) => x.requested)), ["Bilibili Gaming", "JD Gaming", "Trace Esports"]);
  for (const e of sinCartas) {
    assert.equal(e.status, "BLOCKED");
    assert.equal(teamCardsInCatalog(e), 0);
    const p = getPack(e.packId);
    if (p) assert.ok(isDraft(p) && !isPurchasable(p), `${p.id}: un Team Pack sin cartas del equipo no puede venderse`);
  }
});

test("DUPLICADOS · ninguna propuesta pisa un producto existente, otro equipo u otro nombre", () => {
  const idsVivos = new Set(PACKS.map((p) => p.id));
  const nombresVivos = new Map(PACKS.map((p) => [p.name, p.id]));
  const packTeams = TEAM_PACK_AUDIT.map((e) => e.packTeam).filter(Boolean);
  assert.equal(new Set(packTeams).size, packTeams.length, "dos equipos con el mismo packTeam");

  for (const e of TEAM_PACK_AUDIT) {
    const prop = proposedTeamPack(e);
    if (!prop) continue;
    if (idsVivos.has(e.packId)) {
      assert.equal(getPack(e.packId)!.team, e.packTeam, `${e.packId} ya existe para otro equipo`);
      continue;
    }
    assert.ok(!nombresVivos.has(prop.name), `«${prop.name}» ya es el nombre de ${nombresVivos.get(prop.name)}`);
    assert.ok(!PACKS.some((p) => p.team === e.packTeam), `ya hay un sobre para «${e.packTeam}» con otro id`);
    // Y la propuesta no es un producto: nada la ha colado en el catálogo.
    assert.equal(getPack(e.packId), undefined);
  }
});

test("DISTRIBUCIÓN · con los pools que crearían migrate + boost, el equipo es MÁS probable y NO está garantizado", () => {
  // El peso sale del script que crea los pools, no se copia.
  const boostSrc = readFileSync(join(process.cwd(), "scripts", "content-pools-boost.ts"), "utf8");
  const W = Number(boostSrc.match(/TEAM_BOOST_WEIGHT\s*=\s*(\d+)/)?.[1]);
  assert.ok(W > 1, "no se encuentra TEAM_BOOST_WEIGHT");

  const registry = new CardRegistry();
  const NOW = 1_700_000_000_000;
  const N = 500;
  const casos: PackDef[] = [
    getPack("team-g2")!,
    proposedTeamPack(teamPackAudit("Team Liquid")!)!,
    proposedTeamPack(teamPackAudit("LOUD")!)!,
    // Antes Trace Esports (China). Con el catálogo diseñado ningún Team Pack de China cumple la regla (TE/BLG/JDG
    // sin cartas; TYL con épicas que China pesa a 0; XLG convertido en garantía — ver sus notas): Pacific.
    proposedTeamPack(teamPackAudit("Paper Rex")!)!,
  ];

  for (const pack of casos) {
    const flat = buildPool(registry, pack).flat;
    const delEquipo = new Set(flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team)).map((c) => c.id));

    // Mismas formas que `content-pools:migrate` (EXPLICIT, peso 1, prioridad 100) y `content-pools:boost` (RULE, prioridad 50).
    const base: PoolDef = { id: `pack-${pack.id}`, mode: "EXPLICIT", rules: {}, entries: flat.map((c) => ({ cardId: c.id, weight: 1, mode: "INCLUDE" })) };
    const boost: PoolDef = { id: `boost-${pack.id}`, mode: "RULE", rules: {}, entries: [...delEquipo].map((cardId) => ({ cardId, weight: W, mode: "INCLUDE" })) };
    const dist = composeDistribution([{ pool: base, priority: 100 }, { pool: boost, priority: 50 }], NOW)!;
    assert.equal(dist.members?.size, flat.length, `${pack.id}: el sesgo no puede ensanchar ni estrechar el sobre`);
    assert.equal(dist.weightOf([...delEquipo][0]), W);

    const medir = (motor: PackEngine) => {
      let suyas = 0, total = 0, conAlguna = 0, ajenas = 0;
      const elegibles = new Set(flat.map((c) => c.id));
      for (let i = 0; i < N; i++) {
        const r = motor.open(pack, { seed: (0x9e3779b9 + i * 7919) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: NOW });
        let enEste = 0;
        for (const ins of r.instances) {
          assert.ok(elegibles.has(ins.cardId), `${pack.id}: salió ${ins.cardId}, fuera de su pool`);
          total++;
          if (delEquipo.has(ins.cardId)) { suyas++; enEste++; } else ajenas++;
        }
        if (enEste > 0) conAlguna++;
        assert.equal(r.instances.length, pack.cardCount);
      }
      return { cuota: suyas / total, pAlguna: conAlguna / N, ajenas };
    };

    const sin = medir(new PackEngine(registry));
    const con = medir(new PackEngine(registry, (id) => (id === pack.id ? dist : null)));

    assert.ok(con.cuota > sin.cuota * 1.5, `${pack.id}: cuota ${sin.cuota.toFixed(3)} → ${con.cuota.toFixed(3)}`);
    assert.ok(con.pAlguna < 0.99, `${pack.id}: P(≥1) = ${con.pAlguna} sería una garantía`);
    assert.ok(con.ajenas > 0, `${pack.id}: no salió ninguna carta de otro equipo`);
  }
});

test("CHINA · TYL y XLG: el sesgo canónico no puede cumplir el contrato del Team Pack, y el catálogo lo deriva", () => {
  // Un solo peso para todos los Team Packs: el del script que crea los pools.
  const boostSrc = readFileSync(join(process.cwd(), "scripts", "content-pools-boost.ts"), "utf8");
  assert.equal(TEAM_BOOST_WEIGHT, Number(boostSrc.match(/TEAM_BOOST_WEIGHT\s*=\s*(\d+)/)?.[1]));

  const registry = new CardRegistry();
  const NOW = 1_700_000_000_000;
  const medir = (pack: PackDef, N: number) => {
    const flat = buildPool(registry, pack).flat;
    const suyas = new Set(flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team)).map((c) => c.id));
    const base: PoolDef = { id: `pack-${pack.id}`, mode: "EXPLICIT", rules: {}, entries: flat.map((c) => ({ cardId: c.id, weight: 1, mode: "INCLUDE" })) };
    const boost: PoolDef = { id: `boost-${pack.id}`, mode: "RULE", rules: {}, entries: [...suyas].map((cardId) => ({ cardId, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" })) };
    const dist = composeDistribution([{ pool: base, priority: 100 }, { pool: boost, priority: 50 }], NOW)!;
    const motor = new PackEngine(registry, (id) => (id === pack.id ? dist : null));
    let del = 0, total = 0, conAlguna = 0;
    for (let i = 0; i < N; i++) {
      const r = motor.open(pack, { seed: (0x2545f491 + i * 7919) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: NOW });
      const n = r.instances.filter((x) => suyas.has(x.cardId)).length;
      del += n; total += r.instances.length; if (n > 0) conAlguna++;
    }
    return { cuota: del / total, pAlguna: conAlguna / N, suyas: suyas.size, flat: flat.length };
  };

  // La matemática exacta coincide con el motor real (tolerancia de muestreo).
  for (const id of ["team-xlg", "team-g2", "team-navi"]) {
    const pack = getPack(id)!;
    const odds = teamBoostOdds({ packId: id } as TeamPackAuditEntry)!;
    const m = medir(pack, 2000);
    assert.ok(Math.abs(m.cuota - odds.boosted) < 0.02, `${id}: motor ${m.cuota.toFixed(3)} ≠ exacta ${odds.boosted.toFixed(3)}`);
    assert.ok(Math.abs(m.pAlguna - odds.atLeastOne) < 0.03, `${id}: P(≥1) motor ${m.pAlguna.toFixed(3)} ≠ exacta ${odds.atLeastOne.toFixed(3)}`);
  }

  // TYL: 5 cartas, todas Champions S y todas las Champions de China. Pack Opening 3.1: China sortea por plan y la Champions
  // solo cabe en la carta destacada (6 %), así que sus cartas salen poco y el sesgo no tiene a quién ganar dentro de la clase.
  const tyl = teamPackAudit("TYL")!;
  const tylPack = getPack("team-tyl")!;
  const tylPool = buildPool(registry, tylPack).pool;
  const tylCards = tylPool.epic.filter((c) => isTeamPackCard(c, registry.player(c.playerId), "TYL"));
  assert.equal(tylCards.length, 5);
  assert.equal(tylPool.epic.length, 5, "las épicas de China son exactamente las de TYL: el sesgo no tiene a quién ganar");
  const to = teamBoostOdds(tyl)!;
  assert.ok(Math.abs(to.boosted - to.unboosted) < 1e-12 && to.boosted > 0 && to.boosted < 0.02, JSON.stringify(to));
  assert.ok(Math.abs(medir(tylPack, 2000).cuota - to.boosted) < 0.01);
  assert.ok(derivedBlockers(tyl).includes("BOOST_INEFFECTIVE"));

  // XLG: 10 de los 29 Masters de China; con el plan de China (Pack Opening 3.1) y el sesgo ×5, P(≥1) ≈ 99,4 %: una garantía.
  const xlg = teamPackAudit("XLG")!;
  const xo = teamBoostOdds(xlg)!;
  assert.ok(1 - Math.pow(1 - xo.unboosted, 5) < BOOST_GUARANTEE_AT);
  assert.ok(xo.atLeastOne >= BOOST_GUARANTEE_AT, `XLG P(≥1) = ${xo.atLeastOne}`);
  assert.ok(xo.boosted > xo.unboosted * BOOST_MIN_LIFT);
  assert.ok(derivedBlockers(xlg).includes("BOOST_IS_GUARANTEE"));

  for (const e of [tyl, xlg]) {
    const p = getPack(e.packId)!;
    assert.equal(e.status, "BLOCKED");
    assert.ok(isDraft(p) && !isPurchasable(p) && !isPubliclyOpenable(p), `${p.id}: sigue DRAFT, ni se compra ni se abre`);
    assert.deepEqual({ price: p.price, cardCount: p.cardCount, weights: p.weights }, teamPackEconomics("China"), `${p.id}: economía del regional, sin tocar`);
    assert.equal(p.guarantees, undefined);
    assert.equal(p.guaranteedMin, undefined);
  }

  // Y ningún Team Pack a la venta tiene un sesgo inútil o convertido en garantía.
  for (const p of PACKS.filter((x) => x.team && isPurchasable(x))) {
    const odds = teamBoostOdds({ packId: p.id } as TeamPackAuditEntry)!;
    assert.ok(odds.boosted > odds.unboosted * BOOST_MIN_LIFT && odds.atLeastOne < BOOST_GUARANTEE_AT, `${p.id}: ${JSON.stringify(odds)}`);
  }
});
