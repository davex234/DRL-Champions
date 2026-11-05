"use client";

/**
 * UN SOLO RELOJ PARA TODAS LAS CUENTAS ATRÁS (Fase 24.2).
 *
 * Antes cada `Countdown` montaba su propio `setInterval`: doce preguntas abiertas eran doce
 * temporizadores despertando al segundo. Aquí hay UN temporizador compartido por módulo que
 * solo corre mientras alguien lo escucha, y todos los suscriptores leen el mismo «ahora».
 *
 * Es SOLO presentación. El reloj del navegador no decide si una predicción entra: eso lo
 * hace `app_submit_pick` con el `now()` de la base de datos. Esto apaga botones y pinta
 * etiquetas; nada más.
 */
import { useEffect, useState } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function start(): void {
  if (timer) return;
  timer = setInterval(() => {
    current = Date.now();
    for (const l of listeners) l();
  }, 1000);
}

function stop(): void {
  if (timer && listeners.size === 0) { clearInterval(timer); timer = null; }
}

/**
 * El instante actual, refrescado una vez por segundo mientras el componente esté montado.
 *
 * `step` en milisegundos: con 60_000 el componente solo se vuelve a pintar cuando cambia el
 * minuto, aunque el reloj compartido siga latiendo al segundo para los demás.
 */
export function useNow(step = 1000): number {
  /*
   * Arranca con el reloj del sistema, también fuera del navegador: las piezas que lo usan
   * solo se montan tras cargar datos en cliente, así que no hay HTML de servidor que pueda
   * discrepar; y un render estático (QA) enseña una cuenta atrás real, no «0 s».
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let last = Math.floor(Date.now() / step);
    const onTick = () => {
      const bucket = Math.floor(current / step);
      if (bucket !== last) { last = bucket; setNow(current); }
    };
    listeners.add(onTick);
    start();
    setNow(Date.now());
    return () => { listeners.delete(onTick); stop(); };
  }, [step]);

  return now;
}
