/**
 * F84 · RANKED 2.0 — render de las piezas REALES con los fixtures del arnés `/design-system/f84` (sin servidor):
 * emblemas (forma + división + texto), héroe por estado, clasificación y «tu zona», leyenda, cambio de rango tras la
 * partida (colocación, rango obtenido, ascenso, descenso, misma división, tope de pareja), perfil, movimiento reducido y
 * los contratos de hidratación / cambio de cuenta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { rankedGate } from "@/domain/pvpLadder/ranked";
import { rankChip, deriveRank, rankLadder } from "@/domain/ranked/config";
import { CompetitiveEmblem, RankInline } from "./CompetitiveEmblem";
import { RankChange } from "./RankChange";
import { RankLegend } from "./RankLegend";
import { RankedCenter } from "./RankedCenter";
import { RankedLadder } from "./RankedLadder";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { DECK_OK } from "@/app/design-system/fase55/fixtures";
import { RANKED_PLAYER, PLACEMENT_PLAYER } from "@/app/design-system/fase56/fixtures";
import {
  HUB_UNRANKED, HUB_PLACEMENT_4, HUB_LOW, HUB_MID, HUB_HIGH, HUB_CUMBRE, HUB_STALE, HUB_EMPTY_LADDER, HUB_LONG_NAME, HUB_AROUND,
  RESULT_PLACEMENT_4, RESULT_REVEAL, RESULT_PROMOTION_DIV, RESULT_PROMOTION_TIER, RESULT_DEMOTION, RESULT_SAME, RESULT_PAIR_CAP,
} from "@/app/design-system/f84/fixtures";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const ready = rankedGate({ signedIn: true, decks: [DECK_OK], activeDeckId: DECK_OK.id });
const center = (s: typeof HUB_MID) => html(<RankedCenter snap={s} gate={ready} legalDecks={[DECK_OK]} />);

test("E1 · emblema: cada tier con su forma y nombre accesible; divisiones como barras + numeral; nunca solo color", () => {
  const seen = new Set<string>();
  for (const s of rankLadder("rank-v1")) {
    const chip = rankChip(deriveRank(s.floor));
    const h = html(<CompetitiveEmblem rank={chip} state="RANKED" animate={false} />);
    assert.ok(h.includes(`aria-label="Rango: ${chip.label}"`), chip.label);
    assert.ok(h.includes(`data-tier="${chip.tierId}"`));
    seen.add(chip.tierId);
    if (chip.division !== null) {
      const lit = (h.match(new RegExp(`fill="${chip.color}"`, "g")) ?? []).length;
      assert.ok(lit >= 4 - chip.division, `${chip.label}: ${4 - chip.division} barras encendidas`);
    }
  }
  assert.equal(seen.size, 7);
  const p = html(<CompetitiveEmblem rank={null} state="PLACEMENT" placement={{ played: 3, total: 5 }} animate={false} />);
  assert.ok(p.includes('aria-label="Colocación: 3 de 5 partidas"') && text(p).includes("3/5"));
  assert.ok(html(<CompetitiveEmblem rank={null} state="UNRANKED" animate={false} />).includes('aria-label="Sin clasificar"'));
  assert.match(text(html(<RankInline rank={rankChip(deriveRank(1100))} />)), /Veterano I/);
});

test("H1 · héroe por estado: sin clasificar (5 partidas), colocación 4/5, bajo, medio, alto, Cumbre con puesto del Top", () => {
  assert.match(text(center(HUB_UNRANKED)), /Sin clasificar.*Juega 5 partidas ranked/);
  const p = text(center(HUB_PLACEMENT_4)); assert.match(p, /Colocación/); assert.match(p, /4 \/ 5/);
  assert.match(text(center(HUB_LOW)), /Cantera\s*II/);
  const m = center(HUB_MID); assert.match(text(m), /Titular\s*II/); assert.match(text(m), /#212 de 500/); assert.match(text(m), /\+9 de rating para Titular I/);
  assert.match(text(center(HUB_HIGH)), /Estrella\s*I\b/);
  const c = text(center(HUB_CUMBRE)); assert.match(c, /Cumbre/); assert.match(c, /Top 500 · #3/); assert.match(c, /Estás en la Cumbre/);
  assert.ok(!/de rating para/.test(c), "la Cumbre no promete un techo");
});

test("H2 · clasificado pero fuera del Top: se dice qué falta (actividad), sin inventar puesto", () => {
  const t = text(center(HUB_STALE));
  assert.match(t, /Veterano I/); assert.match(t, /Para entrar en el Top 500: Juega una partida/);
  assert.ok(!/Top 500 · #/.test(t));
});

test("L1 · clasificación vacía honesta; nombre largo truncado; «tu zona» con los de alrededor; filas con rango y récord de temporada", () => {
  const e = text(center(HUB_EMPTY_LADDER));
  assert.match(e, /Todavía no hay nadie en el Top esta temporada.*colocación \(5 partidas\)/);
  const long = center(HUB_LONG_NAME);
  assert.ok(long.includes("QA_Nombre_De_Jugador_Larguisimo_Extremo") && long.includes("truncate"));
  const a = html(<RankedLadder top={HUB_AROUND.leaderboardTop} aroundMe={HUB_AROUND.aroundMe} rankedTotal={500} selfPosition={124} topSize={500} loadPage={async () => null} />);
  assert.match(text(a), /Tu zona/); assert.match(text(a), /Tú: #124/);
  assert.equal((a.match(/aria-current="true"/g) ?? []).length >= 1, true);
  assert.match(text(a), /Clasificación · Top 500/);
  assert.ok(a.includes('data-testid="rank-inline"'));
  assert.ok(!/@|email/i.test(text(a)));
});

test("G1 · leyenda: 7 tiers con fronteras reales de rank-v1 y el escalón actual marcado", () => {
  const h = html(<RankLegend version="rank-v1" current={deriveRank(1001).step} open />);
  const t = text(h);
  for (const s of ["Cantera", "Promesa", "Titular", "Veterano", "Capitán", "Estrella", "Cumbre", "< 860", "950–1039", "≥ 1310"]) assert.ok(t.includes(s), s);
  assert.ok(h.includes('data-tier="titular" aria-current="true"'));
  assert.match(t, /divisiones van de III a I/);
});

test("R1 · resultado: colocación 4/5 sin rango; RANGO OBTENIDO al cerrar la colocación", () => {
  const p = html(<RankChange movement={RESULT_PLACEMENT_4} matchId={null} />);
  assert.ok(p.includes('data-kind="PLACEMENT_PROGRESS"')); assert.match(text(p), /4 \/ 5/); assert.match(text(p), /Una partida más y se revela tu rango/);
  const r = html(<RankChange movement={RESULT_REVEAL} matchId={null} />);
  assert.ok(r.includes('data-kind="PLACEMENT_COMPLETE"')); assert.match(text(r), /Rango obtenido/); assert.match(text(r), /Veterano II/); assert.match(text(r), /Rating 1079/);
});

test("R2 · ascenso (división y tier), descenso sobrio y misma división con su barra; tope de pareja explicado", () => {
  const d = text(html(<RankChange movement={RESULT_PROMOTION_DIV} matchId={null} positions={4} position={208} />));
  assert.match(d, /Ascenso/); assert.match(d, /Titular I/); assert.match(d, /desde Titular II/); assert.match(d, /Subes 4 puestos en el Top \(#208\)/);
  const t = html(<RankChange movement={RESULT_PROMOTION_TIER} matchId={null} />);
  assert.ok(t.includes('data-tier-change="true"')); assert.match(text(t), /Estrella III/);
  const down = html(<RankChange movement={RESULT_DEMOTION} matchId={null} />);
  assert.match(text(down), /Descenso/); assert.match(text(down), /Promesa I/); assert.match(text(down), /Te faltan 11 para volver a Titular III/);
  assert.ok(!down.includes("rounded-full border-2"), "el descenso no tiene destellos ni fiesta");
  const same = html(<RankChange movement={RESULT_SAME} matchId={null} />);
  assert.match(text(same), /Titular II/); assert.match(text(same), /\+8/); assert.ok(same.includes('aria-label="Progreso en la división'));
  assert.match(text(html(<RankChange movement={RESULT_PAIR_CAP} matchId={null} />)), /Partida contada sin cambio de rating/);
});

test("R3 · movimiento reducido / sin ceremonia pendiente: la MISMA información, en su estado final (sin fotogramas intermedios)", () => {
  // En servidor/tests no hay `window`: la ceremonia no se anima y se pinta el estado final (igual que con movimiento reducido).
  const h = html(<RankChange movement={RESULT_PROMOTION_TIER} matchId="qa-reduced" />);
  assert.ok(h.includes('data-animated="false"'));
  assert.match(text(h), /Estrella III/); assert.match(text(h), /1229/);
  const src = read("src", "components", "competitive", "ranked", "RankChange.tsx");
  assert.ok(src.includes("useReducedMotion()") && src.includes("!reduced"), "respeta prefers-reduced-motion");
  assert.ok(src.includes("drl:rank-ceremony:"), "la ceremonia se consume una vez por partida y navegador (multi-pestaña)");
  assert.ok(!/fetch\(|method:\s*"POST"/.test(src), "la ceremonia no escribe nada en el servidor");
});

test("P1 · perfil (identidad): emblema + rango + división + rating; Top y mejor rango viven en Competitivo; en colocación, X/5 sin rango", () => {
  const rh = html(<PlayerIdentityView snap={RANKED_PLAYER} />);
  const r = text(rh);
  assert.match(r, /Cumbre/); assert.ok(rh.includes('data-testid="profile-rank"') && rh.includes('data-field="rating"'));
  assert.ok(!/Mejor rango · temporada/.test(r) && !/#3\b/.test(r), "el perfil no repite el centro competitivo");
  const p = html(<PlayerIdentityView snap={PLACEMENT_PLAYER} />);
  assert.ok(p.includes('data-rank-state="PLACEMENT"')); assert.match(text(p), /Colocación 3\/5/);
});

test("A1 · hidratación y cambio de cuenta: la foto competitiva va atada a la cuenta que la pidió (nunca el rango de A en B)", () => {
  const page = read("src", "app", "competitivo", "page.tsx");
  assert.ok(page.includes("owned && owned.owner === uid ? owned.snap : null"));
  assert.ok(page.includes("if (s && uidRef.current === owner) setOwned({ owner, snap: s })"), "una respuesta tardía de otra cuenta se descarta");
  assert.ok(page.indexOf("if (loading) return <Loading") < page.indexOf("<RankedCenter"), "durante la hidratación: neutro, nunca un rango falso");
  const duelos = read("src", "app", "duelos", "page.tsx");
  assert.ok(duelos.includes("useEffect(() => { rankedAsked.current = false; setRanked(null); setGate(null); }, [uid]);"));
  assert.ok(duelos.includes("if (uidRef.current !== owner) return;"));
});

test("A2 · accesibilidad: títulos semánticos, barras con progressbar, CTA único, leyenda plegable con summary", () => {
  const h = center(HUB_MID);
  assert.ok(h.includes("<h1") && h.includes('role="progressbar"') && h.includes("aria-valuenow=\"1001\""));
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
  assert.ok(h.includes("<summary"));
});
