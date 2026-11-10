"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { Player, PlayerStats, VariantDef } from "@/domain/cards/types";
import { STAT_META, STAT_ORDER } from "@/domain/cards/ovr";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { PlayerPhoto } from "./layers/PlayerPhoto";
import { TeamLogo } from "./layers/TeamLogo";
import { Flag } from "./layers/Flag";
import { SerialBadge } from "./layers/SerialBadge";
import { VariantSeal } from "./layers/VariantSeal";
import { CardEffects } from "./CardEffects";
import { variantIdentity } from "@/design/variantIdentity";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

export type CardSize = "sm" | "md" | "lg" | "xl";

/**
 * EL CHAFLÁN DE LA CARTA, por tamaño.
 *
 * `nx-clip` —el corte que llevan todas las placas de NEXUS— usa `var(--nx-chamfer)`, que vale
 * 18 px en todo el producto. Sobre una carta de 150 px eso se come la esquina entera. Se fija
 * localmente a ~7 % del ancho: la misma GEOMETRÍA que el sobre y el tablero, a la escala de
 * este objeto.
 */
export const CHAMFER: Record<CardSize, string> = {
  sm: "11px",
  md: "16px",
  lg: "21px",
  xl: "25px",
};

/** Grosor del canto (el filo metálico entre el borde y la superficie). */
const CANTO: Record<CardSize, string> = {
  sm: "2px",
  md: "3px",
  lg: "3px",
  xl: "4px",
};

export const SIZE_W: Record<CardSize, string> = {
  sm: "w-[150px]",
  md: "w-[230px]",
  lg: "w-[300px]",
  xl: "w-[360px]",
};

const OVR_SIZE: Record<CardSize, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
  xl: "text-6xl",
};

const NAME_SIZE: Record<CardSize, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl",
};

/**
 * Renderizador de cartas por CAPAS (el motor visual del juego):
 * canto + superficie + foto + material de rareza + OVR + placa de datos + serial + nombre.
 *
 * ────────────────────────── LA CARTA COMO OBJETO ──────────────────────────
 *
 * La auditoría dejó una comparación incómoda: **el sobre sellado parecía un objeto físico y la
 * carta que salía de él, no.** El sobre tiene chaflán, troquel, canto y luz; la carta era un
 * `rounded-2xl` con `border-2`. Era el único objeto del juego que no hablaba el idioma del
 * juego.
 *
 * Ahora la carta se construye como las demás piezas de NEXUS, de fuera adentro:
 *
 *     CANTO       chaflán `nx-clip` + degradado metálico  ← el filo del objeto
 *      SUPERFICIE  el tapete de la carta, hundido dentro del canto
 *       MATERIAL    la capa de rareza (`CardEffects`)
 *        PLACA       bloque de datos hundido, con su filo
 *
 * ────────────────────────── LA PLACA, Y POR QUÉ EXISTE ──────────────────────────
 *
 * No es decoración: es lo que arregla un P0. El nick y las estadísticas se pintan en BLANCO, y
 * hay paletas casi blancas —`icon`, `champion`— sobre las que el blanco desaparece. Medido en
 * la auditoría: **la carta más rara del juego era la menos legible**, y encima llevaba el
 * brillo del puntero y el holo por delante.
 *
 * La placa garantiza el contraste con INDEPENDENCIA de la paleta, porque es opaca y oscura, y
 * de paso da a la carta el escalón de profundidad que le faltaba. Es la misma respuesta a dos
 * problemas: legibilidad y materia.
 */
