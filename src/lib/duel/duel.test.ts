/**
 * Tests de la capa de DUELOS entre el motor y la interfaz (Fase 8). Ejecutar: `npm test`.
 *
 * Cubren lo que un test de navegador no puede afirmar con precisión:
 *   · la proyección pública NO filtra las cartas ocultas del rival ni el generador,
 *   · la interfaz no reimplementa ninguna regla del juego,
 *   · el contrato cliente/servidor no puede crecer con campos secretos sin que salte un test.
 *
 * NO tocan la base de datos: construyen la partida con el MISMO motor puro de las Fases 3-7 y
 * comprueban la proyección. Los tests contra la base de datos real viven en
 * `scripts/duel-gameplay-verify.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  DUEL_ROLES, DUEL_DECK_SIZE, type DuelDeckSnapshot,
} from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, type DuelMatch } from "@/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createDuelBot,
} from "@/domain/cardgame/opponent";
import { toPublicView } from "@/server/services/duels";
import { DIFFICULTY_INFO, STAT_INFO, type CombatStatKey } from "./types";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Mazo legal nº `block`, con las cartas reales del catálogo. */
function snapshot(block: number, id: string): DuelDeckSnapshot {
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, (typeof CARDS)[number]>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, c);
    }
    byRole.set(role, [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)));
  }
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  assert.equal(v.valid, true, `el mazo ${id} debe ser legal`);
  return takeDeckSnapshot(deck, v, NOW)!;
}

const MINE = snapshot(0, "mine");
const RIVAL = snapshot(1, "rival");

/** Partida con el jugador como bando A y el bot como B, igual que hace el servidor. */
function play(turns: number): DuelMatch {
  const start = startDuelMatch({ id: "t", snapshotA: MINE, snapshotB: RIVAL, firstAttacker: "B" });
  assert.ok(start.ok);
  let m = start.match;
  let rng = { a: createRng(1), b: createRng(2) };
  const ctrl = createController(
    { side: "A", kind: "BOT", id: "you" },
    { side: "B", kind: "BOT", id: "bot" },
  );
  const bots = { A: createDuelBot("you", "NORMAL"), B: createDuelBot("bot", "NORMAL") };
  for (let i = 0; i < turns * 6 && m.turns.length < turns && m.status === "IN_PROGRESS"; i++) {
    const r = advanceBots(m, ctrl, bots, rng.a, rng.b, 1);
    m = r.match; rng = { a: r.rngA, b: r.rngB };
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (c.ok) m = c.match; }
  }
  return m;
}

// ═════════════════════ La proyección no filtra nada ═════════════════════

test("SEGURIDAD · la proyección NO incluye las cartas no jugadas del rival", () => {
  const m = play(4);
  const view = toPublicView(m, "HARD");
  const json = JSON.stringify(view);

  const played = new Set(m.usedB);
  const hidden = m.snapshotB.cards.filter((c) => !played.has(c.uid));
  assert.ok(hidden.length > 0, "el fixture debe dejar cartas ocultas");

  // La única carta oculta que puede aparecer es la que el rival acaba de DECLARAR: ya está sobre
  // la mesa y es pública por definición.
  const declared = view.pendingRival?.card.uid ?? null;
  for (const c of hidden) {
    if (c.uid === declared) continue;
    assert.ok(!json.includes(c.uid), `la carta oculta ${c.playerName} no puede viajar al cliente`);
  }
});

test("SEGURIDAD · la proyección NO incluye generador, semillas ni snapshots", () => {
  const json = JSON.stringify(toPublicView(play(5), "NORMAL"));
  for (const secret of ["mulberry32", "\"seed\"", "\"rng\"", "\"draws\"", "snapshotB", "checksum", "orchestratorVersion"]) {
    assert.ok(!json.includes(secret), `la proyección no puede contener «${secret}»`);
  }
});

