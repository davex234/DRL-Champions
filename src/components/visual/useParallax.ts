"use client";

/**
 * PARALLAX DE ESCENARIO — compartido por el launcher y el vestíbulo.
 *
 * El escenario responde al ratón. La regla que lo mantiene a 60 fps: **React no se entera**.
 * El puntero escribe dos variables CSS (`--px`, `--py`) en el nodo raíz del hero, y las capas
 * del artwork las consumen desde su `transform`. Cero `setState`, cero re-render, cero layout.
 *
 * El movimiento se suaviza con una interpolación por fotograma (lerp) y el bucle se DETIENE
 * en cuanto el valor converge: un launcher no puede tener un `requestAnimationFrame` girando
 * en vacío mientras el usuario lee las noticias.
 */
import { useEffect, useRef } from "react";

export function useParallax<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  /** 0 = desactivado. 1 = recorrido completo. Lo decide la configuración del usuario. */
  strength: number,
): void {
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (strength <= 0) {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
      return;
    }

    const loop = () => {
      const c = current.current;
      const t = target.current;
      c.x += (t.x - c.x) * 0.09;
      c.y += (t.y - c.y) * 0.09;
      el.style.setProperty("--px", c.x.toFixed(4));
      el.style.setProperty("--py", c.y.toFixed(4));
      // Converge: se apaga el bucle y no se vuelve a encender hasta que el ratón se mueva.
      if (Math.abs(t.x - c.x) < 0.0015 && Math.abs(t.y - c.y) < 0.0015) {
        raf.current = null;
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (raf.current === null) raf.current = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      target.current = {
        x: ((e.clientX - r.left) / r.width - 0.5) * 2 * strength,
        y: ((e.clientY - r.top) / r.height - 0.5) * 2 * strength,
      };
      kick();
    };
    const onLeave = () => {
      target.current = { x: 0, y: 0 };
      kick();
    };

    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [ref, strength]);
}
