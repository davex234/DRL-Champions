"use client";

/**
 * ARNÉS QA · FASE 61 — `/design-system/fase61?scene=<escena>` · GAMEPLAY 5.0 · THE MATCH (solo revisión y capturas).
 *
 * Monta la partida COMPLETA con las piezas reales —entrada (rival → VS → equipo), tablero, revelación del turno,
 * desempate en escena, golpe final, resultado, diálogo de salida y final PvP— sobre partidas del MOTOR PURO
 * (`lib/duel/qaSimulation`: dos bots sobre mazos de cartas REALES del catálogo). Nada se envía ni se escribe.
 *
 * Coherencia: cada revelación se monta sobre el tablero del MISMO turno (`qaSimulate(…, n)` → `lastTurn` = turno n).
 * Los desempates salen de semillas reales cuando existen; si una semilla no da el caso se marca «fabricado».
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { MatchComplete } from "@/components/duel/MatchComplete";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { MatchTopBar } from "@/components/duel/arena/MatchTopBar";
import { ArenaEnvironment } from "@/components/duel/arena/ArenaEnvironment";
import { FullscreenToggle } from "@/components/duel/FullscreenToggle";
import { SoundToggle } from "@/components/duel/SoundToggle";
import { TiebreakReveal } from "@/components/duel/experience/TiebreakReveal";
import { LeaveMatchDialog } from "@/components/duel/experience/LeaveMatchDialog";
import { NxButton } from "@/components/ui/NxButton";
import { qaSimulate, qaSnapshot, qaView } from "@/lib/duel/qaSimulation";
import { leaveConsequence, type EntranceBeat } from "@/lib/duel/matchFlow";
import { DIFFICULTY_INFO, type DuelMatchView, type DuelResultView } from "@/lib/duel/types";
import type { DuelMatch } from "@/domain/cardgame/match";

const noop = () => {};

const SCENES: { id: string; note: string }[] = [
  { id: "found", note: "1 · entrada · rival preparado (bot)" },
  { id: "found-ranked", note: "1b · entrada · rival encontrado (ranked, persona)" },
  { id: "vs", note: "2 · entrada · VS" },
  { id: "lineup", note: "3 · entrada · tu equipo salta a la mesa (cartas reales)" },
  { id: "field-attack", note: "4 · campo · atacas (turno 1)" },
  { id: "field-defense", note: "4b · campo · defiendes (el rival ya declaró)" },
  { id: "stat-reveal", note: "5 · revelación · el eje antes que las cifras (capturar ~0,55 s)" },
  { id: "turn-win", note: "6 · turno ganado" },
  { id: "turn-lose", note: "7 · turno perdido" },
  { id: "turn-draw", note: "7b · turno empatado (sin punto)" },
  { id: "late", note: "8 · recta final (turno 8)" },
  { id: "final-turn", note: "8b · último turno (10)" },
  { id: "tiebreak-ovr", note: "9 · desempate por suma de OVR (+1)" },
  { id: "tiebreak-stat", note: "9b · desempate por total de estadísticas (sin punto)" },
  { id: "tiebreak-none", note: "9c · empate total" },
  { id: "victory", note: "10 · golpe final · victoria" },
  { id: "defeat", note: "11 · golpe final · derrota" },
  { id: "draw", note: "11b · golpe final · empate" },
  { id: "result-win", note: "resultado · victoria con recompensas" },
  { id: "result-loss", note: "resultado · derrota" },
  { id: "result-draw", note: "resultado · empate" },
  { id: "leave", note: "salir · diálogo con la consecuencia real (PvE)" },
  { id: "leave-ranked", note: "salir · diálogo (ranked)" },
];

export default function Fase61QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const fx = useMemo(() => fixtures(), []);
  /* El splash de la PWA (`SplashScreen`, ~1,3 s + fundido) taparía los primeros tiempos: la escena se monta después. */
  const [go, setGo] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setGo(true), 1900); return () => window.clearTimeout(id); }, []);
  if (scene === null || (scene && !go)) return null;
  const s = SCENES.find((x) => x.id === scene);
  if (!s) {
    return (
      <ul className="space-y-1 p-6 text-[13px] text-white/70" data-testid="fase61-index">
        {SCENES.map((x) => <li key={x.id}><a className="underline" href={`?scene=${x.id}`}>{x.id}</a> — {x.note}</li>)}
        <li className="pt-3 text-white/40">fabricados: {JSON.stringify(fx.fabricated)}</li>
      </ul>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#04050b]" data-scene={s.id} data-synthetic="true">
        <Scene id={s.id} fx={fx} />
      </div>
    </MotionConfig>
  );
}

