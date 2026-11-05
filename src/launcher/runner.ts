/**
 * NEXUS LAUNCHER — RELOJ DE DESCARGAS.
 *
 * UN solo temporizador para toda la aplicación. No hay `setInterval` dentro de ningún
 * componente: los componentes se montan y desmontan al cambiar de pantalla, y una descarga
 * que se detiene porque el usuario ha entrado en Configuración no es una descarga.
 *
 * El reloj no sabe qué es un juego: solo entrega `dt`. Quién avanza los trabajos es el store,
 * y cómo avanzan es `download.ts`. Así la simulación sigue siendo pura y testeable.
 *
 * Se usa `setInterval` (no `requestAnimationFrame`) a propósito: rAF se congela cuando la
 * ventana pierde el foco y un gestor de descargas tiene que seguir bajando en segundo plano.
 */
export type TickFn = (dtMs: number, now: number) => void;

export class LauncherClock {
  private handle: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private cb: TickFn | null = null;

  constructor(private readonly intervalMs = 250) {}

  get running(): boolean {
    return this.handle !== null;
  }

  /** Arranca el bucle. Llamarlo dos veces no crea dos bucles. */
  start(cb: TickFn): void {
    this.cb = cb;
    if (this.handle !== null) return;
    this.last = Date.now();
    this.handle = setInterval(() => this.pulse(), this.intervalMs);
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
    this.cb = null;
  }

  /** Un pulso manual (lo usan los tests para avanzar sin esperar tiempo real). */
  pulse(now: number = Date.now()): void {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.cb?.(dt, now);
  }
}

/** Instancia compartida del launcher. */
export const launcherClock = new LauncherClock();
