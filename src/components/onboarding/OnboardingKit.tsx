"use client";

/**
 * FASE 63 · ONBOARDING — PIEZAS COMUNES.
 *
 *   · `OnboardingPill`   «Tu inicio · 3/6» + seis marcas con su estado en TEXTO accesible (no solo color).
 *   · `OnboardingCoach`  el bloque de ayuda DENTRO de la pantalla real (colección, sobre, resultado, progreso). No flota
 *                         sobre la mano ni sobre los botones, no es un modal y no bloquea nada.
 *   · `OnboardingCta`    el botón del paso: enlace a la ruta real, o una ORDEN del servidor (`start`, `first-team`,
 *                         `finish`) con su estado de carga y su error legible. El cliente no concede nada.
 *   · `SkipTutorial`     «Saltar tutorial» con confirmación. Saltar no concede nada y no quita nada.
 *   · `TeamReady`        las diez cartas del equipo que ya existe en el servidor.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NxButton } from "@/components/ui/NxButton";
import { GameModal } from "@/components/ui/game/GameOverlay";
import { CardThumb } from "@/components/cards/CardThumb";
import { getCard } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import type { OnboardingNext, OnboardingView } from "@/domain/onboarding";
import { postOnboarding, OnboardingError, type OnboardingCommandResult } from "@/lib/onboarding/client";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("onboarding");

const STATE_TEXT = { done: "hecho", current: "ahora", next: "después" } as const;

export function OnboardingPill({ view, className }: { view: OnboardingView; className?: string }) {
  useLocale();
  const cur = view.steps.find((s) => s.current);
  return (
    <span className={cn("nx-f63-pill", className)} data-testid="onboarding-pill" aria-label={t("Tu inicio: paso {value} de {max}{v}", { value: view.progress.value, max: view.progress.max, v: cur ? `, ${cur.title}` : "" })}>
      <span aria-hidden>{t("Tu inicio ·")} {td(view.progress.label)}</span>
      <span className="nx-f63-dots" aria-hidden>
        {view.steps.map((s) => <span key={s.id} data-state={s.done ? "done" : s.current ? "current" : "next"} />)}
      </span>
    </span>
  );
}

/** Lista de pasos en texto (lectores de pantalla y la guía). */
export function OnboardingSteps({ view, className }: { view: OnboardingView; className?: string }) {
  useLocale();
  return (
    <ol className={cn("grid gap-1.5 sm:grid-cols-3", className)} aria-label={t("Pasos de tu inicio")} data-testid="onboarding-steps">
      {view.steps.map((s) => {
        const state = s.done ? "done" : s.current ? "current" : "next";
        return (
          <li key={s.id} data-step={s.id} data-state={state} aria-current={s.current ? "step" : undefined}
            className={cn("flex items-center gap-2 text-[12px]", s.done ? "text-ok" : s.current ? "text-white" : "text-white/45")}>
            <span className="nx-readout w-5 shrink-0 text-center">{s.done ? "✓" : s.index}</span>
            <span className="font-display font-bold uppercase tracking-[0.1em]">{td(s.title)}</span>
            <span className="sr-only">({td(STATE_TEXT[state])})</span>
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingCoach({
  view, title, children, actions, testId = "onboarding-coach", className,
}: {
  view: OnboardingView;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  useLocale();
  return (
    <aside aria-label={td(title)} data-testid={testId} data-step={view.current ?? "complete"} className={cn("nx-f63-coach nx-f63-rise px-4 py-4 sm:px-5", className)}>
      <OnboardingPill view={view} />
      <h2 className="mt-2 font-display text-[clamp(20px,2.6vw,26px)] font-extrabold uppercase leading-tight tracking-[0.03em] text-white">{td(title)}</h2>
      {children && <div className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-white/75">{children}</div>}
      {actions && <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{actions}</div>}
    </aside>
  );
}

/**
 * F68 · la pantalla en la que ya está el jugador. Un enlace a la MISMA ruta es un botón muerto (Next no vuelve a montar la
 * página): si el paso siguiente apunta aquí, el botón ejecuta `run` —la acción local equivalente— en vez de navegar.
 */
export interface OnboardingHere { href: string; run: () => void }

/** ¿El paso siguiente apunta a la pantalla actual? Compara la ruta sin query ni barra final. */
export function isSameRoute(href: string, here: OnboardingHere | undefined): boolean {
  if (!here) return false;
  const norm = (h: string) => h.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return norm(href) === norm(here.href);
}

/**
 * El botón del paso. Con `next.command` ejecuta la orden en el servidor y, si va bien, navega a `next.href` (salvo que
 * `onDone` se ocupe). Sin orden, es un enlace. `big` = el botón JUGAR del juego (misma pieza visual que F44).
 */
export function OnboardingCta({
  next, onDone, big = false, label, testId = "onboarding-cta", className, tone = "primary", here,
}: {
  next: OnboardingNext;
  onDone?: (r: OnboardingCommandResult) => void;
  /** F68 · la pantalla actual: si `next.href` es ella, el botón hace `here.run()` (p. ej. abrir otro sobre igual). */
  here?: OnboardingHere;
  big?: boolean;
  /** Papel del botón cuando no es el grande (`big`): el principal o una alternativa. */
  tone?: "primary" | "secondary";
  label?: string;
  testId?: string;
  className?: string;
}) {
  useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = label ?? next.cta;
  const run = useCallback(async () => {
    if (!next.command || busy) return;
    setBusy(true);
    setError(null);
    playSound("ui.confirm");
    try {
      const r = await postOnboarding(next.command);
      if (onDone) onDone(r);
      else router.push(next.href);
    } catch (e) {
      setError(e instanceof OnboardingError && e.status > 0 ? e.message : t("No se pudo completar. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }, [busy, next, onDone, router]);

  // El héroe JUGAR de F44 mide hasta 38 px: con «Abrir mi primer sobre» partía en dos líneas. La guía usa su propia escala.
  const cls = big ? "nx-play w-full sm:w-auto !text-[clamp(20px,2.3vw,28px)] sm:whitespace-nowrap" : undefined;
  return (
    <span className={cn("flex flex-col gap-1.5", big && "nx-play-wrap", className)}>
      {big && <span aria-hidden className="nx-play-halo" />}
      {next.command ? (
        big ? (
          <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={cls} data-size="hero" data-testid={testId} data-command={next.command}>
            {busy ? t("Un momento…") : td(text)}
          </button>
        ) : (
          <NxButton variant={tone} size="lg" onClick={run} disabled={busy} aria-busy={busy} data-testid={testId} data-command={next.command}>
            {busy ? t("Un momento…") : td(text)}
          </NxButton>
        )
      ) : isSameRoute(next.href, here) ? (
        <NxButton variant={big ? "primary" : tone} size="lg" onClick={() => { playSound("ui.confirm"); here!.run(); }} className={cls} data-testid={testId} data-here="">{td(text)}</NxButton>
      ) : big ? (
        <Link href={next.href} className={cls} data-size="hero" data-testid={testId} onClick={() => playSound("ui.confirm")}>{td(text)}</Link>
      ) : (
        <NxButton variant={tone} size="lg" href={next.href} data-testid={testId}>{td(text)}</NxButton>
      )}
      {error && <span role="alert" className="text-[13px] text-warn" data-testid="onboarding-error">{td(error)}</span>}
    </span>
  );
}

export function OnboardingSecondary({ next }: { next: OnboardingNext }) {
  useLocale();
  if (!next.secondary) return null;
  return <NxButton variant="secondary" size="lg" href={next.secondary.href} data-testid="onboarding-secondary">{td(next.secondary.label)}</NxButton>;
}

export function SkipTutorial({ onSkipped, className }: { onSkipped?: (r: OnboardingCommandResult) => void; className?: string }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  const skip = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postOnboarding("skip");
      setOpen(false);
      onSkipped?.(r);
    } catch {
      setError(t("No se pudo guardar. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="onboarding-skip"
        className={cn("nx-focus inline-flex min-h-[44px] items-center px-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/55 underline-offset-4 hover:text-white hover:underline", className)}>
        {t("Saltar tutorial")}
      </button>
      <GameModal
        open={open}
        onClose={close}
        eyebrow={t("Tu inicio")}
        title={t("¿Saltar el tutorial?")}
        testId="onboarding-skip-dialog"
        actions={<>
          <NxButton variant="secondary" size="md" onClick={close} data-autofocus>{t("Seguir con el tutorial")}</NxButton>
          <NxButton variant="primary" size="md" onClick={skip} disabled={busy} aria-busy={busy} data-testid="onboarding-skip-confirm">{busy ? t("Un momento…") : t("Saltar tutorial")}</NxButton>
        </>}
      >
        <p>{t("Tus sobres y tus créditos siguen en tu cuenta: no se pierde nada y no se recibe nada extra.")}</p>
        <p className="mt-2">{fill(t("Puedes repasarlo cuando quieras en {ruta}.", slots("ruta")), { ruta: <b className="text-white">{t("Más → Cómo jugar")}</b> })}</p>
        {error && <p role="alert" className="mt-2 text-warn">{td(error)}</p>}
      </GameModal>
    </>
  );
}

export function TeamReady({ cardIds, name, className }: { cardIds: readonly string[]; name: string; className?: string }) {
  useLocale();
  const cards = cardIds.map((id) => getCard(id)).filter((c): c is CardDef => !!c);
  if (cards.length === 0) return null;
  return (
    <figure className={cn("nx-f62-panel p-3", className)} data-testid="onboarding-team">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[15px] font-bold uppercase tracking-[0.1em] text-ok">{t("✓ Tu equipo")}</span>
        <span className="text-[12px] text-white/60">«{name}» · {cards.length} {t("cartas")}</span>
      </figcaption>
      <ul className="grid grid-cols-5 gap-1.5" aria-label={t("Las {length} cartas de tu equipo", { length: cards.length })}>
        {cards.map((c) => <li key={c.id} className="grid place-items-center"><CardThumb card={c} width={52} /></li>)}
      </ul>
    </figure>
  );
}
