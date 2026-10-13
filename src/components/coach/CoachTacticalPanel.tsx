"use client";

/**
 * SALA TÁCTICA — el panel del entrenador antes de CADA ronda.
 *
 * El entrenador controla TODO: estrategia (concepto), objetivo, tempo, riesgo y
 * utilidad. La IA del Coach Engine propone (recomendación + porqué), pero el humano
 * acepta, modifica o ignora. Reúne el scouting REAL del rival y el estado mental de
 * los 5 jugadores. Emite un `ManualCoachInput` que el Coach Engine traduce a plan.
 */
import { useEffect, useMemo, useState } from "react";
import type { CoachConcept } from "@/coach";
import { conceptDefaults } from "@/coach";
import type { ManualCoachInput, UtilityFocus } from "@/coach";
import type { Aggression, Side, Tempo } from "@/sim";
import type { RiskLevel } from "@/preparation";
import type { PrepView } from "@/components/sim/useCoachMatch";
import { PlayerStatusCard } from "./PlayerStatusCard";
import { ChalkboardBuilder } from "./ChalkboardBuilder";
import type { ChalkboardPlan } from "@/coach";
import { cn } from "@/lib/format";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("coach");

interface StratOpt { label: string; concept: CoachConcept; hint: string }
const ATK_STRATS: StratOpt[] = [
  { label: "Default", concept: "default", hint: "Control + ejecución estándar" },
  { label: "Default lento", concept: "slow", hint: "Control de mapa paciente" },
  // FULL GAME AUDIT · sin nombres de Ascent («B/Tree») en los doce mapas: la zona se dice por su función (`ZONE_LABEL`).
  { label: "Explode A", concept: "explode_a", hint: "Ejecución rápida por la entrada principal" },
  { label: "Explode B", concept: "explode_b", hint: "Ejecución rápida por el flanco" },
  { label: "Split / Fake", concept: "fake", hint: "Finta y reubicación" },
  { label: "Lurk / Picks", concept: "play_picks", hint: "Buscar pick, jugar lento" },
  { label: "Rush / Force", concept: "force", hint: "Duelos rápidos, comprometer" },
  { label: "Eco rush", concept: "save", hint: "Rush agrupado de eco" },
];
const DEF_STRATS: StratOpt[] = [
  { label: "Default", concept: "default", hint: "Defensa estándar repartida" },
  { label: "Pasivo / lento", concept: "slow", hint: "Ceder espacio, bajo riesgo" },
  { label: "Jugar picks", concept: "play_picks", hint: "Info agresiva, buscar pick" },
  { label: "Retake", concept: "play_retake", hint: "Spread + retake coordinado" },
  { label: "Agresivo / Force", concept: "force", hint: "Info agresiva, presionar" },
  { label: "Save", concept: "save", hint: "Apilar y salvar" },
];

interface ObjOpt { id: string; label: string; objective: string; mapPriority: string }
const OBJECTIVES: ObjOpt[] = [
  // FULL GAME AUDIT · zonas por su FUNCIÓN (valen en los doce mapas), no por los nombres de Ascent («A Main», «Tree / B»).
  { id: "main", label: "Entrada principal", objective: "execute_site", mapPriority: "main" },
  { id: "mid", label: "Mid", objective: "map_control", mapPriority: "mid" },
  { id: "tree", label: "Flanco", objective: "execute_site", mapPriority: "tree" },
  { id: "heaven", label: "Heaven", objective: "hold_default", mapPriority: "heaven" },
  { id: "site", label: "Sitio", objective: "execute_site", mapPriority: "site" },
  { id: "control", label: "Control mapa", objective: "map_control", mapPriority: "" },
  { id: "picks", label: "Jugar por picks", objective: "surprise_pick", mapPriority: "" },
  { id: "fb", label: "Buscar first blood", objective: "win_duels", mapPriority: "" },
  { id: "wait", label: "Esperar error rival", objective: "bait_rotation", mapPriority: "" },
];

