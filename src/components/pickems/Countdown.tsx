"use client";

/**
 * Cuenta atrás hasta el cierre de una predicción.
 *
 * ES SOLO UX. El reloj del navegador no decide nada: cuando llega a cero se
 * avisa al contenedor para que recargue, y es el SERVIDOR quien confirma si la
 * pregunta sigue abierta (`app_submit_pick` compara con `now()` de la base de
 * datos). Un usuario con el reloj atrasado seguirá recibiendo un 409.
 */
import { useEffect, useState } from "react";

function format(ms: number): string {
  if (ms <= 0) return "Cerrada";
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
}: {
  /** Instante de cierre (ISO). */
  to: string;
  /** Se llama una sola vez al llegar a cero, para que el contenedor recargue. */
  onExpire?: () => void;
  className?: string;
}) {
  const target = new Date(to).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    if (target - Date.now() <= 0) return;
    // Cada segundo si queda menos de una hora; cada minuto si queda más. No tiene
    // sentido re-renderizar 60 veces por minuto una cuenta atrás de tres días.
    const near = target - Date.now() < 3600_000;
    const id = setInterval(() => {
      const left = target - Date.now();
      setRemaining(left);
      if (left <= 0) { clearInterval(id); onExpire?.(); }
    }, near ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [target, onExpire]);

  const urgent = remaining > 0 && remaining < 3600_000;

  return (
    <span className={className} title={new Date(to).toLocaleString("es-ES")}>
      {remaining > 0 ? (
        <>Cierra en <span className={urgent ? "text-drl" : undefined}>{format(remaining)}</span></>
      ) : (
        "Cerrada"
      )}
    </span>
  );
}
