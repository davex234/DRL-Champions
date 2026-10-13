"use client";

/**
 * UNA PREDICCIÓN — la decisión (Fase 9, ampliada en la 24.2).
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Cada pregunta es una PIEZA con tres partes:
 *
 *     pregunta · +puntos · ESTADO         ← dicho con texto, punto e insignia
 *     [ LOGO BANDO A ]  VS  [ LOGO BANDO B ]   ← dos objetos enfrentados, no dos campos
 *     qué pasa / cuándo cierra / qué pasó ← una línea de estado con `aria-live`
 *
 * Con más de dos opciones —el campeón trae a todos los participantes— se reparten en una
 * rejilla; `featured` la agranda: es la predicción destacada del torneo.
 *
 * El estado NUNCA depende solo del color: lleva su palabra («Pendiente», «Elegido»,
 * «Bloqueada», «Sin predicción», «Acertada», «Fallada»), su punto de estado y, en las
 * opciones, una MARCA dibujada.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * **No decide nada.** Recibe la pregunta tal y como la sirve `pickem_questions_public`
 * —incluido `correct_option`, que la vista solo expone cuando ya está cerrada— y mi
 * respuesta con lo que el corrector dejó escrito (`is_correct`, `points_award`). Los puntos
 * que enseña son `q.points` (configuración del servidor) y `points_award` (lo concedido).
 * Las opciones son las del servidor: no añade, no traduce, no inventa.
 */
import { Piece } from "@/components/ui/Surface";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { cn } from "@/lib/format";
import { Countdown } from "./Countdown";
import type { PickemQuestion } from "@/lib/game/client";
import type { PickFeedback } from "@/lib/usePickem";
import {
  stateOf, awardedPoints, isLockedNow, type MyAnswer, type PickState,
} from "@/domain/pickems/progress";

export type { PickState as EstadoPick };

export const ESTADO: Record<PickState, { label: string; tone: "info" | "ok" | "muted" | "bad" | "key" | "warn"; solid?: boolean }> = {
  pendiente:        { label: "Pendiente",      tone: "info" },
  elegida:          { label: "Elegido",        tone: "ok" },
  bloqueada:        { label: "Bloqueada",      tone: "muted" },
  "sin-prediccion": { label: "Sin predicción", tone: "warn" },
  acertada:         { label: "Acertada",       tone: "ok", solid: true },
  fallada:          { label: "Fallada",        tone: "bad" },
  "sin-participar": { label: "No jugada",      tone: "muted" },
};

/** Nombre corto del tipo de pregunta, para la cabecera de la pieza. */
export const KIND_LABEL: Record<string, string> = {
  match_winner: "Ganador",
  match_score: "Resultado",
  champion: "Campeón",
  advance: "Clasificación",
};

/**
 * LA MARCA. Dibujada, no un emoji ni un glifo prestado.
 *
 * Dos trazos y un anillo, con el mismo canto que el resto del sistema. Es lo que permite
 * distinguir acierto de fallo **sin leer el color**.
 */
function Marca({ tipo, tone }: { tipo: "acierto" | "fallo" | "elegida"; tone: string }) {
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={{ boxShadow: `inset 0 0 0 1.5px ${tone}`, background: `${tone}1f` }}
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round">
        {tipo === "acierto" && <path d="M2 6.4 4.8 9.2 10 3.4" />}
        {tipo === "fallo" && <><path d="M3 3l6 6" /><path d="M9 3l-6 6" /></>}
        {tipo === "elegida" && <circle cx="6" cy="6" r="2.4" fill={tone} stroke="none" />}
      </svg>
    </span>
  );
}

/** Tono de la marca por estado. Los tres del sistema, sin hexadecimales sueltos nuevos. */
const MARCA_TONO = { ok: "var(--nx-ok)", bad: "var(--nx-bad)", key: "var(--nx-accent)" } as const;

const labelOf = (q: PickemQuestion, key: string | null | undefined) =>
  q.options.find((o) => o.key === key)?.label ?? key ?? "—";

