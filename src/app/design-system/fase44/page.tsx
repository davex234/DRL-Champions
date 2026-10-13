"use client";

/**
 * ARNÉS QA · FASE 44 — `/design-system/fase44?scene=<escena>` · GAME EXPERIENCE 4.0 (solo revisión y capturas).
 *
 * Sin escena: índice por secciones del encargo. Con escena: la pieza REAL de producto con datos QA SYNTHETIC (etiquetados)
 * o, para laboratorios que ya tienen arnés (sobre, partida, campaña, draft, colección, temporada, perfil), un marco con
 * ese arnés real. Nada se escribe ni se envía. Esta página no es una pantalla de juego: importa la simulación a propósito.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayButton } from "@/components/ui/game/PlayButton";
import { GameLoader } from "@/components/ui/game/GameLoader";
import { GameEmpty, GameError, GameOffline } from "@/components/ui/game/GameStates";
import { GameModal, GameSheet } from "@/components/ui/game/GameOverlay";
import { GameMomentView } from "@/components/ui/game/GameMoment";
import { GameSkeleton } from "@/components/ui/game/GameSkeleton";
import { XpProgress } from "@/components/ui/game/XpProgress";
import { AudioSettingsPanel } from "@/components/ui/game/AudioSettingsPanel";
import { NxButton } from "@/components/ui/NxButton";
import { Toast } from "@/components/ui/Toast";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { PackOpenStage } from "@/components/packs/PackOpenStage";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { RatingDelta } from "@/components/duel/pvp/PvpOutcome";
import NotFound from "@/app/not-found";
import { mobileMenu, playCta } from "@/design/gameShell";
import { MOTION, MOTION_LEVELS, SPRING, pageMotion, transitionFamily, type MotionLevel, type TransitionFamily } from "@/design/motion";
import { gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import { MOMENT_COPY, type Moment, type MomentKind } from "@/lib/gameExperience/moments";
import { totalXpForLevel } from "@/domain/progression/levels";
import { getPack } from "@/data/packs";
import { qaSimulate, qaSnapshot, qaView } from "@/lib/duel/qaSimulation";
import type { DuelMatch } from "@/domain/cardgame/match";
import type { DuelMatchView, DuelResultView } from "@/lib/duel/types";
import { FASE44_SCENES, SECTIONS, type Fase44Scene } from "./fixtures";

const noop = () => {};

export default function Fase44QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  if (scene === null) return null;
  if (!scene) return <Index />;
  const s = FASE44_SCENES.find((x) => x.id === scene);
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE44_SCENES.map((x) => x.id).join(", ")}</p>;
  return (
    <div className="space-y-4" data-scene={s.id} data-section={s.section}>
      <p className="nx-clip-sm border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1.5 text-[12px] text-drl-gold/90" data-synthetic="true">
        QA SYNTHETIC · {s.section} · {s.note}
      </p>
      <Scene s={s} />
    </div>
  );
}

function Index() {
  return (
    <div className="space-y-6" data-testid="fase44-index">
      <header>
        <p className="nx-label text-drl">Arnés QA · Fase 44</p>
        <h1 className="font-display text-[44px] font-bold uppercase leading-none text-white">Game Experience 4.0</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/60">Todas las secciones del encargo. Escenas QA SYNTHETIC; las que ya tienen arnés propio se abren en su arnés real.</p>
      </header>
      {SECTIONS.map((sec) => (
        <section key={sec} aria-labelledby={`sec-${sec}`}>
          <h2 id={`sec-${sec}`} className="nx-label mb-2">{sec}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FASE44_SCENES.filter((s) => s.section === sec).map((s) => (
              <li key={s.id}>
                <Link href={`/design-system/fase44?scene=${s.id}`} className="nx-clip-sm block min-h-[56px] border border-white/10 bg-white/[0.03] px-3 py-2 hover:border-white/30">
                  <b className="block font-display text-[15px] uppercase text-white">{s.id}</b>
                  <span className="block text-[12.5px] text-white/55">{s.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Scene({ s }: { s: Fase44Scene }) {
  if (s.frame) {
    return (
      <div className="space-y-2">
        <Link href={s.frame} className="nx-action">Abrir el arnés real: {s.frame} →</Link>
        <iframe title={s.id} src={s.frame} className="h-[78vh] w-full border border-white/10 bg-base-900" />
      </div>
    );
  }
  switch (s.id) {
    case "shell-menu": return <ShellMenu />;
    case "shell-bars": return <ShellBars />;
    case "play-cta": return <PlayCtas />;
    case "mode-select": return <Modes facts={FACTS} />;
    case "mode-locked": return <Modes facts={{ ...FACTS, hasValidDeck: false }} />;
    case "mode-signed-out": return <Modes facts={{ ...FACTS, signedIn: false, hasValidDeck: null, campaign: null, draft: null }} />;
    case "packs-inventory": return <PackInventory />;
    case "packs-empty": return <GameEmpty glyph="pack" title="No tienes sobres" hint="Los sobres se consiguen en la tienda con créditos, y jugando te llevas créditos y recompensas." primary={{ href: "/tienda", label: "Conseguir sobres" }} secondary={[{ href: "/jugar", label: "Jugar" }]} testId="inventory-empty-packs" />;
    case "deck-moments": return <MomentsList kinds={["deck-ready", "deck-active", "deck-saved"]} />;
    case "result-victory": return <Results kind="win" />;
    case "result-defeat": return <Results kind="loss" />;
    case "result-draw": return <Results kind="draw" />;
    case "result-level-up": return <Results kind="win" levelUp />;
    case "xp-levels": return <XpLab />;
    case "rating-delta": return <RatingLab />;
    case "moments": return <MomentsList kinds={Object.keys(MOMENT_COPY) as MomentKind[]} />;
    case "empty": return <EmptyLab />;
    case "error": return <ErrorLab />;
    case "not-found": return <NotFound />;
    case "offline": return <div className="space-y-4"><GameOffline /><GameOffline compact /></div>;
    case "loading": return <LoadingLab />;
    case "toasts": return <ToastLab />;
    case "motion-lab": return <MotionLab />;
    case "overlays": return <Overlays />;
    case "audio": return <div className="max-w-md"><AudioSettingsPanel /></div>;
    case "reduced": return <MotionConfig reducedMotion="always"><MotionLab forcedReduced /></MotionConfig>;
    default: return null;
  }
}

/* ───────────── armazón y JUGAR ───────────── */