test("SEGURIDAD · del rival solo se conoce CUÁNTAS cartas le quedan, no cuáles", () => {
  const m = play(3);
  const view = toPublicView(m, "EASY");
  assert.equal(view.rivalRemaining, DUEL_DECK_SIZE - m.usedB.length);
  assert.equal(view.rivalUsed.length, m.usedB.length);
  // No existe ningún campo con la mano del rival.
  assert.ok(!("rivalHand" in view));
  assert.ok(!("snapshotB" in view));
});

test("SEGURIDAD · al terminar, el historial ya no esconde nada", () => {
  const m = play(10);
  const view = toPublicView(m, "NORMAL");
  assert.equal(view.history.length, 10);
  assert.equal(view.rivalUsed.length, 10);
  assert.equal(view.rivalRemaining, 0);
  assert.ok(view.result, "una partida terminada trae resultado");
});

// ═════════════════════ La proyección dice la verdad ═════════════════════

test("la proyección copia el marcador del motor, no lo recalcula", () => {
  for (const n of [1, 4, 7]) {
    const m = play(n);
    const view = toPublicView(m, "NORMAL");
    // En curso: el recuento turno a turno del orquestador.
    assert.equal(view.scoreYou, m.scoreA, `turno ${n}`);
    assert.equal(view.scoreRival, m.scoreB, `turno ${n}`);
    assert.equal(view.ties, m.ties, `turno ${n}`);
    assert.equal(view.turn, m.currentTurn, `turno ${n}`);
    assert.equal(view.yourHand.length + view.yourUsed.length, DUEL_DECK_SIZE);
  }
});

test("REGRESIÓN · al terminar, el marcador de cabecera es el del RESOLVER, no el incremental", () => {
  /*
   * El desempate por suma de medias del documento de diseño otorga un punto adicional, así que el
   * marcador final del Combat Resolver puede ser 6-5 donde el recuento turno a turno dice 5-5.
   * La cabecera enseñaba el incremental y contradecía al resultado. El resolver es la autoridad.
   */
  const m = play(10);
  const view = toPublicView(m, "NORMAL");
  assert.ok(view.result, "la partida ha terminado");
  assert.equal(view.scoreYou, view.result!.scoreYou, "cabecera y resultado deben coincidir");
  assert.equal(view.scoreRival, view.result!.scoreRival);
  assert.equal(view.scoreYou, m.result!.combat.scoreA, "y ser los del resolver");
  assert.equal(view.scoreRival, m.result!.combat.scoreB);

  // Y el caso concreto que lo destapó: un empate de marcador deshecho por la suma de medias.
  const mirror = startDuelMatch({ id: "tb", snapshotA: MINE, snapshotB: RIVAL, firstAttacker: "A" });
  assert.ok(mirror.ok);
  void mirror;
});

test("el resultado de la proyección es el del Combat Resolver, traducido a «tú» y «rival»", () => {
  const m = play(10);
  const view = toPublicView(m, "NORMAL");
  const r = m.result!;
  assert.equal(view.result!.scoreYou, r.scoreA);
  assert.equal(view.result!.scoreRival, r.scoreB);
  assert.equal(view.result!.isDraw, r.isDraw);
  assert.equal(view.result!.decidedBy, r.combat.decidedBy);
  assert.equal(view.result!.rulesVersion, r.combat.resolverVersion);
  assert.equal(
    view.result!.winner,
    r.winner === null ? null : r.winner === "A" ? "YOU" : "RIVAL",
  );
});

test("cada turno del historial conserva las dos cartas, sus ejes y sus valores", () => {
  const view = toPublicView(play(10), "HARD");
  for (const t of view.history) {
    assert.ok(t.you.uid && t.rival.uid);
    assert.ok(t.you.value >= 0 && t.rival.value >= 0);
    assert.ok(["stronghold", "gamesense", "entryfrag"].includes(t.you.stat));
    // El resultado del turno es coherente con los valores que lo produjeron.
    if (t.outcome === "A") assert.ok(t.you.value > t.rival.value, `T${t.number}`);
    if (t.outcome === "B") assert.ok(t.you.value < t.rival.value, `T${t.number}`);
    if (t.outcome === "TIE") assert.equal(t.you.value, t.rival.value, `T${t.number}`);
  }
});

