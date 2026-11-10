/**
 * PÁGINA DEL EVENTO — EL CUADRO (Fase 24.4).
 *
 * ────────────────────────── QUÉ PUBLICA VLR ──────────────────────────
 *
 * La página del evento (`/event/{id}/slug`, la misma que ya descarga el importador para la
 * cabecera y los equipos) lleva el cuadro dibujado con un markup estable, observado en cinco
 * eventos reales (Champions 2024 y 2025, Americas Stage 1 2024, Pacific Stage 2 2025 y
 * Champions 2026 todavía sin jugar):
 *
 *   <div class="wf-label mod-large">Bracket | Group A</div>
 *   <div class="event-brackets-container">
 *     <div class="bracket-container mod-upper|mod-lower [mod-compact]">
 *       <div class="bracket-col mod-N [mod-single]">
 *         <div class="bracket-col-label">Upper Semifinals | Opening | Qualified</div>
 *         <div class="bracket-row mod-K|mod-spacing">
 *           <a class="bracket-item [mod-last] [mod-empty]" href="/{matchId}/{slug}" title="A vs. B">
 *             <div class="bracket-item-team mod-first [mod-winner|mod-loser]" data-team-id="…">
 *               <div class="bracket-item-team-name"><span>Nombre</span></div>
 *               <div class="bracket-item-team-score">2</div>
 *             </div>
 *             … segundo equipo …
 *             <div class="bracket-item-line mod-up|mod-down|mod-straight"></div>   ← ALIMENTA la columna siguiente
 *           </a>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * La columna «Qualified» (`mod-single`) no lleva partido: un solo `bracket-item-team` con el
 * clasificado (vacío hasta que se sepa). Un partido aún sin equipos («TBD vs. TBD») SÍ tiene
 * id de partido en el href y las cajas de equipo vacías.
 *
 * ────────────────────────── QUÉ SE AFIRMA Y QUÉ NO ──────────────────────────
 *
 * `bracket-item-line` es la marca EXPLÍCITA de que ese partido alimenta la columna siguiente
 * de su mismo contenedor. Con ella y con las cuentas de cajas, la gramática es cerrada:
 *
 *   · 2 alimentadores por cada destino, en parejas consecutivas (down, up) → el ganador de la
 *     primera va al HUECO 1 del destino y el de la segunda al HUECO 2. Verificado en los cinco
 *     eventos contra los resultados reales (Upper Semifinals → Upper Final, Opening → Winner's).
 *   · tantos alimentadores como destinos → uno a uno, en orden. SIN hueco: el otro hueco lo
 *     ocupa un equipo que llega de fuera (cabeza de serie, o el que cae del cuadro alto) y la
 *     página no dice cuál. Verificado (Upper Round 1 → Upper Semifinals con byes; Lower R1 → R2).
 *   · alimentador con `mod-straight` hacia una columna `mod-single` → el ganador se CLASIFICA
 *     (nodo de clasificación). Verificado en Champions 2026 (Winner's → Qualified, Decider → Qualified).
 *   · cualquier otra combinación → no se afirma nada para esa transición.
 *
 * Lo que la página NO dice y aquí NO se inventa: adónde cae el PERDEDOR (el cuadro bajo es otro
 * contenedor sin líneas desde el alto), la Final Baja → Gran Final (otro contenedor), ni un
 * «reset» de gran final. Eso queda para la verificación por resultado (24.3).
 *
 * Y una red más: si un alimentador ya terminó y su ganador NO está en el destino que la
 * gramática señala, la transición entera se descarta y se registra como conflicto. Un cambio
 * de markup produce cero aristas y un aviso, nunca aristas falsas.
 *
 * Parsing PURO: sin DOM, sin red. Igual que el resto del conector.
 */
import { findAll, textOf, decodeEntities } from "./parser";
import { ns, td } from "@/i18n/runtime";

const tr = ns("importervlr");

export type BracketLineDir = "up" | "down" | "straight";

export interface VlrBracketTeam { name: string; vlrTeamId?: string; score?: number; winner: boolean; loser: boolean }

