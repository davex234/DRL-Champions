"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import type { PackDef } from "@/domain/packs/types";
import { packIdentity } from "./packIdentity";
import { PackSigil } from "./PackSigil";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("packs");

/**
 * EL SOBRE SELLADO — el objeto que se compra y se abre.
 *
 * Un sobre de cromos es papel metalizado. Eso es lo que hay que dibujar, y se puede hacer
 * entero con degradados: no hace falta ni una imagen ni una petición de red.
 *
 * LAS CAPAS, y qué aporta cada una:
 *
 *   1. **Cuerpo metalizado.** Tres degradados cruzados en vez de uno plano. Un solo
 *      degradado se lee como «fondo de caja»; tres cruzados se leen como material.
 *   2. **Bandas de foil.** Franjas diagonales de bajo contraste que rompen la superficie.
 *      Son lo que hace que la luz «tenga por dónde correr».
 *   3. **Reflejo especular.** Una banda que barre. Se apaga durante el corte, porque un
 *      reflejo alegre mientras rasgas el sobre pelea con la tensión.
 *   4. **Troquel central.** El sigilo angular de NEXUS, calado sobre el foil.
 *   5. **Costura perforada.** La línea por la que se rasga, con su troquelado.
 *   6. **Carga.** La costura se ENCIENDE conforme arrastras. Es la realimentación que
 *      convierte un gesto en una ceremonia: ves que estás a punto de conseguirlo.
 *   7. **Cantoneras.** Marcas de troquel en las esquinas. Solo de `premium` hacia arriba.
 *
 * `cutProgress` (0-1) gobierna 3, 5, 6 y el levantamiento de la solapa.
 *
 * ────────────────────────── UNA FAMILIA, CUATRO ESCALONES ──────────────────────────
 *
 * Antes los doce sobres del catálogo se distinguían en UNA variable: su color. El Inicial
 * (gratis) y el Icon (20.000 créditos) eran el mismo objeto pintado de otro tono, así que la
 * tienda tenía que explicar con texto lo que el objeto no decía.
 *
 * Ahora la GEOMETRÍA es común —el chaflán, el sigilo hexagonal, la costura— y cambian el
 * material y el acabado: densidad de foil, anillos del troquel, barrido, resplandor y
 * cantoneras. El escalón lo decide `packIdentity` a partir de la garantía que el catálogo ya
 * declara; aquí no se escribe ni una regla por `packId`.
 *
 * COSTE. Todo es CSS y un SVG. El único bucle es el reflejo, y se detiene en cuanto empieza
 * el corte. Con `prefers-reduced-motion` no hay ninguno.
 */
/**
 * FASE 57 · el borde dentado del rasgado, en % del sobre: la costura (`flapPct`) con dientes irregulares pero
 * DETERMINISTAS (mismos siempre: nada de azar en la presentación).
 */
export function tornEdge(flapPct: number, teeth = 14): string {
  const pts: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * 100;
    const y = flapPct + (i % 2 === 0 ? 0 : 1.6 + ((i * 7) % 5) * 0.35);
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")}, 100% 100%, 0% 100%)`;
}

