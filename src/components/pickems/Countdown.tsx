"use client";

/**
 * Cuenta atrás hasta el cierre de una predicción.
 *
 * ES SOLO UX. El reloj del navegador no decide nada: cuando llega a cero se
 * avisa al contenedor para que recargue, y es el SERVIDOR quien confirma si la
 * pregunta sigue abierta (`app_submit_pick` compara con `now()` de la base de
 * datos). Un usuario con el reloj atrasado seguirá recibiendo un 409.
 *
 * Fase 24.2: todas las cuentas atrás de la pantalla laten con UN solo reloj compartido
 * (`useNow`); antes cada una tenía su `setInterval`.
 */
import { useEffect, useRef } from "react";
import { useNow } from "@/lib/useNow";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export function formatRemaining(ms: number): string {
  if (ms <= 0) return t("Cerrada");
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}

export function Countdown({
  to,
  onExpire,
  className,
  prefix = t("Cierra en"),
}: {
  /** Instante de cierre (ISO). */
  to: string;
  /** Se llama una sola vez al llegar a cero, para que el contenedor recargue. */
  onExpire?: () => void;
  className?: string;
  prefix?: string;
}) {
  useLocale();
  const target = new Date(to).getTime();
  const now = useNow(1000);
  const remaining = now === 0 ? 1 : target - now;
  const fired = useRef(false);

  useEffect(() => {
    if (now === 0) return;
    if (target - now <= 0 && !fired.current) { fired.current = true; onExpire?.(); }
  }, [now, target, onExpire]);

  const urgent = remaining > 0 && remaining < 3600_000;

  return (
    <span className={className} title={new Date(to).toLocaleString(getIntlLocale())}>
      {remaining > 0 ? (
        <>{td(prefix)} <span className={urgent ? "text-drl" : undefined}>{formatRemaining(remaining)}</span></>
      ) : (
        t("Cerrada")
      )}
    </span>
  );
}