export function PickQuestion({
  q, mine, now, saving, feedback, disabled, readOnly, featured, onPick, onExpire,
}: {
  q: PickemQuestion;
  /** Mi respuesta guardada, con lo que dijo el corrector. */
  mine: MyAnswer | undefined;
  /** «Ahora» del reloj compartido. Apaga el botón al llegar a cero; el servidor decide. */
  now?: number;
  saving: boolean;
  /** Estado del guardado de ESTA pregunta (guardando / guardada / error / cerrada). */
  feedback?: PickFeedback | null;
  /** Sin sesión, o guardando: se puede leer pero no elegir. */
  disabled: boolean;
  /** Historial: solo lectura aunque la pregunta siguiera abierta. */
  readOnly?: boolean;
  /** Predicción destacada del torneo (campeón): más grande, con logos grandes. */
  featured?: boolean;
  onPick: (option: string) => void;
  /**
   * La cuenta atrás llegó a cero. El reloj del navegador NO decide nada —el cierre lo manda
   * el servidor— pero al expirar hay que recargar para que lo que se ve coincida con lo que
   * el servidor ya considera cerrado.
   */
  onExpire?: () => void;
}) {
  const estado = stateOf(q, mine, now);
  const info = ESTADO[estado];
  const locked = isLockedNow(q, now);
  const corregida = locked && !!q.correct_option;
  const duelo = !featured && q.options.length === 2;
  const withLogo = q.kind !== "match_score";
  const canPick = !locked && !readOnly && !disabled && !saving;
  const awarded = awardedPoints(mine);

  const tone = estado === "acertada" ? "success" : estado === "fallada" ? "primary" : featured ? "gold" : "neutral";

  return (
    <Piece
      tone={tone}
      lifted={featured}
      className={cn(
        featured ? "px-4 py-4 sm:px-6 sm:py-6" : "px-3 py-3 sm:px-4 sm:py-4",
        estado === "acertada" && "nx-hit-glow",
        locked && !corregida && "opacity-90",
      )}
      data-state={estado}
      data-kind={q.kind}
    >
      {/* ── Cabecera: qué es, qué vale y en qué estado está ── */}
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <span className="nx-label">{KIND_LABEL[q.kind] ?? q.kind}</span>
          <p
            className={cn(
              "font-display font-bold uppercase leading-tight tracking-[0.03em]",
              featured ? "text-[clamp(20px,3.4vw,30px)]" : "text-[14px] sm:text-[15px]",
              locked && !corregida ? "text-ink-secondary" : "text-white",
            )}
          >
            {q.prompt}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {/* Los puntos son `q.points`: configuración del servidor, no una constante de la UI. */}
          {corregida ? (
            <Readout
              size="xs"
              value={estado === "acertada" ? `+${awarded ?? q.points}` : estado === "fallada" ? "+0" : "—"}
              unit="pts"
              tone={estado === "acertada" ? "var(--nx-ok)" : undefined}
              aria-label={estado === "acertada" ? `Sumaste ${awarded ?? q.points} puntos` : "Cero puntos"}
            />
          ) : (
            <Readout size="xs" value={`+${q.points}`} unit="pts" tone="var(--nx-gold)" aria-label={`Vale ${q.points} puntos`} />
          )}
          <Badge tone={info.tone} solid={info.solid} dot={!info.solid}>{info.label}</Badge>
        </span>
      </div>

      {/* ── La decisión ── */}
      {duelo ? (
        <div className="mx-auto flex max-w-[680px] items-stretch gap-2 sm:gap-3">
          <Opcion q={q} o={q.options[0]} mine={mine} corregida={corregida} canPick={canPick} saving={saving} feedback={feedback} onPick={onPick} duelo withLogo={withLogo} />
          <span className="flex shrink-0 items-center">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-ink-faint">vs</span>
          </span>
          <Opcion q={q} o={q.options[1]} mine={mine} corregida={corregida} canPick={canPick} saving={saving} feedback={feedback} onPick={onPick} duelo withLogo={withLogo} />
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-2",
            featured ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-4",
          )}
          role="group"
          aria-label={q.prompt}
        >
          {q.options.map((o) => (
            <Opcion key={o.key} q={q} o={o} mine={mine} corregida={corregida} canPick={canPick} saving={saving} feedback={feedback} onPick={onPick} withLogo={withLogo} featured={featured} />
          ))}
        </div>
      )}

      {/* ── Qué pasa después: SIEMPRE con palabras ── */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1" role="status" aria-live="polite">
        {feedback ? (
          <span className={cn("flex items-center gap-1.5 nx-label",
            feedback.kind === "saved" && "!text-ok",
            feedback.kind === "error" && "!text-bad",
            feedback.kind === "locked" && "!text-warn")}>
            <StatusDot tone={feedback.kind === "saved" ? "ok" : feedback.kind === "saving" ? "info" : feedback.kind === "locked" ? "warn" : "bad"} pulse={feedback.kind === "saving"} size={5} />
            {feedback.message}
          </span>
        ) : corregida ? (
          <span className="nx-label">
            {estado === "acertada" ? (
              <>
                <b className="text-ok">Acertada · +{awarded ?? q.points} {(awarded ?? q.points) === 1 ? "punto" : "puntos"}</b>
                {awarded === null && <span className="text-ink-faint"> · pendiente de sumar</span>}
              </>
            ) : estado === "fallada" ? (
              <>
                <b className="text-bad">Fallada · +0</b>
                {" · Resultado: "}
                <b className="text-white">{labelOf(q, q.correct_option)}</b>
              </>
            ) : (
              <>No participaste · Resultado: <b className="text-white">{labelOf(q, q.correct_option)}</b></>
            )}
          </span>
        ) : locked ? (
          <span className="nx-label">
            {mine
              ? <>Bloqueada · <b className="text-white">{labelOf(q, mine.option)}</b> · pendiente del resultado</>
              : <b className="text-warn">Sin predicción · Cerrada</b>}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={mine ? "ok" : "info"} size={5} />
              <span className="nx-label">
                {readOnly
                  ? (mine ? <>Tu elección: <b className="text-white">{labelOf(q, mine.option)}</b></> : "Sin predicción")
                  : mine
                    ? <>Elegido: <b className="text-white">{labelOf(q, mine.option)}</b> · puedes cambiarlo hasta el cierre</>
                    : "Elige una opción"}
              </span>
            </span>
            <Countdown to={q.locks_at} onExpire={onExpire} className="nx-label ml-auto" />
          </>
        )}
      </div>
    </Piece>
  );
}