export interface VlrBracketItem {
  /** Id numérico de VLR del partido (del href). `undefined` en la caja de clasificado. */
  matchId?: string;
  teams: VlrBracketTeam[];
  /** Presencia y dirección de la línea hacia la columna siguiente. */
  line?: BracketLineDir;
  empty: boolean;
}

export interface VlrBracketColumn {
  label: string;
  /** Columna de clasificado (`mod-single`): sin partido, un solo equipo. */
  qualified: boolean;
  items: VlrBracketItem[];
}

export interface VlrBracketContainer {
  /** «Group A», «Bracket»… el `wf-label` que precede al contenedor, si lo hay. */
  group?: string;
  side: "upper" | "lower";
  columns: VlrBracketColumn[];
}

export type StructureEvidence = "SOURCE_STRUCTURED_HTML";
export type StructureConfidence = "CONFIRMED";

export interface VlrStructuralEdge {
  fromMatchId: string;
  source: "WINNER";
  /** Partido destino, o `undefined` si el destino es un nodo de clasificación. */
  toMatchId?: string;
  toSlot?: 1 | 2;
  /** Clave del nodo de clasificación (`qualified:<grupo>:<columna>`). */
  qualificationKey?: string;
  qualificationLabel?: string;
  evidence: StructureEvidence;
  confidence: StructureConfidence;
}

export interface VlrBracketStructure {
  containers: VlrBracketContainer[];
  edges: VlrStructuralEdge[];
  /** Transiciones que no encajan en la gramática (no producen aristas) y conflictos con resultados. */
  unknown: string[];
  conflicts: string[];
  /** ¿Había cuadro en la página? `false` = no hay markup de brackets (no es un error). */
  present: boolean;
}

/* ═══════════════════════════ 1. PARSE ═══════════════════════════ */

const cls = (tag: string): string => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/\s+/g, " ").trim();

