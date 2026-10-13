"use client";

/**
 * CARTA EN VISTA DE DUELO (Fase 8).
 *
 * Reutiliza la identidad visual que ya existe —la paleta de la variante (`getVariant`) y la capa de
 * retrato con sigilo de reserva (`PlayerPhoto`)— y cambia solo lo que el duelo necesita: en vez de las
 * seis estadísticas de colección, el TRÍO DE COMBATE, que es lo único que se compara.
 *
 * Los números vienen del servidor dentro del DTO. Aquí no se calcula ni se ajusta ninguno.
 */
import { memo, useEffect, useState } from "react";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { PlayerPhoto } from "@/components/cards/layers/PlayerPhoto";
import { useArtworkStore } from "@/store/useArtworkStore";
import { debePintarArtwork } from "@/components/cards/CardVisual";
import { STAT_INFO, type CombatStatKey, type DuelDeckCardDTO, type RivalCardHint } from "@/lib/duel/types";
import { hintPresentation } from "@/lib/duel/hintDisplay";
import { CardArt } from "@/components/cards/CardArt";
import { RoleMark } from "./RoleMark";
import type { RoleId } from "@/domain/cards/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export type DuelCardSize = "xs" | "sm" | "md" | "lg";

const WIDTH: Record<DuelCardSize, string> = {
  xs: "w-[54px]",
  sm: "w-[84px]",
  md: "w-[116px]",
  lg: "w-[168px]",
};
const OVR_SIZE: Record<DuelCardSize, string> = {
  xs: "text-[13px]",
  sm: "text-xl",
  md: "text-[26px]",
  lg: "text-4xl",
};
/*
 * F71 · EL TRÍO DE COMBATE SE LEE. En la carta del duelo (`lg`) las cifras eran de 11 px sobre una
 * carta de ~190: es con lo que se juega y había que acercarse a la pantalla. Crecen con la carta;
 * los valores son los mismos del DTO, no se recalcula nada.
 */
const TRIO_ABBR: Record<DuelCardSize, string> = {
  xs: "text-[7px]",
  sm: "text-[7px]",
  md: "text-[8px]",
  lg: "text-[10px]",
};
const TRIO_VALUE: Record<DuelCardSize, string> = {
  xs: "text-[11px]",
  sm: "text-[11px]",
  md: "text-[13px]",
  lg: "text-[17px]",
};
const NAME_SIZE: Record<DuelCardSize, string> = {
  xs: "text-[7px]",
  sm: "text-[10px]",
  md: "text-[13px]",
  lg: "text-lg",
};

export interface DuelCardProps {
  card: DuelDeckCardDTO;
  size?: DuelCardSize;
  /** Resalta la estadística declarada en este enfrentamiento. */
  highlightStat?: CombatStatKey | null;
  selected?: boolean;
  /** Ya jugada: se apaga y deja de ser elegible. */
  used?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  /**
   * Halo sobre la SILUETA de la carta (color del bando en el duelo, por ejemplo). Solo en la carta
   * diseñada: es `drop-shadow` sobre el asset, nunca una caja alrededor.
   */
  glow?: string | null;
  /**
   * F71.2 · sin el trío SH/GS/EF externo (la mesa central del duelo lo enseña en los paneles laterales). No toca
   * el arte ni las seis estadísticas impresas de la carta: solo quita la fila de combate que añade la interfaz.
   */
  hideCombat?: boolean;
}