const RESUME = playCta({ resume: { id: "resume-pve", label: "Continuar partida", href: "/duelos/jugar", eyebrow: "Partida rápida · en curso", title: "Contra el bot · Normal" } });
const PLAY = playCta(null);

function PlayCtas() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="play-cta-lab">
      {[PLAY, RESUME].map((cta) => (
        <section key={cta.kind} className="nx-clip space-y-5 border border-white/10 bg-white/[0.02] p-6">
          <p className="nx-label">{cta.kind === "play" ? "Sin partida abierta" : "El servidor dice: partida abierta"}</p>
          <PlayButton cta={cta} size="hero" testId={`lab-${cta.kind}-hero`} />
          <div className="flex items-center gap-6">
            <PlayButton cta={cta} size="bar" testId={`lab-${cta.kind}-bar`} />
            <PlayButton cta={cta} size="dock" testId={`lab-${cta.kind}-dock`} />
          </div>
        </section>
      ))}
    </div>
  );
}

function ShellBars() {
  return (
    <div className="space-y-6">
      <div className="nx-gamebar flex h-topbar items-center justify-between px-5">
        <span className="font-display text-[19px] font-bold text-white">NE<span className="text-drl">XUS</span></span>
        <nav className="flex h-full items-stretch">{["Colección", "Equipos", "Sobres", "Temporada", "Mundo"].map((l, i) => <span key={l} className="nx-gamebar-link" data-active={i === 1}>{l}</span>)}</nav>
        <PlayButton cta={PLAY} size="bar" />
      </div>
      <div className="relative mx-auto h-[120px] max-w-[390px] overflow-visible">
        <div className="nx-dock absolute inset-x-0 bottom-0 flex h-mobilebar items-stretch">
          {["Inicio", "Cartas", "", "Sobres", "Perfil"].map((l, i) => (
            <div key={i} className="relative flex flex-1 items-center justify-center">
              {l ? <span className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white/55">{l}</span> : <span className="absolute -top-6"><PlayButton cta={RESUME} size="dock" /></span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShellMenu() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <NxButton variant="secondary" onClick={() => setOpen(true)}>Abrir menú</NxButton>
      <GameSheet open={open} onClose={() => setOpen(false)} title="Menú" eyebrow="NEXUS" testId="shell-menu-sheet">
        <nav className="space-y-5">
          {mobileMenu().map((g) => (
            <section key={g.id}>
              <p className="nx-label mb-1.5">{g.label}</p>
              <ul className="grid gap-1">{g.items.map((it) => <li key={it.href} className="nx-clip-sm flex min-h-[48px] flex-col justify-center bg-white/[0.03] px-3"><b className="font-display text-[17px] uppercase text-white">{it.label}</b></li>)}</ul>
            </section>
          ))}
        </nav>
        <div className="nx-clip-sm mt-6 border border-white/10 p-4"><AudioSettingsPanel /></div>
      </GameSheet>
    </>
  );
}

/* ───────────── modos ───────────── */

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: true,
  campaign: { available: true, completed: 4, total: 15, complete: false, nextName: "Ritmo de élite", chapter: "Capítulo 1" },
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null } as unknown as ModeFacts["draft"],
};

function Modes({ facts }: { facts: ModeFacts }) {
  return (
    <GameModesHub
      cards={gameModes(facts)}
      rtcProgress={facts.signedIn ? { completed: 4, total: 15 } : null}
    />
  );
}

/* ───────────── sobres ───────────── */

function PackInventory() {
  const pack = getPack("estandar") ?? getPack("inicial");
  if (!pack) return null;
  return <PackOpenStage pack={pack} packId={pack.id} total={3} />;
}

/* ───────────── resultados ───────────── */

function useMatches() {
  return useMemo(() => {
    const mine = qaSnapshot(0, "qa-you", "QA SYNTHETIC · Mi equipo");
    const rival = qaSnapshot(1, "qa-rival", "QA SYNTHETIC · Rival");
    let win: DuelMatch | null = null, loss: DuelMatch | null = null;
    for (let seed = 1; seed <= 400 && (!win || !loss); seed++) {
      const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
      if (m.result?.winner === "A" && !win) win = m;
      if (m.result?.winner === "B" && !loss) loss = m;
    }
    return { win: qaView(win!), loss: qaView(loss!) };
  }, []);
}

const withResult = (v: DuelMatchView, r: Partial<DuelResultView>): DuelMatchView => ({ ...v, result: { ...v.result!, ...r } });

function Results({ kind, levelUp = false }: { kind: "win" | "loss" | "draw"; levelUp?: boolean }) {
  const fx = useMatches();
  const award = kind === "win" ? { points: 14, credits: 220, xp: 110 } : kind === "loss" ? { points: 0, credits: 40, xp: 25 } : { points: 0, credits: 90, xp: 50 };
  const base = kind === "loss" ? fx.loss : fx.win;
  const view = kind === "draw"
    ? withResult(base, { decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, reason: "QA SYNTHETIC · empate fabricado", award })
    : withResult(base, { award });
  // XP total inventada; con `levelUp` la ganancia cruza el umbral real del nivel 7 → 8.
  const xp = levelUp ? totalXpForLevel(8) + 40 : totalXpForLevel(6) + 260;
  return <ResultScreen view={view} xp={xp} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} />;
}

function XpLab() {
  const l6 = totalXpForLevel(6);
  return (
    <div className="grid max-w-2xl gap-4">
      <XpProgress xp={l6 + 100} gained={0} label="Sin cambio" />
      <XpProgress xp={l6 + 200} gained={110} label="Un tramo" />
      <XpProgress xp={totalXpForLevel(7) + 30} gained={120} label="Sube un nivel" />
      <XpProgress xp={totalXpForLevel(9) + 10} gained={totalXpForLevel(9) + 10 - (l6 + 300)} label="Varios niveles" />
    </div>
  );
}

function RatingLab() {
  const ev = (delta: number) => ({ matchId: "qa", oldRating: 1201, delta, newRating: 1201 + delta, opponentRating: 1246, kFactor: 24, result: delta > 0 ? "WIN" as const : delta < 0 ? "LOSS" as const : "DRAW" as const, createdAt: Date.now() });
  return <div className="grid max-w-xl gap-6">{[18, -12, 0].map((d) => <div key={d} className="nx-clip-sm border border-white/10 p-4"><RatingDelta outcome={ev(d)} /></div>)}</div>;
}

function MomentsList({ kinds }: { kinds: MomentKind[] }) {
  const facts: Record<MomentKind, Moment> = {
    objective: { key: "o", kind: "objective", fact: "Gana un duelo", reward: "+400 créditos · +300 XP del pase" },
    "level-up": { key: "l", kind: "level-up", fact: "Nivel 7" },
    achievement: { key: "a", kind: "achievement", fact: "Primera victoria ranked" },
    "deck-ready": { key: "d", kind: "deck-ready", fact: "Equipo 2 · 10 cartas, 2 por rol" },
    "deck-active": { key: "da", kind: "deck-active", fact: "Equipo 2 jugará tus partidas" },
    "deck-saved": { key: "ds", kind: "deck-saved", fact: "Equipo 2" },
    reward: { key: "r", kind: "reward", fact: "Nivel 3 del pase", reward: "+280 créditos" },
    prediction: { key: "p", kind: "prediction", fact: "FNC gana a G2" },
    rating: { key: "ra", kind: "rating", fact: "1201 → 1219" },
  };
  return <div className="grid max-w-md gap-4" data-testid="moments-lab">{kinds.map((k) => <GameMomentView key={k} moment={facts[k]} inline />)}</div>;
}

/* ───────────── estados ───────────── */

function EmptyLab() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <GameEmpty glyph="pack" title="No tienes sobres" hint="Consíguelos en la tienda o jugando." primary={{ href: "/tienda", label: "Conseguir sobres" }} secondary={[{ href: "/jugar", label: "Jugar" }]} />
      <GameEmpty glyph="cards" title="Tu colección está vacía" hint="Cada sobre trae cinco cartas reales." primary={{ href: "/inventario", label: "Abrir sobres" }} />
      <GameEmpty glyph="team" title="Todavía no tienes equipo" hint="Diez cartas, dos por rol." primary={{ href: "/duelos/mazos?nuevo=1", label: "Crear equipo" }} secondary={[{ href: "/coleccion", label: "Ver colección" }]} />
    </div>
  );
}