function parseTeam(block: string): VlrBracketTeam {
  const head = /<div[^>]*class="[^"]*bracket-item-team[^"]*"[^>]*>/.exec(block)?.[0] ?? "";
  const c = cls(head);
  const name = textOf(/<span>([\s\S]*?)<\/span>/.exec(block)?.[1] ?? "");
  const scoreTxt = textOf(/bracket-item-team-score[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "");
  const vlrTeamId = /data-team-id="(\d+)"/.exec(head)?.[1];
  return {
    name: decodeEntities(name),
    vlrTeamId,
    score: /^\d+$/.test(scoreTxt) ? Number(scoreTxt) : undefined,
    winner: /\bmod-winner\b/.test(c),
    loser: /\bmod-loser\b/.test(c),
  };
}

/** Bloques `bracket-item-team` de un fragmento, uno por equipo. */
function parseTeams(html: string): VlrBracketTeam[] {
  const starts = findAll(/<div[^>]*class="[^"]*\bbracket-item-team\b(?![-\w])[^"]*"[^>]*>/g, html).map((m) => m.index);
  return starts.map((s, i) => parseTeam(html.slice(s, starts[i + 1] ?? html.length)));
}

/** Etiqueta `wf-label` que precede a un índice (el nombre del grupo o «Bracket»). */
function labelBefore(html: string, index: number): string | undefined {
  const i = html.lastIndexOf('class="wf-label mod-large"', index);
  if (i < 0) return undefined;
  const t = textOf(html.slice(i, html.indexOf("</div>", i)).replace(/^[^>]*>/, ""));
  return t || undefined;
}

/**
 * Los contenedores de cuadro de la página del evento. Falla en seguro: sin markup → `[]`.
 */
export function parseEventBrackets(html: string): VlrBracketContainer[] {
  const out: VlrBracketContainer[] = [];
  const groupStarts = findAll(/<div[^>]*class="event-brackets-container[^"]*"[^>]*>/g, html);
  const groupBounds = groupStarts.map((g, i) => ({
    start: g.index, end: groupStarts[i + 1]?.index ?? html.length, label: labelBefore(html, g.index),
  }));

  for (const gb of groupBounds) {
    const region = html.slice(gb.start, gb.end);
    const conts = findAll(/<div[^>]*class="bracket-container[^"]*"[^>]*>/g, region);
    for (let ci = 0; ci < conts.length; ci++) {
      const c = cls(conts[ci][0]);
      const side: "upper" | "lower" = /\bmod-lower\b/.test(c) ? "lower" : "upper";
      const cRegion = region.slice(conts[ci].index, conts[ci + 1]?.index ?? region.length);
      // `bracket-col` seguido de espacio o cierre: `bracket-col-label` NO es una columna.
      const cols = findAll(/<div[^>]*class="bracket-col(?: [^"]*)?"[^>]*>/g, cRegion);
      const columns: VlrBracketColumn[] = [];
      for (let k = 0; k < cols.length; k++) {
        const colCls = cls(cols[k][0]);
        const colRegion = cRegion.slice(cols[k].index, cols[k + 1]?.index ?? cRegion.length);
        const label = textOf(/bracket-col-label"[^>]*>([\s\S]*?)<\/div>/.exec(colRegion)?.[1] ?? "");
        const qualified = /\bmod-single\b/.test(colCls);
        if (/\bmod-placeholder\b/.test(colCls)) continue;
        const items: VlrBracketItem[] = [];
        if (qualified) {
          // Sin partido: la caja del clasificado (vacía hasta que se sepa).
          const teams = parseTeams(colRegion);
          items.push({ teams: teams.slice(0, 1), empty: teams.length === 0 || !teams[0].name });
        } else {
          const anchors = findAll(/<a[^>]*class="[^"]*\bbracket-item\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g, colRegion);
          for (const a of anchors) {
            const ac = cls(a[0].slice(0, a[0].indexOf(">") + 1));
            const href = /href="\/(\d+)\//.exec(a[0])?.[1];
            const empty = /\bmod-empty\b/.test(ac);
            if (empty) { items.push({ teams: [], empty: true }); continue; }
            const line = /bracket-item-line[^"]*\bmod-(up|down|straight)\b/.exec(a[1])?.[1] as BracketLineDir | undefined;
            items.push({ matchId: href, teams: parseTeams(a[1]), line, empty: false });
          }
        }
        if (!label && items.length === 0) continue;
        columns.push({ label, qualified, items });
      }
      if (columns.length > 0) out.push({ group: gb.label, side, columns });
    }
  }
  return out;
}

/* ═══════════════════════════ 2. GRAMÁTICA → ARISTAS ═══════════════════════════ */

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const slugOf = (s: string): string => norm(s) || "x";

/** Un partido terminado con ganador: el nombre del ganador, o `undefined` si aún no se sabe. */
const winnerName = (it: VlrBracketItem): string | undefined => it.teams.find((t) => t.winner && t.name)?.name;

/**
 * Deriva las aristas estructurales de los contenedores parseados. Puro y determinista.
 *
 * Solo dentro de cada contenedor y solo entre columnas consecutivas. Cada transición se
 * valida contra los resultados que ya existan; si contradice, se descarta entera.
 */
export function deriveBracketStructure(containers: VlrBracketContainer[]): VlrBracketStructure {
  const edges: VlrStructuralEdge[] = [];
  const unknown: string[] = [];
  const conflicts: string[] = [];

  for (const cont of containers) {
    const where = `${cont.group ?? "bracket"}/${cont.side}`;
    for (let k = 0; k + 1 < cont.columns.length; k++) {
      const from = cont.columns[k];
      const to = cont.columns[k + 1];
      if (from.qualified) continue;
      const feeders = from.items.filter((it) => !it.empty && it.matchId && it.line);
      if (feeders.length === 0) continue;
      const tag = `${where}: ${from.label || "?"} → ${to.label || "?"}`;

      // ── Clasificación: alimentadores «rectos» hacia una columna de clasificado ──
      if (to.qualified) {
        const targets = to.items;
        if (feeders.length !== 1 || targets.length !== 1 || feeders[0].line !== "straight") {
          unknown.push(tr("{tag}: clasificación no unívoca ({length} alimentadores, {length2} cajas)", { tag, length: feeders.length, length2: targets.length }));
          continue;
        }
        const f = feeders[0];
        const w = winnerName(f);
        const q = targets[0].teams[0]?.name;
        if (w && q && norm(w) !== norm(q)) { conflicts.push(tr("{tag}: el ganador «{w}» no es el clasificado «{q}»", { tag, w: td(w), q: td(q) })); continue; }
        const key = `qualified:${slugOf(cont.group ?? "bracket")}:${slugOf(from.label)}`;
        edges.push({
          fromMatchId: f.matchId!, source: "WINNER", qualificationKey: key,
          qualificationLabel: to.label || "Qualified",
          evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED",
        });
        continue;
      }

      const targets = to.items.filter((it) => !it.empty && it.matchId);
      if (targets.length === 0) { unknown.push(tr("{tag}: sin destinos", { tag })); continue; }

      const candidate: VlrStructuralEdge[] = [];
      if (feeders.length === 2 * targets.length) {
        // Parejas consecutivas (down, up) → huecos 1 y 2 del destino en orden.
        let ok = true;
        for (let i = 0; i < targets.length; i++) {
          const a = feeders[2 * i], b = feeders[2 * i + 1];
          if (a.line !== "down" || b.line !== "up") { ok = false; break; }
          candidate.push({ fromMatchId: a.matchId!, source: "WINNER", toMatchId: targets[i].matchId!, toSlot: 1, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" });
          candidate.push({ fromMatchId: b.matchId!, source: "WINNER", toMatchId: targets[i].matchId!, toSlot: 2, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" });
        }
        if (!ok) { unknown.push(tr("{tag}: parejas sin el patrón (down, up)", { tag })); continue; }
      } else if (feeders.length === targets.length) {
        // Uno a uno, en orden. Sin hueco: la página no dice cuál.
        for (let i = 0; i < targets.length; i++) {
          candidate.push({ fromMatchId: feeders[i].matchId!, source: "WINNER", toMatchId: targets[i].matchId!, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" });
        }
      } else {
        unknown.push(tr("{tag}: {length} alimentadores para {length2} destinos", { tag, length: feeders.length, length2: targets.length }));
        continue;
      }

      // ── Verificación contra resultados ya publicados ──
      const byId = new Map(to.items.filter((it) => it.matchId).map((it) => [it.matchId!, it]));
      let contradiction: string | null = null;
      for (const e of candidate) {
        const f = feeders.find((x) => x.matchId === e.fromMatchId)!;
        const w = winnerName(f);
        if (!w) continue;
        const dest = byId.get(e.toMatchId!)!;
        const names = dest.teams.map((t) => norm(t.name)).filter(Boolean);
        if (names.length === 0) continue; // destino aún sin equipos: nada que contrastar
        if (!names.includes(norm(w))) { contradiction = tr("{tag}: el ganador «{w}» de {fromMatchId} no juega {toMatchId}", { tag, w: td(w), fromMatchId: e.fromMatchId, toMatchId: e.toMatchId }); break; }
        if (e.toSlot && dest.teams[e.toSlot - 1]?.name && norm(dest.teams[e.toSlot - 1].name) !== norm(w)) {
          contradiction = tr("{tag}: «{w}» no ocupa el hueco {toSlot} de {toMatchId}", { tag, w: td(w), toSlot: e.toSlot, toMatchId: e.toMatchId }); break;
        }
      }
      if (contradiction) { conflicts.push(contradiction); continue; }
      edges.push(...candidate);
    }
  }

  // Integridad básica: sin autoaristas, sin dos ganadores del mismo partido a dos sitios.
  const seenFrom = new Set<string>();
  const clean = edges.filter((e) => {
    if (e.toMatchId === e.fromMatchId) { conflicts.push(tr("autoarista en {fromMatchId}", { fromMatchId: e.fromMatchId })); return false; }
    if (seenFrom.has(e.fromMatchId)) { conflicts.push(tr("el ganador de {fromMatchId} tiene dos destinos", { fromMatchId: e.fromMatchId })); return false; }
    seenFrom.add(e.fromMatchId);
    return true;
  });

  return { containers, edges: clean, unknown, conflicts, present: containers.length > 0 };
}

/** Todo junto: HTML de la página del evento → estructura. Nunca lanza. */
export function parseBracketStructure(html: string): VlrBracketStructure {
  try {
    return deriveBracketStructure(parseEventBrackets(html));
  } catch (e) {
    return { containers: [], edges: [], unknown: [`PARSE_FAILED: ${e instanceof Error ? e.message : String(e)}`], conflicts: [], present: false };
  }
}