/* ───────────── fixtures (motor puro, deterministas) ───────────── */

interface Fx {
  start: DuelMatchView; defense: DuelMatchView; late: DuelMatchView; final: DuelMatchView;
  winAt: DuelMatchView; loseAt: DuelMatchView; drawAt: DuelMatchView | null;
  win: DuelMatchView; loss: DuelMatchView; draw: DuelMatchView;
  ovr: DuelMatchView; stat: DuelMatchView; none: DuelMatchView;
  fabricated: Record<string, boolean>;
}

function fixtures(): Fx {
  const mine = qaSnapshot(0, "qa-you", "Mi equipo");
  const rival = qaSnapshot(1, "qa-rival", "Rival");
  const mirror = qaSnapshot(0, "qa-mirror", "Espejo");

  const find = (pred: (m: DuelMatch) => boolean, pool: DuelMatch[]) => pool.find(pred) ?? null;
  const full: DuelMatch[] = [];
  for (let seed = 1; seed <= 300; seed++) full.push(qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed));
  const mirrors: DuelMatch[] = [];
  for (let seed = 1; seed <= 300; seed++) mirrors.push(qaSimulate(mine, mirror, 10, seed % 2 ? "A" : "B", seed));

  const win = find((m) => m.result?.winner === "A" && m.result.combat.decidedBy === "SCORE", full)!;
  const loss = find((m) => m.result?.winner === "B" && m.result.combat.decidedBy === "SCORE", full)!;
  const ovrM = find((m) => m.result?.combat.decidedBy === "OVR_TIEBREAK", [...full, ...mirrors]);
  const statM = find((m) => m.result?.combat.decidedBy === "STAT_MARGIN", [...mirrors, ...full]);
  const noneM = find((m) => Boolean(m.result?.isDraw), [...mirrors, ...full]);

  /* Revelaciones coherentes: el tablero del turno n con su propio `lastTurn`. */
  const turnView = (want: "A" | "B" | "TIE"): DuelMatchView | null => {
    for (let seed = 1; seed <= 120; seed++) {
      for (let n = 2; n <= 6; n++) {
        const v = qaView(qaSimulate(mine, rival, n, seed % 2 ? "A" : "B", seed));
        if (v.lastTurn?.outcome === want) return v;
      }
    }
    return null;
  };

  const winV = qaView(win);
  const fabricate = (r: Partial<DuelResultView>) => ({ ...winV, result: { ...winV.result!, ...r } });
  return {
    start: qaView(qaSimulate(mine, rival, 0, "A")),
    defense: qaView(qaSimulate(mine, rival, 0, "B")),
    late: qaView(qaSimulate(mine, rival, 7, "A", 7)),
    final: qaView(qaSimulate(mine, rival, 9, "A", 7)),
    winAt: turnView("A")!, loseAt: turnView("B")!, drawAt: turnView("TIE"),
    win: winV, loss: qaView(loss),
    draw: noneM ? qaView(noneM) : fabricate({ decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, reason: "QA · empate fabricado" }),
    ovr: ovrM ? qaView(ovrM) : fabricate({ decidedBy: "OVR_TIEBREAK", winner: "YOU", scoreYou: 6, scoreRival: 5, reason: "QA · desempate fabricado" }),
    stat: statM ? qaView(statM) : fabricate({ decidedBy: "STAT_MARGIN", winner: "YOU", isDraw: false, scoreYou: 5, scoreRival: 5, reason: "QA · desempate fabricado" }),
    none: noneM ? qaView(noneM) : fabricate({ decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, reason: "QA · empate fabricado" }),
    fabricated: { ovr: !ovrM, stat: !statM, draw: !noneM },
  };
}

/* ───────────── composición (la misma de /duelos/jugar) ───────────── */

function Frame({ view, children, bar = true }: { view: DuelMatchView; children: React.ReactNode; bar?: boolean }) {
  const rivalName = view.rivalLabel ?? DIFFICULTY_INFO[view.difficulty].label;
  return (
    <div className="flex min-h-screen flex-col">
      {bar && (
        <MatchTopBar
          view={view}
          mode="quick"
          rivalName={rivalName}
          difficultyLabel={DIFFICULTY_INFO[view.difficulty].label}
          controls={
            <>
              <button type="button" aria-label="Cómo se juega" className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-black/40 font-display text-[15px] font-bold text-white/75">?</button>
              <SoundToggle className="hidden sm:grid" />
              <FullscreenToggle />
              <NxButton variant="ghost" size="md" className="shrink-0" onClick={noop}>Salir</NxButton>
            </>
          }
        />
      )}
      <div className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-[clamp(4px,1vh,16px)] sm:px-6">{children}</div>
    </div>
  );
}