const TEMPOS: { label: string; tempo: Tempo }[] = [
  { label: "Muy lento", tempo: "slow" }, { label: "Lento", tempo: "slow" },
  { label: "Normal", tempo: "mid" }, { label: "Rápido", tempo: "fast" }, { label: "Muy rápido", tempo: "fast" },
];
const RISKS: { label: string; aggression: Aggression; risk: RiskLevel }[] = [
  { label: "Muy conservador", aggression: "passive", risk: "low" },
  { label: "Conservador", aggression: "passive", risk: "medium" },
  { label: "Balanceado", aggression: "balanced", risk: "medium" },
  { label: "Agresivo", aggression: "aggressive", risk: "medium" },
  { label: "Muy agresivo", aggression: "aggressive", risk: "high" },
];
const UTILITIES: { id: UtilityFocus; label: string; icon: string }[] = [
  { id: "entry", label: "Entradas", icon: "⚡" }, { id: "retake", label: "Retake", icon: "↩️" },
  { id: "defense", label: "Defensa", icon: "🛡️" }, { id: "control", label: "Control", icon: "🗺️" },
  { id: "save", label: "Guardar", icon: "💾" },
];

const tempoToIdx = (t: Tempo) => (t === "slow" ? 1 : t === "mid" ? 2 : 3);
const riskToIdx = (a: Aggression, r: RiskLevel) =>
  a === "passive" ? (r === "low" ? 0 : 1) : a === "balanced" ? 2 : r === "high" ? 4 : 3;

/**
 * El plan de la ronda.
 *
 * `onChange` existe para que la ORDEN pueda estar fuera de este panel. La barra de acción del
 * partido vive anclada al pie del escenario —para no obligar a bajar hasta aquí— y necesita
 * confirmar exactamente el plan que se ve en pantalla, no uno por defecto. Así que el panel
 * publica su plan hacia arriba y quien manda puede estar en otro sitio.
 */
