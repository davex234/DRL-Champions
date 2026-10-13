import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEAM_IDENTITIES, resolveTeamIdentity, teamIdentityById, candidateIdentities, isAmbiguousAlias,
  currentTeamIdentity, historicalTeamContext, isCurrentAlias, isHistoricalAlias,
  normalizeAlias, identitySlug, masterySetIdForAlias, type TeamIdentity,
} from "./teamIdentities";
import { TEAM_PACK_AUDIT, deriveStatus, teamPackAudit, type TeamPackBlocker } from "./teamPackCatalog";
import { PACKS } from "./packs";
import { PLAYERS } from "./players";
import { CARDS, getPlayer } from "./catalog";

const byId = (id: string): TeamIdentity => teamIdentityById(id)!;

// ─────────────────────────────────────────────────────────────────────────────
// 1 · RESOLUCIÓN DE ALIAS
// ─────────────────────────────────────────────────────────────────────────────
test("1 · resolución de alias — exacto, por nombre, por id canónico y por etiqueta", () => {
  assert.equal(resolveTeamIdentity("TL")?.canonicalId, "team-liquid");
  assert.equal(resolveTeamIdentity("Team Liquid")?.canonicalId, "team-liquid");
  assert.equal(resolveTeamIdentity("team-liquid")?.canonicalId, "team-liquid", "por canonicalId");
  assert.equal(resolveTeamIdentity("FNC")?.canonicalId, "fnatic");
  assert.equal(resolveTeamIdentity("Leviatán")?.canonicalId, "leviatan", "por displayName con acento");
  assert.equal(resolveTeamIdentity("LEV")?.canonicalId, "leviatan");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · ALIASES ACTUALES
// ─────────────────────────────────────────────────────────────────────────────
test("2 · currentTeamIdentity solo responde a alias de roster ACTUAL", () => {
  assert.equal(currentTeamIdentity("FNC")?.canonicalId, "fnatic", "FNC es actual");
  assert.ok(isCurrentAlias("TL"));
  assert.ok(isCurrentAlias("TH") && isCurrentAlias("Team Heretics"), "Heretics tiene dos alias actuales");
  // Un histórico NO es actual:
  assert.equal(currentTeamIdentity("Fnatic"), undefined, "«Fnatic» (semilla impura) no es roster actual");
  assert.equal(currentTeamIdentity("Team Liquid"), undefined, "«Team Liquid» es histórico");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · ALIASES HISTÓRICOS
// ─────────────────────────────────────────────────────────────────────────────
test("3 · historicalTeamContext solo responde a alias históricos, y no los vuelve actuales", () => {
  assert.equal(historicalTeamContext("Fnatic")?.canonicalId, "fnatic");
  assert.equal(historicalTeamContext("Team Liquid")?.canonicalId, "team-liquid");
  assert.ok(isHistoricalAlias("Karmine Corp"));
  // Un alias actual NO es histórico:
  assert.equal(historicalTeamContext("FNC"), undefined);
  assert.equal(historicalTeamContext("TL"), undefined);
  // Y un histórico nunca cuenta como actual (decisión B):
  assert.ok(!isCurrentAlias("Fnatic") && isHistoricalAlias("Fnatic"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · VERIFIED / UNVERIFIED  (alineado con la auditoría 20.2, ya testeada)
// ─────────────────────────────────────────────────────────────────────────────
test("4 · el status coincide con el estado de la auditoría 20.2 (BLOCKED ⇒ unverified)", () => {
  // Todo unverified debe declarar un motivo; todo verified, ninguno.
  for (const id of TEAM_IDENTITIES) {
    if (id.status === "unverified") assert.ok(id.unverifiedReason && id.unverifiedReason.length > 10, `${id.canonicalId} sin motivo`);
    else assert.equal(id.unverifiedReason, undefined, `${id.canonicalId} verified con motivo`);
  }
  // Para las identidades que corresponden a un equipo objetivo, el status se deriva del audit:
  // BLOCKED ⇒ unverified; READY/PARTIAL ⇒ verified. (gen/gen-g se comprueban aparte en el test A.)
  // Los bloqueos de ECONOMÍA del sobre (el sesgo no actúa o es una garantía: TYL, XLG) no dicen nada de quién es
  // el equipo: el estado de identidad se deriva sin ellos.
  const ECONOMIA: TeamPackBlocker[] = ["BOOST_INEFFECTIVE", "BOOST_IS_GUARANTEE"];
  const map: [string, string][] = [
    ["team-heretics", "Team Heretics"], ["fnatic", "Fnatic"], ["team-liquid", "Team Liquid"],
    ["karmine-corp", "Karmine Corp"], ["m8", "Gentle Mates"], ["fut", "FUT"],
    ["g2", "G2 Esports"], ["leviatan", "Leviatán"], ["nrg", "NRG"], ["100t", "100 Thieves"],
    ["loud", "LOUD"], ["sentinels", "Sentinels"], ["paper-rex", "Paper Rex"], ["t1", "T1"],
    ["ns", "Nongshim RedForce"], ["drx", "DRX"], ["ge", "Global Esports"],
    ["edward-gaming", "Edward Gaming"], ["tyl", "TYLOO"], ["blg", "Bilibili Gaming"],
    ["xlg", "Xi Lai Gaming"], ["te", "Trace Esports"], ["jdg", "JD Gaming"],
  ];
  for (const [canonicalId, requested] of map) {
    const audit = teamPackAudit(requested)!;
    const identidad = deriveStatus(audit.blockers.filter((b) => !ECONOMIA.includes(b)), PACKS.some((p) => p.id === audit.packId));
    const expected = identidad === "BLOCKED" ? "unverified" : "verified";
    assert.equal(byId(canonicalId).status, expected, `${canonicalId} ↔ ${requested} (audit ${audit.status})`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · CASOS AMBIGUOS  (decisión 11)
// ─────────────────────────────────────────────────────────────────────────────
test("5 · un alias reclamado por >1 identidad no se resuelve a ninguno", () => {
  // Hoy no hay colisiones declaradas — lo comprobamos y además probamos la SALVAGUARDA con
  // una entrada sintética que sí colisiona, sin tocar el registro real.
  for (const [, ids] of ((): Map<string, TeamIdentity[]> => {
    const m = new Map<string, TeamIdentity[]>();
    for (const id of TEAM_IDENTITIES) {
      for (const a of [...id.currentAliases, ...id.historicalAliases, id.displayName, id.canonicalId]) {
        const k = normalizeAlias(a);
        const l = m.get(k) ?? []; if (!l.includes(id)) l.push(id); m.set(k, l);
      }
    }
    return m;
  })()) {
    assert.ok(ids.length <= 1, `alias colisiona entre ${ids.map((i) => i.canonicalId).join(", ")}`);
  }
  // La salvaguarda en sí: candidateIdentities distingue 0/1/≥2, y resolve devuelve undefined si ≥2.
  assert.equal(isAmbiguousAlias("G2"), false, "G2 solo pertenece a g2 (G2 Gozen es «G2 Gozen»)");
  assert.equal(candidateIdentities("noexiste").length, 0);
  assert.equal(candidateIdentities("G2").length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 · PRESERVACIÓN DE setId / slugs  (§I del informe)
// ─────────────────────────────────────────────────────────────────────────────
test("6 · masterySetIdForAlias reproduce el setId existente (cero huérfanos)", () => {
  // El slug debe ser idéntico al de domain/collection/mastery para no renombrar conjuntos.
  const masterySrc = readFileSync(join(process.cwd(), "src", "domain", "collection", "mastery.ts"), "utf8");
  assert.match(masterySrc, /equipo:\$\{slug\(team\)\}/, "mastery sigue usando equipo:${slug(team)}");
  // Valores conocidos que hoy existen como conjuntos de maestría:
  assert.equal(masterySetIdForAlias("Team Heretics"), "equipo:team-heretics");
  assert.equal(masterySetIdForAlias("Gen.G"), "equipo:gen-g");
  assert.equal(masterySetIdForAlias("GEN"), "equipo:gen");
  assert.equal(masterySetIdForAlias("Fnatic"), "equipo:fnatic");
  assert.equal(masterySetIdForAlias("Leviatán"), "equipo:leviatan");
  // identitySlug == el slug de mastery para cualquier string.
  for (const s of ["Team Heretics", "Gen.G", "GEN", "Leviatán", "EDward Gaming", "100T"]) {
    assert.equal(`equipo:${identitySlug(s)}`, masterySetIdForAlias(s));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 · COBERTURA  (§K9, acotada a lo que el informe soporta)
// ─────────────────────────────────────────────────────────────────────────────
test("7 · cobertura — todo identificador real (Player.team) de los 24 objetivos resuelve", () => {
  assert.equal(TEAM_PACK_AUDIT.length, 24);
  // Los `identifiers` SON valores reales de Player.team; deben resolver todos. Los nombres de
  // marca de `requested` (p. ej. «Gentle Mates») NO son valores de Player.team y, por decisión,
  // el registro no inventa alias que no estén en los datos — por eso no se exige que resuelvan.
  for (const e of TEAM_PACK_AUDIT) {
    for (const idfr of e.identifiers) {
      assert.ok(PLAYERS.some((p) => p.team === idfr), `«${idfr}» no es un Player.team real`);
      assert.ok(resolveTeamIdentity(idfr), `identificador «${idfr}» (${e.requested}) no resuelve`);
    }
    // Gen.G es el único objetivo cuyos dos identificadores resuelven a identidades DISTINTAS
    // (separación por decisión 10); el resto agrupa todos sus identificadores en una identidad.
    const canon = [...new Set(e.identifiers.map((i) => resolveTeamIdentity(i)!.canonicalId))];
    if (e.requested === "Gen.G") assert.equal(canon.length, 2, "Gen.G/GEN deben quedar separados");
    else assert.equal(canon.length, 1, `${e.requested}: sus identificadores deben agrupar en una identidad`);
  }
  // Todo alias declarado tiene su lado (actual o histórico) y ninguna identidad queda sin alias.
  for (const id of TEAM_IDENTITIES) {
    assert.ok(id.currentAliases.length + id.historicalAliases.length + 1 >= 1);
    for (const a of id.currentAliases) assert.ok(isCurrentAlias(a), `${a} debería ser actual`);
    for (const a of id.historicalAliases) assert.ok(isHistoricalAlias(a), `${a} debería ser histórico`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 · AUSENCIA DE RESOLUCIÓN INCORRECTA  (§K, decisión C)
// ─────────────────────────────────────────────────────────────────────────────
test("8 · alias desconocido / vacío → undefined, nunca una identidad falsa", () => {
  // Catálogo diseñado (2026-09-21): AG, MIBR, ZETA, KRÜ… tienen cartas y YA tienen identidad (ver test 9).
  // Lo que no existe en el registro sigue sin resolver.
  for (const bad of ["", "   ", "Equipo Inexistente", "BST", "xyz123"]) {
    assert.equal(resolveTeamIdentity(bad), undefined, `«${bad}» no debería resolver`);
    assert.equal(currentTeamIdentity(bad), undefined);
    assert.equal(historicalTeamContext(bad), undefined);
  }
  assert.equal(resolveTeamIdentity(null), undefined);
  assert.equal(resolveTeamIdentity(undefined), undefined);
  // «MIBR» tiene cartas: identidad propia, pero `unverified` (no es rival de campaña ni Team Pack).
  assert.ok(PLAYERS.some((p) => p.team === "MIBR"));
  assert.equal(resolveTeamIdentity("MIBR")?.canonicalId, "mibr");
  assert.equal(resolveTeamIdentity("MIBR")?.status, "unverified");
});

test("9 · todo equipo con cartas en el catálogo resuelve a UNA identidad, sin fusionar equipos distintos", () => {
  const conCartas = new Set(CARDS.map((c) => getPlayer(c.playerId)!.team));
  for (const team of conCartas) {
    assert.equal(isAmbiguousAlias(team), false, `«${team}» ambiguo`);
    assert.ok(resolveTeamIdentity(team), `«${team}» sin identidad`);
  }
  // Las identidades nuevas del catálogo no reclaman alias de otra.
  const nuevas = TEAM_IDENTITIES.filter((i) => i.unverifiedReason?.startsWith("Equipo del catálogo diseñado"));
  assert.equal(nuevas.length, 20);
  for (const i of nuevas) for (const a of [...i.currentAliases, ...i.historicalAliases]) {
    assert.equal(resolveTeamIdentity(a)?.canonicalId, i.canonicalId, `${a} → ${i.canonicalId}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// A · Gen.G y GEN NO se fusionan
// ─────────────────────────────────────────────────────────────────────────────
test("A · Gen.G y GEN son identidades separadas y unverified, sin cruzarse", () => {
  const genG = resolveTeamIdentity("Gen.G")!;
  const gen = resolveTeamIdentity("GEN")!;
  assert.equal(genG.canonicalId, "gen-g");
  assert.equal(gen.canonicalId, "gen");
  assert.notEqual(genG.canonicalId, gen.canonicalId, "no deben ser la misma identidad");
  assert.equal(genG.status, "unverified");
  assert.equal(gen.status, "unverified");
  // Ninguna lista el alias de la otra:
  assert.ok(!genG.currentAliases.concat(genG.historicalAliases).includes("GEN"));
  assert.ok(!gen.currentAliases.concat(gen.historicalAliases).includes("Gen.G"));
  // La normalización tampoco las fusiona:
  assert.notEqual(normalizeAlias("Gen.G"), normalizeAlias("GEN"));
  // Y siguen existiendo como dos valores reales con cartas (no se ha tocado el dato):
  assert.ok(PLAYERS.some((p) => p.team === "Gen.G") && PLAYERS.some((p) => p.team === "GEN"));
});

// ─────────────────────────────────────────────────────────────────────────────
// B · un alias histórico no se interpreta automáticamente como equipo actual
// ─────────────────────────────────────────────────────────────────────────────
test("B · un alias histórico nunca es CURRENT_TEAM_IDENTITY", () => {
  for (const id of TEAM_IDENTITIES) {
    for (const h of id.historicalAliases) {
      assert.equal(currentTeamIdentity(h), undefined, `${h} (histórico de ${id.canonicalId}) no debe ser actual`);
      // pero SÍ resuelve la identidad (para pintar contexto histórico):
      assert.equal(resolveTeamIdentity(h)?.canonicalId, id.canonicalId);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C · un alias desconocido no produce una identidad falsa  (cubierto en 8; caso extra)
// ─────────────────────────────────────────────────────────────────────────────
test("C · variantes de casing/espacios de un desconocido siguen sin resolver", () => {
  for (const bad of ["  bst ", "Bst", "B S T"]) assert.equal(resolveTeamIdentity(bad), undefined);
  // Pero un conocido sí, con casing/espacios distintos:
  assert.equal(resolveTeamIdentity("  team liquid  ")?.canonicalId, "team-liquid");
  assert.equal(resolveTeamIdentity("fnc")?.canonicalId, "fnatic");
});

// ─────────────────────────────────────────────────────────────────────────────
// D · resolución determinista
// ─────────────────────────────────────────────────────────────────────────────
test("D · la resolución es determinista", () => {
  for (const alias of ["TL", "Fnatic", "GEN", "Gen.G", "desconocido", "Leviatán"]) {
    const a = resolveTeamIdentity(alias);
    for (let i = 0; i < 5; i++) assert.equal(resolveTeamIdentity(alias), a);
  }
  // canonicalId únicos (identidad estable):
  const ids = TEAM_IDENTITIES.map((i) => i.canonicalId);
  assert.equal(new Set(ids).size, ids.length, "canonicalId duplicado");
});

// ─────────────────────────────────────────────────────────────────────────────
// E · la capa NO modifica ninguna fuente de datos existente
// ─────────────────────────────────────────────────────────────────────────────
test("E · resolver es de solo lectura: no muta PLAYERS, CARDS ni las entradas del registro", () => {
  const teamsBefore = PLAYERS.map((p) => p.team).join("|");
  const cardsBefore = CARDS.length;
  const snapshot = TEAM_IDENTITIES.map((i) => `${i.canonicalId}:${i.currentAliases.join(",")}:${i.historicalAliases.join(",")}:${i.status}`).join(";");
  // Ejercita todos los caminos:
  for (const a of ["TL", "Fnatic", "GEN", "Gen.G", "MIBR", "", "Leviatán", "G2", "G2 Gozen"]) {
    resolveTeamIdentity(a); currentTeamIdentity(a); historicalTeamContext(a);
    candidateIdentities(a); isAmbiguousAlias(a); masterySetIdForAlias(a || "x");
  }
  assert.equal(PLAYERS.map((p) => p.team).join("|"), teamsBefore, "PLAYERS.team mutado");
  assert.equal(CARDS.length, cardsBefore, "CARDS mutado");
  assert.equal(
    TEAM_IDENTITIES.map((i) => `${i.canonicalId}:${i.currentAliases.join(",")}:${i.historicalAliases.join(",")}:${i.status}`).join(";"),
    snapshot, "el registro se ha mutado",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Consistencia con la auditoría 20.2 (sin modificarla)
// ─────────────────────────────────────────────────────────────────────────────
test("consistencia · cada identificador de un objetivo resuelve a UNA identidad, y Gen.G/GEN a dos distintas", () => {
  const genG = teamPackAudit("Gen.G")!;
  assert.deepEqual(genG.identifiers, ["Gen.G", "GEN"]);
  assert.notEqual(resolveTeamIdentity("Gen.G")!.canonicalId, resolveTeamIdentity("GEN")!.canonicalId);
});