function Board({ view, busy = false }: { view: DuelMatchView; busy?: boolean }) {
  return (
    <Frame view={view}>
      <MatchBoard view={view} onPlay={noop} busy={busy} error={null} onDismissError={noop} arena="quick" hudInTopBar />
    </Frame>
  );
}

function Moment({ view }: { view: DuelMatchView | null }) {
  const turn = view?.lastTurn ?? null;
  if (!view || !turn) return <p className="p-6 text-white/60">Esta semilla no trae ese turno.</p>;
  const all = [...view.yourHand, ...view.yourUsed, ...view.rivalUsed];
  const you = all.find((c) => c.uid === turn.you.uid);
  const rival = all.find((c) => c.uid === turn.rival.uid);
  if (!you || !rival) return null;
  return (
    <>
      <Board view={view} busy />
      <DuelMoment turn={turn} yourCard={you} rivalCard={rival} totalTurns={view.totalTurns} onClose={noop} autoCloseMs={600_000} />
    </>
  );
}

function Result({ view }: { view: DuelMatchView }) {
  return (
    <Frame view={view} bar={false}>
      <ArenaEnvironment variant="quick" />
      <ResultScreen view={view} xp={4_200} onPlayAgain={noop} onDecks={noop} onReplay={noop} onChange={noop} mode="PVE" deckId="qa-listo" />
    </Frame>
  );
}

function Intro({ view, from, ranked = false }: { view: DuelMatchView; from: EntranceBeat; ranked?: boolean }) {
  return (
    <>
      <Board view={view} busy />
      <MatchIntro view={view} rivalName={ranked ? "RivalReal" : DIFFICULTY_INFO[view.difficulty].label} mode={ranked ? "ranked" : "quick"} from={from} rivalAvatar={ranked ? "🦊" : null} onDone={noop} />
    </>
  );
}

function Scene({ id, fx }: { id: string; fx: Fx }) {
  switch (id) {
    case "found": return <Intro view={fx.start} from="FOUND" />;
    case "found-ranked": return <Intro view={fx.start} from="FOUND" ranked />;
    case "vs": return <Intro view={fx.start} from="VERSUS" />;
    case "lineup": return <Intro view={fx.start} from="LINEUP" />;
    case "field-attack": return <Board view={fx.start} />;
    case "field-defense": return <Board view={fx.defense} />;
    case "stat-reveal": return <Moment view={fx.winAt} />;
    case "turn-win": return <Moment view={fx.winAt} />;
    case "turn-lose": return <Moment view={fx.loseAt} />;
    case "turn-draw": return <Moment view={fx.drawAt} />;
    case "late": return <Board view={fx.late} />;
    case "final-turn": return <Board view={fx.final} />;
    case "tiebreak-ovr": return <><Result view={fx.ovr} /><TiebreakReveal result={fx.ovr.result!} onDone={noop} /></>;
    case "tiebreak-stat": return <><Result view={fx.stat} /><TiebreakReveal result={fx.stat.result!} onDone={noop} /></>;
    case "tiebreak-none": return <><Result view={fx.none} /><TiebreakReveal result={fx.none.result!} onDone={noop} /></>;
    case "victory": return <><Result view={fx.win} /><MatchComplete result={fx.win.result!} onDone={noop} /></>;
    case "defeat": return <><Result view={fx.loss} /><MatchComplete result={fx.loss.result!} onDone={noop} /></>;
    case "draw": return <><Result view={fx.draw} /><MatchComplete result={fx.draw.result!} onDone={noop} /></>;
    case "result-win": return <Result view={fx.win} />;
    case "result-loss": return <Result view={fx.loss} />;
    case "result-draw": return <Result view={fx.draw} />;
    case "leave": return <><Board view={fx.late} /><LeaveMatchDialog open consequence={leaveConsequence("quick")} onStay={noop} onKeep={noop} onAbandon={noop} /></>;
    case "leave-ranked": return <><Board view={fx.late} /><LeaveMatchDialog open consequence={leaveConsequence("ranked")} onStay={noop} onKeep={noop} onAbandon={noop} /></>;
    default: return null;
  }
}
