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
import { visualHintValue } from "./hintVisuals";
import { fnv1a32 } from "@/domain/cardgame/hints";
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
import { startDuelMatch, confirmTurn, selectDefenderCard, selectDefenderStat, requiredDefenderStat, type DuelMatch } from "@/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createDuelBot,
} from "@/domain/cardgame/opponent";
import { toPublicView } from "@/server/services/duels";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { buildMatchView } from "./matchView";
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
  // El rol es de la CARTA (catálogo diseñado): un jugador puede aparecer en dos roles, y el mazo no
  // puede repetirlo. Se descarta en los roles siguientes a quien ya ha entrado.
  const usados = new Set<string>();
  const picks = DUEL_ROLES.flatMap((r) => {
    const elegidas = (byRole.get(r) ?? []).filter((c) => !usados.has(c.playerId)).slice(block * 2, block * 2 + 2);
    for (const c of elegidas) usados.add(c.playerId);
    return elegidas;
  });
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

  // DUEL GAMEPLAY UX 2.0 · NINGUNA carta oculta puede aparecer, tampoco la que el rival acaba de comprometer atacando:
  // va boca abajo hasta que respondas.
  for (const c of hidden) {
    assert.ok(!json.includes(c.uid), `la carta oculta ${c.playerName} no puede viajar al cliente`);
  }
});

test("F71 · SEGURIDAD · PvE: una pista por carta oculta del bot y ni un dato más de lo oculto", () => {
  for (const n of [0, 3, 6]) {
    const m = play(n);
    const view = toPublicView(m, "HARD");
    assert.equal(view.rivalHints.length, view.rivalRemaining, `turno ${n}: una pista por carta oculta`);
    for (const h of view.rivalHints) if (h) assert.deepEqual(Object.keys(h).sort(), ["type", "value"]);

    const json = JSON.stringify(view);
    const hintsJson = JSON.stringify(view.rivalHints);
    const played = new Set(m.usedB);
    const visibleRival = m.snapshotB.cards.filter((x) => played.has(x.uid));
    const mineKnown = new Set([...MINE.cards, ...visibleRival].flatMap((x) => [x.uid, x.cardId, x.playerId, x.playerName]));
    for (const c of m.snapshotB.cards.filter((x) => !played.has(x.uid))) {
      // El fixture puede repetir un jugador en los dos mazos: lo que ya es TUYO no es un secreto del rival.
      for (const secret of [c.uid, c.cardId, c.playerId, c.playerName].filter((x) => !mineKnown.has(x))) {
        assert.ok(!json.includes(`"${secret}"`), `turno ${n}: «${secret}» (oculta) no puede viajar`);
      }
    }
    for (const field of ["uid", "cardId", "playerId", "nick", "ovr", "combat", "serial", "variantId"]) {
      assert.ok(!hintsJson.includes(`"${field}"`), `las pistas no llevan «${field}»`);
    }
  }
});

