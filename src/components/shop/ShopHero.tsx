"use client";

/**
 * ARMERÍA — LA VITRINA.
 *
 * ══════════════════════════ QUÉ ES ══════════════════════════
 *
 * El sobre que estás mirando, a tamaño de objeto, con todo lo que hace falta para decidir y
 * nada más. Contesta las siete preguntas de la tienda en un solo plano:
 *
 *   qué es · qué contiene · qué garantiza · cuánto cuesta · si te llega · cómo se compra
 *
 * ══════════════════════════ TRES DECISIONES ══════════════════════════
 *
 * **1. El precio va PEGADO al saldo.** Antes el precio estaba debajo del botón, al final de
 * la tarjeta: se decidía antes de saber lo que costaba. Aquí las dos cifras se leen juntas y
 * la resta la hace la pantalla, no el jugador.
 *
 * **2. La economía se consulta, no se grita.** El texto de orientación —el que dice cuántos
 * créditos cuesta una rara en este sobre— es dato REAL (`domain/packs/guidance`) y se queda,
 * porque la tienda no puede esconder lo que un sobre rinde. Pero vive detrás de un
 * desplegable: una tienda de videojuego no abre con una hoja de cálculo.
 *
 * **3. Un solo botón manda.** «Comprar y abrir» es la acción; «+1» —comprar sin abrir— es un
 * botón aparte CON etiqueta, no un signo suelto sin nombre accesible.
 *
 * No cambia ni una regla: precio, pesos, garantía y reparto salen de las recetas y de la
 * estadística medida, exactamente igual que antes.
 */
