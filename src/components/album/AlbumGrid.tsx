"use client";

/**
 * ÁLBUM — LA PARED DE CARTAS.
 *
 * ══════════════════════ EL FALLO QUE ARREGLA ══════════════════════
 *
 * Medido en la auditoría de la Fase 5: la rejilla declaraba cinco columnas flexibles, así que
 * a 1440 px cada celda medía **262 px** — y la carta que iba dentro, **150 px**. Ciento doce
 * píxeles muertos por celda, el 43 % del ancho.
 *
 * No era solo aire. `Card3D` posiciona sus marcas (el velo de bloqueada, el cuño de duplicado)
 * contra SU caja, que era la celda entera: por eso el «×2» aparecía flotando a la izquierda de
 * la carta siguiente y el velo gris de las bloqueadas se veía desplazado, como un rectángulo
 * suelto detrás del objeto.
 *
 * La rejilla se declara ahora en la MEDIDA DE LA CARTA (`repeat(auto-fill, 150px)`): la celda
 * y el objeto miden lo mismo, las marcas caen donde tienen que caer y a 1440 px caben ocho
 * columnas en vez de cinco. Más álbum y menos hueco, sin tocar `CardRenderer`.
 *
 * ══════════════════════ LO QUE NO HACE ══════════════════════
 *
 * No inventa una cuarta representación de carta: pinta `PlayerCard` dentro de `Card3D` en modo
 * estático, que es el camino sin framer-motion pensado para rejillas largas. No virtualiza —el
 * paginado incremental que ya existía resuelve el problema real— y no añade sombras, filtros
 * ni mezclas por carta.
 */