/**
 * UNA OPCIÓN — un bando al que apostar.
 *
 * Es un `<button>` con su `aria-pressed`: se recorre con Tab y se elige con Enter o
 * espacio. Ocupa alto de verdad (56 px, por encima del objetivo táctil de 44) y dice lo que
 * es con una marca dibujada además del color.
 */
function Opcion({
  q, o, mine, corregida, canPick, saving, feedback, onPick, duelo, withLogo, featured,
}: {
  q: PickemQuestion;
  o: { key: string; label: string };
  mine: MyAnswer | undefined;
  corregida: boolean;
  canPick: boolean;
  saving: boolean;
  feedback?: PickFeedback | null;
  onPick: (option: string) => void;
  duelo?: boolean;
  withLogo: boolean;
  featured?: boolean;
}) {
  const elegida = mine?.option === o.key;
  const correcta = corregida && q.correct_option === o.key;
  const falladaMia = corregida && elegida && !correcta;

  const tono = correcta ? MARCA_TONO.ok : falladaMia ? MARCA_TONO.bad : MARCA_TONO.key;
  const marcada = correcta || falladaMia || elegida;
  const pop = elegida && (feedback?.kind === "saving" || feedback?.kind === "saved");

  /*
   * Correcta y fallada se pintan aunque la opción no sea la del usuario: el resultado del
   * partido es información pública una vez corregido. Lo que NO se enseña nunca es la
   * respuesta de una pregunta abierta — y eso lo garantiza la vista del servidor, que
   * devuelve `correct_option: null` mientras `locked` es falso.
   */
  return (
    <button
      type="button"
      disabled={!canPick}
      aria-pressed={elegida}
      aria-label={`${o.label}${elegida ? " · tu elección" : ""}${correcta ? " · resultado" : ""}`}
      onClick={() => onPick(o.key)}
      className={cn(
        "nx-clip-sm group relative flex min-w-0 flex-1 items-center gap-2 px-3 py-2 transition duration-fast motion-reduce:transition-none",
        featured ? "min-h-[72px] sm:min-h-[84px]" : "min-h-[56px]",
        duelo ? "justify-center text-center" : "text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl focus-visible:ring-offset-2 focus-visible:ring-offset-base-900",
        "disabled:cursor-default",
        canPick && !elegida && "hover:bg-white/[0.07]",
        pop && "nx-pick-pop",
        saving && elegida && "opacity-80",
      )}
      style={{
        background: marcada ? `${tono}14` : "rgba(255,255,255,0.035)",
        boxShadow: marcada
          ? `inset 0 0 0 1.5px ${tono}, inset 0 1px 0 rgba(255,255,255,0.08)`
          : "inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {marcada && (
        <Marca tipo={correcta ? "acierto" : falladaMia ? "fallo" : "elegida"} tone={tono} />
      )}
      {withLogo && (
        <span className="shrink-0" aria-hidden>
          <TeamLogo team={o.label} size={featured ? 40 : 28} />
        </span>
      )}
      {/* `flex-initial`, no `flex-none`: con logo delante, un nombre largo tiene que poder encogerse y truncarse. */}
      <span className={cn("min-w-0", duelo ? "flex-initial" : "flex-1")}>
        <b
          className={cn(
            "block truncate font-display font-bold uppercase tracking-[0.03em]",
            featured ? "text-[15px] sm:text-[17px]" : duelo ? "text-[15px] sm:text-[17px]" : "text-[14px] sm:text-[15px]",
            marcada ? "text-white" : !canPick ? "text-ink-faint" : "text-ink-secondary",
          )}
        >
          {o.label}
        </b>
        {/*
          La ETIQUETA de lo que es esta opción. Es la que hace que el estado no dependa del
          color: «Tu elección» y «Resultado» se leen igual en escala de grises.
        */}
        {(elegida || correcta) && (
          <span className="nx-label mt-0.5 block truncate" style={{ color: tono }}>
            {correcta && elegida ? "Tu elección · resultado" : correcta ? "Resultado" : "Tu elección"}
          </span>
        )}
      </span>
    </button>
  );
}
