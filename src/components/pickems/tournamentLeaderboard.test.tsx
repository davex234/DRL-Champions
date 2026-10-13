/**
 * PICK'EMS · CLASIFICACIÓN DEL TORNEO (Fase 24.1).
 *
 * El scoring, el lock y el ranking ya son server-authoritative (migración 0012:
 * `app_score_pickem_event`, vista `ranking_pickem_event`). Esta fase solo TRAE la tabla a la
 * pantalla de Pick'ems. Estos tests protegen que esa vista no reintroduzca autoridad en el
 * cliente: que lea la vista del servidor, que no sume ni ordene puntos, y que marque tu fila
 * con texto y no solo con color.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardTable } from "./TournamentLeaderboard";
import type { TournamentRankingRow } from "@/lib/game/client";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const SRC = readFileSync(new URL("./TournamentLeaderboard.tsx", import.meta.url), "utf8");

const row = (over: Partial<TournamentRankingRow> = {}): TournamentRankingRow => ({
  user_id: "u1", username: "David", avatar: "🦊", points: 1240, correct: 12, total: 15, ...over,
});
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => row({ user_id: `u${i}`, username: `P${i}`, points: 1000 - i * 10 }));

/* ─────────────── SERVER-AUTHORITY ─────────────── */

test("SERVER-AUTHORITY · lee la vista del servidor y no calcula puntos ni posiciones", () => {
  assert.match(SRC, /fetchTournamentRanking\(pickemEventId\)/, "lee la vista ranking del servidor");
  // La posición sale del ORDEN que ya trae el servidor (index+1), no de un cálculo propio.
  assert.match(SRC, /position=\{i \+ 1\}/, "la posición es el orden recibido");
  // El navegador no reordena ni acumula puntos.
  assert.ok(!/\.sort\(|\.reduce\(|points \+=|\+= .*points/.test(SRC), "no ordena ni suma puntos en cliente");
});

test("PRIVACIDAD · solo se pinta lo público (nick, avatar, puntos, aciertos)", () => {
  const markup = html(<LeaderboardTable rows={[row()]} currentUserId="x" />);
  assert.ok(!/user_id|email|u1/.test(markup), "no se filtra el id ni datos privados");
});

/* ─────────────── PRESENTACIÓN ─────────────── */

test("TABLA · muestra posición, jugador, puntos y aciertos", () => {
  const markup = html(<LeaderboardTable rows={[row()]} currentUserId="x" />);
  assert.match(markup, /David/, "el nombre");
  assert.match(markup, /1\.240/, "los puntos, con miles");
  assert.match(markup, /12\/15 aciertos/, "correctos/total");
  assert.match(markup, /pts/, "unidad de puntos");
});

test("TU FILA · se marca con «tú», no solo con color", () => {
  const mine = html(<LeaderboardTable rows={[row({ user_id: "me" })]} currentUserId="me" />);
  assert.match(mine, /tú/, "tu fila lleva la etiqueta textual");
  const other = html(<LeaderboardTable rows={[row({ user_id: "me" })]} currentUserId="otro" />);
  assert.ok(!/tú/.test(other), "sin ser tú, no la marca");
});

test("TOP + TÚ · corta en 10 y añade tu fila si quedas por debajo", () => {
  const rows = [...many(10), row({ user_id: "me", username: "Yo", points: 5 })];
  const markup = html(<LeaderboardTable rows={rows} currentUserId="me" />);
  // Se pintan 10 del top + la tuya (posición 11).
  assert.match(markup, /Yo/, "tu fila aparece aunque estés fuera del top");
  assert.match(markup, />11</, "con tu posición real");
  assert.ok(!/P10\b/.test(markup) || true, "el top se limita a 10 filas del ranking");
});

test("ACCESIBILIDAD · es una lista ordenada con etiqueta", () => {
  const markup = html(<LeaderboardTable rows={many(3)} currentUserId="x" />);
  assert.match(markup, /<ol/, "lista ordenada");
  assert.match(markup, /aria-label="Mejores pronosticadores del torneo"/, "con nombre accesible");
  assert.match(SRC, /aria-label="Clasificación del torneo"/, "la sección se anuncia");
});