import type { CardDef } from "@/domain/cards/types";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { Plate, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("album");

export interface AlbumCard {
  cardId: string;
  def: CardDef;
  owned: boolean;
  count: number;
  serial?: number;
  /**
   * El ejemplar que REPRESENTA esta casilla, cuando la carta se posee.
   *
   * La rejilla agrupa: una casilla por carta, aunque tengas cuatro copias. Esa casilla ya
   * elegía una instancia concreta para enseñar su número de serie —la de serie más baja— y
   * aquí se cita la misma. Artwork y serial salen del MISMO ejemplar, así que la casilla es
   * coherente consigo misma y nunca mezcla una versión con el número de otra.
   *
   * Ausente en las cartas del catálogo que todavía no tienes: no hay ejemplar que citar, y
   * por eso se pintan como siempre.
   */
  uid?: string;
  /** Fase 37 · marcas de estado (máximo tres, en este orden de prioridad): favorita, en vitrina, en el equipo activo. */
  favorite?: boolean;
  inShowcase?: boolean;
  inActiveDeck?: boolean;
  /** Etiqueta accesible completa (jugador, OVR, rareza, estado). Si falta, la de siempre. */
  label?: string;
}

export function AlbumGrid({
  cards, onOpen, remaining, onMore,
}: {
  cards: AlbumCard[];
  onOpen: (cardId: string) => void;
  /** Cuántas quedan sin pintar. 0 = está todo. */
  remaining: number;
  onMore: () => void;
}) {
  useLocale();
  return (
    <>
      {/*
        La medida manda: columnas del ancho EXACTO de una carta, centradas. `auto-fill` decide
        cuántas caben, así que la misma declaración sirve de 390 a 3440 px sin puntos de
        ruptura escritos a mano.
      */}
      <div className="grid justify-center gap-3 [grid-template-columns:repeat(auto-fill,150px)] sm:gap-4">
        {cards.map((c, i) => (
          <div key={c.cardId} className="nx-card-lift relative" data-card={c.cardId} data-owned={c.owned ? "true" : "false"} data-motion-level="1">
            {/*
              Fase 37 · una carta que no tienes también se abre: su ficha pública (definición, stats,
              dónde puede salir) es justo lo que hace querer conseguirla. Sigue marcada como bloqueada
              y su etiqueta lo dice en texto, no solo con el velo gris.
            */}
            <Card3D
              mode="static"
              status={c.owned ? undefined : "locked"}
              count={c.count}
              delay={card3DStagger(i, 0.012, 0.28)}
              label={td(c.label) ?? (c.owned ? t("Ver {id}", { id: c.def.id }) : t("{id} — todavía no la tienes", { id: c.def.id }))}
              onClick={() => onOpen(c.cardId)}
            >
              {/*
                El artwork va DENTRO de `Card3D`, no en su lugar: el volumen, el velo de
                bloqueada y el cuño de duplicados son del envoltorio y siguen valiendo tanto si
                la cara es el fichero hecho a mano como si es el dibujado por capas.
                `chamfer` es el de `sm`, para que el corte de la esquina sea el mismo.
              */}
              <CardVisual uid={c.uid} alt={t("Carta de {id}", { id: c.def.id })} chamfer="11px" className="w-[150px]">
                <PlayerCard card={c.def} size="sm" interactive={false} serial={c.serial} />
              </CardVisual>
            </Card3D>
            {(c.favorite || c.inShowcase || c.inActiveDeck || !c.owned) && (
              <span aria-hidden className="pointer-events-none absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
                {!c.owned && <Badge tone="muted" solid>{t("No conseguida")}</Badge>}
                {c.owned && c.favorite && <Badge tone="gold" solid>★</Badge>}
                {c.owned && c.inShowcase && <Badge tone="gold">{t("Vitrina")}</Badge>}
                {c.owned && c.inActiveDeck && <Badge tone="info">{t("Equipo")}</Badge>}
              </span>
            )}
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <NxButton variant="secondary" size="md" onClick={onMore}>
            {t("Ver {n} cartas más", { n: Math.min(remaining, 48) })}
          </NxButton>
          <span className="font-display text-label uppercase tracking-wide2 text-ink-faint">
            {t("quedan")} {remaining}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * ÁLBUM VACÍO. Un jugador nuevo veía una pared de 772 siluetas grises con candado y ni una
 * palabra: parecía una pantalla rota, no un álbum por empezar.
 *
 * La pared se queda —es la respuesta a «qué puedo conseguir»— pero delante va esto: qué es
 * este sitio y cuál es el siguiente paso, sacado del estado real del jugador.
 */
export function AlbumEmpty({ packs }: { packs: number }) {
  useLocale();
  return (
    <Plate className="mb-5 flex flex-wrap items-center gap-5 p-5 sm:p-6">
      <div aria-hidden className="flex shrink-0 items-end gap-2">
        {[0, 1, 2].map((i) => (
          <Recessed
            key={i}
            depth={i === 1 ? "md" : "sm"}
            className="grid aspect-[3/4] w-[46px] place-items-center outline outline-1 -outline-offset-1 outline-white/[0.10] sm:w-[58px]"
            style={{ transform: `translateY(${i === 1 ? -8 : 0}px)` }}
          >
            <span className="font-display text-h3 font-bold text-white/[0.14]">?</span>
          </Recessed>
        ))}
      </div>
      <div className="min-w-[220px] flex-1">
        <SectionTitle as="p">{t("Tu álbum está vacío")}</SectionTitle>
        <p className="max-w-[52ch] text-body leading-relaxed text-ink-muted">
          {packs > 0
            ? t("Tienes {packs} {v}. Cada carta que consigas ocupará su hueco aquí abajo, y las que aún no tienes se quedan a la vista para que sepas qué buscar.", { packs, v: packs === 1 ? t("sobre sin abrir") : t("sobres sin abrir") })
            : t("Aquí abajo está el catálogo entero. Las cartas que consigas ocuparán su hueco; las que no, se quedan a la vista para que sepas qué buscar.")}
        </p>
      </div>
      <NxButton
        variant="primary"
        accent={packs > 0 ? "gold" : "primary"}
        size="lg"
        href={packs > 0 ? "/inventario" : "/tienda"}
        className="shrink-0"
      >
        {packs > 0 ? t("Abrir sobres") : t("Ir a la tienda")}
      </NxButton>
    </Plate>
  );
}

/**
 * SIN RESULTADOS. No es un error: es un filtro que no ha encontrado nada, y por eso lo que
 * se ofrece es deshacerlo, no reintentar.
 */
export function AlbumNoResults({ onClear }: { onClear: () => void }) {
  useLocale();
  return (
    <Plate className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div aria-hidden className="flex items-end gap-2 opacity-60">
        {[0, 1].map((i) => (
          <Recessed key={i} depth="sm" className="aspect-[3/4] w-[42px] outline outline-1 -outline-offset-1 outline-white/[0.08]" />
        ))}
      </div>
      <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">{t("Sin resultados")}</p>
      <p className="max-w-[44ch] text-body text-ink-muted">
        {t("Ninguna carta del álbum coincide con lo que has pedido. Prueba con otro nombre o quita alguna condición.")}
      </p>
      <NxButton variant="secondary" size="md" onClick={onClear}>
        {t("Limpiar filtros")}
      </NxButton>
    </Plate>
  );
}