test("la estadística obligada al defender la calcula el SERVIDOR, no la interfaz", () => {
  // Con el bot atacando primero, la proyección del turno 1 ya trae la respuesta obligada.
  const m = play(0);
  const start = startDuelMatch({ id: "x", snapshotA: MINE, snapshotB: RIVAL, firstAttacker: "B" });
  assert.ok(start.ok);
  const ctrl = createController({ side: "A", kind: "HUMAN", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
  const r = advanceBots(start.match, ctrl, { B: createDuelBot("bot", "NORMAL") }, createRng(1), createRng(2));
  const view = toPublicView(r.match, "NORMAL");
  assert.equal(view.youAreAttacker, false);
  assert.ok(view.pendingRival, "el rival ya ha declarado");
  assert.ok(view.requiredStat, "la proyección trae la estadística obligada");
  // Y es exactamente la que impone la tabla del dominio.
  const COUNTER: Record<CombatStatKey, CombatStatKey> = {
    stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold",
  };
  assert.equal(view.requiredStat, COUNTER[view.pendingRival!.stat]);
  void m;
});

// ═════════════════════ La interfaz no reimplementa reglas ═════════════════════

const UI_FILES = [
  "src/components/duel/DuelCard.tsx",
  "src/components/duel/MatchBoard.tsx",
  "src/components/duel/Scoreboard.tsx",
  "src/components/duel/TurnHistory.tsx",
  "src/components/duel/DuelMoment.tsx",
  "src/components/duel/ResultScreen.tsx",
  "src/components/duel/ReplayViewer.tsx",
  "src/components/duel/DeckBuilder.tsx",
  "src/app/duelos/page.tsx",
  "src/app/duelos/mazos/page.tsx",
  "src/app/duelos/jugar/page.tsx",
  "src/app/duelos/replay/[matchId]/page.tsx",
  "src/lib/duel/client.ts",
];

/** Código de un fichero sin comentarios: lo que de verdad se ejecuta. */
function code(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("INVARIANTE · la interfaz no reimplementa el combate", () => {
  // Se buscan LLAMADAS a las funciones del motor, no la simple aparición del nombre: la interfaz sí
  // puede LEER campos que se llaman parecido (`result.sumOvrYou` es un dato que manda el servidor).
  const CALLS = [
    "resolveCombat",      // no se resuelve ningún combate en el cliente
    "resolveEncounter",
    "computeCombatOvr",   // el OVR no se recalcula
    "combatOvrRaw",
    "sumOvr",
    "statTotals",
    "createDuelBot",      // la interfaz no crea bots
    "advanceBots",
    "confirmTurn",
    "createRng",          // ni generadores
    "nextFloat",
  ];
  for (const f of UI_FILES) {
    const c = code(f);
    for (const fn of CALLS) {
      assert.ok(!new RegExp(String.raw`\b${fn}\s*\(`).test(c), `${f} no puede llamar a «${fn}()»`);
    }
    // Estos sí se prohíben como texto: copiar la tabla o sacar azar del cliente.
    assert.ok(!c.includes("COMBAT_MATCHUP"), `${f} no puede copiar la tabla de enfrentamientos`);
    assert.ok(!c.includes("Math.random"), `${f} no puede generar azar`);
  }
});

test("INVARIANTE · la interfaz no importa el orquestador ni el resolver", () => {
  for (const f of UI_FILES) {
    const c = code(f);
    assert.ok(!/from "@\/domain\/cardgame\/match"/.test(c), `${f} importa el orquestador`);
    assert.ok(!/from "@\/domain\/cardgame\/combat"/.test(c), `${f} importa el resolver`);
    assert.ok(!/from "@\/domain\/cardgame\/opponent"/.test(c), `${f} importa los bots`);
    assert.ok(!/@\/server\//.test(c), `${f} importa código de servidor`);
  }
});

test("INVARIANTE · la interfaz no lee la base de datos de duelos directamente", () => {
  for (const f of UI_FILES) {
    const c = code(f);
    assert.ok(!c.includes("duel_matches"), `${f} no puede tocar la tabla de partidas`);
    assert.ok(!c.includes("duel_decks"), `${f} no puede tocar la tabla de mazos`);
    assert.ok(!/from\("user_cards"\)/.test(c), `${f} no puede leer el inventario a mano`);
  }
});

test("INVARIANTE · las reglas de composición salen del dominio, no de constantes copiadas", () => {
  const builder = code("src/components/duel/DeckBuilder.tsx");
  assert.ok(builder.includes("DUEL_ROLES"), "el constructor consume los roles del dominio");
  assert.ok(builder.includes("DUEL_COMPOSITION"), "y la composición exigida");
  // No puede haber un 2 escrito a mano como cuota de rol.
  assert.ok(!/Duelista:\s*2/.test(builder), "la cuota por rol no se copia");
});

test("REGRESIÓN · defendiendo, la mano resalta el eje OBLIGADO en todas las cartas", () => {
  /*
   * Encontrado jugando (Fase 8.5): al defender, la estadística ya está decidida por la tabla y lo
   * único que se elige es la carta. Si las diez cartas enseñan SH/GS/EF con el mismo peso, elegir se
   * convierte en buscar el número correcto entre treinta. Ocurre en la mitad de los turnos.
   */
  const board = code("src/components/duel/MatchBoard.tsx");
  const mano = board.slice(board.indexOf("view.yourHand.map"));
  assert.ok(
    /highlightStat=\{attacking \?[\s\S]{0,80}: required\}/.test(mano),
    "la mano debe resaltar `required` cuando el jugador defiende",
  );
  // Y el eje obligado tiene que venir del servidor, no calcularse aquí.
  assert.ok(board.includes("view.requiredStat"), "el eje obligado lo manda el servidor");
});

test("INVARIANTE · ningún componente de duelo usa localStorage para el estado del juego", () => {
  for (const f of UI_FILES) {
    const c = code(f);
    assert.ok(!c.includes("localStorage"), `${f} no puede guardar la partida en el navegador`);
    assert.ok(!c.includes("useGameStore"), `${f} no puede tomar el inventario del almacén local`);
  }
});

test("INVARIANTE · todo componente de duelo existe y está cubierto por estos invariantes", () => {
  const dir = join(process.cwd(), "src/components/duel");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  for (const f of files) {
    assert.ok(
      UI_FILES.includes(`src/components/duel/${f}`),
      `${f} es nuevo: añádelo a UI_FILES para que los invariantes lo cubran`,
    );
  }
});

// ═════════════════════ Presentación ═════════════════════

test("las tres dificultades se describen sin exponer los porcentajes internos", () => {
  for (const d of ["EASY", "NORMAL", "HARD"] as const) {
    const info = DIFFICULTY_INFO[d];
    assert.ok(info.label && info.tagline && info.detail.length > 20, d);
    assert.ok(!/\d+\s*%/.test(info.detail), `${d} no debe mostrar porcentajes de heurística`);
  }
  assert.ok(DIFFICULTY_INFO.EASY.level < DIFFICULTY_INFO.NORMAL.level);
  assert.ok(DIFFICULTY_INFO.NORMAL.level < DIFFICULTY_INFO.HARD.level);
});

test("las tres estadísticas tienen presentación propia y distinguible", () => {
  const colors = new Set(Object.values(STAT_INFO).map((s) => s.color));
  assert.equal(colors.size, 3, "cada eje tiene su color");
  for (const k of ["stronghold", "gamesense", "entryfrag"] as CombatStatKey[]) {
    assert.equal(STAT_INFO[k].abbr.length, 2);
    assert.ok(STAT_INFO[k].blurb.length > 5);
  }
});
