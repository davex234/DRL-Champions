/**
 * F86 · FIXTURES QA SYNTHETIC de torneos (arnés `/design-system/cups` y pruebas de render). Los cuadros salen del
 * DOMINIO REAL (`planBracket` + `applyOutcome`) proyectados con la misma forma que devuelve el servidor (`CupDetail`),
 * así que cada escena es un estado alcanzable. Nombres y tags inventados; ningún id de usuario.
 */
import { applyOutcome, planBracket, playable, roundName, type BracketState } from "@/domain/cups/bracket";
import { displayState, roundWindow } from "@/domain/cups/lifecycle";
import type { CupCard, CupDetail, CupHub, CupMatchView, CupPlayer, CupRoundView, CupMe } from "@/server/services/cups";

export const QA_NOW = Date.UTC(2026, 9, 12, 19, 30);
const iso = (ms: number) => new Date(ms).toISOString();
const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const tagOf = (i: number) => Array.from({ length: 7 }, (_, k) => ALPHA[(i * 7 + k * 13 + 3) % ALPHA.length]).join("");
const NAMES = ["Nova", "Kairo", "Sable", "Vex", "Lumen", "Riptide", "Onyx", "Halcyon", "Ember", "Zephyr", "Quill", "Brisa", "Tundra", "Kestrel", "Mirage", "Pulsar"];
const AVATARS = ["🦊", "🐺", "🦅", "🐉", "🦂", "🐍", "🦁", "🐻", "🦈", "🐲", "🦉", "🐯", "🐼", "🦄", "🐙", "🦇"];
export const playerKey = (i: number) => `p${i}`;
const ME = playerKey(3);
const nameOf = (i: number) => `${NAMES[(i - 1) % NAMES.length]}${i > NAMES.length ? `_${i}` : ""}`;
export const LONG_NAME = "ElNombreDeJugadorMásLargoPermitido_99";

function player(key: string, seed: number | null, me: string | null = ME): CupPlayer {
  const i = Number(key.slice(1));
  return { seed, username: i === 7 ? LONG_NAME : nameOf(i), avatar: AVATARS[(i - 1) % AVATARS.length], tag: tagOf(i), you: key === me };
}

