/**
 * CORE GAMEPLAY 2.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 26).
 *
 * Como `arena.behavior.test.ts` y `packLoop.contract.test.ts`: sin navegador ni base de datos, se
 * lee lo que hay escrito en las pantallas y se afirma lo que la fase promete y lo que NO puede
 * romper — autoridad del servidor, cerrojo de jugada, reconexión, motor/balance/reglas intactos.
 * Cuatro bloques: flujo de partida, PvP, UX (móvil, movimiento, sonido, ayuda) y regresión.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DUEL_CONTEXTS } from "@/lib/duel/telemetry";
import { EVENT_NAMES, FLOWS } from "@/lib/telemetry/contract";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
/** Sin comentarios: lo que de verdad se ejecuta. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const JUGAR = read("app", "duelos", "jugar", "page.tsx");
const PREMATCH = read("components", "duel", "PreMatch.tsx");
const INTRO = read("components", "duel", "MatchIntro.tsx");
const BOARD = read("components", "duel", "MatchBoard.tsx");
const STAT_SELECTOR = read("components", "duel", "arena", "StatSelector.tsx");
const MOMENT = read("components", "duel", "DuelMoment.tsx");
const RESULT = read("components", "duel", "ResultScreen.tsx");
const SUMMARY = read("components", "duel", "MatchSummary.tsx");
const HELP = read("components", "duel", "HelpSheet.tsx");
const SOUND_BTN = read("components", "duel", "SoundToggle.tsx");
const PVP_ARENA = read("components", "duel", "pvp", "PvpArena.tsx");
const PVP_OUTCOME = read("components", "duel", "pvp", "PvpOutcome.tsx");
const PVP_PAGE = read("app", "duelos", "pvp", "page.tsx");
const HUB = read("app", "duelos", "page.tsx");
const HOME = read("app", "page.tsx");
const CLIENT = read("lib", "duel", "client.ts");
const DUEL_TEST = read("lib", "duel", "duel.test.ts");
const SOUND = read("lib", "sound.ts");
const RULES = read("domain", "cardgame", "combat", "rules.ts");
const MATCH_TYPES = read("domain", "cardgame", "match", "types.ts");
const BOTS = read("domain", "cardgame", "opponent", "bots.ts");
const FEATURES = read("config", "features.ts");
const UX = [JUGAR, PREMATCH, INTRO, BOARD, MOMENT, RESULT, SUMMARY, HELP, SOUND_BTN, PVP_ARENA, PVP_OUTCOME, PVP_PAGE];

/* ═══════════════════════ A · flujo de partida ═══════════════════════ */

test("A1 · la pre-partida enseña TODOS los mazos y lee la validación del servidor (no revalida)", () => {
  assert.ok(PREMATCH.includes("decks.map((d) =>"), "se listan todos, no solo los válidos");
  assert.ok(!/decks\.filter\(\(d\) => d\.valid\)/.test(code(PREMATCH)), "no se esconde el mazo incompleto");
  assert.ok(PREMATCH.includes("deckReadiness(d)"), "el estado sale de `valid`/`missingByRole` del servidor");
  assert.ok(!/DUEL_COMPOSITION|validateDuelDeck/.test(PREMATCH), "no reimplementa la composición");
});

test("A2 · con un mazo inválido no se puede empezar: se dicen los roles que faltan y se ofrece completar el equipo", () => {
  assert.ok(PREMATCH.includes("disabled={!canStart}"));
  assert.ok(PREMATCH.includes("const canStart = Boolean(chosen && readiness?.ready) && !busy;"));
  assert.ok(PREMATCH.includes("No puedes empezar con «{chosen.name}»"));
  assert.ok(PREMATCH.includes('aria-label="Roles que faltan"'));
  assert.ok(PREMATCH.includes("Completar equipo"));
  assert.ok(PREMATCH.includes("href={`/duelos/mazos?deck=${chosen.id}`}"));
});

