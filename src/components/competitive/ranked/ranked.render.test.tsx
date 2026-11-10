/**
 * FASE 55 · COMPETITIVO 4.0 — render de las piezas REALES con los fixtures QA del arnés (sin servidor).
 * Estados: centro (clasificado, colocación, sin clasificar, mazo ilegal, sin mazos, partida viva), búsqueda,
 * rival encontrado, resultado con ascenso / descenso / clasificado, historial, clasificación y temporada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { rankedGate } from "@/domain/pvpLadder/ranked";
import { RankedCenter } from "./RankedCenter";
import { RecentMatchCards } from "./RecentMatchCards";
import { RankedLadder } from "./RankedLadder";
import { SeasonStrip } from "./SeasonStrip";
import { RankedSearch } from "@/components/duel/pvp/RankedSearch";
import { RankedMatchFound } from "@/components/duel/pvp/RankedMatchFound";
import { RankedMovement } from "@/components/duel/pvp/RankedMovement";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { rankMovement } from "@/domain/ranked/standing";
import {
  HUB, NEW, PLACEMENT, FIRST, DECK_OK, DECK_OK_2, DECK_BAD, MATCHUP, MOVE_HOLD, MOVE_UP, MOVE_DOWN, MOVE_PLACED, MOVE_ENTERED, HISTORY, QA_NOW,
} from "@/app/design-system/fase55/fixtures";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ready = rankedGate({ signedIn: true, decks: [DECK_OK, DECK_OK_2], activeDeckId: DECK_OK.id });

test("C1 · centro clasificado (F84): RANGO + división, rating, puesto del Top, progreso a la siguiente división y JUGAR", () => {
  const h = html(<RankedCenter snap={HUB} gate={ready} legalDecks={[DECK_OK, DECK_OK_2]} onChooseDeck={() => {}} />);
  const t = text(h);
  // 1201 con rank-v1 → Capitán I (1190–1219); la siguiente división es Estrella III (1220).
  assert.match(t, /Capitán\s*I\b/);
  assert.ok(h.includes('data-tier="capitan"') && h.includes('data-division="1"'), "forma y división en el emblema, no solo color");
  assert.match(t, /1201/);
  assert.match(t, /#124 de 500/);
  assert.match(t, /\+19 de rating para Estrella III/);
  assert.match(t, /\+9 para superar a/);
  assert.ok(h.includes('data-testid="ranked-play-cta"') && h.includes(`href="/duelos/pvp?buscar=${DECK_OK.id}"`));
  assert.match(t, /Jugar competitivo/i);
  assert.ok(h.includes('data-testid="ranked-deck-select"'), "con dos mazos legales se puede cambiar");
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1, "un solo CTA dominante");
});

test("C2 · estadísticas SOLO persistidas; racha solo si hay; mejor rating del libro; nunca K/D ni MVP", () => {
  const t = text(html(<RankedCenter snap={HUB} gate={ready} legalDecks={[DECK_OK]} />));
  for (const k of ["Partidas", "Victorias", "Derrotas", "% victorias", "Mejor rating"]) assert.ok(t.includes(k), k);
  assert.ok(!/K\/D|MVP|KDA/.test(t));
});

test("C3 · colocación de la temporada (F84): 4 / 5 sin rango; sin clasificar: qué hacen las 5 primeras", () => {
  const ph = html(<RankedCenter snap={PLACEMENT} gate={ready} legalDecks={[DECK_OK]} />);
  const p = text(ph);
  assert.match(p, /Partidas de colocación 4 \/ 5/);
  assert.match(p, /Te falta 1 partida/);
  assert.ok(ph.includes('data-scene="ranked-hero" data-state="PLACEMENT" data-tier="none"'), "en colocación el héroe no enseña rango");
  const n = text(html(<RankedCenter snap={NEW} gate={ready} legalDecks={[DECK_OK]} />));
  assert.match(n, /Sin clasificar/);
  assert.match(n, /Juega 5 partidas ranked esta temporada para obtener tu rango/);
  assert.match(n, /Aún no has jugado ninguna partida ranked/);
});

test("C4 · mazo ilegal: qué falta EXACTAMENTE (frases del validador) y EDITAR ESE mazo; sin mazos: CREAR", () => {
  const h = html(<RankedCenter snap={NEW} gate={rankedGate({ signedIn: true, decks: [DECK_BAD], activeDeckId: DECK_BAD.id })} legalDecks={[]} />);
  const t = text(h);
  assert.match(t, /no es legal/);
  assert.match(t, /El mazo debe tener 10 cartas: te faltan 2\./);
  assert.match(t, /Necesitas 2 cartas de Centinela; ahora tienes 1\./);
  assert.ok(h.includes(`href="/duelos/mazos?deck=${DECK_BAD.id}"`));
  assert.ok(!h.includes('data-testid="ranked-play-cta"'), "sin mazo legal no se ofrece JUGAR");
  const none = html(<RankedCenter snap={NEW} gate={rankedGate({ signedIn: true, decks: [], activeDeckId: null })} legalDecks={[]} />);
  assert.ok(none.includes('data-testid="ranked-create-deck"') && none.includes('href="/duelos/mazos?nuevo=1"'));
});

test("C5 · partida PvP viva: CONTINUAR PARTIDA, no JUGAR", () => {
  const h = html(<RankedCenter snap={HUB} gate={rankedGate({ signedIn: true, decks: [DECK_OK], activeDeckId: DECK_OK.id, activeMatchId: "resume-ranked" })} legalDecks={[DECK_OK]} resumeHref="/duelos/pvp?match=abc" />);
  assert.ok(h.includes('data-testid="ranked-resume"') && h.includes('href="/duelos/pvp?match=abc"'));
  assert.ok(!h.includes('data-testid="ranked-play-cta"'));
});

test("C6 · carril del pase cerrado: puntos reales y lo que falta; #1 con carril abierto", () => {
  const t = text(html(<RankedCenter snap={NEW} gate={ready} legalDecks={[DECK_OK]} />));
  assert.match(t, /Llevas 78/); assert.match(t, /te faltan 322/);
  const f = html(<RankedCenter snap={FIRST} gate={ready} legalDecks={[DECK_OK]} />);
  // F84 · 1488 → CUMBRE (élite, sin divisiones) y #1 del Top: emblema + puesto numerado.
  assert.match(text(f), /Cumbre/); assert.match(text(f), /Top 500 · #1/); assert.match(text(f), /Eres el número 1/);
});

test("C7 · honestidad visible antes de jugar: rival humano, sin bots, resultado del servidor", () => {
  const t = text(html(<RankedCenter snap={HUB} gate={ready} legalDecks={[DECK_OK]} />));
  assert.match(t, /no hay bots/); assert.match(t, /Rival humano/); assert.match(t, /Resultado del servidor/);
});

test("B1 · buscando: ventana real por espera (±150 → cualquiera), jugadores reales, caducidad y cancelar", () => {
  const a = text(html(<RankedSearch waitingSeconds={10} position={0} rating={1201} deckName="QA" busy={false} onCancel={() => {}} />));
  assert.match(a, /Buscando rival/i); assert.match(a, /±150/); assert.match(a, /no tiene bots/); assert.match(a, /Cancelar búsqueda/);
  assert.ok(!/caduca/.test(a), "el aviso de poca gente solo tras un minuto");
  const b = text(html(<RankedSearch waitingSeconds={134} position={0} rating={1201} deckName="QA" busy={false} onCancel={() => {}} />));
  assert.match(b, /Cualquiera/); assert.match(b, /caduca en 07:46/);
});

test("M1 · rival encontrado: los dos lados con identidad pública, el rival etiquetado como jugador real", () => {
  const t = text(html(<RankedMatchFound matchup={MATCHUP} deckName={DECK_OK.name} onDone={() => {}} />));
  assert.match(t, /Rival encontrado/i); assert.match(t, /Jugador real/);
  assert.ok(t.includes(MATCHUP.rival.username) && t.includes(String(MATCHUP.rival.rating)) && t.includes("#98"));
  assert.match(t, /Rival \+35 de rating/);
  assert.match(t, new RegExp(`Equipo: ${DECK_OK.name}`));
  const loading = text(html(<RankedMatchFound matchup={null} deckName={null} onDone={() => {}} />));
  assert.match(loading, /Cargando…/);
});

test("R1 · ascenso / descenso / clasificado / entrada: palabra, glifo y puestos; sin ceremonia si no se movió", () => {
  const up = text(html(<RankedMovement movement={MOVE_UP} rankedTotal={500} />));
  assert.match(up, /Ascenso/); assert.match(up, /#14/); assert.match(up, /#9/); assert.match(up, /Subes 5 puestos/);
  const down = text(html(<RankedMovement movement={MOVE_DOWN} rankedTotal={500} />));
  assert.match(down, /Descenso/); assert.match(down, /Bajas 7 puestos/);
  assert.match(text(html(<RankedMovement movement={MOVE_PLACED} rankedTotal={500} />)), /Clasificado/);
  assert.match(text(html(<RankedMovement movement={MOVE_ENTERED} rankedTotal={500} />)), /Entras en la escalera/);
  assert.equal(html(<RankedMovement movement={MOVE_HOLD} rankedTotal={500} />), "");
});

test("R2 · resultado ranked (RESULTADO ÚNICO): veredicto y el CAMBIO de rating del asiento en la línea de recompensas; sin escalera ni ceremonia", () => {
  const ev = { matchId: "qa", oldRating: 1211, delta: 18, newRating: 1229, opponentRating: 1236, kFactor: 24, result: "WIN" as const, createdAt: QA_NOW };
  // Asiento del servidor: partida 9 de la temporada (ya clasificado) que cruza 1220 → ASCENSO Capitán I → Estrella III.
  const rank = rankMovement({ oldRating: 1211, newRating: 1229, seasonMatchNumber: 9, rule: "STANDARD" }, { placementGames: 5, rankConfigVersion: "rank-v1" });
  const h = html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={null} rating={1229} outcome={ev} rank={rank}
    ladder={{ before: { position: 14 }, after: { position: 9, rankedTotal: 500 }, positions: 5, movement: MOVE_UP }} onAgain={() => {}} onBack={() => {}} backLabel="Volver a Competitivo" rivalName="Kaelis" />);
  assert.ok(h.includes('data-mode="PVP"') && h.includes('data-kind="win"'));
  assert.ok(h.includes('data-field="rating"'));
  const t = text(h);
  for (const s of ["Victoria", "+18", "Rating", "Jugar otra", "Volver al lobby"]) assert.ok(t.includes(s), s);
  // El rango, la escalera y el rival viven en Competitivo / el perfil: el resultado no los apila.
  assert.ok(!h.includes('data-testid="rank-change"') && !h.includes('data-testid="pvp-ladder"'));
  for (const s of ["Ascenso", "Estrella III", "Subes 5 puestos", "Kaelis"]) assert.ok(!t.includes(s), s);
  const pending = html(<PvpOutcome verdict="LOSS" lifecycle="FINISHED" view={null} rating={1201} outcome={null} ladder={null} onAgain={() => {}} onBack={() => {}} />);
  assert.ok(pending.includes('data-field="rating-pending"') && !text(pending).includes("1201"), "sin asiento no se inventa un número");
});

test("H1 · historial: palabra de resultado, rival, antes→después y enlace al detalle; vacío honesto", () => {
  const h = html(<RecentMatchCards matches={HISTORY.slice(0, 3)} />);
  const t = text(h);
  assert.match(t, /Victoria/); assert.match(t, /Derrota/);
  assert.ok(h.includes(`href="/duelos/competitivo/partida/${HISTORY[0].matchId}"`));
  assert.match(t, /1140 → 1158/);
  assert.match(text(html(<RecentMatchCards matches={[]} />)), /Aún no has jugado ninguna partida ranked/);
});

test("L1 · clasificación: mi fila marcada y botón a mi página cuando no estoy en la visible", () => {
  const h = html(<RankedLadder top={HUB.leaderboardTop} rankedTotal={500} selfPosition={124} loadPage={async () => null} />);
  assert.ok(h.includes('data-testid="ladder-me"') && /Ir a mi posición \(#124\)/.test(text(h)));
  assert.match(text(h), /Global · 500 jugadores clasificados/);
  assert.ok(!/@|email/i.test(text(h)), "sin correos");
});

test("T1 · temporada: nombre del calendario, récord del libro, sin reinicio simulado, enlace a /temporada", () => {
  const h = html(<SeasonStrip season={HUB.season} />);
  const t = text(h);
  assert.ok(HUB.season && t.includes(HUB.season.displayName));
  assert.match(t, /tu rating continúa entre temporadas/);
  assert.ok(h.includes('href="/temporada/pase"')); // IA 2026-10-07 · la temporada (y su tramo ranked) se ve en el pase
  assert.match(t, /14/, "8+5+1 partidas en la temporada");
});