/** Juega el cuadro hasta `upToRound` (gana el mejor seed salvo `upsets`); el resto queda como esté. */
function advance(st: BracketState, upToRound: number, upsets: Set<string> = new Set()): BracketState {
  let s = st;
  for (let guard = 0; guard < 200; guard++) {
    const m = playable(s).filter((x) => x.round <= upToRound)[0];
    if (!m) break;
    const a = m.a.kind === "PLAYER" ? m.a : null, b = m.b.kind === "PLAYER" ? m.b : null;
    const fav = (a!.seed ?? 99) < (b!.seed ?? 99) ? a! : b!;
    const dog = fav === a ? b! : a!;
    const r = applyOutcome(s, m.round, m.slot, { winnerId: upsets.has(`${m.round}:${m.slot}`) ? dog.userId : fav.userId }, "PLAYED");
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

/** Proyección con la forma del servidor (`CupRoundView[]`). `overrides` fuerza estados (en juego, retenido, plazo). */
function project(st: BracketState, startsAt: number, windowMin: number, now: number, me: string | null = ME, overrides: Record<string, Partial<CupMatchView>> = {}): CupRoundView[] {
  const out: CupRoundView[] = [];
  for (let r = 1; r <= st.rounds; r++) {
    const w = roundWindow(startsAt, windowMin, r);
    out.push({
      round: r, name: roundName(r, st.rounds), availableAt: iso(w.availableAt), deadlineAt: iso(w.deadlineAt),
      matches: st.matches.filter((m) => m.round === r).map((m) => {
        const a = m.a.kind === "PLAYER" ? player(m.a.userId, m.a.seed, me) : null;
        const b = m.b.kind === "PLAYER" ? player(m.b.userId, m.b.seed, me) : null;
        const played = m.status === "COMPLETED";
        const base: CupMatchView = {
          round: r, slot: m.slot, a, b, aEmpty: m.a.kind === "EMPTY", bEmpty: m.b.kind === "EMPTY",
          state: displayState(m.status, w.availableAt, w.deadlineAt, now),
          winner: m.winnerId === null ? null : m.a.kind === "PLAYER" && m.a.userId === m.winnerId ? "A" : "B",
          resolution: m.resolution, score: played ? { a: m.a.kind === "PLAYER" && m.a.userId === m.winnerId ? 6 : 4, b: m.a.kind === "PLAYER" && m.a.userId === m.winnerId ? 4 : 6 } : null,
          you: !!(a?.you || b?.you),
        };
        return { ...base, ...(overrides[`${r}:${m.slot}`] ?? {}) };
      }),
    });
  }
  return out;
}

const keys = (n: number) => Array.from({ length: n }, (_, i) => playerKey(i + 1));

function card(o: Partial<CupCard> & { slug: string; name: string }): CupCard {
  return {
    phase: "REGISTRATION_OPEN", format: "SINGLE_ELIMINATION", participants: 23, max: 64, min: 4,
    registrationOpenAt: iso(QA_NOW - 86_400_000), registrationCloseAt: iso(QA_NOW + 2 * 86_400_000 + 3_600_000 * 5), startsAt: iso(QA_NOW + 3 * 86_400_000),
    completedAt: null, cancelledAt: null, champion: null, mine: null, placement: null, ...o,
  };
}

const RULES = "Eliminación directa a partida única con tu equipo de diez cartas.\nCada ronda tiene su plazo: si nadie juega a tiempo, la organización resuelve el cruce.";
function detail(o: Partial<CupDetail> & { card: CupCard }): CupDetail {
  return {
    description: "El primer torneo abierto de Valorosters: 64 plazas, una partida por cruce y un trofeo único para quien gane la final.",
    rules: RULES, rulesVersion: 1, roundWindowMinutes: 1440, cancelled: null, schedule: [], bracket: null, bracketSize: null, rounds: null,
    participants: keys(o.card.participants).map((k) => player(k, null)), participantsTotal: o.card.participants,
    me: null, serverNow: QA_NOW, unlisted: false, ...o,
  };
}
const meOf = (o: Partial<CupMe>): CupMe => ({ status: null, withdrawn: false, seed: null, placement: null, placementLabel: null, eliminatedRound: null, match: null, canRegister: false, canWithdraw: false, ...o });

/* ───────────── escenas ───────────── */

const OPEN = card({ slug: "valorosters-open-1", name: "Valorosters Open #1" });
export const DETAIL_OPEN = detail({ card: OPEN, me: meOf({ canRegister: true }) });
export const DETAIL_REGISTERED = detail({ card: { ...OPEN, participants: 24, mine: "REGISTERED" }, me: meOf({ status: "REGISTERED", canWithdraw: true }) });
export const DETAIL_FULL = detail({ card: { ...OPEN, participants: 64 }, me: meOf({}) });
export const DETAIL_SCHEDULED = detail({ card: { ...OPEN, phase: "SCHEDULED", participants: 0, registrationOpenAt: iso(QA_NOW + 3_600_000 * 20) }, participants: [], me: meOf({}) });

// Copa semanal: rondas de 90 min. Cuartos ya jugados (−2 h → −30 min); semifinal ABIERTA ahora (−30 min → +60 min).
const START8 = QA_NOW - 3_600_000 * 2;
const W8 = 90;
const B8 = planBracket(keys(8));
const B8_R1 = advance(B8, 1);
const r8 = project(B8_R1, START8, W8, QA_NOW);
const myM8 = r8[1].matches.find((m) => m.you)!;
export const DETAIL_LIVE_8 = detail({
  card: { ...OPEN, slug: "copa-semanal-41", name: "Copa Semanal #41", phase: "IN_PROGRESS", participants: 8, max: 8, mine: "ALIVE", startsAt: iso(START8), registrationOpenAt: iso(START8 - 3 * 86_400_000), registrationCloseAt: iso(START8 - 3_600_000) },
  roundWindowMinutes: W8, bracket: r8, bracketSize: 8, rounds: 3, schedule: r8.map((r) => ({ round: r.round, name: r.name, availableAt: r.availableAt, deadlineAt: r.deadlineAt })),
  participants: keys(8).map((k, i) => player(k, i + 1)), participantsTotal: 8,
  me: meOf({ status: "ALIVE", seed: 3, match: {
    round: 2, slot: myM8.slot, roundName: "Semifinal", state: "READY", opponent: { ...(myM8.a?.you ? myM8.b! : myM8.a!), userId: "00000000-0000-4000-8000-0000000000aa" },
    availableAt: r8[1].availableAt, deadlineAt: r8[1].deadlineAt, youReady: false, opponentReady: true, gameMatchId: null, waitingFor: null, advancedFrom: "Cuartos de final", rivalSource: null,
  } }),
});
export const DETAIL_ACTIVE_8 = { ...DETAIL_LIVE_8, me: meOf({ ...DETAIL_LIVE_8.me!, match: { ...DETAIL_LIVE_8.me!.match!, state: "ACTIVE", gameMatchId: "00000000-0000-4000-8000-00000000game" } }),
  bracket: project(B8_R1, START8, W8, QA_NOW, ME, { [`2:${myM8.slot}`]: { state: "ACTIVE" } }) } as CupDetail;

const START64 = QA_NOW - 86_400_000 - 3_600_000;
const B64 = advance(planBracket(keys(64)), 1, new Set(["1:5", "1:20"]));
const r64 = project(B64, START64, 1440, QA_NOW, ME, { "2:0": { state: "ACTIVE" }, "2:3": { state: "ACTION_REQUIRED" } });
const myR2 = r64[1].matches.find((m) => m.you)!;
export const DETAIL_LIVE_64 = detail({
  card: { ...OPEN, phase: "IN_PROGRESS", participants: 64, mine: "ALIVE", startsAt: iso(START64) },
  bracket: r64, bracketSize: 64, rounds: 6, schedule: r64.map((r) => ({ round: r.round, name: r.name, availableAt: r.availableAt, deadlineAt: r.deadlineAt })),
  participants: keys(64).map((k, i) => player(k, i + 1)), participantsTotal: 64,
  me: meOf({ status: "ALIVE", seed: 3, match: {
    round: 2, slot: myR2.slot, roundName: "Ronda de 32", state: "READY", opponent: { ...(myR2.a?.you ? myR2.b! : myR2.a!), userId: "00000000-0000-4000-8000-0000000000bb" },
    availableAt: r64[1].availableAt, deadlineAt: iso(QA_NOW + 3_600_000 * 22), youReady: true, opponentReady: false, gameMatchId: null, waitingFor: null, advancedFrom: "Ronda de 64", rivalSource: null,
  } }),
});

const B8_DONE = advance(B8, 3, new Set(["2:0"]));
const champKey = B8_DONE.championId!;
const START8D = START8 - 7 * 86_400_000;
const r8d = project(B8_DONE, START8D, W8, QA_NOW, champKey);
export const DETAIL_CHAMPION = detail({
  card: { ...OPEN, slug: "copa-semanal-40", name: "Copa Semanal #40", phase: "COMPLETED", participants: 8, max: 8, mine: "CHAMPION", placement: "CHAMPION", completedAt: iso(START8D + 3 * W8 * 60_000 - 600_000), champion: player(champKey, 3, champKey),
    startsAt: iso(START8D), registrationOpenAt: iso(START8D - 3 * 86_400_000), registrationCloseAt: iso(START8D - 3_600_000) },
  roundWindowMinutes: W8, bracket: r8d, bracketSize: 8, rounds: 3, schedule: r8d.map((r) => ({ round: r.round, name: r.name, availableAt: r.availableAt, deadlineAt: r.deadlineAt })),
  participants: keys(8).map((k, i) => player(k, i + 1, champKey)), participantsTotal: 8,
  me: meOf({ status: "CHAMPION", placement: "CHAMPION", placementLabel: "Campeón" }),
});
export const DETAIL_COMPLETED_PUBLIC = { ...DETAIL_CHAMPION, card: { ...DETAIL_CHAMPION.card, mine: null, placement: null, champion: { ...DETAIL_CHAMPION.card.champion!, you: false } },
  bracket: project(B8_DONE, START8D, W8, QA_NOW, null), participants: keys(8).map((k, i) => player(k, i + 1, null)), me: null } as CupDetail;
export const DETAIL_CANCELLED = detail({ card: { ...OPEN, phase: "CANCELLED", participants: 3, cancelledAt: iso(QA_NOW - 3_600_000) }, cancelled: { reason: "No se alcanzó el mínimo de 4 inscritos." }, me: meOf({}) });
export const DETAIL_ELIMINATED = { ...DETAIL_LIVE_8, card: { ...DETAIL_LIVE_8.card, mine: "ELIMINATED" as const, placement: "QUARTERFINAL" as const }, me: meOf({ status: "ELIMINATED", placement: "QUARTERFINAL", placementLabel: "Cuartos de final", eliminatedRound: 1 }) } as CupDetail;

export const HUB: CupHub = {
  serverNow: QA_NOW,
  open: [OPEN, card({ slug: "copa-novatos", name: "Copa Novatos", participants: 9, max: 16 })],
  upcoming: [card({ slug: "copa-semanal-42", name: "Copa Semanal #42", phase: "SCHEDULED", participants: 0, max: 32, registrationOpenAt: iso(QA_NOW + 86_400_000) })],
  live: [DETAIL_LIVE_8.card],
  finished: [DETAIL_COMPLETED_PUBLIC.card, card({ slug: "copa-semanal-39", name: "Copa Semanal #39", phase: "CANCELLED", participants: 3, max: 16 })],
  finishedOffset: 0, finishedHasMore: true,
  mine: [{ ...DETAIL_LIVE_8.card }, { ...OPEN, mine: "REGISTERED" }],
  ready: { slug: "copa-semanal-41", name: "Copa Semanal #41", round: 2, slot: myM8.slot, roundName: "Semifinal", opponent: DETAIL_LIVE_8.me!.match!.opponent, state: "READY", deadlineAt: r8[1].deadlineAt },
  history: { participations: 5, titles: 1, best: "CHAMPION", bestLabel: "Campeón", entries: [{ slug: "copa-semanal-40", name: "Copa Semanal #40", placement: "CHAMPION", label: "Campeón", completedAt: DETAIL_CHAMPION.card.completedAt }, { slug: "copa-semanal-38", name: "Copa Semanal #38", placement: "SEMIFINAL", label: "Semifinal", completedAt: iso(QA_NOW - 8 * 86_400_000) }] },
};
export const HUB_EMPTY: CupHub = { serverNow: QA_NOW, open: [], upcoming: [], live: [], finished: [], finishedOffset: 0, finishedHasMore: false, mine: [], ready: null, history: { participations: 0, titles: 0, best: null, bestLabel: null, entries: [] } };

/* ───────────── F86.1 · estados de la espera y del avance ───────────── */

const withMatch = (base: CupDetail, patch: Partial<NonNullable<CupMe["match"]>>, mePatch: Partial<CupMe> = {}): CupDetail =>
  ({ ...base, me: meOf({ ...base.me!, ...mePatch, match: { ...base.me!.match!, ...patch } }) });
/** Mi semifinal jugable, nadie listo todavía. */
export const DETAIL_BEFORE_READY = withMatch(DETAIL_LIVE_8, { opponentReady: false, youReady: false });
/** Pulsé JUGAR: el servidor me tiene listo; espero al rival (sobrevive a F5: lo dice el servidor). */
export const DETAIL_WAITING = withMatch(DETAIL_LIVE_8, { opponentReady: false, youReady: true });
/** Plazo de la ronda vencido sin partida: en revisión. */
export const DETAIL_DEADLINE = withMatch(DETAIL_LIVE_8, { state: "NO_SHOW_PENDING", youReady: false, opponentReady: false });
/** Empate exacto: retenido para la organización. */
export const DETAIL_REVIEW = withMatch(DETAIL_LIVE_8, { state: "ACTION_REQUIRED", youReady: false, opponentReady: false, gameMatchId: "00000000-0000-4000-8000-00000000game" });
/** Gané mi cruce y espero rival: el cruce del que sale se está jugando AHORA. */
export const DETAIL_ADVANCED = withMatch(DETAIL_LIVE_8, { state: "PENDING", opponent: null, youReady: false, opponentReady: false, waitingFor: "Ganador del cruce 2 de Semifinal", rivalSource: "ACTIVE", advancedFrom: "Semifinal", roundName: "Final", round: 3, slot: 0 });
/** Siguiente cruce ya jugable (rival definido). */
export const DETAIL_NEXT_PLAYABLE = withMatch(DETAIL_LIVE_8, { opponentReady: false, youReady: false, advancedFrom: "Cuartos de final" });
/** Aviso global del armazón (fuera de la ficha). */
export const NOTICE_READY = { key: "copa-semanal-41:2:1:READY:true", title: "Tu rival te espera", text: "Copa Semanal #41 · Semifinal: Kairo #KZEU9P4 ya está listo", cta: "Jugar", href: "/copas/copa-semanal-41" };
