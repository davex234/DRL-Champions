"use client";

/**
 * ESCENARIO INMERSIVO — sacar una pantalla del marco de la aplicación sin sacarla de la app.
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * `GameShell` mete todo dentro de `main.mx-auto.max-w-[1480px].px-4.pb-28.pt-6`. Está bien
 * para una colección o una tienda: son documentos. Un partido no lo es. Metido ahí, el mapa
 * quedaba en un `aspect-video` con márgenes, y debajo colgaban el deck de control, el panel
 * de estadísticas y la tira de jugadores — de modo que dirigir una ronda consistía en mirar
 * una franja del centro de la pantalla y bajar a buscar los botones.
 *
 * ────────────────────────── LAS DOS INMERSIONES ──────────────────────────
 *
 * **1. Fullscreen-like (siempre).** Rompe el ancho máximo y los márgenes del `main` con
 * `100vw` y se ancla a la altura del viewport menos la barra superior. No pide permiso a
 * nadie, funciona en todos los navegadores y es lo que garantiza que la experiencia sea la
 * misma aunque el fullscreen real no se conceda.
 *
 * **2. Fullscreen real (si el navegador quiere).** Un control que llama a la Fullscreen API.
 * Es una mejora, no un requisito: si la API no existe, si el navegador la deniega o si estamos
 * en un iframe sin permiso, el botón no se enseña y la inmersión de arriba sigue en pie.
 *
 * Esa separación es deliberada. Un modo que solo se siente bien en fullscreen real es un modo
 * que se siente mal en la mitad de los navegadores.
 *
 * ────────────────────────── POR QUÉ `100vw` Y NO `100%` ──────────────────────────
 *
 * Porque `100%` sería el ancho del `main`, que es justo lo que hay que escapar. El truco es
 * el clásico —ancho de viewport y margen negativo de la mitad de la diferencia— calculado en
 * CSS puro para que no dependa de medir nada en JavaScript y no parpadee al hidratar.
 *
 * `100vw` incluye la barra de desplazamiento. Se descuenta con `calc(100vw - (100vw - 100%))`,
 * que es exactamente el ancho del contenedor cuando no hay barra y lo compensa cuando la hay.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CHROME } from "@/design/tokens";
import { cn } from "@/lib/format";

/** Alto de la barra superior. Del token, no copiado: si cambia allí, cambia aquí solo. */
const BARRA = CHROME.topBar;

interface Documento extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}
interface Elemento extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

/** ¿Está el documento en pantalla completa de verdad? */
const enPantallaCompleta = (): boolean => {
  if (typeof document === "undefined") return false;
  const d = document as Documento;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
};

export interface ImmersiveStageProps {
  children: ReactNode;
  /**
   * La barra de acción, siempre visible al pie. Va aquí y no dentro de `children` porque su
   * razón de ser es no moverse: es el sitio donde el jugador sabe que está lo que toca hacer.
   */
  footer?: ReactNode;
  /** Cabecera fija: marcador, ronda, estado. */
  header?: ReactNode;
  className?: string;
  /** Etiqueta de la región para quien navega sin ver. */
  label?: string;
}

export function ImmersiveStage({ children, footer, header, className, label }: ImmersiveStageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  /*
   * El soporte se comprueba en el CLIENTE, después de montar. Hacerlo durante el render
   * daría un HTML de servidor distinto al del navegador —el servidor no tiene `document`— y
   * React lo marcaría como error de hidratación.
   */
  const [soportado, setSoportado] = useState(false);

  useEffect(() => {
    const el = ref.current as Elemento | null;
    setSoportado(Boolean(el && (el.requestFullscreen ?? el.webkitRequestFullscreen)));
    const sync = () => setCompleta(enPantallaCompleta());
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const alternar = useCallback(async () => {
    const el = ref.current as Elemento | null;
    if (!el) return;
    try {
      if (enPantallaCompleta()) {
        const d = document as Documento;
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      /*
       * Denegado. No es un error que contar: la inmersión de CSS sigue puesta y la pantalla
       * se ve igual. Avisar de esto sería avisar de que una mejora opcional no se aplicó.
       */
    }
  }, []);

  return (
    <section
      ref={ref}
      aria-label={label}
      data-immersive={completa ? "full" : "like"}
      /*
       * Los márgenes negativos cancelan el relleno vertical del `main` de `GameShell`
       * (`pt-6 pb-28 md:pb-12`). Sin ellos sobran entre 70 y 130 px por debajo del escenario
       * y la página gana una barra de desplazamiento para no enseñar nada: exactamente el
       * «scroll vertical innecesario» que el encargo prohíbe.
       */
      className={cn("relative isolate flex flex-col bg-[#05070c] -mt-6 -mb-28 md:-mb-12", className)}
      style={
        completa
          ? { width: "100%", height: "100vh" }
          : {
              // Escapar del `main`: ancho de viewport, centrado con margen negativo.
              width: "calc(100vw - (100vw - 100%))",
              marginLeft: "calc(50% - 50vw + ((100vw - 100%) / 2))",
              /*
               * ALTO FIJO, no mínimo.
               *
               * Con `min-height` el escenario crecía con su contenido: la sala táctica medía
               * 1.813 px, el `overflow-y-auto` de dentro no llegaba a activarse nunca —su
               * padre no tenía altura que respetar— y la barra de acción acababa a 1.816 px
               * del borde superior, es decir, otra vez «baja a buscar el botón».
               *
               * Fijando la altura, el contenido tiene que caber: lo que sobra se desplaza
               * DENTRO del escenario y la cabecera y el pie no se mueven de la pantalla.
               */
              height: `calc(100svh - ${BARRA}px)`,
            }
      }
    >
      {header && (
        <div className="relative z-20 shrink-0 border-b border-white/8 bg-[#070a10]/85 backdrop-blur-sm">
          {header}
        </div>
      )}

      {/* El contenido crece hasta llenar lo que quede: es lo que hace que el mapa domine. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>

      {footer && (
        <div className="relative z-20 shrink-0 border-t border-white/8 bg-[#070a10]/90 backdrop-blur-sm">
          {footer}
        </div>
      )}

      {/*
        El control de pantalla completa. Solo aparece si el navegador puede darla — un botón
        que no hace nada es peor que no tener botón.
      */}
      {soportado && (
        <button
          type="button"
          onClick={alternar}
          aria-pressed={completa}
          title={completa ? "Salir de pantalla completa" : "Pantalla completa"}
          className="nx-focus absolute right-2 top-2 z-30 grid h-11 w-11 place-items-center rounded-md border border-white/12 bg-black/45 text-white/60 backdrop-blur-sm transition hover:text-white"
        >
          <span className="sr-only">{completa ? "Salir de pantalla completa" : "Pantalla completa"}</span>
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            {completa ? (
              <path d="M6 1.5v4.5H1.5M10 14.5V10h4.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M1.5 6V1.5H6M10 1.5h4.5V6M14.5 10v4.5H10M6 14.5H1.5V10" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}
    </section>
  );
}