export function SealedPack({
  pack,
  cutProgress,
  width = 260,
  ceremony = false,
  torn = false,
  reducedOverride,
}: {
  /**
   * El sobre del catálogo. De aquí sale TODO: nombre, acento, escalón, categoría, símbolo y
   * artwork. Recibir el `PackDef` y no parámetros sueltos es lo que hace imposible dibujar un
   * sobre a medias — antes llegaban `accent` y `name`, y ninguna pantalla le contaba la
   * garantía, que es justo lo que da el escalón.
   */
  pack: Pick<PackDef, "id" | "name" | "accent" | "guaranteedMin" | "team" | "eventId" | "price" | "restrictRegion">;
  cutProgress: number;
  /** Ancho en px. La tienda lo usa a escala reducida; la ceremonia, a tamaño completo. */
  width?: number;
  /**
   * FASE 57 · CEREMONIA. El sobre es el ASSET: sin caja, sin chaflán por `clip-path`, sin sombra rectangular; la
   * profundidad va por `drop-shadow` sobre la silueta del propio arte y el halo es luz radial, no un rectángulo borroso.
   */
  ceremony?: boolean;
  /** FASE 57 · la solapa ya se arrancó: el cuerpo se recorta por la costura con borde dentado y sale luz de dentro. */
  torn?: boolean;
  /**
   * APERTURA 2026-10-15 · el movimiento ya decidido por la ceremonia (sistema + «Animaciones de apertura»). Sin él, el del
   * sistema (la tienda, como siempre).
   */
  reducedOverride?: boolean;
}) {
  useLocale();
  const systemReduced = useReducedMotion();
  const reduced = reducedOverride ?? systemReduced;
  const id = packIdentity(pack);
  /*
   * Un id de degradado por instancia. La tienda dibuja dieciséis sobres a la vez y dos `<defs>`
   * con el mismo id se pisan: ganaría el primero del documento y los demás heredarían su
   * color. `useId` lo hace único sin que el llamante tenga que pensarlo.
   */
  const gradId = `nxpack-${useId().replace(/:/g, "")}`;
  const accent = pack.accent;
  const opened = cutProgress > 0.001;
  const height = Math.round(width * (380 / 260));
  const flap = Math.round(height * 0.175);

  // Escala tipográfica atada al ancho: el mismo objeto sirve a 40 px en el carril y a 272 en
  // la ceremonia sin que el texto se descoloque.
  const k = width / 260;
  /*
   * ¿HAY ARTWORK DEFINITIVO PARA ESTE SOBRE? (Fase 20.1)
   *
   * Cambia QUIÉN dibuja el objeto. El asset entregado es la cara COMPLETA del sobre —silueta,
   * material, foil, troquel, marca y placa con el nombre—, así que cuando existe hay que
   * APAGAR la decoración procedimental: superponerle el foil, las cantoneras y la banda del
   * nombre daría dos objetos pintados uno encima del otro.
   *
   * Lo que NO se apaga es la estructura que hace que el sobre se abra: costura, carga y
   * solapa. Van fuera de esta decisión para que la ceremonia de la Fase 19 funcione igual
   * lleve artwork o no — y el asset reserva esa zona por convención (`public/packs/README`).
   */
  const conArte = !!id.artwork;
  /* Fase 57 · la ceremonia pinta el asset tal cual (silueta + drop-shadow). La tienda sigue igual. */
  const asset = ceremony && conArte;
  const flapPct = (flap / height) * 100;

  return (
    <div className="relative" style={{ width, height, transformStyle: "preserve-3d" }}>
      {/* Resplandor de fondo. Crece con el corte: la energía «sale» del sobre. En ceremonia es luz radial. */}
      {ceremony ? (
        <div
          aria-hidden
          className="absolute -inset-[30%] -z-10 transition-opacity duration-normal"
          style={{ background: `radial-gradient(closest-side, ${accent}, transparent)`, opacity: Math.min(0.75, id.bloom + 0.18 + cutProgress * 0.4) }}
        />
      ) : (
      <div
        className="absolute -inset-8 -z-10 rounded-[40px] blur-3xl transition-opacity duration-normal"
        style={{ background: accent, opacity: id.bloom + cutProgress * 0.4 }}
      />
      )}

      {/* ── Cuerpo ── */}
      <div
        className={cn("absolute inset-0", asset ? "" : "nx-clip overflow-hidden shadow-card", !conArte && "border-2")}
        data-pack-body
        style={{
          ...(asset ? { filter: "drop-shadow(0 26px 30px rgba(0,0,0,0.65))" } : {}),
          // Con arte, el recorte va en la IMAGEN (abajo): recortar este nodo recortaría también su drop-shadow y
          // dejaría ver la sombra de la caja como un rectángulo oscuro. Sin arte, el cuerpo dibujado se recorta aquí.
          ...(torn && !asset ? { clipPath: tornEdge(flapPct) } : {}),
          ...(conArte
            ? {}
            : {
                borderColor: accent,
                // Tres degradados cruzados: metal, no fondo de caja.
                background: `
            linear-gradient(160deg, ${accent}26 0%, transparent 38%),
            radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.10), transparent 60%),
            linear-gradient(180deg, #171a2b 0%, #080a12 55%, #12141f 100%)`,
              }),
          ["--nx-chamfer" as string]: `${Math.round(20 * k)}px`,
        }}
      >
        {/* Decoración procedimental: solo cuando el arte todavía no ha llegado. */}
        {!conArte && (<>
        {/* Bandas de foil. Su densidad es el primer indicador del escalón del sobre. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            opacity: Math.min(0.85, 0.55 * id.foil),
            backgroundImage: `repeating-linear-gradient(115deg, ${accent}00 0px, ${accent}14 2px, ${accent}00 9px, ${accent}00 26px)`,
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-25" />

        {/* Franja de acento diagonal, detrás del troquel. */}
        <div
          aria-hidden
          className="absolute -inset-x-10 top-[46%] h-24 -translate-y-1/2 -rotate-12 opacity-25 blur-md"
          style={{ background: accent }}
        />

        {/* Reflejo especular. Solo de `premium` arriba: un sobre base es mate. */}
        {!reduced && !opened && id.sweep && (
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-1/3 -skew-x-12"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
            }}
            animate={{ x: ["-150%", "350%"] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
          />
        )}

        {/*
          CANTONERAS. Cuatro marcas de troquel en las esquinas. Es el detalle que hace que el
          objeto se lea como una pieza acuñada y no como un rectángulo con degradado, y por eso
          solo la llevan los escalones que representan algo.
        */}
        {id.corners &&
          ([
            ["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"],
          ] as const).map(([v, h]) => {
            /*
             * Longhands, NUNCA el atajo `borderTop: "1px solid x"`. React avisa (y con razón)
             * cuando en un mismo elemento se mezclan atajo y propiedad concreta del mismo
             * valor: cuál gana depende del orden de actualización, así que el canto puede
             * quedarse sin pintar en un rerender. Es el aviso que la consola del arnés cazó.
             */
            const grosor = Math.max(1, 1.5 * k);
            const vProp = v === "top" ? "borderTop" : "borderBottom";
            const hProp = h === "left" ? "borderLeft" : "borderRight";
            return (
              <span
                key={`${v}-${h}`}
                aria-hidden
                className="absolute"
                style={{
                  [v]: 7 * k, [h]: 7 * k,
                  width: 14 * k, height: 14 * k,
                  [`${vProp}Width`]: grosor, [`${vProp}Style`]: "solid", [`${vProp}Color`]: `${accent}aa`,
                  [`${hProp}Width`]: grosor, [`${hProp}Style`]: "solid", [`${hProp}Color`]: `${accent}aa`,
                } as React.CSSProperties}
              />
            );
          })}
        </>)}

        {/*
          ── LA CARA IMPRESA ──

          Si el artwork definitivo de ESTE sobre ya está en el repositorio, es lo que se
          imprime. Si no, se dibuja: troquel, marca y categoría. El dibujado NO es un marcador
          de posición —es el objeto que el juego enseña hoy— y por eso tiene identidad propia
          por producto en vez de ser un rectángulo esperando una imagen.

          La estructura (costura, solapa, carga) queda FUERA de esta decisión a propósito: es
          lo que hace que el sobre se abra, y tiene que seguir abriéndose igual lleve artwork o
          no. Un artwork que tuviera que incluir su propia solapa animada obligaría a recortar
          cada fichero por la costura.
        */}
        {id.artwork ? (
          <img
            src={id.artwork}
            alt=""
            /* Las medidas de la convención (`data/packArtwork`): 3× el objeto, proporción 13:19. */
            width={780}
            height={1140}
            draggable={false}
            className={cn("absolute inset-0 h-full w-full select-none", asset ? "object-contain" : "object-cover")}
            style={torn && asset ? { clipPath: tornEdge(flapPct) } : undefined}
            data-pack-art
          />
        ) : (
          <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: flap + 22 * k }}>
            {/*
              EL TROQUEL. El símbolo lo decide la CATEGORÍA del producto y el material su
              ESCALÓN: por eso un Champions y un Icon comparten acabado sin confundirse, y un
              Team Pack lleva el escudo con las siglas reales del equipo.
            */}
            <PackSigil
              kind={id.sigil}
              accent={accent}
              monogram={id.monogram}
              rings={id.rings}
              rich={id.richSigil}
              gradientId={gradId}
              style={{ width: 88 * k, height: 88 * k }}
            />

            <p
              className="mt-1.5 font-display font-bold uppercase text-white"
              style={{ fontSize: 21 * k, letterSpacing: `${0.28 * k}em`, textIndent: `${0.28 * k}em` }}
            >
              {t("Nexus")}
            </p>
            {/*
              LA CATEGORÍA, no «Valorant Cards». El subtítulo de marca era el mismo en los
              dieciséis sobres, así que no distinguía nada; la clase de producto sí —«Equipo»,
              «Evento», «Bienvenida»— y sale derivada del catálogo.
            */}
            <p
              className="font-display uppercase"
              style={{
                fontSize: 8.5 * k,
                letterSpacing: `${0.34 * k}em`,
                textIndent: `${0.34 * k}em`,
                color: `${accent}b0`,
              }}
            >
              {td(id.categoryLabel)}
            </p>
          </div>
        )}

        {/*
          ── Banda inferior con el nombre del sobre ──
          Con arte entregado no se pinta: el asset ya lleva su placa con el nombre y el código,
          y superponer otra banda dejaría el nombre escrito dos veces.
        */}
        {!conArte && (
        <div
          className="absolute inset-x-0 bottom-0 border-t px-4 py-3 text-center"
          style={{ borderColor: `${accent}44`, background: `linear-gradient(0deg, ${accent}22, transparent)` }}
        >
          <p
            className="font-display font-bold uppercase"
            style={{ color: accent, fontSize: 14 * k, letterSpacing: `${0.14 * k}em` }}
          >
            {td(pack.name)}
          </p>
        </div>
        )}
      </div>

      {/*
        ── Costura perforada ──
        La línea por la que se rasga EXISTE antes de rasgar. Si solo apareciera al empezar el
        corte, el sobre no diría por dónde se abre y el gesto sería adivinanza.
      */}
      <div
        aria-hidden
        className="absolute left-3 right-3 z-floating"
        style={{
          top: flap,
          height: 2,
          background: `repeating-linear-gradient(90deg, ${accent}66 0 6px, transparent 6px 12px)`,
          // Con arte entregado el asset ya lleva su costura troquelada: pintar otra encima
          // dejaba dos líneas paralelas a un par de píxeles.
          opacity: opened || conArte ? 0 : 0.8,
        }}
      />

      {/* Fase 57 · rasgado: luz que sale de DENTRO por la boca del sobre (color del sobre, nunca de una rareza). */}
      {torn && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[4%] z-floating"
          data-pack-mouth
          style={{ top: flap - Math.round(18 * k), height: Math.round(40 * k), background: `radial-gradient(60% 50% at 50% 60%, #ffffff, ${accent} 45%, transparent 75%)`, opacity: 0.85 }}
        />
      )}

      {/* Carga: la costura se enciende de izquierda a derecha conforme arrastras. */}
      <motion.div
        aria-hidden
        className="absolute left-3 right-3 z-floating origin-left"
        style={{
          top: flap - 1,
          height: 4,
          background: `linear-gradient(90deg, #fff, ${accent})`,
          boxShadow: `0 0 20px #fff, 0 0 36px ${accent}`,
          scaleX: cutProgress,
          opacity: opened ? 1 : 0,
        }}
      />

      {/*
        ── Solapa superior, que se levanta al cortar ──

        CON ARTE ENTREGADO es el RECORTE SUPERIOR DEL PROPIO ASSET, no una placa dibujada: se
        pinta el mismo fichero a tamaño completo y anclado arriba, así que la solapa ES la zona
        de sellado impresa. Y está invisible mientras el sobre está cerrado —sin borde, sin
        degradado— porque ahí ya la está enseñando el asset de debajo; aparece solo cuando
        empieza a girar.

        Antes se dibujaba siempre con su propio borde de acento y su degradado, y sobre un
        sobre con artwork eso pintaba un segundo objeto perfilado encima del primero: se veía
        un rectángulo brillante de más en la zona del sellado.
      */}
      {!torn && (
      <motion.div
        className={cn("absolute inset-x-0 top-0 z-surface overflow-hidden", !conArte && "border-2")}
        style={{
          height: flap,
          /*
           * Longhands por lado, no `borderColor` + `borderBottom: "none"`. Esa mezcla de
           * atajo y propiedad concreta hacía que React avisara en CADA rerender del corte
           * («don't mix shorthand and non-shorthand properties»), porque la solapa se
           * repinta con `cutProgress`. El resultado visual es el mismo: tres cantos.
           */
          ...(conArte
            ? {
                backgroundImage: `url(${id.artwork})`,
                backgroundSize: `${width}px ${height}px`,
                backgroundPosition: "top center",
                backgroundRepeat: "no-repeat",
                // Cerrada no se ve: la zona de sellado que hay debajo es la misma imagen.
                opacity: opened ? 1 : 0,
              }
            : {
                borderTopColor: accent,
                borderLeftColor: accent,
                borderRightColor: accent,
                borderBottomWidth: 0,
                background: `linear-gradient(160deg, #1e2233 0%, #0a0c16 100%)`,
              }),
          transformOrigin: "top center",
          transformPerspective: 700,
          rotateX: -160 * cutProgress,
          clipPath: `polygon(0 0, calc(100% - ${Math.round(20 * k)}px) 0, 100% ${Math.round(20 * k)}px, 100% 100%, 0 100%)`,
        }}
      >
        {/* La textura de la solapa solo se dibuja si no la trae impresa el asset. */}
        {!conArte && (<>
          <div aria-hidden className="absolute inset-0 bg-grid opacity-30" />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              opacity: Math.min(0.8, 0.5 * id.foil),
              backgroundImage: `repeating-linear-gradient(115deg, ${accent}00 0px, ${accent}14 2px, ${accent}00 9px, ${accent}00 26px)`,
            }}
          />
        </>)}
      </motion.div>
      )}
    </div>
  );
}
