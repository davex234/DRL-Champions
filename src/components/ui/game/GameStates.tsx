"use client";

/**
 * FASE 44 · ESTADOS DE JUEGO — error, vacío, sin conexión y sin cuenta.
 *
 * Nada de «Error 500», «Failed to fetch» ni «No data». El jugador lee QUÉ ha pasado en su idioma y tiene SIEMPRE una
 * salida: reintentar (si se puede), volver al lobby, o la siguiente acción real de esa pantalla. El detalle técnico
 * (si alguien lo pasa) se escribe en consola, nunca en pantalla. Iconografía de la casa (SVG de trazo, 45°), sin emoji.
 */
import { useEffect } from "react";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";

type Glyph = "alert" | "empty" | "offline" | "lock" | "pack" | "cards" | "team" | "trophy";

export function StateGlyph({ glyph, className }: { glyph: Glyph; className?: string }) {
  const paths: Record<Glyph, React.ReactNode> = {
    alert: <><path d="M12 3 22 20H2z" /><path d="M12 10v4M12 17v.5" /></>,
    empty: <><path d="M4 7h16v12H4z" /><path d="M4 7l3-4h10l3 4" /><path d="M9 12h6" /></>,
    offline: <><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><path d="M3 3l18 18" /></>,
    lock: <><path d="M6 11h12v10H6z" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></>,
    pack: <><path d="M6 3h12v18H6z" /><path d="M6 8h12M9 13l3-2 3 2-3 2z" /></>,
    cards: <><path d="M8 4h11v15H8z" /><path d="M5 7v13h11" /></>,
    team: <><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" /><path d="M12 8v8M8 10l8 4M16 10l-8 4" /></>,
    trophy: <><path d="M7 4h10v6a5 5 0 0 1-10 0z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 15v4M8 21h8" /></>,
  };
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter">
      {paths[glyph]}
    </svg>
  );
}

export interface StateAction { href?: string; onClick?: () => void; label: string }

function Actions({ primary, secondary }: { primary?: StateAction; secondary?: StateAction[] }) {
  if (!primary && !secondary?.length) return null;
  return (
    <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
      {primary && (primary.href !== undefined
        ? <NxButton variant="primary" size="lg" href={primary.href}>{primary.label}</NxButton>
        : <NxButton variant="primary" size="lg" onClick={primary.onClick}>{primary.label}</NxButton>)}
      {secondary?.map((a) => (a.href !== undefined
        ? <NxButton key={a.label} variant="secondary" size="lg" href={a.href}>{a.label}</NxButton>
        : <NxButton key={a.label} variant="secondary" size="lg" onClick={a.onClick}>{a.label}</NxButton>))}
    </div>
  );
}

const TONE_RGB = { key: "255,46,99", cyan: "25,227,255", gold: "255,211,92", warn: "255,176,61", neutral: "238,241,248" } as const;

export function GamePanelState({
  glyph, eyebrow, title, hint, primary, secondary, tone = "neutral", className, testId, role,
}: {
  glyph: Glyph;
  eyebrow?: string;
  title: string;
  hint?: string;
  primary?: StateAction;
  secondary?: StateAction[];
  tone?: keyof typeof TONE_RGB;
  className?: string;
  testId?: string;
  role?: "alert" | "status";
}) {
  const rgb = TONE_RGB[tone];
  return (
    <section
      role={role}
      data-testid={testId}
      className={cn("nx-clip relative isolate overflow-hidden border px-6 py-10 text-center sm:px-10 sm:py-12", className)}
      style={{ borderColor: `rgba(${rgb},0.28)`, background: `radial-gradient(70% 90% at 50% 0%, rgba(${rgb},0.12), transparent 70%), linear-gradient(180deg, rgba(17,19,31,0.92), rgba(8,9,16,0.96))` }}
    >
      <span className="mx-auto grid h-16 w-16 place-items-center" style={{ color: `rgb(${rgb})` }}>
        <StateGlyph glyph={glyph} className="h-11 w-11" />
      </span>
      {eyebrow && <p className="nx-label mt-3" style={{ color: `rgba(${rgb},0.9)` }}>{eyebrow}</p>}
      <p className="mt-2 font-display text-[clamp(22px,3vw,30px)] font-bold uppercase leading-tight tracking-[0.04em] text-white">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-white/60">{hint}</p>}
      <Actions primary={primary} secondary={secondary} />
    </section>
  );
}

/**
 * NO SE HA PODIDO CARGAR. `message` es la frase para el jugador (nunca un error crudo); `detail` —si llega— va a la
 * consola. Siempre ofrece volver al lobby.
 */
export function GameError({
  message, onRetry, detail, className, lobbyHref = "/",
}: {
  message?: string;
  onRetry?: () => void;
  detail?: unknown;
  className?: string;
  lobbyHref?: string;
}) {
  useEffect(() => {
    if (detail !== undefined) console.error("[nexus]", detail instanceof Error ? detail.message : detail);
  }, [detail]);
  return (
    <GamePanelState
      role="alert"
      testId="game-error"
      glyph="alert"
      tone="key"
      eyebrow="Algo ha fallado"
      title="No se ha podido cargar"
      hint={playerMessage(message)}
      primary={onRetry ? { label: "Reintentar", onClick: onRetry } : { label: "Volver al lobby", href: lobbyHref }}
      secondary={onRetry ? [{ label: "Volver al lobby", href: lobbyHref }] : undefined}
      className={className}
    />
  );
}

/**
 * Filtro de última línea: si a una pantalla se le escapa un texto técnico, el jugador ve una frase neutra.
 * La lista es la misma que vigila el verificador de copy.
 */
export const TECHNICAL_PATTERN = /(failed to fetch|networkerror|internal server error|http \d{3}|error \d{3}|status \d{3}|typeerror|syntaxerror|referenceerror|unexpected token|\bjson\b|pgrst|supabase|postgres|\bsql\b|stack trace|\bundefined\b|\bnull\b|\bNaN\b|econnrefused|aborterror|something went wrong|load failed|network connection|operation was aborted|\bjwt\b|permission denied|violates|check constraint|duplicate key|row-level security)/i;

export function playerMessage(message?: string | null): string {
  if (!message || TECHNICAL_PATTERN.test(message)) return "La conexión con el servidor ha fallado. Tu progreso está a salvo: vuelve a intentarlo en unos segundos.";
  return message;
}

export function GameEmpty({
  glyph = "empty", title, hint, primary, secondary, className, testId = "game-empty",
}: {
  glyph?: Glyph;
  title: string;
  hint?: string;
  primary?: StateAction;
  secondary?: StateAction[];
  className?: string;
  testId?: string;
}) {
  return <GamePanelState glyph={glyph} title={title} hint={hint} primary={primary} secondary={secondary} className={className} testId={testId} role="status" />;
}

/** Aviso sin conexión, coherente en todo el juego. No ofrece acciones que necesitan red. */
export function GameOffline({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div role="status" data-testid="game-offline" className={cn("nx-clip-sm flex items-center gap-3 border border-warn/40 bg-warn/[0.08] px-4", compact ? "py-2" : "py-3", className)}>
      <StateGlyph glyph="offline" className="h-5 w-5 shrink-0 text-warn" />
      <p className="text-[14px] leading-snug text-white/85">
        <b className="mr-2 font-display text-[14px] uppercase tracking-[0.12em] text-warn">Estás sin conexión</b>
        Los datos mostrados pueden estar desactualizados.
      </p>
    </div>
  );
}