test("A3 · los textos que leen los verificadores no cambian: Preparación, Fácil/Normal/Difícil, Comenzar duelo, Continuar", () => {
  assert.ok(PREMATCH.includes(">\n              Preparación\n"));
  assert.ok(PREMATCH.includes("Comenzar duelo"));
  // Ajuste UX · FÁCIL/NORMAL/DIFÍCIL en mayúsculas SOLO por CSS: el DOM conserva «Fácil»/«Normal»/«Difícil» (DIFFICULTY_INFO).
  assert.ok(/Mayúsculas SOLO por CSS/.test(PREMATCH) && PREMATCH.includes("{info.label}"), "las etiquetas de dificultad salen de DIFFICULTY_INFO");
  assert.ok(MOMENT.includes("Continuar"));
  assert.ok(JUGAR.includes('label="Preparando duelo…"'));
});

test("A4 · la intro es saltable, se va sola, respeta reduced-motion y no bloquea ninguna petición", () => {
  assert.ok(INTRO.includes("Saltar"));
  // F61 · la entrada tiene tres tiempos (`matchFlow.entranceTimeline`); se va sola al acabar el último.
  assert.ok(INTRO.includes("ids.push(window.setTimeout(onDone, timeline.total));"));
  assert.ok(INTRO.includes("entranceTimeline(reduced, from)"));
  assert.ok(INTRO.includes("useReducedMotion()"));
  assert.ok(JUGAR.includes('<MatchIntro key="intro"'));
  assert.ok(JUGAR.includes('setStage("intro")'), "la intro va DESPUÉS de que el servidor cree la partida");
  assert.ok(!/fetch\(|startDuel\(/.test(code(INTRO)), "la intro no habla con el servidor");
});

test("A5 · seleccionar → confirmar: la carta y el eje se eligen en el tablero y la jugada viaja al servidor", () => {
  assert.ok(BOARD.includes("onPlay(chosen.uid, attacking ? stat ?? undefined : undefined);"));
  // F67 · la jugada PvE lleva la versión de la vista (optimista, la valida el servidor; no decide nada).
  assert.ok(JUGAR.includes("await playDuelTurn(view.matchId, cardUid, stat, view.stateVersion)"));
  assert.ok(CLIENT.includes('post<{ view: DuelMatchView }>(DUEL, { action: "play", matchId, cardUid, stat, ...(typeof expectedVersion === "number" ? { expectedVersion } : {}) })'));
});

test("A6 · CERROJO: una jugada en vuelo bloquea mano, ejes y botón, y no hay doble envío", () => {
  assert.ok(BOARD.includes("const lock = lockCopy({ busy, waitingRival, attacking, hasCard: Boolean(chosen), hasStat: Boolean(stat) });"));
  assert.ok(BOARD.includes("if (!chosen || busy || lock.locked) return;"), "confirmar no reentra");
  assert.ok(BOARD.includes("disabled={lock.locked}\n            onPick={pickCard}"), "la mano no responde");
  // F71 · los ejes viven en `arena/StatSelector` (columna de decisión); el tablero le pasa el cerrojo.
  assert.ok(BOARD.includes("locked={lock.locked}") && BOARD.includes("onSelect={(k) => { if (lock.locked) return;"), "los ejes no responden");
  assert.ok(STAT_SELECTOR.includes("disabled={locked || !card}\n              aria-pressed={on}"), "los ejes no responden");
  assert.ok(BOARD.includes("disabled={!ready || busy || lock.locked}"), "el botón no responde");
  assert.ok(BOARD.includes("aria-busy={busy}"));
  assert.ok(JUGAR.includes("if (!view || inFlight.current) return;"), "la página tiene su propio cerrojo de red");
  assert.ok(JUGAR.includes("busy={busy || settling || reveal !== null || stage === \"intro\"}"), "se bloquea también durante intro y revelación");
});

test("A7 · el rival solo se revela cuando lo dice el servidor: `pendingRival` / `rivalUsed` / `rivalRemaining`", () => {
  assert.ok(BOARD.includes("view.pendingRival ? ("), "la carta rival solo aparece si el servidor la mandó");
  // DUEL GAMEPLAY UX 2.0 · CARTA RIVAL COMPROMETIDA: oculta hasta que respondes. En la mesa, su reverso; el lateral, sin carta.
  assert.ok(BOARD.includes('data-testid="rival-committed"') && /rival-committed[^]*?<DuelCardBack size="lg"/.test(BOARD));
  assert.ok(!/pendingRival\??\.card|pendingRival\??\.value/.test(BOARD), "la vista ya no trae carta ni valor del rival comprometido");
  // F71 · además del recuento, las pistas públicas que calculó el servidor (una por carta oculta) y su ROL canónico.
  assert.ok(BOARD.includes("<RivalHand count={view.rivalRemaining} hints={view.rivalHints} roles={view.rivalRoles ?? []} />"));
  assert.ok(!/rivalHand|snapshotB/.test(code(BOARD)));
});

test("A8 · la revelación nombra las estadísticas por su nombre real y el veredicto viene de `outcome`", () => {
  assert.ok(MOMENT.includes("const v = roundVerdict(turn);"));
  assert.ok(MOMENT.includes("{v.detail}"));
  assert.ok(MOMENT.includes('const youWin = turn.outcome === "A";'));
  assert.ok(!/turn\.you\.value\s*>\s*turn\.rival\.value/.test(code(MOMENT)), "no decide quién gana comparando valores");
});

test("A9 · el desempate por OVR se explica SOLO cuando ocurre, con las cifras del servidor", () => {
  assert.ok(SUMMARY.includes("if (!d.tiebreak) return null;"));
  assert.ok(RESULT.includes('<DecisionPanel result={r} className="mt-3" />'));
  assert.ok(PVP_OUTCOME.includes("<DecisionPanel result={view.result}"));
});

test("A10 · marcador e historial: pista de turnos, columna reservada y tira en miniatura", () => {
  assert.ok(BOARD.includes("<TurnTrack view={view}"));
  /*
   * FASE 45 · LA MESA SIGUE SIN MOVERSE, PERO YA NO POR LA REJILLA.
   *
   * Lo que esta línea protegía es que el tablero no salte entre el turno 1 y el 2. Antes eso lo
   * garantizaba una columna de 300 px reservada a la derecha; esa columna se ha ido (el historial
   * es un cajón) y ahora lo garantiza la RESERVA DE ALTURA de las filas de posiciones: las
   * casillas vacías son fichas bajas, pero la fila mide siempre lo que mide una carta, así que
   * la primera carta jugada no empuja nada. Mismo invariante, otro mecanismo.
   */
  const played = readFileSync(join(process.cwd(), "src/components/duel/arena/PlayedRow.tsx"), "utf8");
  assert.ok(played.includes("min-h-[calc(var(--pos)*1.16)]"), "la fila de posiciones reserva su altura: la mesa no salta");
  assert.ok(!BOARD.includes("xl:grid-cols-[minmax(0,1fr)_300px]"), "la columna lateral fija ya no existe");
  assert.ok(RESULT.includes("<RoundStrip history={view.history}"));
  assert.ok(SUMMARY.includes('aria-label="Historial por turnos"'));
});

test("A11 · el final: CARTA DESTACADA (nunca «MVP»), recompensa, XP y nivel salen de datos del servidor", () => {
  assert.ok(SUMMARY.includes("Carta destacada"));
  assert.ok(!/\bMVP\b/.test(code(SUMMARY) + code(RESULT) + code(PVP_OUTCOME)), "en el código que se ejecuta no existe «MVP»");
  assert.ok(RESULT.includes("r.award.credits") && RESULT.includes("r.award.xp") && RESULT.includes("r.award.points"));
  assert.ok(!/award\.(credits|xp|points)\s*[+\-*\/]\s*\d/.test(code(RESULT)), "no se retoca la recompensa en el cliente");
  assert.ok(RESULT.includes("<LevelProgressPanel xp={xp}"));
  assert.ok(JUGAR.includes("fetchGameState().then((s) => setXp("), "la XP total se pide al servidor");
  // Fase 44 · la barra anima del XP anterior real al nuevo real: el nivel sigue saliendo de la curva del dominio (`xpTimeline` → `levelFromXp`).
  assert.ok(SUMMARY.includes("<XpProgress xp={xp} gained={gained}"), "el panel de nivel usa la pieza de XP de juego");
  assert.ok(readFileSync(join(process.cwd(), "src/lib/gameExperience/xp.ts"), "utf8").includes("levelFromXp(after)"), "el nivel usa la curva del dominio de progresión");
});

test("A12 · post-partida: revancha directa con el mismo mazo y rival, cambiar, ver la partida, salir", () => {
  // F63 · «equipo» (terminología única): antes «Cambiar rival o mazo».
  assert.ok(RESULT.includes("Revancha") && RESULT.includes("Cambiar rival o equipo") && RESULT.includes("Ver la partida") && RESULT.includes("Salir a Duelos"));
  assert.ok(JUGAR.includes("void begin(deckId, difficulty);"), "la revancha crea OTRA partida en el servidor");
  assert.ok(JUGAR.includes('trackDuel("rematch")'));
});

test("A13 · reconexión PvE: al entrar se pregunta al servidor por la partida activa y se retoma donde quedó", () => {
  assert.ok(JUGAR.includes("await Promise.all([fetchActiveDuel(), fetchDuelDecks()])"));
  assert.ok(JUGAR.includes("Partida recuperada desde el servidor"));
  assert.ok(JUGAR.includes('trackDuel("reconnect")'));
  assert.ok(!/localStorage|sessionStorage/.test(code(JUGAR)));
});

test("A14 · telemetría: los siete momentos, solo con contextos del brief y sin taxonomía nueva", () => {
  const used = new Set<string>();
  for (const src of UX) for (const m of src.matchAll(/trackDuel\("([a-z_]+)"\)/g)) used.add(m[1]);
  for (const c of used) assert.ok((DUEL_CONTEXTS as readonly string[]).includes(c), c);
  for (const c of DUEL_CONTEXTS) assert.ok(used.has(c), `falta el momento ${c}`);
  assert.equal(EVENT_NAMES.length, 4);
  assert.equal(FLOWS.length, 4);
  for (const src of UX) assert.ok(!/track\("(match_|duel_|round_)/.test(src), "sin nombres de evento inventados");
});

/* ═══════════════════════ B · PvP ═══════════════════════ */

test("B1 · en PvP el turno ajeno cierra la mesa y lo dice: «Esperando al rival…»", () => {
  assert.ok(PVP_ARENA.includes("waitingRival={!tuTurno && enJuego}"));
  assert.ok(PVP_ARENA.includes("busy={busy || !tuTurno}"));
  assert.ok(BOARD.includes('"Esperando al rival…"'));
  assert.ok(PVP_ARENA.includes("snap?.isYourTurn"), "el turno lo dice el servidor");
});

test("B2 · el mazo del rival sigue oculto: la vista PvP nace redactada y el tablero solo pinta lo jugado", () => {
  assert.ok(PVP_ARENA.includes("buildMatchView(snap.match, {"));
  assert.ok(!/snapshotB|rivalHand/.test(code(PVP_ARENA) + code(PVP_PAGE)));
});

test("B3 · el timeout es del servidor: la cuenta atrás no decide nada y el cierre lo nombra `lifecycle`", () => {
  assert.ok(PVP_ARENA.includes("no decide nada"));
  // F76 · los terminales ya no son una copia local (`TERMINALES`): la página usa la definición canónica del dominio.
  assert.ok(PVP_PAGE.includes("isTerminal(lifecycle as PvpLifecycle)") && PVP_PAGE.includes("snap?.lifecycle"));
  assert.ok(!/setTimeout|setInterval/.test(code(PVP_PAGE)), "la página no tiene relojes");
});

test("B4 · reconexión PvP: se reconstruye desde el servidor y se enseña el estado de la conexión", () => {
  assert.ok(PVP_ARENA.includes("connectionCopy(state.status, snap !== null)"));
  assert.ok(PVP_ARENA.includes("data-connection={state.status}"));
  assert.ok(PVP_PAGE.includes('label="Recuperando la partida…"'));
  assert.ok(PVP_PAGE.includes('"reconnect" : "match_start"'));
  assert.ok(!/localStorage|sessionStorage/.test(code(PVP_PAGE) + code(PVP_ARENA)));
});

test("B5 · doble envío y respuesta tardía: actionId único, expectedVersion y resincronización en STALE_VERSION", () => {
  assert.ok(PVP_PAGE.includes("actionId: crypto.randomUUID()"));
  assert.ok(PVP_PAGE.includes("expectedVersion: state.stateVersion"));
  assert.ok(PVP_PAGE.includes("La partida avanzó mientras decidías. Vuelve a intentarlo."));
  assert.ok(PVP_PAGE.includes("syncNow();"));
  assert.ok(PVP_ARENA.includes("if (!tuTurno || busy) return;"));
});

test("B6 · sin revancha PvP (el backend no la tiene): «Buscar otro rival»; el rating se LEE", () => {
  assert.ok(PVP_OUTCOME.includes("Buscar otro rival"));
  assert.ok(!/Revancha/.test(code(PVP_OUTCOME)));
  assert.ok(PVP_OUTCOME.includes('data-field="pending"'), "sin movimiento aún: se dice, no se inventa");
  assert.ok(!/newRating\s*-\s*oldRating/.test(code(PVP_OUTCOME) + code(PVP_PAGE)));
  assert.ok(PVP_PAGE.includes("outcome=1"));
});

test("B7 · la arena PvP sigue con un solo bucle de red: nada de fetch ni relojes de red propios", () => {
  const arena = code(PVP_ARENA);
  assert.ok(!/fetch\(/.test(arena));
  assert.ok(((arena.match(/setInterval/g) ?? []).length) <= 1, "solo el tick visual");
  // F72.8 · el contador es el componente COMPARTIDO con el PvE (`TurnTimer`): anuncia solo al cruzar 10 s y 5 s.
  assert.ok(PVP_ARENA.includes("<TurnTimer ms={restante} yours={tuTurno} />"));
  const timer = read("components", "duel", "arena", "TurnTimer.tsx");
  assert.ok(timer.includes('role="timer"') && timer.includes('aria-live="polite"') && !/setInterval|fetch\(/.test(timer));
});

/* ═══════════════════════ C · UX ═══════════════════════ */

test("C1 · ayuda «?» en pre-partida, arena PvE y arena PvP; sin copiar la tabla de enfrentamientos", () => {
  assert.ok(PREMATCH.includes('aria-label="Cómo se juega"'));
  assert.ok(JUGAR.includes('aria-label="Cómo se juega"'));
  assert.ok(PVP_ARENA.includes('<HelpSheet open={help} onClose={() => setHelp(false)} mode="PVP" />'));
  assert.ok(JUGAR.includes('<HelpSheet open={help} onClose={() => setHelp(false)} mode="PVE" />'));
  assert.ok(!/COMBAT_MATCHUP|stronghold.*entryfrag.*gamesense.*gamesense/.test(code(HELP)), "la respuesta obligada no se copia");
  assert.ok(HELP.includes("STAT_INFO"), "los nombres reales salen del contrato");
});

test("C2 · móvil: la ayuda es hoja inferior, el historial en miniatura desplaza en horizontal, sin anchos fijos", () => {
  assert.ok(HELP.includes("fixed inset-x-0 bottom-0") && HELP.includes("sm:left-1/2 sm:top-1/2"));
  assert.ok(HELP.includes("env(safe-area-inset-bottom)"));
  assert.ok(SUMMARY.includes("overflow-x-auto"));
  // `max-w-[1320px]` de la arena es un TECHO, no un ancho fijo: lo que se prohíbe es `w-[NNNNpx]`.
  assert.ok(!/(?<!max-)w-\[\d{4,}px\]/.test(UX.join("\n")));
});

test("C3 · movimiento reducido: MotionConfig en la arena y `useReducedMotion` en intro, revelación y resultado", () => {
  assert.ok(JUGAR.includes('MotionConfig reducedMotion="user"'));
  for (const [n, s] of [["intro", INTRO], ["momento", MOMENT], ["resultado", RESULT]] as const) assert.ok(s.includes("useReducedMotion()"), n);
});

test("C4 · sonido: cues en selección, confirmación, veredicto y final; el silencio existe y se respeta", () => {
  assert.ok(BOARD.includes('playCue("ui")') && BOARD.includes('playCue("whoosh")'));
  assert.ok(MOMENT.includes('"round_win" : "round_lose"'));
  assert.ok(RESULT.includes('"victory" : kind === "loss" ? "defeat" : "ui"'));
  assert.ok(SOUND_BTN.includes("setMuted(next)") && SOUND_BTN.includes("isMuted()"));
  assert.ok(/if \(!ac \|\| muted( \|\| k <= 0)?\) return;/.test(SOUND), "silenciado (o volumen 0, Fase 44), ningún cue suena");
  assert.ok(JUGAR.includes("<SoundToggle") && PVP_ARENA.includes("<SoundToggle"));
  assert.ok(!/localStorage/.test(code(SOUND_BTN)));
});

test("C5 · objetivos táctiles y foco: ayuda/sonido/salir de 44 px; controles con `nx-focus`", () => {
  assert.ok(/h-11 w-11/.test(SOUND_BTN) && /h-11 w-11/.test(PREMATCH) && /h-11 w-11/.test(JUGAR));
  assert.ok(JUGAR.includes('variant="ghost" size="md" className="shrink-0" onClick={onQuit}'));
  assert.ok(INTRO.includes("min-h-[44px]") && HELP.includes("nx-focus"));
});

test("C6 · entrada al modo: la home ofrece JUGAR o CREAR/EDITAR EQUIPO según el estado real de los mazos", () => {
  // Fase 35: «Jugar» entra por el hub de modos (`/jugar`). Fase 36: la decisión vive en el dominio del Daily Loop
  // (prioridad única) y la home solo la pinta; el equipo no válido lleva a ESE equipo en el constructor.
  const DAILY = read("domain", "dailyLoop", "index.ts");
  assert.ok(HOME.includes("<DailyLobby") && HOME.includes("useDailyLoop("));
  assert.ok(DAILY.includes('play: "/jugar"') && DAILY.includes('cta: "Crear equipo"') && DAILY.includes('cta: "Editar equipo"'));
  assert.ok(DAILY.includes("export const deckEditRoute = (deckId: string) => `${DAILY_ROUTES.decks}?deck=${encodeURIComponent(deckId)}`;"));
  assert.ok(DAILY.includes('if (d.valid > 0) return "READY";'));
  // F71 · /duelos: sin equipo válido cada modo enseña el CTA de `gameModes()` («Completar equipo»).
  assert.ok(HUB.includes("hasValidDeck: m ? m.decks.valid > 0 : null") && HUB.includes("gameModes(facts)"));
});

test("C7 · errores y estados de fallo: el error del servidor se enseña y se puede cerrar; sin partida se explica", () => {
  assert.ok(BOARD.includes('aria-label="Cerrar aviso"'));
  assert.ok(JUGAR.includes("<ErrorState message={fatal} onRetry={boot} />"));
  // F63 · REESCRITO A PROPÓSITO: la primera sesión usa «equipo» en todas partes (terminología única del producto).
  assert.ok(PREMATCH.includes("No tienes ningún equipo listo"));
  assert.ok(JUGAR.includes('<NeedsAccount what="jugar duelos" />'));
});

/* ═══════════════════════ D · regresión (motor, balance, reglas, economía) ═══════════════════════ */

test("D1 · el motor y las reglas no se han tocado: 10 turnos, reglas v2, tres desempates en su orden", () => {
  assert.ok(MATCH_TYPES.includes("TURNS_PER_MATCH = 10"));
  assert.ok(RULES.includes("CURRENT_COMBAT_RULES = COMBAT_RULES_V2") || RULES.includes("CURRENT_COMBAT_RULES: CombatRules = COMBAT_RULES_V2"));
  assert.ok(RULES.includes('"duel-combat-2"'));
});

test("D2 · el balance de los bots no cambia: EASY 0 · NORMAL 0.5 · HARD 0.85, sin información perfecta", () => {
  assert.ok(BOTS.includes("NORMAL_HEURISTIC_RATE = 0.5") && BOTS.includes("HARD_HEURISTIC_RATE = 0.85"));
  assert.ok(/EASY:\s*\{ heuristicRate: 0,\s*perfectInformation: false \}/.test(BOTS));
  assert.ok(!/perfectInformation: true/.test(BOTS));
});

test("D3 · la interfaz nueva no importa el motor, no genera azar, no guarda partida y está bajo UI_FILES", () => {
  for (const [n, s] of [["PreMatch", PREMATCH], ["MatchIntro", INTRO], ["HelpSheet", HELP], ["SoundToggle", SOUND_BTN], ["MatchSummary", SUMMARY]] as const) {
    const c = code(s);
    assert.ok(!/@\/domain\/cardgame\/(match|combat|opponent)|@\/server\//.test(c), n);
    assert.ok(!/Math\.random|localStorage|useGameStore/.test(c), n);
    assert.ok(DUEL_TEST.includes(`"src/components/duel/${n}.tsx"`), `${n} en UI_FILES`);
  }
});

test("D4 · el cliente solo envía lo que el servidor valida: acción, mazo, dificultad, partida, carta y eje", () => {
  const bodies = [...CLIENT.matchAll(/\{ action: "[a-z]+"(?:, [^}]*)? \}/g)].map((m) => m[0]);
  assert.ok(bodies.length >= 7);
  // F67 · con límites de palabra: `expectedVersion` contiene «xp» y no es una decisión del cliente.
  for (const b of bodies) assert.ok(!/(winner|score|result|award|xp|credits|seed|rival)/.test(b), b);
});

test("D6 · REGRESIÓN (encontrada en el arnés) · en PvP la mano rival cuenta 10 − jugadas, no «lo visible − jugadas»", () => {
  /*
   * `buildMatchView` restaba sobre `rivalSnap.cards.length`, y en PvP el snapshot llega REDACTADO
   * por `projectMatchFor` (solo lo jugado + la declarada): la mesa decía «Rival · 1 carta» a mitad
   * de partida y pintaba un solo reverso. El tamaño del mazo es un invariante del dominio.
   */
  const MV = read("lib", "duel", "matchView.ts");
  assert.ok(MV.includes("rivalRemaining: Math.max(0, DUEL_DECK_SIZE - usedRival.size)"));
  assert.ok(!/rivalRemaining: rivalSnap\.cards\.length/.test(MV));
});

test("D5 · Marketplace sigue cerrado y esta fase no lo toca", () => {
  assert.ok(/GLOBAL_MARKET_ENABLED\s*=\s*false/.test(FEATURES));
  assert.ok(!/market|mercado/i.test(UX.map(code).join("\n")));
});