function ErrorLab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GameError message="Road to Champions no responde ahora mismo" onRetry={noop} />
      <GameError message="TypeError: Failed to fetch (PGRST301)" />
    </div>
  );
}

function LoadingLab() {
  return (
    <div className="space-y-6">
      <GameLoader label="Preparando duelo…" tip="Defendiendo, la estadística la impone la tabla: elige la carta que mejor la aguante." />
      <GameSkeleton kind="hero" />
      <GameSkeleton kind="cards" />
      <GameSkeleton kind="deck" />
    </div>
  );
}

function ToastLab() {
  const [n, setN] = useState(1);
  const list = [{ msg: "Equipo guardado y listo para duelo", ok: true }, { msg: "«Equipo 2» es tu equipo activo", ok: true }, { msg: "Failed to fetch", ok: false }];
  const t = list[(n - 1) % list.length];
  return (
    <div className="space-y-3">
      <NxButton variant="secondary" onClick={() => setN((x) => x + 1)}>Siguiente aviso</NxButton>
      <p className="text-[13px] text-white/50">El error técnico se enseña como frase de juego.</p>
      <Toast toast={{ id: n, msg: t.msg, ok: t.ok }} />
    </div>
  );
}

/* ───────────── movimiento ───────────── */

function MotionLab({ forcedReduced = false }: { forcedReduced?: boolean }) {
  const prefers = useReducedMotion();
  const reduced = forcedReduced || !!prefers;
  const [run, setRun] = useState(0);
  const families: TransitionFamily[] = ["gameplay", "collection", "season", "default"];
  return (
    <div className="space-y-6" data-testid="motion-lab" data-reduced={reduced ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-3">
        <NxButton variant="primary" onClick={() => setRun((r) => r + 1)}>Reproducir</NxButton>
        <span className="nx-label">{reduced ? "Movimiento reducido: todo a fundido de 120 ms" : "Movimiento normal"}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {([0, 1, 2, 3, 4] as MotionLevel[]).map((lv) => (
          <motion.div
            key={`${lv}-${run}`}
            data-motion-level={lv}
            className="nx-clip-sm border border-white/10 bg-white/[0.03] p-4"
            initial={lv === 0 ? false : reduced ? { opacity: 0 } : { opacity: 0, y: lv >= 3 ? 0 : 12, scale: lv >= 3 ? 1.2 : 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduced ? { duration: 0.12 } : { duration: MOTION_LEVELS[lv].maxMs / 1000 * (lv >= 3 ? 0.7 : 1), ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="nx-label">Nivel {lv}</p>
            <p className="font-display text-[20px] font-bold uppercase text-white">{MOTION_LEVELS[lv].name}</p>
            <p className="nx-readout text-[13px] text-white/60">≤ {MOTION_LEVELS[lv].maxMs} ms</p>
            <p className="mt-1 text-[12.5px] text-white/50">{MOTION_LEVELS[lv].examples.join(" · ")}</p>
          </motion.div>
        ))}
      </div>
      <table className="w-full max-w-2xl text-left text-[13px] text-white/70">
        <caption className="nx-label mb-2 text-left">Tokens y familias</caption>
        <tbody>
          {Object.entries(MOTION).map(([k, v]) => <tr key={k} className="border-b border-white/5"><th className="py-1 font-display uppercase">duration.{k}</th><td className="nx-readout">{v} ms</td></tr>)}
          {Object.entries(SPRING).map(([k, v]) => <tr key={k} className="border-b border-white/5"><th className="py-1 font-display uppercase">spring.{k}</th><td className="nx-readout">k {v.stiffness} · c {v.damping}</td></tr>)}
          {families.map((fam) => <tr key={fam} className="border-b border-white/5"><th className="py-1 font-display uppercase">page.{fam}</th><td className="nx-readout">{pageMotion(fam, reduced).ms} ms · ej. {fam === "gameplay" ? "/jugar" : fam === "collection" ? "/coleccion" : fam === "season" ? "/temporada" : "/mundo"} → {transitionFamily(fam === "gameplay" ? "/jugar" : fam === "collection" ? "/coleccion" : fam === "season" ? "/temporada" : "/mundo")}</td></tr>)}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-6"><PlayButton cta={PLAY} size="hero" /><GameLoader compact label="Cargando…" /></div>
    </div>
  );
}

function Overlays() {
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(true);
  return (
    <div className="flex flex-wrap gap-3">
      <NxButton variant="secondary" onClick={() => setSheet(true)} data-testid="open-sheet">Abrir hoja</NxButton>
      <NxButton variant="secondary" onClick={() => setModal(true)} data-testid="open-modal">Abrir diálogo</NxButton>
      <GameSheet open={sheet} onClose={() => setSheet(false)} title="Cambiar equipo" eyebrow="Preparación">
        <p className="text-[15px] text-white/70">Escape cierra; el foco vuelve al botón que la abrió.</p>
      </GameSheet>
      <GameModal
        open={modal}
        onClose={() => setModal(false)}
        eyebrow="Draft Gauntlet"
        title="¿Abandonar la run?"
        actions={<><NxButton variant="secondary" onClick={() => setModal(false)} data-autofocus>Seguir jugando</NxButton><NxButton variant="danger" onClick={() => setModal(false)}>Abandonar</NxButton></>}
      >
        La run termina y se conserva en tu historial. No hay recompensa que perder.
      </GameModal>
    </div>
  );
}