import { hexToRgbTriplet } from "@/design/environment";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import { BUCKET_LABEL } from "@/domain/packs/types";
import { packStats } from "@/data/packStats";
import { guidanceFor } from "@/domain/packs/guidance";
import { classOddsFor, tablePct } from "@/domain/packs/odds";
import { PACK_CLASS_COLOR } from "@/domain/packs/packClass";
import { SealedPack } from "@/components/packs/SealedPack";
import { packIdentity, teamCardCount } from "@/components/packs/packIdentity";
import { Stage, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { formatCredits, cn, plural } from "@/lib/format";
import { CreditGlyph } from "@/components/ui/game/GameGlyph";

/** Los cinco cubos de rareza, en orden. El color es el del sistema de cartas. */
const BUCKET_ORDER: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const BUCKET_COLOR: Record<RarityBucket, string> = {
  common: "#8b96a3",
  uncommon: "#ffce4f",
  rare: "#19e3ff",
  epic: "#ff2e63",
  legendary: "#ffd35c",
};

export function ShopHero({
  pack, owned, credits, busy, onBuyAndOpen, onBuyOnly,
}: {
  pack: PackDef;
  /** Sobres de ESTE tipo sin abrir. */
  owned: number;
  credits: number;
  busy: boolean;
  onBuyAndOpen: () => void;
  onBuyOnly: () => void;
}) {
  const [verDetalle, setVerDetalle] = useState(false);
  const reduced = useReducedMotion();

  /*
   * El reparto que se ENSEÑA es el MEDIDO (`data/packStats`), no el declarado: el Premium
   * declara un 30 % de comunes y entrega un 25,2 % porque la garantía ocupa una casilla.
   * Enseñar el peso declarado sería prometer una probabilidad que el sobre no cumple.
   */
  const stats = packStats(pack.id);
  const guidance = guidanceFor(pack.id);
  const totalWeight = BUCKET_ORDER.reduce((s, b) => s + pack.weights[b], 0);
  const share = (b: RarityBucket): number =>
    stats ? stats.drawn[b] : totalWeight > 0 ? pack.weights[b] / totalWeight : 0;

  // Fase 57.3 · línea principal: la tabla por clase (la que decide), no el reparto por rareza.
  const classOdds = classOddsFor(pack);
  const gratis = pack.price === 0;
  const alcanza = gratis || credits >= pack.price;
  const faltan = Math.max(0, pack.price - credits);

  return (
    <Stage tone="neutral" className="relative isolate overflow-hidden">
      {/* La luz del sobre. Un solo foco, del color del propio objeto. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: `radial-gradient(620px 420px at 26% 45%, ${pack.accent}26, transparent 68%)` }}
      />

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,300px)_1fr] lg:items-center lg:gap-9">
        {/*
          ── El objeto ──
          Se dibuja SIEMPRE a 216 px y se escala con la pantalla dentro de un contenedor de
          altura fija. En móvil, a tamaño completo, el precio y el botón caían por debajo del
          pliegue: el jugador veía un sobre precioso y tenía que desplazarse para saber si
          podía comprarlo. `transform` no ocupa espacio, de ahí la altura explícita.
        */}
        <div className="relative h-[236px] w-full sm:h-[300px] lg:h-[324px]">
          {/* Fase 44.1 · CÁMARA DE SOBRES: el sobre en su pedestal, bajo un cono de luz de su propio color. */}
          <span aria-hidden className="nx-vault-cone pointer-events-none absolute -top-8 left-1/2 -z-10 h-[115%] w-[300px] -translate-x-1/2" style={{ ["--vault-rgb" as string]: hexToRgbTriplet(pack.accent) }} />
          <svg aria-hidden viewBox="0 0 320 60" className="nx-vault-pedestal pointer-events-none absolute bottom-0 left-1/2 -z-10 hidden h-[54px] w-[270px] -translate-x-1/2 sm:block" style={{ ["--vault-rgb" as string]: hexToRgbTriplet(pack.accent) }}>
            <ellipse cx="160" cy="20" rx="140" ry="15" fill={`rgba(${hexToRgbTriplet(pack.accent)},0.10)`} stroke={`rgba(${hexToRgbTriplet(pack.accent)},0.7)`} strokeWidth="1.5" />
            <ellipse cx="160" cy="20" rx="96" ry="9" fill="none" stroke={`rgba(${hexToRgbTriplet(pack.accent)},0.3)`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center [perspective:900px]">
            {/*
              AL ELEGIR UN SOBRE, EL SOBRE LLEGA. La `key` es el `packId`: al cambiar de sobre
              la pieza se remonta y vuelve a entrar, así que seleccionar en el carril se siente
              como traer un objeto a la vitrina y no como cambiar el `src` de una imagen.
              Es medio segundo y no mueve nada de sitio (`transform` puro).
            */}
            {/*
              DOS NODOS, Y ES OBLIGATORIO QUE SEAN DOS. El de fuera lleva la escala por
              pantalla; el de dentro, la animación. framer-motion escribe la propiedad
              `transform` COMPLETA en línea, así que animar sobre el mismo nodo que lleva
              `scale-[0.68] sm:scale-90` borra esa escala — el sobre saldría a tamaño completo
              en un móvil. Es la misma trampa que `globals.css` ya documenta con `animate-rise`.
            */}
            <div
              className="origin-center scale-[0.68] transition-transform duration-normal ease-out sm:scale-90 lg:scale-100 motion-safe:hover:[transform:rotateY(-9deg)_rotateX(4deg)]"
              style={{ transformStyle: "preserve-3d" }}
            >
              <motion.div
                key={pack.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0.2 : 0.42, ease: [0.16, 1, 0.3, 1] }}
              >
                <SealedPack pack={pack} cutProgress={0} width={216} />
              </motion.div>
            </div>
          </div>
        </div>

        {/*
          ── La ficha ──
          En móvil el PRECIO y la ACCIÓN adelantan al reparto de rarezas: la pregunta de un
          jugador con el pulgar es «¿cuánto cuesta y puedo?», y el desglose se consulta
          después. En pantalla ancha caben las dos cosas y vuelve el orden natural.
        */}
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              La FAMILIA del producto, derivada del catálogo. El `tag` es una etiqueta curada y
              puede decir lo mismo («Equipo»), así que solo se enseña cuando aporta algo
              distinto — dos insignias con la misma palabra no son jerarquía, son ruido.
            */}
            <Badge tone="info">{packIdentity(pack).categoryLabel}</Badge>
            {pack.tag && pack.tag !== packIdentity(pack).categoryLabel && <Badge tone="gold">{pack.tag}</Badge>}
            <Badge tone="muted">{plural(pack.cardCount, "carta", "cartas")}</Badge>
            {classOdds
              ? classOdds.guarantee && <Badge tone="info">{classOdds.guarantee}</Badge>
              : pack.guaranteedMin && <Badge tone="info">{BUCKET_LABEL[pack.guaranteedMin]}+ garantizada</Badge>}
            {owned > 0 && <Badge tone="ok" dot>{owned} sin abrir</Badge>}
          </div>

          <h2 className="mt-2.5 font-display text-[clamp(26px,4vw,40px)] font-bold uppercase leading-none tracking-wide text-white">
            {pack.name}
          </h2>
          <p className="mt-2 max-w-lg text-body leading-relaxed text-ink-muted">{pack.description}</p>

          {/*
            ── SOBRE DE EQUIPO: LO QUE HAY DE VERDAD Y LO QUE NO SE PROMETE ──

            Las dos frases que este producto necesita, y las dos son comprobables:

            **Cuántas cartas del equipo existen.** Derivado del catálogo, no escrito a mano:
            Fnatic tiene 25 y Team Heretics 11, así que los dos sobres NO pueden comportarse
            igual y la tienda no debe insinuar que sí. Si entran cartas nuevas, la cifra cambia
            sola.

            **Que no hay garantía.** Es lo más importante que se puede decir aquí. El sobre
            repondera las cartas del equipo (pool persistido, peso medido), y reponderar no es
            garantizar: hay sobres que no traen ninguna. Decirlo antes de cobrar es la
            diferencia entre vender puntería y prometer un resultado.
          */}
          {pack.team && <TeamNote team={pack.team} />}

          {/* ── Qué sale de aquí ── */}
          {classOdds ? (
            <div className="order-2 mt-5 lg:order-1">
              <p className="mb-1.5 font-display text-label uppercase tracking-wide2 text-ink-faint">Clase de cada carta · media</p>
              <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Reparto por clase del sobre">
                {classOdds.rows.map((r) => (
                  <div key={r.cls} title={`${r.label}: ${tablePct(r.perCard)}`} style={{ width: `${r.perCard * 100}%`, background: PACK_CLASS_COLOR[r.cls] }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {classOdds.rows.map((r) => (
                  <li key={r.cls} className="flex items-center gap-1.5 text-caption text-ink-muted">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: PACK_CLASS_COLOR[r.cls] }} />
                    {r.label}
                    <span className="nx-readout text-ink-secondary">{tablePct(r.perCard)}</span>
                  </li>
                ))}
              </ul>
              {/* Icon por sobre (2026-10-09): la misma frase que la ficha, del plan que sortea el servidor. */}
              {classOdds.icon && <p className="mt-2 text-caption font-bold text-white" data-icon-text>{classOdds.icon.text}</p>}
            </div>
          ) : (
          <div className="order-2 mt-5 lg:order-1">
            <p className="mb-1.5 font-display text-label uppercase tracking-wide2 text-ink-faint">
              {stats ? "Reparto real" : "Probabilidades"}
            </p>
            <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Reparto de rarezas del sobre">
              {BUCKET_ORDER.map((b) =>
                share(b) > 0 ? (
                  <div
                    key={b}
                    title={`${BUCKET_LABEL[b]}: ${(share(b) * 100).toFixed(1)} %`}
                    style={{ width: `${share(b) * 100}%`, background: BUCKET_COLOR[b] }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {BUCKET_ORDER.filter((b) => share(b) > 0).map((b) => (
                <li key={b} className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[b] }} />
                  {BUCKET_LABEL[b]}
                  <span className="nx-readout text-ink-secondary">{(share(b) * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
          )}

          {/* ── Precio, saldo y acción ── */}
          <div className="order-1 mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 lg:order-2 lg:mt-6">
            <Readout
              size="md"
              label="Precio"
              value={gratis ? "Gratis" : formatCredits(pack.price)}
              unit={gratis ? undefined : "créditos"}
              tone={gratis ? "var(--nx-ok)" : "var(--nx-gold)"}
            />
            <Readout
              size="sm"
              label="Tu saldo"
              value={formatCredits(credits)}
              tone={alcanza ? "var(--nx-ink-secondary)" : "var(--nx-bad)"}
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <NxButton
                variant="primary"
                size="lg"
                onClick={onBuyAndOpen}
                disabled={busy || (owned === 0 && !alcanza)}
              >
                {busy ? "Procesando…" : owned > 0 ? "Abrir sobre" : gratis ? "Conseguir y abrir" : "Comprar y abrir"}
              </NxButton>
              {!gratis && (
                <NxButton
                  variant="secondary"
                  size="lg"
                  onClick={onBuyOnly}
                  disabled={busy || !alcanza}
                  aria-label={`Comprar ${pack.name} sin abrirlo`}
                >
                  Comprar sin abrir
                </NxButton>
              )}
            </div>
          </div>

          {/* Por qué no se puede: se dice, no se deja el botón apagado sin explicación. */}
          {!alcanza && owned === 0 && (
            <p className="order-1 mt-3 text-caption text-warn lg:order-2">
              Te faltan <span className="nx-readout">{formatCredits(faltan)}</span> créditos para este sobre.
            </p>
          )}

          {/*
            LA ECONOMÍA, A PETICIÓN. Es dato medido y no se esconde, pero no abre la tienda:
            quien quiera saber cuánto le cuesta una rara aquí, lo despliega.
          */}
          {guidance && (
            <div className="order-3 mt-3 lg:mt-4">
              <button
                type="button"
                onClick={() => setVerDetalle((v) => !v)}
                aria-expanded={verDetalle}
                className="nx-focus inline-flex min-h-[44px] items-center gap-1.5 font-display text-label uppercase tracking-wide2 text-ink-muted transition-colors hover:text-white"
              >
                Para qué sirve este sobre
                <span aria-hidden className={cn("transition-transform duration-fast", verDetalle && "rotate-180")}>▾</span>
              </button>
              {verDetalle && (
                <Recessed className="mt-1 p-3.5">
                  <p className="text-caption leading-relaxed text-ink-secondary">{guidance.headline}</p>
                  {guidance.warnings.map((w) => (
                    <p key={w} className="mt-1.5 text-caption leading-relaxed text-drl-gold/80">{w}</p>
                  ))}
                  {typeof guidance.costPerRarity.rare === "number" && (
                    <p className="mt-2 font-display text-label uppercase tracking-wide2 text-ink-faint">
                      Rara ≈ <CreditGlyph className="align-[-2px]" /> {formatCredits(Math.round(guidance.costPerRarity.rare))} por carta
                    </p>
                  )}
                </Recessed>
              )}
            </div>
          )}
        </div>
      </div>
    </Stage>
  );
}

/**
 * LA NOTA DEL SOBRE DE EQUIPO.
 *
 * Tres datos y ninguno escrito a mano:
 *
 *   · cuántas cartas del equipo hay en el catálogo (`teamCardCount`, derivado),
 *   · de qué rarezas son —porque si el equipo no tiene ninguna épica, el sesgo no puede
 *     alcanzar a las épicas y el jugador merece saberlo antes de pagar—,
 *   · que **no hay garantía**.
 *
 * Lo último es lo que convierte esto en una nota honesta en vez de un reclamo. El sobre
 * repondera (pool persistido, peso medido con el motor real); reponderar no es garantizar.
 */
function TeamNote({ team }: { team: string }) {
  const { total, porRareza } = teamCardCount(team);
  const conCartas = BUCKET_ORDER.filter((b) => (porRareza[b] ?? 0) > 0);

  return (
    <Recessed className="mt-3 max-w-lg p-3">
      <p className="text-caption leading-relaxed text-ink-secondary">
        <b className="nx-readout text-white">{total}</b> cartas de{" "}
        <b className="text-white">{team}</b> pueden salir de este sobre, y son{" "}
        <b className="text-white">más probables</b> que el resto — pero{" "}
        <b className="text-white">no están garantizadas</b>: hay sobres que no traen ninguna.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {conCartas.map((b) => (
          <li key={b} className="flex items-center gap-1.5 text-caption text-ink-muted">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[b] }} />
            {BUCKET_LABEL[b]}
            <span className="nx-readout text-ink-secondary">{porRareza[b]}</span>
          </li>
        ))}
      </ul>
      {/*
        Si al equipo le faltan rarezas, se DICE. Es el mismo criterio que ya aplica
        `domain/packs/guidance` con las rarezas imposibles: una ausencia que el jugador
        descubriría pagando es una promesa falsa por omisión.
      */}
      {conCartas.length < BUCKET_ORDER.length && (
        <p className="mt-2 text-caption leading-snug text-warn">
          {team} no tiene cartas{" "}
          {BUCKET_ORDER.filter((b) => !conCartas.includes(b)).map((b) => BUCKET_LABEL[b].toLowerCase()).join(" ni ")}
          : en esas rarezas el sobre reparte como un regional normal.
        </p>
      )}
    </Recessed>
  );
}
