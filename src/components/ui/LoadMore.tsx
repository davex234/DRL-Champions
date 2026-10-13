"use client";

/**
 * PIE DE UNA LISTA QUE SE CARGA POR PÁGINAS (COLECCIONES ILIMITADAS).
 *
 * Un centinela invisible pide la página siguiente cuando entra en pantalla (scroll infinito) y, debajo, lo que el
 * jugador necesita ver según el estado: «cargando», el error con «Reintentar», o el botón «Ver más» (que también sirve
 * a quien navega con teclado o no tiene `IntersectionObserver`). Sin más páginas no pinta nada.
 */
import { NxButton } from "@/components/ui/NxButton";
import { useReachEnd } from "@/lib/game/useCardInstances";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

export interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onMore: () => void;
  onRetry: () => void;
  /** Cuántos elementos hay ya en pantalla y cuántos en total (si se sabe), para el texto de progreso. */
  shown?: number;
  total?: number | null;
  testId?: string;
}

export function LoadMore({ hasMore, loading, error, onMore, onRetry, shown, total, testId = "load-more" }: LoadMoreProps) {
  useLocale();
  const sentinel = useReachEnd(onMore, hasMore && !loading && !error);
  if (!hasMore && !loading && !error) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-2" data-testid={testId} data-state={error ? "error" : loading ? "loading" : "idle"}>
      <div ref={sentinel} aria-hidden className="h-px w-full" />
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-center gap-3 text-caption text-warn">
          <span>{error}</span>
          <NxButton variant="tertiary" size="md" onClick={onRetry} data-testid={`${testId}-retry`}>{t("Reintentar")}</NxButton>
        </div>
      ) : loading ? (
        <p role="status" aria-live="polite" className="text-caption text-ink-muted">{t("Cargando más…")}</p>
      ) : (
        <NxButton variant="tertiary" size="md" onClick={onMore} data-testid={`${testId}-button`}>
          {typeof total === "number" && typeof shown === "number" ? t("Ver más ({shown} de {total})", { shown, total }) : t("Ver más")}
        </NxButton>
      )}
    </div>
  );
}
