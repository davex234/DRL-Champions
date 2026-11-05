"use client";

/**
 * ARNÉS QA · FASE 50 — `/design-system/fase50?scene=<escena>` · NEXUS ARENA (solo revisión y capturas).
 *
 * Monta la arena COMPLETA tal y como la compone `/duelos/jugar` —barra de la partida, recinto, tablero,
 * revelación del turno, golpe final y resultado— a pantalla completa, sobre partidas del MOTOR PURO
 * (las mismas fixtures deterministas de la Fase 45). Nada se envía ni se escribe; los veredictos, los
 * ejes y las cifras llegan ya resueltos en la vista.
 *
 * Tapa el armazón del producto a propósito (`fixed inset-0`): la ruta real es INMERSIVA y así se ve.
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
import { NxButton } from "@/components/ui/NxButton";
import { DIFFICULTY_INFO, type DuelMatchView, type DuelTurnView } from "@/lib/duel/types";
import { fase45Fixtures } from "../fase45/fixtures";

const noop = () => {};

interface Scene { id: string; note: string; reduced?: boolean }

/** Las escenas del encargo (§44) y alguna más para la revisión de estados. */
const SCENES: Scene[] = [
  { id: "start", note: "1 · inicio de partida (turno 1, atacas)" },
  { id: "rival-played", note: "2 · el rival ha jugado (defiendes)" },
  { id: "selecting", note: "3 · seleccionando carta (el script pulsa una carta de la mano)" },
  { id: "both", note: "4 · ambas cartas en la zona de duelo (defensa + carta elegida)" },
  { id: "turn-win", note: "5 · resolución ganada" },
  { id: "turn-loss", note: "6 · resolución perdida" },
  { id: "turn-tie", note: "resolución empatada" },
  { id: "mid", note: "7 · turno avanzado" },
  { id: "t10", note: "8 · turno 10" },
  { id: "complete-win", note: "golpe final · victoria" },
  { id: "result-win", note: "9 · resultado final · victoria" },
  { id: "result-loss", note: "resultado final · derrota" },
  { id: "locked", note: "jugada en vuelo (cerrojo)" },
  { id: "intro", note: "intro VS" },
];

export default function Fase50QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const fx = useMemo(() => fase45Fixtures(), []);
  if (scene === null) return null;
  const s = SCENES.find((x) => x.id === scene);
  if (!s) {
    return (
      <ul className="space-y-1 text-[13px] text-white/70" data-testid="fase50-index">
        {SCENES.map((x) => <li key={x.id}><a className="underline" href={`?scene=${x.id}`}>{x.id}</a> — {x.note}</li>)}
      </ul>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      {/* Inmersiva, como la ruta real: tapa el armazón y se desplaza sola si hace falta. */}
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#04050b]" data-scene={s.id} data-synthetic="true">
        <Scene id={s.id} fx={fx} />
      </div>
    </MotionConfig>
  );
}

type Fx = ReturnType<typeof fase45Fixtures>;

/** La misma composición que `/duelos/jugar`: barra + marco de la arena + contenido. */
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

function Moment({ board, view, turn }: { board: DuelMatchView; view: DuelMatchView; turn: DuelTurnView | null }) {
  if (!turn) return <p className="p-6 text-white/60">QA SYNTHETIC · esta semilla no trae ese turno.</p>;
  const find = (uid: string) => [...view.yourHand, ...view.yourUsed, ...view.rivalUsed].find((c) => c.uid === uid) ?? null;
  const you = find(turn.you.uid);
  const rival = find(turn.rival.uid);
  if (!you || !rival) return <p className="p-6 text-white/60">QA SYNTHETIC · esta semilla no trae las dos cartas del turno.</p>;
  return (
    <>
      <Board view={board} busy />
      <DuelMoment turn={turn} yourCard={you} rivalCard={rival} onClose={noop} autoCloseMs={600_000} />
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

function Scene({ id, fx }: { id: string; fx: Fx }) {
  switch (id) {
    case "start": return <Board view={fx.attack} />;
    case "rival-played": return <Board view={fx.defense} />;
    case "selecting": return <Board view={fx.mid} />;
    case "both": return <Board view={fx.imposed} />;
    case "turn-win": return <Moment board={fx.mid} view={fx.win} turn={fx.winTurn} />;
    case "turn-loss": return <Moment board={fx.mid} view={fx.loss} turn={fx.lossTurn} />;
    case "turn-tie": return <Moment board={fx.mid} view={fx.win} turn={fx.tieTurn} />;
    case "mid": return <Board view={fx.mid} />;
    case "t10": return <Board view={fx.t10} />;
    case "locked": return <Board view={fx.mid} busy />;
    case "complete-win": return <><Result view={fx.win} /><MatchComplete result={fx.win.result!} onDone={noop} /></>;
    case "result-win": return <Result view={fx.win} />;
    case "result-loss": return <Result view={fx.loss} />;
    case "intro": return <><Board view={fx.attack} busy /><MatchIntro view={fx.attack} rivalName="Normal" onDone={noop} /></>;
    default: return null;
  }
}