function DuelCardBase({
  card, size = "md", highlightStat = null, selected = false, used = false, disabled = false,
  onClick, className, glow = null, hideCombat = false,
}: DuelCardProps) {
  useLocale();
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  const palette = variant.palette;
  const showStats = size !== "xs" && !hideCombat;
  const interactive = Boolean(onClick) && !disabled && !used;

  /*
   * ────────────────────── EL ARTWORK MANUAL, DEBAJO DEL CROMO ──────────────────────
   *
   * Aquí NO se sustituye la cara de la carta, como sí se hace en la colección. Se sustituye
   * la CAPA DE ARTE: el artwork ocupa el fondo y encima siguen el OVR, el nombre y el trío de
   * combate, exactamente donde estaban.
   *
   * Es una decisión de juego, no de estilo. En el duelo la carta no es un objeto que se
   * admira: es el control con el que se elige, y esa elección se hace leyendo los tres
   * números. Taparlos con un fichero de 750×1050 encogido a 84 px habría quitado la
   * información con la que se juega — y eso no es un cambio visual, es un cambio de reglas.
   *
   * El degradado inferior que ya existía sigue garantizando que los números se lean sobre
   * cualquier arte, igual que los garantizaba sobre cualquier foto.
   *
   * Las cartas del RIVAL —y las del bot, cuyos `uid` son sintéticos— no están en el mapa: el
   * cliente solo conoce sus propios ejemplares. Caen al dibujado de siempre, que es lo
   * correcto: adivinar la versión del rival sería justo el cruce entre versiones prohibido.
   */
  const artwork = useArtworkStore((s) => s.byUid[card.uid]);
  const [artworkFalló, setArtworkFalló] = useState(false);
  // La MISMA decisión que usa la colección, no una copia parecida: si algún día cambia lo que
  // cuenta como artwork pintable, cambia en los dos sitios a la vez.
  /*
   * CATÁLOGO DISEÑADO (2026-09-21): la imagen de la carta es del CATÁLOGO, no del ejemplar —la
   * misma para todos—, así que sirve también para las cartas del rival sin cruzar versiones.
   * Va como capa de arte: el trío de combate sigue encima, que es con lo que se juega.
   */
  const imagenCatalogo = getCard(card.cardId)?.image ?? null;
  const artworkUrl = debePintarArtwork(artwork, artworkFalló)
    ? artwork!.url
    : imagenCatalogo && !artworkFalló ? imagenCatalogo : null;
  useEffect(() => { setArtworkFalló(false); }, [artwork?.url, imagenCatalogo]);

  /*
   * FASE 50 · LA CARTA DISEÑADA YA TRAE SU CROMO IMPRESO. Las 331 cartas del catálogo son piezas
   * terminadas: el OVR, el rol, la bandera, el nombre y la fila de estadísticas están DIBUJADOS en la
   * imagen. Pintar encima los nuestros duplicaba el nombre («SPLASH SPLASH»), montaba un segundo OVR
   * sobre el impreso y tapaba la fila de estadísticas con un degradado. Con la imagen del catálogo
   * solo se añade lo que la carta impresa NO tiene: el trío de combate, abajo, pegado al borde.
   * El artwork manual de un ejemplar (sin cromo impreso) y la foto de reserva siguen como siempre.
   */
  const impresa = Boolean(artworkUrl && imagenCatalogo && artworkUrl === imagenCatalogo);

  /*
   * CARD ART = CARD VISUAL (limpieza global de cartas). La carta diseñada ES el asset: sin borde de
   * rareza, sin fondo de paleta, sin radio ni recorte, sin anillo de selección rectangular. Lo que
   * la interfaz añade encima es solo lo que el juego necesita y la carta impresa no trae —el trío
   * de combate, dentro de la silueta— y los estados van sobre la silueta con `drop-shadow`
   * (elegida: halo cian) o con filtros de color (usada: apagada).
   */
  const trio = showStats && (
    <div className={cn("grid grid-cols-3 gap-x-1", impresa ? "rounded-[4px] bg-black/55 px-0.5 py-[2px] ring-1 ring-white/10" : "mt-1")}>
      {(Object.keys(STAT_INFO) as CombatStatKey[]).map((k) => {
        const on = highlightStat === k;
        return (
          <div
            key={k}
            className={cn(
              "flex items-center justify-center gap-0.5 rounded-[3px] px-0.5 transition",
              on && "bg-white/20 ring-1 ring-white/40",
            )}
          >
            <span
              className={cn(TRIO_ABBR[size], "font-extrabold leading-none")}
              style={{ color: STAT_INFO[k].color }}
            >
              {STAT_INFO[k].abbr}
            </span>
            <span className={cn(TRIO_VALUE[size], "font-display font-bold leading-none text-white tabular-nums")} data-combat={k}>
              {card.combat[k]}
            </span>
          </div>
        );
      })}
    </div>
  );

  const bodyImpresa = impresa ? (
    <div className="relative" data-card-art-wrap>
      <CardArt
        src={artworkUrl!}
        alt=""
        onError={() => setArtworkFalló(true)}
        glow={selected ? "#2fe0ff" : glow}
        glowSize={selected ? 12 : 16}
        dim={used}
        shadow={size === "xs" ? "none" : "rest"}
      />
      {card.serial != null && size !== "xs" && (
        <span className="absolute right-[8%] top-[4%] z-10 rounded bg-black/60 px-1 text-[8px] font-bold text-white">
          #{card.serial}
        </span>
      )}
      {used && (
        <span className="absolute inset-0 z-20 grid place-items-center font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/85 [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
          {t("Usada")}
        </span>
      )}
      {/* El trío de combate, dentro de la silueta de la carta: es con lo que se juega. */}
      {trio && <div className="absolute inset-x-[6%] bottom-[2.2%] z-10">{trio}</div>}
    </div>
  ) : null;

  const body = bodyImpresa ?? (
    <div
      className={cn(
        "relative aspect-[5/7] overflow-hidden rounded-xl border-2 transition",
        used && "grayscale-[0.85] brightness-[0.55]",
        /*
         * SELECCIONADA. En VERDE, que es el color del jugador en el tablero — antes era
         * `ring-drl`, el ROJO del rival: lo tuyo se marcaba con el color del enemigo. El
         * anillo NO depende de hover ni de foco: una carta elegida tiene que seguir
         * diciendo que lo está cuando el puntero se ha ido a otra parte.
         */
        /* FASE 50 · el jugador es CIAN en la arena: la carta elegida se marca con su color. */
        selected && "ring-2 ring-[#2fe0ff] ring-offset-2 ring-offset-base-900",
      )}
      style={{ borderColor: palette.primary, background: palette.background, color: palette.text }}
    >
      {/* Capa de arte: el artwork manual del ejemplar si lo tiene; si no, la foto de siempre. */}
      {artworkUrl ? (
        <img
          src={artworkUrl}
          alt=""
          aria-hidden
          width={750}
          height={1050}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setArtworkFalló(true)}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      ) : (
        <div className="absolute inset-x-[6%] bottom-[30%] top-[6%]">
          {player ? (
            <PlayerPhoto player={player} palette={palette} rank={variant.rank} />
          ) : (
            <div className="grid h-full place-items-center font-display text-xl font-bold opacity-80">
              {card.nick.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      )}

      <div
        className={cn("absolute inset-x-0 bottom-0", impresa ? "h-[17%]" : "h-[48%]")}
        style={{
          background: impresa
            ? "linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.5) 60%, transparent)"
            : "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.18) 55%, transparent)",
        }}
      />

      {/*
        VELO SUPERIOR, y solo cuando hay artwork.
        Con la foto de siempre el OVR se lee sobre el fondo de la paleta, porque el retrato va
        metido hacia dentro (`inset-x-[6%] top-[6%]`) y deja ese margen. El artwork manual va a
        sangre, así que el número queda directamente encima del arte — y en el duelo ese número
        es con lo que se elige. Un degradado corto arriba le devuelve el contraste sin tapar la
        ilustración, igual que el de abajo se lo da al trío de combate.
      */}
      {artworkUrl && !impresa && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[26%]"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.62), transparent)" }}
        />
      )}

      {/* OVR · rol · país (la carta diseñada ya los lleva impresos) */}
      {!impresa && (
      <div className="absolute left-0 top-0 z-10 flex flex-col items-center gap-0.5 px-1.5 py-1">
        <span className={cn("font-display font-bold leading-none", OVR_SIZE[size])}>{card.ovr}</span>
        {size !== "xs" && (
          <span className="font-display text-[8px] font-bold uppercase tracking-wider opacity-85">
            {td(ROLE_ABBR[card.role]) ?? td(card.role)}
          </span>
        )}
        {size !== "xs" && card.country && (
          <span className="rounded border border-current px-1 text-[7px] font-bold uppercase opacity-75">
            {card.country}
          </span>
        )}
      </div>
      )}

      {card.serial != null && size !== "xs" && (
        <span className="absolute right-1 top-1 z-10 rounded bg-black/50 px-1 text-[8px] font-bold text-white">
          #{card.serial}
        </span>
      )}

      {used && (
        <span className="absolute inset-0 z-20 grid place-items-center bg-base-900/55 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
          {t("Usada")}
        </span>
      )}

      {/* Nombre · variante · trío de combate (en la carta diseñada, solo el trío: el resto está impreso) */}
      <div className={cn("absolute inset-x-0 bottom-0 z-10 px-1.5", impresa ? "pb-1" : "pb-1.5 pt-3")}>
        {!impresa && <div className="mb-0.5 h-px w-full opacity-40" style={{ background: palette.text }} />}
        {!impresa && (
        <p
          className={cn(
            "truncate text-center font-display font-bold uppercase leading-none text-white",
            NAME_SIZE[size],
          )}
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}
        >
          {card.nick}
        </p>
        )}
        {size !== "xs" && !impresa && (
          <p className="mt-0.5 truncate text-center text-[7px] font-bold uppercase tracking-[0.14em] text-white/75">
            {td(variant.label)}
          </p>
        )}
        {trio}
      </div>
    </div>
  );

  if (!interactive) {
    return <div className={cn(WIDTH[size], "shrink-0", disabled && "opacity-50", className)}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={t("{nick}, {role}, OVR {ovr}", { nick: card.nick, role: td(card.role), ovr: card.ovr })}
      className={cn(
        WIDTH[size],
        "shrink-0 rounded-xl transition hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl",
        "motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {body}
    </button>
  );
}

export const DuelCard = memo(DuelCardBase);

/** Reverso: lo que ves de una carta del rival que todavía no ha jugado. */
/**
 * EL DORSO NEXUS (Fase 50). Una carta boca abajo del rival: rojo profundo, marco interior y el
 * emblema de NEXUS en el centro. No lleva ningún dato de la carta —no puede llevarlo: no lo recibe—.
 */
export function DuelCardBack({
  size = "md", className, hint = null, role = null, layout = "hand",
}: {
  size?: DuelCardSize;
  className?: string;
  /**
   * F71 · la ÚNICA pista pública de esta carta oculta (país, liga, equipo o rol), ya calculada en el
   * servidor. F72.2 · se pinta SOLO como imagen (bandera, icono de rol, icono de liga, logo): sin texto ni
   * códigos. Sin asset → dorso normal. Sin silueta ni foto: el misterio sigue.
   */
  hint?: RivalCardHint | null;
  /**
   * DUEL GAMEPLAY UX 2.0 · el ROL canónico de esta carta oculta (mano del rival), junto a su pista: `[bandera/logo] + rol`.
   * Icono real cuando exista; mientras, su abreviatura.
   */
  role?: RoleId | null;
  /**
   * AJUSTE · `committed` = la carta que el rival comprometió en la mesa (boca abajo): la MISMA pista y el MISMO rol que
   * esa carta tiene en la fila superior, compuestos en la parte baja del reverso (`[bandera/logo]` y debajo el rol). El
   * nombre accesible lo pone quien la monta (la ranura de la mesa); aquí no se repite.
   */
  layout?: "hand" | "committed";
}) {
  useLocale();
  const p = hint ? hintPresentation(hint) : null;
  const committed = layout === "committed";
  const roleText = role ? t("rol {role}", { role: td(role) }) : null;
  const label = p ? (roleText ? `${p.ariaLabel}; ${roleText}` : p.ariaLabel) : roleText ? t("Carta oculta; {roleText}", { roleText: td(roleText) }) : null;
  return (
    <div
      className={cn(WIDTH[size], "shrink-0", className)}
      {...(label && !committed ? { role: "img", "aria-label": label } : {})}
      {...(p ? { "data-testid": committed ? "rival-committed-hint" : "rival-hint", "data-hint-type": p.type, "data-hint-shape": p.shape } : {})}
      {...(committed && role ? { "data-role": role } : {})}
    >
      <div
        className="relative aspect-[5/7] overflow-hidden rounded-[10%/7%] border-2 [container-type:inline-size]"
        style={{
          borderColor: "rgba(255,46,99,0.75)",
          // F72.8 · con pista, el neón del dorso es INTERIOR: se pinta dentro de su caja, debajo de la pista, y no
          // invade la carta vecina (el halo exterior va una sola vez, detrás del abanico: `RivalHand`).
          ...(p ? { boxShadow: "inset 0 0 12px rgba(255,46,99,0.45), inset 0 0 2px rgba(255,46,99,0.6)" } : {}),
          background:
            "radial-gradient(80% 60% at 50% 45%, rgba(255,46,99,0.30), transparent 70%)," +
            "repeating-linear-gradient(135deg, rgba(255,46,99,0.08) 0 2px, transparent 2px 9px)," +
            "linear-gradient(160deg, #2a0714 0%, #12030a 55%, #07020a 100%)",
        }}
      >
        <div className="absolute inset-[7%] rounded-[8%/5%] border border-[#ff2e63]/40" />
        <div
          aria-hidden
          className={cn("absolute", committed && (p || role) ? "inset-x-[31%] top-[7%] bottom-[66%]" : "inset-[26%]")}
          style={{
            backgroundColor: "#ff4f7e",
            WebkitMaskImage: "url(/branding/icon/icon-mono.svg)",
            maskImage: "url(/branding/icon/icon-mono.svg)",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            filter: "drop-shadow(0 0 6px rgba(255,46,99,0.9))",
            opacity: p && !committed ? 0.22 : 0.9,
          }}
        />
        {committed && (p || role) && (
          /*
            AJUSTE · CARTA COMPROMETIDA: pista + rol en el pie del reverso, como parte del propio dorso. Columna invertida
            para que en el DOM el rol vaya ANTES y la pista sea lo último que se pinta (mismo contrato limpio F72.8: placa
            neutra debajo, el fichero original encima, sin filtros ni transformaciones).
            AJUSTE VISUAL · la pista es la protagonista del dorso: bandera al 80 % del ancho (antes 46 %) y logo/icono al
            64 % (antes 34 %), con el emblema más pequeño arriba. Cada forma tiene su caja con la proporción de su FICHERO
            (bandera 4:3, logo cuadrado) y `object-fit: contain`: un logo ancho (NRG, MIBR) o alto (FUT) cabe entero, sin
            deformarse ni recortarse, centrado en su caja.
          */
          <span aria-hidden data-committed-hint className="absolute inset-x-0 bottom-[7%] flex flex-col-reverse items-center gap-[0.3em] text-[clamp(9px,7cqi,15px)]">
            {role && <RoleMark role={role} className="text-[1em]" />}
            {p && (
              <span
                aria-hidden
                data-hint-layer={p.shape}
                className={cn("relative isolate block", p.shape === "flag" ? "w-[80%]" : "w-[64%]")}
                style={{ aspectRatio: p.shape === "flag" ? "4 / 3" : "1 / 1" }}
              >
                {/*
                  Fondo neutro bajo la imagen. Bandera: marco fino (junto al magenta su blanco se percibe rosado, F72.8).
                  Logo: ya no es un cuadrado con borde sino un halo oscuro suave, sin bordes, que se funde con el dorso.
                */}
                <span
                  aria-hidden
                  data-hint-plate
                  className={cn(
                    "absolute block",
                    p.shape === "flag"
                      ? "-inset-[3%] rounded-[4px] border border-white/15 bg-[#0b0c12]"
                      : "-inset-[10%] rounded-full bg-[radial-gradient(closest-side,rgba(11,12,18,0.92),rgba(11,12,18,0.7)_62%,rgba(11,12,18,0)_100%)]",
                  )}
                />
                <img
                  data-hint-art={p.shape}
                  src={p.src}
                  alt=""
                  draggable={false}
                  loading="eager"
                  decoding="async"
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  className="relative block h-full w-full select-none object-contain"
                  style={{ filter: "none", mixBlendMode: "normal", opacity: 1 }}
                />
              </span>
            )}
          </span>
        )}
        {!committed && role && (
          // DUEL GAMEPLAY UX 2.0 · el rol va ANTES de la pista en el DOM (abajo del dorso, sin solaparse): la pista sigue
          // siendo lo último que se pinta (contrato F72.8: nada encima de la imagen).
          <span aria-hidden data-role-layer className="absolute inset-x-0 bottom-[6%] flex justify-center">
            <RoleMark role={role} className="text-[clamp(6px,2.1vh,9px)]" />
          </span>
        )}
        {!committed && p && (
          /*
            F72.8 · LA PISTA ES UNA VENTANA LIMPIA SOBRE EL DORSO. Dos capas, en este orden:

              1 · la PLACA (`data-hint-plate`): un fondo neutro, casi negro, apenas mayor que la imagen. Es del DORSO:
                  separa la bandera del magenta (junto al magenta, el blanco se PERCIBE rosado aunque sea #fff) y da a
                  los logos con transparencia un fondo sin tinte.
              2 · el ASSET ORIGINAL (`<img data-hint-art>`), encima de todo, sin ningún tratamiento: sin filtro, sin
                  sombra, sin blend, opacidad 1, sin transform (se coloca con porcentajes, no con translate, para no
                  re-muestrearla a medio píxel). `object-fit: contain`: el fichero tal cual.

            Antes (F72.2–F72.6) era un fondo CSS con sombra negra y anillo blanco (bandera) o `drop-shadow` (logo),
            dentro de un abanico con `filter: drop-shadow`: la imagen se rasterizaba dentro de superficies filtradas.
            Si el fichero no carga, la imagen se oculta (nada de icono roto) y queda el dorso con su emblema.
          */
          <span
            aria-hidden
            data-hint-layer={p.shape}
            className={cn("absolute isolate block", p.shape === "flag" ? "left-[8%] top-[21.5%] w-[84%]" : "left-[10%] top-[15.4%] w-[80%]")}
            style={{ aspectRatio: p.shape === "flag" ? "4 / 3" : "1 / 1" }}
          >
            <span
              aria-hidden
              data-hint-plate
              className={cn(
                "absolute block border border-white/15 bg-[#0b0c12]",
                p.shape === "flag" ? "-inset-[5%] rounded-[4px]" : "-inset-[4%] rounded-[16%]",
              )}
            />
            <img
              data-hint-art={p.shape}
              src={p.src}
              alt=""
              draggable={false}
              loading="eager"
              decoding="async"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
              className="relative block h-full w-full select-none object-contain"
              style={{ filter: "none", mixBlendMode: "normal", opacity: 1 }}
            />
          </span>
        )}
      </div>
    </div>
  );
}
