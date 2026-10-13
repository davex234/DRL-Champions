"use client";

/**
 * RETRATO DE AGENTE — la pieza de identidad para las superficies de interfaz (Fase 48).
 *
 * ────────────────────────── LA REGLA QUE ORDENA ESTE COMPONENTE ──────────────────────────
 *
 * **Arte en la interfaz; sigilos en el mapa.** Esto NO se usa sobre el tablero, y no es un
 * olvido: a 20 px, encima de un mapa con flechas, zonas y humos, una cara es una mancha
 * marrón y un sigilo sigue siendo una marca. La pizarra se queda con `AgentEmblem`.
 *
 * ────────────────────────── EL RESPALDO NO ES UN ERROR ──────────────────────────
 *
 * Mientras no haya arte producido, esto dibuja el SIGILO del agente dentro del mismo marco,
 * sobre un velo del acento propio del agente. No es una imagen rota, ni un cuadrado gris, ni
 * un gradiente con iniciales: es la identidad que el producto YA tiene, presentada bien.
 *
 * Y el camino de vuelta está abierto: publicar `/agents/veil/portrait.webp` y añadir
 * `"portrait"` a su `published` en `visuals.ts` hace que este mismo componente lo enseñe. Ni
 * una línea de las pantallas cambia.
 *
 * ────────────────────────── DOS DETALLES QUE PARECEN MENORES Y NO LO SON ──────────────────────────
 *
 * **1 · No se pide la imagen «por si acaso».** El manifiesto dice qué existe, así que con cero
 * arte publicado se hacen CERO peticiones. Es lo contrario de lo que pasa con las fotos de
 * jugador, donde cada carta pide un PNG que no está: diez agentes en un roster serían diez
 * 404 por render. Aun así queda el `onError` como segunda red, por si un fichero declarado
 * desaparece del despliegue.
 *
 * **2 · El anillo depende de la forma del hueco.** En una caja cuadrada —el roster, las tiras,
 * el panel de Presentar— el sigilo va CON su anillo de clase, porque ahí es una ficha y el
 * anillo es lo que la convierte en una. En una caja alta de retrato el anillo pelearía con el
 * marco, así que va desnudo y grande. Así el respaldo no empeora ninguna pantalla respecto a
 * lo que ya había.
 */
import { useEffect, useState } from "react";
import { agentArt, agentVisual, AGENT_ART_CONTRACT, type AgentArtVariant } from "@/agents/visuals";
import { AgentEmblem, AGENT_CLASS_LABEL } from "./AgentEmblem";
import { cn } from "@/lib/format";

/** Piezas que ya se sabe que faltan, recordadas durante esta sesión (una petición, no veinte). */
const ausentes = new Set<string>();

export function AgentPortrait({
  agentId,
  variant = "portrait",
  /**
   * Altura de la caja en píxeles, o `"fill"` para que ocupe el ancho disponible y saque la
   * altura de la proporción del contrato. `"fill"` es lo que usan los cinco huecos: así el
   * retrato crece con la columna sin que ninguna pantalla calcule píxeles.
   */
  size = 96,
  className,
  /**
   * El nombre y la clase los pone la pantalla, no el arte. Con `decorative` el retrato no se
   * anuncia a los lectores de pantalla porque el texto de al lado ya lo dice.
   */
  decorative = false,
}: {
  agentId: string;
  variant?: AgentArtVariant;
  size?: number | "fill";
  className?: string;
  decorative?: boolean;
}) {
  const visual = agentVisual(agentId);
  const src = agentArt(agentId, variant);
  const [falla, setFalla] = useState(() => (src ? ausentes.has(src) : false));

  useEffect(() => { setFalla(src ? ausentes.has(src) : false); }, [src]);

  const spec = AGENT_ART_CONTRACT[variant];
  const accent = visual?.accent ?? "#9aa4bf";
  const etiqueta = visual ? `${visual.name} · ${AGENT_CLASS_LABEL[visual.class]}` : agentId;
  /* Un hueco cuadrado es una FICHA: el sigilo va con anillo. Uno alto es un marco: va desnudo. */
  const ficha = spec.aspect === 1;

  /*
   * La caja se reserva SIEMPRE con la proporción del contrato, haya arte o no. Es lo que
   * impide el salto cuando las piezas lleguen: el hueco ya mide lo que va a medir.
   */
  const caja: React.CSSProperties = size === "fill"
    ? { width: "100%", aspectRatio: `${spec.width} / ${spec.height}` }
    : { width: Math.round(size * spec.aspect), height: size };

  return (
    <span
      data-testid="agent-portrait"
      data-agent={agentId}
      data-variant={variant}
      /* Para el QA: dice si lo que se está viendo es arte o el sigilo, sin mirar píxeles. */
      data-art={src && !falla ? "image" : "glyph"}
      className={cn("relative block shrink-0 overflow-hidden", className)}
      style={caja}
    >
      {src && !falla ? (
        <img
          src={src}
          alt={decorative ? "" : etiqueta}
          width={spec.width}
          height={spec.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => { ausentes.add(src); setFalla(true); }}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <span
          /*
            El nombre lo dice el SIGILO, que ya es un `role="img"` con su etiqueta. Poner otra
            aquí encima haría que un lector de pantalla anunciara «Warden · Centinela» dos
            veces seguidas. Y cuando la pantalla ya escribe el nombre al lado, `aria-hidden`
            en el envoltorio calla todo lo de dentro, sigilo incluido.
          */
          aria-hidden={decorative || undefined}
          className="absolute inset-0 grid place-items-center"
          style={{
            /* Un velo del acento del agente: lo justo para que cinco huecos no sean cinco cajas iguales. */
            background: ficha
              ? undefined
              : `radial-gradient(118% 88% at 50% 22%, ${accent}26 0%, ${accent}0f 46%, transparent 76%)`,
          }}
        >
          <AgentEmblem agentId={agentId} size={ficha ? "100%" : "62%"} plain={!ficha} />
        </span>
      )}
    </span>
  );
}

/**
 * ¿Hay arte de verdad para este agente en esta variante?
 *
 * Lo usan las pantallas que quieran repartir el espacio distinto según haya retrato o no, sin
 * repetir la lógica del manifiesto.
 */
export const hasAgentArt = (agentId: string, variant: AgentArtVariant = "portrait"): boolean =>
  agentArt(agentId, variant) !== null;