test("F71 · la pista de una carta es la misma en PvE y en la proyección PvP (misma partida, misma carta)", () => {
  const m = play(4);
  const countryOf = (pid: string) => registry.player(pid)?.country ?? "";
  // F72.2 · los dos caminos del servidor pintan con el mismo resolvedor visual.
  assert.deepEqual(toPublicView(m, "NORMAL").rivalHints, projectMatchFor(m, "A", countryOf, visualHintValue).rivalHints);
  // Y la vista PvP construida en el cliente solo COPIA lo que trajo la proyección.
  const pvpView = buildMatchView(projectMatchFor(m, "A", countryOf, visualHintValue), { side: "A", registry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.deepEqual(pvpView.rivalHints, toPublicView(m, "NORMAL").rivalHints);
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
  // DUEL GAMEPLAY UX 2.0 · la marca de rol (icono real o abreviatura canónica): presentación pura.
  "src/components/duel/RoleMark.tsx",
  // F72.8 · el contador de la decisión: solo pinta el plazo del servidor (sin azar, sin orquestador, sin BD).
  "src/components/duel/arena/TurnTimer.tsx",
  "src/components/duel/MatchBoard.tsx",
  "src/components/duel/Scoreboard.tsx",
  "src/components/duel/TurnHistory.tsx",
  "src/components/duel/DuelMoment.tsx",
  "src/components/duel/ResultScreen.tsx",
  // Resultado mínimo de PARTIDA RÁPIDA: veredicto, marcador y motivo del servidor + dos salidas. Presentación pura.
  "src/components/duel/QuickMatchResult.tsx",
  "src/components/duel/DailyRewardSlot.tsx",
  "src/components/duel/ReplayViewer.tsx",
  "src/components/duel/DeckBuilder.tsx",
  // Fase 22.2: el botón de pantalla completa es presentación pura (Fullscreen API); entra en la
  // lista para quedar sujeto a los mismos invariantes (sin azar, sin orquestador, sin BD).
  "src/components/duel/FullscreenToggle.tsx",
  "src/components/duel/arena/ArenaSurface.tsx",
  "src/components/duel/arena/PlayedRow.tsx",
  "src/components/duel/arena/HandFan.tsx",
  "src/components/duel/arena/ClashBanner.tsx",
  // F71: la columna de decisión (los tres ejes al atacar, el obligado al defender). Presentación pura.
  "src/components/duel/arena/StatSelector.tsx",
  "src/components/duel/arena/RivalStats.tsx",
  // Fase 45: el recinto de la arena. Es fondo puro -gradientes y transformaciones-, no
  // conoce la partida y no decide nada; entra en la lista para quedar bajo los mismos
  // invariantes que el resto (sin azar, sin orquestador, sin BD, sin localStorage).
  "src/components/duel/arena/ArenaEnvironment.tsx",
  // Fase 50 (NEXUS Arena): la barra de la partida. Presentación sobre la vista del servidor
  // (turno, marcador, pista de los diez); no decide nada y entra bajo los mismos invariantes.
  "src/components/duel/arena/MatchTopBar.tsx",
  // Fase 26 (Core Gameplay 2.0): pre-partida, intro, ayuda, silencio y piezas del final. Todo
  // presentación sobre datos del servidor; entran en la lista para quedar bajo los invariantes.
  "src/components/duel/PreMatch.tsx",
  "src/components/duel/MatchIntro.tsx",
  "src/components/duel/MatchComplete.tsx",
  "src/components/duel/HelpSheet.tsx",
  "src/components/duel/SoundToggle.tsx",
  "src/components/duel/MatchSummary.tsx",
  // Arena PvP (Bloque 7.5). Entran en la MISMA lista que el PvE a propósito: los invariantes de
  // «la interfaz no reimplementa el combate», «no hay azar» y «no hay localStorage» valen igual
  // —y más— para una pantalla donde hay otra persona al otro lado.
  "src/components/duel/pvp/PvpArena.tsx",
  "src/components/duel/pvp/PvpLobby.tsx",
  "src/components/duel/pvp/PvpOutcome.tsx",
  // Fase 29 (Social 1.0): el final del duelo privado (cara a cara + salidas sociales). Presentación.
  "src/components/duel/pvp/PrivateDuelPanel.tsx",
  // Fase 55 (Competitivo 4.0): buscando rival, rival encontrado y ascenso/descenso. Presentación sobre la vista de
  // cola, el `?matchup=` y las dos fotos de la escalera: no deciden turno, final ni rating.
  "src/components/duel/pvp/RankedSearch.tsx",
  "src/components/duel/pvp/RankedMatchFound.tsx",
  "src/components/duel/pvp/RankedMovement.tsx",
  // Fase 32 (Deck Builder 2.0): hub de equipos y piezas del constructor. Presentación sobre la foto del
  // servidor; las reglas salen del dominio. Entran para quedar bajo los mismos invariantes.
  "src/components/duel/deck/bits.tsx",
  "src/components/duel/deck/TeamBoard.tsx",
  "src/components/duel/deck/CollectionPanel.tsx",
  "src/components/duel/deck/AnalysisPanel.tsx",
  "src/components/duel/deck/ComparePanel.tsx",
  "src/components/duel/deck/SlotSheet.tsx",
  "src/components/duel/deck/NameSheet.tsx",
  "src/components/duel/deck/TeamHub.tsx",
  // Fase 33 (Match Experience 3.0): HUD del turno, detalle de turno, partida contada y «tu equipo vs
  // rival». Presentación pura sobre la vista del servidor; quedan bajo los mismos invariantes.
  "src/components/duel/experience/MatchHud.tsx",
  "src/components/duel/experience/TurnDetailSheet.tsx",
  "src/components/duel/experience/ResultStory.tsx",
  "src/components/duel/experience/PreMatchVersus.tsx",
  "src/components/duel/experience/MatchEndHero.tsx",
  // Fase 43 (Card Mastery & Deck Strategy 3.0): laboratorio, foco de carta, impacto, plantilla por objetivo, perfil
  // pre-partida, lectura de la partida y comparador de equipos. Descriptivo, sin motor ni azar: mismos invariantes.
  "src/components/duel/strategy/StrategyLabPanel.tsx",
  "src/components/duel/strategy/CardFocusSection.tsx",
  "src/components/duel/strategy/StrategyImpact.tsx",
  "src/components/duel/strategy/SuggestSection.tsx",
  "src/components/duel/strategy/PreMatchStrategy.tsx",
  "src/components/duel/strategy/MatchStrategyPanel.tsx",
  "src/components/duel/strategy/DeckCompareView.tsx",
  // Fase 61 (Gameplay 5.0 · The Match): icono del rol, desempate en escena, salida con consecuencia real y final PvP
  // vivido en directo. Presentación sobre la vista del servidor (`lib/duel/matchFlow`); mismos invariantes.
  "src/components/duel/experience/RoleIcon.tsx",
  "src/components/duel/experience/TiebreakReveal.tsx",
  "src/components/duel/experience/LeaveMatchDialog.tsx",
  "src/components/duel/experience/MatchEnding.tsx",
  "src/lib/duel/matchFlow.ts",
  "src/lib/duel/useLeaveGuard.ts",
  "src/app/duelos/pvp/page.tsx",
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
  /*
   * La mano se dibuja ahora en `arena/HandFan`, pero quien decide qué eje resaltar sigue
   * siendo `MatchBoard`, que se lo pasa como función. Lo que se comprueba es esa decisión.
   */
  const board = code("src/components/duel/MatchBoard.tsx");
  const mano = board.slice(board.indexOf("<PlayerHand"));
  assert.ok(mano.length > 0, "MatchBoard debe montar la mano del jugador");
  assert.ok(
    /highlightStat=\{\([\s\S]{0,40}\) =>[\s\S]{0,120}: required\)\}/.test(mano),
    "la mano debe resaltar `required` cuando el jugador defiende",
  );
  // Y el eje obligado tiene que venir del servidor, no calcularse aquí.
  assert.ok(board.includes("view.requiredStat"), "el eje obligado lo manda el servidor");

  // La mano del RIVAL no puede recibir cartas: recibe un número y pinta reversos.
  const fan = code("src/components/duel/arena/HandFan.tsx");
  assert.ok(/export function RivalHand\(\{ count/.test(fan),
    "RivalHand debe recibir un recuento, nunca las cartas del rival");
  const firma = fan.slice(fan.indexOf("export function RivalHand"));
  assert.ok(!/cards|DuelDeckCardDTO/.test(firma.slice(0, 400)),
    "RivalHand no puede recibir cartas: solo cuántas quedan");
  // Y en el tablero solo se le pasa el recuento público del servidor.
  assert.ok(/<RivalHand count=\{view\.rivalRemaining\}/.test(board),
    "la mano del rival se pinta con `rivalRemaining`, el único dato público");
});

test("INVARIANTE · ningún componente de duelo usa localStorage para el estado del juego", () => {
  for (const f of UI_FILES) {
    const c = code(f);
    assert.ok(!c.includes("localStorage"), `${f} no puede guardar la partida en el navegador`);
    assert.ok(!c.includes("useGameStore"), `${f} no puede tomar el inventario del almacén local`);
  }
});

test("INVARIANTE · todo componente de duelo existe y está cubierto por estos invariantes", () => {
  /*
   * RECURSIVO desde el rediseño de la arena. Antes solo miraba el primer nivel de
   * `components/duel`, así que al mover piezas a `duel/arena/` habrían quedado fuera de
   * TODOS los invariantes —nada de resolver, nada de azar, nada de localStorage— sin que
   * ningún test se quejara. Una lista de ficheros protegidos que no se entera de las
   * subcarpetas protege menos de lo que parece.
   */
  const raiz = join(process.cwd(), "src/components/duel");
  const encontrados: string[] = [];
  const barrer = (dir: string, prefijo: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { barrer(join(dir, e.name), `${prefijo}${e.name}/`); continue; }
      // Los ficheros de prueba no son componentes: `*.test.tsx` vive junto a lo que prueba y no entra en UI_FILES.
      if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) encontrados.push(`${prefijo}${e.name}`);
    }
  };
  barrer(raiz, "");

  for (const f of encontrados) {
    assert.ok(
      UI_FILES.includes(`src/components/duel/${f}`),
      `${f} es nuevo: añádelo a UI_FILES para que los invariantes lo cubran`,
    );
  }
});

/*
 * INVARIANTES PROPIOS DE LA ARENA PvP (Bloque 7.5).
 *
 * Los de arriba valen para toda la interfaz de duelo. Estos son los que solo tienen sentido
 * cuando hay OTRA PERSONA al otro lado: que la pantalla no se invente el turno, ni el final, ni
 * el rating, y que no abra un segundo bucle de red.
 */
const PVP_UI = [
  "src/components/duel/pvp/PvpArena.tsx",
  "src/components/duel/pvp/PvpLobby.tsx",
  "src/components/duel/pvp/PvpOutcome.tsx",
  "src/components/duel/pvp/PrivateDuelPanel.tsx",
  "src/components/duel/pvp/RankedSearch.tsx",
  "src/components/duel/pvp/RankedMatchFound.tsx",
  "src/components/duel/pvp/RankedMovement.tsx",
  "src/app/duelos/pvp/page.tsx",
];

test("INVARIANTE PvP · la pantalla no decide el turno, el final ni el rating", () => {
  const todo = PVP_UI.map(code).join("\n");

  // El turno lo dice el servidor con `isYourTurn`; no se deduce comparando identidades.
  assert.ok(/isYourTurn/.test(todo), "la arena tiene que leer `isYourTurn` del servidor");
  assert.ok(
    !/===\s*(userId|myId|session\.user)/.test(todo),
    "el turno no se deduce comparando ids en el cliente",
  );

  // El final lo nombra el servidor con `lifecycle`.
  assert.ok(/lifecycle/.test(todo), "el estado terminal se lee de `lifecycle`");

  // El delta de rating NO se calcula: se pide.
  assert.ok(/outcome=1/.test(todo), "el rating post-partida se pide al servidor");
  assert.ok(
    !/newRating\s*-\s*oldRating/.test(todo),
    "el cliente no calcula el delta de rating",
  );

  // Nada de declarar un resultado en la petición.
  for (const campo of ["winnerId", "loserId", "ratingDelta", "expired", "timeout"]) {
    assert.ok(
      !new RegExp(campo + "\\s*:").test(todo.replace(/"/g, "")),
      "la interfaz no debe enviar " + campo + ": el resultado lo decide el servidor",
    );
  }
});

test("INVARIANTE PvP · un solo bucle de red y sin estado de partida en el navegador", () => {
  const pantallas = PVP_UI.map(code).join("\n");

  /*
   * Ni la página ni los componentes crean temporizadores de RED. El único `setInterval` que se
   * tolera es el del reloj visual de la arena, que no hace peticiones.
   */
  const arena = code("src/components/duel/pvp/PvpArena.tsx");
  const intervalos = (arena.match(/setInterval/g) ?? []).length;
  assert.ok(intervalos <= 1, "la arena solo puede tener el tick visual, tiene " + intervalos);
  assert.ok(!/fetch\(/.test(arena), "la arena no hace peticiones por su cuenta");

  // La partida NO vive en el navegador: la autoridad es el servidor y se le pregunta.
  assert.ok(
    !/localStorage|sessionStorage/.test(pantallas),
    "la partida PvP no se guarda en el navegador",
  );

  // El hook de cola se apaga solo al emparejar, para no coexistir con el poller de partida.
  const cola = code("src/lib/duel/usePvpQueue.ts");
  assert.ok(!/setInterval/.test(cola), "la cola usa setTimeout reprogramado, no setInterval");
  assert.ok(/sondeando\.current = false/.test(cola), "la cola debe poder apagarse sola");
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

// ═════════════════════ F71.2 · SH/GS/EF del rival: solo lo público viaja al cliente ═════════════════════

/** Avanza la partida paso a paso (bots) y guarda la PRIMERA foto en cada estado del rival que nos interesa. */
function rivalStates(): { hidden: DuelMatch; declared: DuelMatch } {
  const start = startDuelMatch({ id: "t712", snapshotA: MINE, snapshotB: RIVAL, firstAttacker: "B" });
  assert.ok(start.ok);
  let m = start.match;
  let rng = { a: createRng(7), b: createRng(9) };
  const ctrl = createController({ side: "A", kind: "BOT", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
  const bots = { A: createDuelBot("you", "NORMAL"), B: createDuelBot("bot", "NORMAL") };
  let hidden: DuelMatch | null = null, declared: DuelMatch | null = null;
  for (let i = 0; i < 400 && m.status === "IN_PROGRESS" && !(hidden && declared); i++) {
    const v = toPublicView(m, "NORMAL");
    if (!v.pendingRival && m.turns.length > 0 && !hidden) hidden = m;       // carta del rival del turno: oculta
    if (v.pendingRival && !declared) declared = m;                          // el rival ha declarado: pública
    const r = advanceBots(m, ctrl, bots, rng.a, rng.b, 1);
    m = r.match; rng = { a: r.rngA, b: r.rngB };
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (c.ok) m = c.match; }
  }
  assert.ok(hidden && declared, "el fixture recorre los dos estados");
  return { hidden: hidden!, declared: declared! };
}

/** Todos los objetos con `combat` que viajan en un payload, con su uid. */
function combatCarriers(payload: unknown): { uid: string; combat: Record<string, number> }[] {
  const out: { uid: string; combat: Record<string, number> }[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (o.combat && typeof o.uid === "string") out.push({ uid: o.uid, combat: o.combat as Record<string, number> });
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(JSON.stringify(payload)));
  return out;
}

test("F71.2 · SEGURIDAD · PvE: con la carta rival OCULTA no viaja ningún SH/GS/EF suyo que no se haya jugado", () => {
  const { hidden } = rivalStates();
  const view = toPublicView(hidden, "HARD");
  assert.equal(view.pendingRival, null, "carta del rival sin declarar");
  const rivalUids = new Set(hidden.snapshotB.cards.map((c) => c.uid));
  const played = new Set(hidden.usedB);
  for (const c of combatCarriers(view)) {
    if (!rivalUids.has(c.uid)) continue;
    assert.ok(played.has(c.uid), `SH/GS/EF de una carta rival no jugada (${c.uid}) viajó al cliente`);
  }
});

test("DUEL UX 2.0 · INFORMACIÓN · PvE: la carta que el rival COMPROMETE atacando no viaja hasta que respondes; después, sí", () => {
  const { declared } = rivalStates();
  const view = toPublicView(declared, "HARD");
  assert.ok(view.pendingRival, "el rival ha comprometido su carta");
  assert.deepEqual(Object.keys(view.pendingRival!).sort(), ["committed", "hint", "role", "stat"], "solo «comprometida», la estadística declarada y sus pistas públicas");
  const uid = declared.draft.attackerCardUid!;
  const secret = declared.snapshotB.cards.find((c) => c.uid === uid)!;
  const json = JSON.stringify(view);
  const mine = new Set(MINE.cards.flatMap((c) => [c.uid, c.cardId, c.playerId, c.playerName]));
  // Ni id de la carta, ni del jugador, ni su nombre (salvo que el mismo jugador esté también en TU mazo de prueba).
  for (const s of [secret.uid, secret.cardId, secret.playerId, secret.playerName].filter((x) => x && !mine.has(x))) {
    assert.ok(!json.includes(`"${s}"`), `«${s}» de la carta comprometida viajó antes de responder`);
  }
  // Ni sus estadísticas: ningún objeto con `combat` del rival que no se haya jugado.
  const rivalUids = new Set(declared.snapshotB.cards.map((c) => c.uid));
  for (const c of combatCarriers(view)) if (rivalUids.has(c.uid)) assert.ok(declared.usedB.includes(c.uid), `SH/GS/EF de ${c.uid} viajó`);
  // Tras COMPROMETER tu respuesta (la jugada que cierra el turno) la carta se revela en el turno cerrado.
  const mineFree = declared.snapshotA.cards.find((c) => !declared.usedA.includes(c.uid))!;
  const d1 = selectDefenderCard(declared, mineFree.uid); assert.ok(d1.ok);
  const forced = requiredDefenderStat(d1.match)!;
  const d2 = selectDefenderStat(d1.match, forced); assert.ok(d2.ok);
  const closed = confirmTurn(d2.match); assert.ok(closed.ok);
  const after = toPublicView(closed.match, "HARD");
  assert.equal(after.lastTurn?.rival.uid, uid, "revelada en el turno cerrado");
  assert.ok(after.rivalUsed.some((c) => c.uid === uid && c.combat.stronghold === secret.combat.stronghold), "y en lo jugado, con sus cifras reales");
});

test("F71.2 · SEGURIDAD · PvP: cada proyección solo lleva SH/GS/EF del rival jugados o del declarado (A y B)", () => {
  const { hidden, declared } = rivalStates();
  for (const m of [hidden, declared]) {
    for (const viewer of ["A", "B"] as const) {
      const rival = viewer === "A" ? "B" : "A";
      const rivalSnap = rival === "A" ? m.snapshotA : m.snapshotB;
      const used = new Set(rival === "A" ? m.usedA : m.usedB);
      const declaredUid = m.attacker === rival ? m.draft.attackerCardUid : null;
      const rivalUids = new Set(rivalSnap.cards.map((c) => c.uid));
      const proj = projectMatchFor(m, viewer, (pid: string) => registry.player(pid)?.country ?? "");
      // Control negativo: el detector SÍ ve las cartas ocultas en la partida cruda (sin proyectar).
      assert.ok(combatCarriers(m).some((c) => rivalUids.has(c.uid) && !used.has(c.uid) && c.uid !== declaredUid), "el detector funciona");
      assert.ok(combatCarriers(proj).length > 0, "la proyección lleva al menos tus cartas");
      for (const c of combatCarriers(proj)) {
        if (!rivalUids.has(c.uid)) continue;
        assert.ok(used.has(c.uid) || c.uid === declaredUid, `${viewer} recibió SH/GS/EF de una carta oculta del rival`);
      }
    }
  }
});

test("DUEL UX 2.0 · ROLES · los roles del reverso salen del rol CANÓNICO de cada carta oculta, alineados con sus pistas", () => {
  const { hidden, declared } = rivalStates();
  for (const m of [hidden, declared]) {
    const v = toPublicView(m, "NORMAL");
    const roles = v.rivalRoles ?? [];
    assert.equal(roles.length, v.rivalHints.length, "una entrada por carta oculta, como las pistas");
    assert.equal(roles.length, v.rivalRemaining);
    const unplayed = m.snapshotB.cards.filter((c) => !m.usedB.includes(c.uid));
    const canon = (xs: (string | null | undefined)[]) => xs.map((x) => x ?? "").sort();
    assert.deepEqual(canon(roles), canon(unplayed.map((c) => c.role)), "mismo multiconjunto que los roles reales");
    // Alineación: el i-ésimo reverso lleva la pista y el rol de la MISMA carta (mismo orden por hash).
    const order = [...unplayed].sort((a, b) => fnv1a32(`${m.id}:${a.uid}:order`) - fnv1a32(`${m.id}:${b.uid}:order`));
    assert.deepEqual(roles, order.map((c) => c.role ?? null));
    for (const r of roles) assert.ok(r === null || ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"].includes(r), `solo el rol: ${r}`);
  }
});

test("DUEL UX 2.0 · ROLES · comprometer la carta NO cambia pistas ni roles del reverso (nada se deduce por diferencia)", () => {
  const { declared } = rivalStates();
  // El mismo turno, justo antes de que el rival comprometiera su carta.
  const before: DuelMatch = { ...declared, phase: "ATTACKER_CARD", draft: { attackerCardUid: null, attackerStat: null, defenderCardUid: null, defenderStat: null } };
  const a = toPublicView(before, "NORMAL"), b = toPublicView(declared, "NORMAL");
  assert.deepEqual(b.rivalHints, a.rivalHints);
  assert.deepEqual(b.rivalRoles, a.rivalRoles);
  assert.equal(b.rivalRemaining, a.rivalRemaining);
});

/*
 * AJUSTE · PISTA DE LA CARTA COMPROMETIDA — TEST CRÍTICO. Se toma la carta concreta que el rival comprometió:
 *   · fila superior: su entrada (la i-ésima por el mismo orden por hash) → pista X, rol Y;
 *   · carta central (`pendingRival`): pista X, rol Y. DEBEN COINCIDIR;
 *   · y de esa carta NO viaja nada más: ni uid, ni id de carta, ni id de jugador, ni nick, ni OVR, ni cifras, ni su arte.
 * En PvE (`toPublicView`) y en PvP (`projectMatchFor` + `buildMatchView`), que es lo que recibe cada cliente.
 */
function checkCommittedHint(m: DuelMatch, view: ReturnType<typeof toPublicView>, label: string) {
  const uid = m.draft.attackerCardUid!;
  const secret = m.snapshotB.cards.find((c) => c.uid === uid)!;
  const unplayed = m.snapshotB.cards.filter((c) => !m.usedB.includes(c.uid));
  const order = [...unplayed].sort((x, y) => fnv1a32(`${m.id}:${x.uid}:order`) - fnv1a32(`${m.id}:${y.uid}:order`));
  const i = order.findIndex((c) => c.uid === uid);
  assert.ok(i >= 0, `${label}: la comprometida sigue en la fila superior`);
  const p = view.pendingRival!;
  assert.deepEqual(p.hint, view.rivalHints[i], `${label}: pista central = pista de esa carta arriba`);
  assert.equal(p.role, view.rivalRoles![i], `${label}: rol central = rol de esa carta arriba`);
  assert.equal(p.role, secret.role, `${label}: el rol es el canónico de la carta`);
  if (p.hint) assert.deepEqual(Object.keys(p.hint).sort(), ["type", "value"]);
  // Nada que la identifique.
  const json = JSON.stringify(view);
  const mine = new Set(MINE.cards.flatMap((c) => [c.uid, c.cardId, c.playerId, c.playerName]));
  for (const k of [secret.uid, secret.cardId, secret.playerId, secret.playerName].filter((x) => x && !mine.has(x))) {
    assert.ok(!json.includes(`"${k}"`), `${label}: «${k}» viajó antes de la revelación`);
  }
  const art = CARDS.find((c) => c.id === secret.cardId)?.image;
  if (art) assert.ok(!json.includes(art), `${label}: el arte de la carta viajó`);
  assert.ok(!view.rivalUsed.some((c) => c.uid === uid), `${label}: no está entre lo jugado`);
  for (const c of combatCarriers(view)) assert.notEqual(c.uid, uid, `${label}: sus cifras viajaron`);
  assert.ok(!("card" in p) && !("value" in p) && !("ovr" in p), `${label}: ni carta, ni valor, ni OVR`);
}

test("AJUSTE · PISTA COMPROMETIDA · PvE: pista y rol centrales = los de esa carta en la fila superior; identidad ausente", () => {
  const { declared } = rivalStates();
  checkCommittedHint(declared, toPublicView(declared, "NORMAL"), "PvE");
});

test("AJUSTE · PISTA COMPROMETIDA · PvP: lo mismo sobre la proyección que recibe el defensor", () => {
  const { declared } = rivalStates();
  const projected = projectMatchFor(declared, "A", (pid) => registry.player(pid)?.country ?? "", visualHintValue);
  const view = buildMatchView(projected, { side: "A", registry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.ok(view.pendingRival, "el defensor ve la carta comprometida (boca abajo)");
  checkCommittedHint(declared, view, "PvP");
  // Revelación: al cerrar el turno ya no hay pista pendiente; la carta completa está en lo jugado.
  const mineFree = declared.snapshotA.cards.find((c) => !declared.usedA.includes(c.uid))!;
  const d1 = selectDefenderCard(declared, mineFree.uid); assert.ok(d1.ok);
  const d2 = selectDefenderStat(d1.match, requiredDefenderStat(d1.match)!); assert.ok(d2.ok);
  const closed = confirmTurn(d2.match); assert.ok(closed.ok);
  const after = buildMatchView(projectMatchFor(closed.match, "A"), { side: "A", registry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.equal(after.pendingRival, null);
  assert.ok(after.rivalUsed.some((c) => c.uid === declared.draft.attackerCardUid));
});