export function CoachTacticalPanel({ prep, onConfirm, onChange }: {
  prep: PrepView;
  /** Opcional (F69 · F68-012): en el partido la orden vive en el pie anclado; sin ella no hay botón duplicado. */
  onConfirm?: (input: ManualCoachInput) => void;
  onChange?: (input: ManualCoachInput) => void;
}) {
  useLocale();
  const rec = prep.recommendation;
  const strats = prep.side === "ATK" ? ATK_STRATS : DEF_STRATS;

  const [concept, setConcept] = useState<CoachConcept>(rec.concept);
  const [objIdx, setObjIdx] = useState<number>(-1); // -1 = objetivo recomendado
  const [tempoIdx, setTempoIdx] = useState<number>(tempoToIdx(rec.tempo));
  const [riskIdx, setRiskIdx] = useState<number>(riskToIdx(rec.aggression, rec.riskLevel));
  const [utility, setUtility] = useState<UtilityFocus>("entry");

  const acceptRecommendation = () => {
    setConcept(rec.concept);
    setTempoIdx(tempoToIdx(rec.tempo));
    setRiskIdx(riskToIdx(rec.aggression, rec.riskLevel));
    setObjIdx(-1);
  };

  /*
   * FULL GAME AUDIT (2026-10-07) · elegir una ESTRATEGIA pone los diales en los de esa estrategia (la recomendada, con
   * los de la recomendación; otra, con los suyos propios) y su objetivo vuelve a ser el de la estrategia. Antes solo
   * cambiaba el concepto: el objetivo/carril, el tempo y el riesgo seguían siendo los de la recomendación y mandaban
   * sobre la estrategia elegida. Cambiar después un dial sigue siendo decisión del entrenador.
   */
  const pickConcept = (c: CoachConcept) => {
    setConcept(c);
    setObjIdx(-1);
    if (c === rec.concept) {
      setTempoIdx(tempoToIdx(rec.tempo));
      setRiskIdx(riskToIdx(rec.aggression, rec.riskLevel));
    } else {
      const d = conceptDefaults(c, prep.side);
      setTempoIdx(tempoToIdx(d.tempo));
      setRiskIdx(riskToIdx(d.aggression, d.riskLevel));
    }
  };

  // La PIZARRA traduce su plan compilado a los diales del panel (concepto/tempo/objetivo/utilidad).
  const applyChalk = (plan: ChalkboardPlan) => {
    setConcept(plan.concept);
    setTempoIdx(tempoToIdx(plan.tempo));
    setUtility(plan.utility);
    setObjIdx(plan.order.lane === "mid" ? 1 : plan.order.lane === "tree" ? 2 : 0);
    setRiskIdx(plan.order.style === "aggressive" ? 3 : plan.order.style === "passive" ? 1 : plan.order.style === "save" ? 0 : 2);
  };

  const input: ManualCoachInput = useMemo(() => ({
    concept,
    tempo: TEMPOS[tempoIdx].tempo,
    aggression: RISKS[riskIdx].aggression,
    riskLevel: RISKS[riskIdx].risk,
    // Sin objetivo elegido a mano: el de la recomendación SOLO si se juega la estrategia recomendada; si no, vacío y
    // `buildManualPlan` usa el de la estrategia elegida (su forma base).
    primaryObjective: objIdx >= 0 ? OBJECTIVES[objIdx].objective : concept === rec.concept ? rec.primaryObjective : "",
    mapPriority: objIdx >= 0 ? OBJECTIVES[objIdx].mapPriority : concept === rec.concept ? rec.mapPriority : "",
    utility,
  }), [concept, tempoIdx, riskIdx, objIdx, utility, rec]);

  // Publica el plan cada vez que cambia, para que la barra de acción confirme ESTE y no otro.
  useEffect(() => { onChange?.(input); }, [input, onChange]);

  const sideLabel = prep.side === "ATK" ? "ATAQUE" : "DEFENSA";
  const homeName = prep.teamNames?.home ?? tr("Tu equipo");
  const awayName = prep.teamNames?.away ?? tr("Rival");

  return (
    <div className="animate-rise space-y-4">
      {/* Cabecera */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-base-700/70 to-base-800/70 px-5 py-3">
        <div>
          <p className="font-display text-[11px] uppercase tracking-[0.3em] text-drl">{tr("Sala táctica · Ronda")} {prep.roundNumber}</p>
          <h2 className="font-display text-2xl font-bold uppercase text-white">
            {tr("Preparas")} <span className={prep.side === "ATK" ? "text-rose-400" : "text-cyan-400"}>{td(sideLabel)}</span>
          </h2>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-bold tabular-nums text-white">{prep.score.home}<span className="text-white/30"> - </span>{prep.score.away}</p>
          <p className="text-[10px] text-white/40">{td(homeName)} · {td(awayName)}</p>
        </div>
      </header>

      {prep.matchPoint && (
        <div className={cn("flex items-center justify-center gap-3 rounded-xl border px-4 py-3 text-center animate-pulse",
          prep.matchPoint === "home" ? "border-emerald-400/50 bg-emerald-500/10" : prep.matchPoint === "both" ? "border-amber-300/50 bg-amber-400/10" : "border-rose-400/50 bg-rose-500/10")}>
          <span className="font-display text-xl font-black uppercase tracking-[0.3em]"
            style={{ color: prep.matchPoint === "home" ? "#37e6a0" : prep.matchPoint === "both" ? "#ffd35c" : "#ff4d6a" }}>
            {prep.matchPoint === "home" ? tr("★ MATCH POINT ★") : prep.matchPoint === "both" ? tr("★ MATCH POINT · LOS DOS ★") : tr("⚠ MATCH POINT RIVAL ⚠")}
          </span>
          <span className="text-sm text-white/60">{prep.matchPoint === "home" ? tr("Una ronda para cerrarlo.") : prep.matchPoint === "both" ? tr("La siguiente ronda decide el partido.") : tr("Una ronda o se acaba.")}</span>
        </div>
      )}

      {(prep.isSideSwitch || prep.isPistol) && (
        <div className={cn("rounded-xl border px-4 py-2.5 text-sm",
          prep.isSideSwitch ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-drl/40 bg-drl/10 text-drl")}>
          {prep.isSideSwitch
            ? tr("🔄 CAMBIO DE LADO. Nuevo briefing: replantea estrategia, compra y lectura del rival para la segunda mitad.")
            : tr("🔫 RONDA PISTOLA. Sin economía: gana el duelo y arranca con ventaja el lado.")}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Columna izquierda: DECISIONES */}
        <div className="space-y-4">
          <Section title={tr("Estrategia")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {strats.map((s) => (
                <button key={s.label} onClick={() => pickConcept(s.concept)}
                  className={cn("rounded-xl border px-3 py-2.5 text-left transition",
                    concept === s.concept ? "border-drl bg-drl/15 shadow-glow" : "border-white/10 bg-white/5 hover:bg-white/10")}>
                  <p className="font-display text-xs font-bold uppercase tracking-wide text-white">{td(s.label)}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-white/40">{td(s.hint)}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section title={tr("Objetivo")}>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={objIdx === -1} onClick={() => setObjIdx(-1)}>{tr("Recomendado")}</Pill>
              {OBJECTIVES.map((o, i) => (
                <Pill key={o.id} active={objIdx === i} onClick={() => setObjIdx(i)}>{td(o.label)}</Pill>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title={tr("Tempo")}>
              <Slider steps={TEMPOS.map((t) => t.label)} value={tempoIdx} onChange={setTempoIdx} accent="#19e3ff" />
            </Section>
            <Section title={tr("Riesgo")}>
              <Slider steps={RISKS.map((r) => r.label)} value={riskIdx} onChange={setRiskIdx} accent="#ff2e63" />
            </Section>
          </div>

          <Section title={tr("Prioridad de utilidad")}>
            <div className="flex flex-wrap gap-1.5">
              {UTILITIES.map((u) => (
                <Pill key={u.id} active={utility === u.id} onClick={() => setUtility(u.id)}>{u.icon} {tdIn("coach", u.label)}</Pill>
              ))}
            </div>
          </Section>

          <ChalkboardBuilder onApply={applyChalk} />
        </div>

        {/* Columna derecha: IA + SCOUTING */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-drl/30 bg-drl/5 p-4">
            <div className="flex items-center justify-between">
              <p className="font-display text-[11px] uppercase tracking-widest text-drl">{tr("Recomendación IA")}</p>
              <span className="rounded-full bg-drl/20 px-2 py-0.5 text-[10px] font-bold text-drl">{Math.round(rec.confidence * 100)}{tr("% confianza")}</span>
            </div>
            <p className="mt-1 font-display text-lg font-bold uppercase text-white">{conceptName(rec.concept)}</p>
            <ul className="mt-2 space-y-1">
              {prep.reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-white/65"><span className="text-drl">›</span>{td(r)}</li>
              ))}
            </ul>
            <button onClick={acceptRecommendation}
              className="mt-3 w-full rounded-lg border border-drl/40 bg-drl/15 px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-drl transition hover:bg-drl/25">
              {tr("Aceptar recomendación")}
            </button>
          </div>

          <ScoutPanel prep={prep} />
        </div>
      </div>

      {/* Composición (Agent Engine) */}
      <CompositionBriefing prep={prep} />

      {/* Jugadores */}
      <Section title={tr("Tu quinteto · estado mental")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {prep.cards.map((c) => <PlayerStatusCard key={c.name} card={c} />)}
        </div>
      </Section>

      {/*
        F69 · F68-012: este botón hacía lo mismo que «Comenzar fase de compra» del pie anclado
        (`confirmPreparation` con el plan marcado), que se ve siempre por mucho que se desplace el
        panel. Dos CTA para una acción; solo se pinta si el panel se usa fuera del partido.
      */}
      {onConfirm && (
        <button onClick={() => onConfirm(input)}
          className="nx-focus w-full rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-4 font-display text-base font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
          {tr("Confirmar plan → Fase de compra ▸")}
        </button>
      )}
    </div>
  );
}

function CompositionBriefing({ prep }: { prep: PrepView }) {
  useLocale();
  const { ours, theirs, matchup } = prep.composition;
  const RAT: { key: keyof typeof ours.ratings; label: string }[] = [
    { key: "execute", label: tr("Execute") }, { key: "control", label: tr("Control") }, { key: "info", label: tr("Info") },
    { key: "entry", label: tr("Entrada") }, { key: "retake", label: tr("Retake") }, { key: "postplant", label: tr("Post-plant") },
  ];
  return (
    <Section title={tr("Análisis de composición")}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* La tuya */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-bold uppercase text-white">{td(ours.archetypeLabel)}</span>
            <span className="text-[10px] text-white/40">{ours.playstyle.join(" · ")}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {RAT.map((r) => <RatingBar key={r.key} label={td(r.label)} mine={ours.ratings[r.key]} theirs={theirs.ratings[r.key]} />)}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Tags title={tr("Fortalezas")} items={ours.strengths} tone="good" />
            <Tags title={tr("Debilidades")} items={ours.weaknesses} tone="bad" />
          </div>
          {ours.synergies.length > 0 && (
            <ul className="space-y-0.5 pt-1">
              {ours.synergies.slice(0, 3).map((s, i) => <li key={i} className="text-[11px] text-emerald-300/80">↳ {td(s)}</li>)}
            </ul>
          )}
          {ours.risks.length > 0 && (
            <ul className="space-y-0.5">
              {ours.risks.slice(0, 2).map((s, i) => <li key={i} className="text-[11px] text-rose-300/80">⚠ {td(s)}</li>)}
            </ul>
          )}
        </div>
        {/* Matchup + rival */}
        <div className="space-y-2">
          <div className="rounded-xl border border-drl/30 bg-drl/5 p-3">
            <p className="font-display text-[11px] uppercase tracking-widest text-drl">{tr("Lectura del enfrentamiento")}</p>
            <ul className="mt-1.5 space-y-1">
              {matchup.recommendations.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-white/70"><span className="text-drl">›</span>{td(r)}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-white/10 bg-base-800/60 p-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-bold uppercase text-white/80">{tr("Rival ·")} {td(theirs.archetypeLabel)}</span>
              <span className="text-[10px] text-white/40">{theirs.playstyle.slice(0, 2).join(" · ")}</span>
            </div>
            {theirs.risks.length > 0 && <p className="mt-1 text-[11px] text-amber-300/80">{tr("Punto débil:")} {td(theirs.risks[0])}</p>}
          </div>
        </div>
      </div>
    </Section>
  );
}

function RatingBar({ label, mine, theirs }: { label: string; mine: number; theirs: number }) {
  useLocale();
  const edge = mine - theirs;
  const col = edge > 6 ? "#37e6a0" : edge < -6 ? "#ff4d6a" : "#19e3ff";
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[10px] uppercase tracking-wide text-white/45">{td(label)}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, Math.min(100, mine))}%`, background: col }} />
      </div>
      <span className="w-6 text-right text-[10px] tabular-nums text-white/45">{mine}</span>
    </div>
  );
}

function Tags({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  useLocale();
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-white/35">{td(title)}</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {items.length === 0 ? <span className="text-[10px] text-white/25">—</span> : items.map((t, i) => (
          <span key={i} className={cn("rounded px-1.5 py-0.5 text-[10px]", tone === "good" ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200")}>{td(t)}</span>
        ))}
      </div>
    </div>
  );
}

function ScoutPanel({ prep }: { prep: PrepView }) {
  useLocale();
  const s = prep.scout;
  return (
    <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
      <p className="font-display text-[11px] uppercase tracking-widest text-amber-300">{tr("Scouting del rival")}</p>
      {s.rounds < 2 ? (
        <p className="mt-2 text-[12px] text-white/40">{tr("Aún sin lecturas fiables (ronda {n}). Observa sus patrones.", { n: prep.roundNumber })}</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[12px] text-white/70">
          <li>{fill(tr("🎯 Ataca más por {zona} ({pct}%)", { ...slots("zona"), pct: Math.round(s.predictedAttack.confidence * 100) }), { zona: <b className="text-white">{td(s.predictedAttack.label)}</b> })}</li>
          <li>{fill(tr("🕳️ Defiende menos {zona}", slots("zona")), { zona: <b className="text-white">{td(s.leastDefended.label)}</b> })}</li>
          {s.pattern.strength >= 0.5 && <li>{fill(tr("🔁 Repite {pattern} (patrón {strength}%)", { ...slots("pattern"), strength: Math.round(s.pattern.strength * 100) }), { pattern: <b className="text-white">{td(s.pattern.label)}</b> })}</li>}
          {s.dominantFragger && <li>{tr("⭐ Jugador caliente:")} <b className="text-white">{td(s.dominantFragger)}</b></li>}
          <li>{tr("💰 Su economía:")} <b className="text-white">{s.enemyEconomy.buy ?? "—"}</b> ({td(s.enemyEconomy.health)})</li>
        </ul>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/30 p-4">
      <p className="mb-2.5 font-display text-[11px] uppercase tracking-widest text-white/45">{td(title)}</p>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("rounded-lg px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition",
        active ? "bg-drl text-white shadow-glow" : "border border-white/10 bg-white/5 text-white/60 hover:text-white")}>
      {children}
    </button>
  );
}

function Slider({ steps, value, onChange, accent }: { steps: string[]; value: number; onChange: (v: number) => void; accent: string }) {
  return (
    <div>
      <input type="range" min={0} max={steps.length - 1} value={value} step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-drl" style={{ accentColor: accent }} />
      <div className="mt-1 flex justify-between">
        {steps.map((s, i) => (
          <button key={s} onClick={() => onChange(i)}
            className={cn("text-[9px] uppercase tracking-wide transition", i === value ? "font-bold text-white" : "text-white/30 hover:text-white/60")}>
            {td(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

const CONCEPT_NAMES: Record<CoachConcept, string> = {
  slow: "Default lento", default: "Default", explode_a: "Explode A", explode_b: "Explode B",
  fake: "Fake / Split", play_picks: "Jugar por picks", play_retake: "Retake", force: "Force", save: "Save / Eco",
};
function conceptName(c: CoachConcept): string { return td(CONCEPT_NAMES[c]) ?? c; }