export function CardRenderer({
  player,
  variant,
  stats,
  ovr,
  serial,
  size = "md",
  interactive = true,
  showStats = true,
  effects,
  className,
}: {
  player: Player;
  variant: VariantDef;
  stats: PlayerStats;
  ovr: number;
  serial?: number;
  size?: CardSize;
  interactive?: boolean;
  showStats?: boolean;
  /** Activa efectos caros (partículas/rayos). Por defecto en tamaños grandes. */
  effects?: boolean;
  className?: string;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const palette = variant.palette;
  const rich = effects ?? (size === "lg" || size === "xl");
  const showLogo = size !== "sm";
  /*
   * Las estadísticas se enseñan TAMBIÉN en el tamaño pequeño, en una tira compacta.
   * Ocultarlas dejaba un tercio inferior vacío en la rejilla de la colección —el sitio
   * donde más cartas se ven a la vez— y hacía que la carta pareciera sin terminar. Son
   * además el dato que se compara al construir un mazo.
   */
  const showCardStats = showStats;
  const compactStats = size === "sm";

  /*
   * QUÉ RECONOCE ESTA CARTA. Presentación pura: `variantIdentity` no decide qué variante
   * tiene una carta, solo cómo se dibuja la que el dominio ya decidió.
   */
  const identidad = variantIdentity(variant.id);
  /*
   * El medallón es lo PRIMERO que tiene que verse, así que se dimensiona como se dimensiona
   * el OVR, no como un icono. A 11 px —el primer intento— no se registraba: había que
   * acercarse a la pantalla para saber si una carta llevaba sello.
   */
  const sealSize = size === "sm" ? 15 : size === "md" ? 20 : 24;

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotX = useSpring(useTransform(my, [-0.5, 0.5], [11, -11]), { stiffness: 200, damping: 18 });
  const rotY = useSpring(useTransform(mx, [-0.5, 0.5], [-13, 13]), { stiffness: 200, damping: 18 });
  const shineX = useTransform(mx, [-0.5, 0.5], ["0%", "100%"]);
  const shineY = useTransform(my, [-0.5, 0.5], ["0%", "100%"]);
  const shineBg = useTransform(
    [shineX, shineY],
    ([x, y]: string[]) =>
      `radial-gradient(circle at ${x} ${y}, rgba(255,255,255,0.4), transparent 45%)`,
  );

  function onMove(e: React.PointerEvent) {
    if (!interactive || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
  }

  const isHolo = variant.rank >= 6;

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={interactive ? { rotateX: rotX, rotateY: rotY, transformPerspective: 900 } : undefined}
      className={cn("relative select-none", SIZE_W[size], className)}
    >
      {/* Halo exterior para alta rareza */}
      {isHolo && (
        <div
          className="nx-clip absolute -inset-2 -z-10 opacity-60 blur-xl"
          style={{ background: palette.primary, ["--nx-chamfer" as string]: CHAMFER[size] }}
        />
      )}

      {/*
        EL CANTO. El filo del objeto: un anillo metálico más claro que la superficie que
        encierra, chaflanado con la misma geometría que el sobre y el tablero. Es lo que hace
        que la carta tenga BORDE y no solo contorno.
      */}
      <div
        data-card-frame
        className="nx-clip relative aspect-[5/7] shadow-card"
        style={{
          ["--nx-chamfer" as string]: CHAMFER[size],
          padding: CANTO[size],
          background: `linear-gradient(150deg, ${palette.secondary} 0%, ${palette.primary} 38%, ${palette.primary}88 62%, ${palette.primary} 100%)`,
        }}
      >
        {/*
          MICROGRAFÍA DEL CANTO — solo en cartas de torneo.

          Responde a «¿cuáles son especiales?» antes que a «¿cuál es cuál?», y lo hace con
          TEXTURA, no con color: un rayado fino sobre el filo metálico. A tamaño de rejilla no
          se lee como un patrón, se lee como que el canto está TRABAJADO — que es justo la
          diferencia entre una pieza de serie y una conmemorativa.
        */}
        {identidad.tournament && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.4) 0 1px, rgba(0,0,0,0.22) 1px 2.6px)",
              maskImage: "linear-gradient(180deg, #000 0 12%, transparent 12% 88%, #000 88% 100%)",
              WebkitMaskImage: "linear-gradient(180deg, #000 0 12%, transparent 12% 88%, #000 88% 100%)",
            }}
          />
        )}
        {/* LA SUPERFICIE, hundida dentro del canto. */}
        <div
          className="nx-clip relative h-full w-full overflow-hidden"
          style={{
            ["--nx-chamfer" as string]: `calc(${CHAMFER[size]} - ${CANTO[size]})`,
            background: palette.background,
            color: palette.text,
            /* La sombra que proyecta el canto sobre la superficie: el escalón de profundidad. */
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.12)",
          }}
        >
        {/* CAPA: foto del jugador */}
        <div className="absolute inset-x-0 bottom-[30%] top-[6%]">
          <div className="relative mx-auto h-full w-[88%]">
            <PlayerPhoto player={player} palette={palette} rank={variant.rank} rich={rich} />
          </div>
        </div>

        {/* Degradado inferior para legibilidad del texto */}
        <div
          className="absolute inset-x-0 bottom-0 h-[46%]"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.15) 55%, transparent)" }}
        />

        {/* CAPA: material de rareza. `density` decide si se anima o se queda quieto. */}
        <CardEffects variant={variant} density={rich ? "detail" : "grid"} />

        {/*
          CAPA: brillo dinámico que sigue al puntero.

          Enmascarado para que MUERA antes de llegar a la placa de datos. Antes cubría la
          carta entera al 50 % de opacidad, y sobre las paletas claras (`icon`, `champion`)
          era una de las tres capas que borraban el nick.
        */}
        {interactive && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.38]"
            style={{
              background: shineBg,
              maskImage: "linear-gradient(to top, transparent 34%, black 52%)",
              WebkitMaskImage: "linear-gradient(to top, transparent 34%, black 52%)",
            }}
          />
        )}

        {/* CAPA: columna izquierda — OVR · rol · bandera · logo */}
        <div className="absolute left-0 top-0 z-10 flex flex-col items-center gap-1 px-2.5 py-2">
          {/*
            El OVR se pinta con `palette.text`, que en las paletas claras es oscuro y en las
            oscuras claro — ahí no había problema. Lo que sí lo había es que quedaba sobre la
            foto o sobre el material, sin nada detrás. Un velo local del color de fondo le da
            asiento sin teñirlo ni cambiar su color.
          */}
          <span
            aria-hidden
            className="pointer-events-none absolute -left-2 -top-2 h-[120%] w-[190%] -z-10"
            style={{ background: `radial-gradient(60% 60% at 22% 18%, ${palette.background.includes("gradient") ? "rgba(0,0,0,0.34)" : palette.background}, transparent 72%)` }}
          />
          <span className={cn("font-display font-bold leading-none", OVR_SIZE[size])} style={{ textShadow: "0 1px 5px rgba(0,0,0,0.45)" }}>{ovr}</span>
          <span className="font-display text-[10px] font-semibold uppercase tracking-wider opacity-85">
            {td(ROLE_ABBR[player.role]) ?? td(player.role)}
          </span>
          <Flag iso={player.country} width={size === "sm" ? 18 : 24} />
          {showLogo && <TeamLogo team={player.team} size={size === "lg" || size === "xl" ? 30 : 24} />}
        </div>

        {/*
          LA PROCEDENCIA — medallón de variante y número de serie, apilados.

          Los dos dicen lo mismo desde ángulos distintos: QUÉ reconoce esta carta y CUÁNTAS
          hay. Juntos en la esquina se leen como una marca de acuñación; separados eran un
          icono suelto y un chip suelto.

          El medallón va aquí y no solo en la placa porque en la placa no se veía: a 11 px
          junto a una etiqueta de 10 px no registraba, y la prueba de «¿cuál es Champion
          Edition?» seguía fallando. Aquí es lo segundo que se mira después del OVR.
        */}
        {(identidad.seal || (variant.serialized && serial != null)) && (
          <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
            {identidad.seal && (
              <span
                className="nx-clip-sm flex items-center gap-1 px-1.5 py-1"
                style={{
                  ["--nx-chamfer-sm" as string]: "5px",
                  background: "rgba(6,8,14,0.88)",
                  color: palette.secondary,
                  boxShadow: `inset 0 0 0 1px ${palette.primary}aa, 0 1px 6px rgba(0,0,0,0.5)`,
                }}
              >
                <VariantSeal shape={identidad.seal} size={sealSize} label={td(identidad.sealLabel)} />
                {/*
                  El código, SOLO en la familia TOP. Es lo que evita cinco diseños distintos
                  para lo que conceptualmente es una sola cosa: el galón dice «esto es una
                  TOP» y dos letras dicen cuál. En las demás familias el sello ya es único.
                */}
                {identidad.code && (
                  <span
                    className="font-display font-bold leading-none tracking-tight"
                    style={{ fontSize: size === "sm" ? 9 : size === "md" ? 11 : 13 }}
                  >
                    {identidad.code}
                  </span>
                )}
              </span>
            )}
            {variant.serialized && serial != null && (
              <SerialBadge
                serial={serial}
                limit={variant.serialLimit ?? 0}
                palette={palette}
                size={size === "sm" ? "sm" : "md"}
              />
            )}
          </div>
        )}

        {/*
          LA PLACA DE DATOS — nombre, variante y estadísticas, sobre superficie propia.

          Es opaca y oscura A PROPÓSITO, y no depende de la paleta. El texto de este bloque se
          pinta en blanco, y hay paletas casi blancas (`icon`, `champion`) sobre las que el
          blanco no existe: la carta más rara del juego era la menos legible, y encima llevaba
          el brillo del puntero y el holo por delante. Con la placa, el contraste está
          garantizado para las 37 variantes y para cualquiera que se añada.

          Y es, a la vez, el escalón de profundidad que le faltaba a la carta: filo oscuro
          arriba, filo claro abajo — la misma placa hundida que usan el tablero y el sobre.
        */}
        <div
          className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-3"
          style={{
            background: "linear-gradient(180deg, rgba(6,8,14,0) 0%, rgba(6,8,14,0.78) 26%, rgba(6,8,14,0.93) 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
          }}
        >
          {/* Filo de la placa, con el color de la variante: la une al canto. */}
          <div className="mb-1.5 h-px w-full opacity-70" style={{ background: palette.primary }} />
          <p
            className={cn(
              "truncate text-center font-display font-bold uppercase leading-none tracking-wide text-white",
              NAME_SIZE[size],
            )}
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}
          >
            {player.nick}
          </p>
          {/*
            El NOMBRE de la variante, sin sello: el sello vive en el medallón de la esquina y
            repetirlo aquí marcaba el mismo dato dos veces en una carta de 150 px. El nombre
            confirma para quien lee; el medallón identifica para quien solo mira.
          */}
          <p
            className="mt-0.5 truncate text-center font-display text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: palette.secondary }}
          >
            {td(variant.label)}
          </p>

          {showCardStats && (compactStats ? (
            /*
              En tamaño pequeño, BARRAS en vez de cifras.
              Son seis estadísticas: seis números con su etiqueta no caben en una carta de
              150 px —la primera versión se salía por los bordes— y, aunque cupieran, seis
              cifras diminutas no se leen en una rejilla: son ruido. Un perfil de barras sí
              se compara de un vistazo, que es justo lo que se hace al mirar la colección.
              Las cifras exactas están en la carta grande y en el detalle.
            */
            <div className="mt-1.5 flex h-4 items-end justify-center gap-[3px]" aria-hidden>
              {STAT_ORDER.map((key) => (
                <span
                  key={key}
                  title={`${STAT_META[key].label} ${stats[key]}`}
                  className="w-[7px] rounded-[1px] bg-white/85"
                  style={{ height: `${Math.max(12, Math.min(100, stats[key]))}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
              {STAT_ORDER.map((key) => (
                <div key={key} className="flex items-center justify-between text-[11px] text-white">
                  <span className="font-semibold opacity-75">{td(STAT_META[key].label)}</span>
                  <span className="font-display font-bold tabular-nums">{stats[key]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        </div>
      </div>
    </motion.div>
  );
}
