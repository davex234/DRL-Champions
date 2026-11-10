"use client";

/**
 * COMMAND CENTER — LA VITRINA.
 *
 * Tus tres mejores cartas, en abanico, como OBJETOS: se solapan, se inclinan y tienen
 * material y rareza propios. No son tres tarjetas de interfaz en una rejilla.
 *
 * ────────────────────────── LO QUE ARREGLA ──────────────────────────
 *
 * En el vestíbulo anterior el abanico solo existía si tenías cartas. Para un jugador nuevo
 * —que es quien más mira esta pantalla— la mitad derecha del escenario se quedaba VACÍA:
 * un hueco negro del tamaño de un póster. Ahora ese hueco es una superficie HUNDIDA con la
 * silueta de tres cartas y la acción real que las consigue, sacada del estado del jugador:
 * si tiene sobres, invita a abrirlos; si no, a la tienda.
 *
 * La colocación va en un envoltorio y no en `Card3D`, porque el componente anima su propio
 * `transform` y escribirle otro encima haría que uno pisara al otro. `interactive={false}`
 * porque el movimiento lo pone `Card3D`, y solo él.
 */
import type { CardDef } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D } from "@/components/visual/Card3D";
import { Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("lobby");

export interface ShowcaseCard {
  uid: string;
  def: CardDef;
  serial?: number;
}

export function LobbyShowcase({
  cards, packs, offerAction = true,
}: {
  cards: ShowcaseCard[];
  packs: number;
  /**
   * ¿La vitrina ofrece su propia salida? Se apaga cuando el CTA del escenario YA lleva al
   * mismo sitio: dos botones que hacen lo mismo en el mismo plano no son dos opciones, son
   * una duda.
   */
  offerAction?: boolean;
}) {
  useLocale();
  if (cards.length === 0) return <EmptyShowcase packs={packs} offerAction={offerAction} />;

  return (
    /*
     * El abanico se dibuja a TAMAÑO REAL de carta (`size="sm"` = 150 px) y se escala con la
     * pantalla. Antes se le daba a `Card3D` un ancho de 92–146 px mientras `PlayerCard`
     * renderizaba su tamaño por defecto —230 px—, así que la carta desbordaba su envoltorio
     * y el abanico se salía del escenario por la derecha. No se veía porque hacía falta
     * tener cartas para que apareciera.
     *
     * La escala va en un contenedor de altura fija: `transform` no ocupa espacio, así que sin
     * esa altura el escenario reservaría el hueco de las cartas sin escalar.
     */
    <div
      className="relative h-[168px] w-full sm:h-[196px] lg:h-[224px] xl:h-[248px]"
      aria-label={t("Lo mejor de tu colección")}
    >
      <div className="absolute inset-0 flex items-center justify-center lg:justify-end lg:pr-2">
        <div className="flex items-center origin-center scale-[0.66] sm:scale-[0.8] lg:scale-90 xl:scale-100">
          {cards.slice(0, 3).map((c, i) => {
            const v = getVariant(c.def.variantId);
            return (
              <div
                key={c.uid}
                style={{
                  marginLeft: i === 0 ? 0 : -46,
                  transform: `rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -14 : 6}px)`,
                  zIndex: i === 1 ? 3 : 2 - Math.abs(i - 1),
                }}
              >
                <Card3D
                  /* El halo continuo, solo en la carta del centro: tres a la vez se funden. */
                  mode={i === 1 && v.rank >= 5 ? "legendary" : "hover"}
                  glow={v.palette.primary}
                  delay={0.12 + i * 0.09}
                >
                  <PlayerCard card={c.def} serial={c.serial} size="sm" interactive={false} />
                </Card3D>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * LA VITRINA VACÍA. Tres huecos con la forma de una carta y una salida real.
 *
 * No dice «no tienes cartas»: enseña el sitio donde van y cómo llenarlo. La acción sale del
 * estado del jugador, no de una suposición.
 */
function EmptyShowcase({ packs, offerAction }: { packs: number; offerAction: boolean }) {
  useLocale();
  return (
    <div className="flex justify-center lg:justify-end" aria-label={t("Tu vitrina, todavía vacía")}>
      <div className="flex flex-col items-center gap-3 px-4 sm:px-8">
        {/*
          Los huecos llevan `outline` y no un borde: `Recessed` fija su sombra por `style`, y
          una clase de sombra no la ganaría. El contorno es lo que hace que se lean como el
          SITIO de una carta y no como tres interrogaciones flotando en negro.
        */}
        <div className="flex items-end gap-2.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Recessed
              key={i}
              depth={i === 1 ? "md" : "sm"}
              className="grid aspect-[3/4] w-[64px] place-items-center outline outline-1 -outline-offset-1 outline-white/[0.10] sm:w-[86px] xl:w-[100px]"
              style={{ transform: `translateY(${i === 1 ? -12 : 0}px)` }}
            >
              <span className="font-display text-h2 font-bold text-white/[0.14]">?</span>
            </Recessed>
          ))}
        </div>
        <div className="text-center">
          <p className="font-display text-label uppercase tracking-wide2 text-ink-muted">{t("Tu vitrina")}</p>
          <p className="mt-1 max-w-[24ch] text-caption text-ink-muted">
            {packs > 0
              ? t("Tienes {packs} {v} esperando. Ábrelos y las mejores cartas se enseñan aquí.", { packs, v: packs === 1 ? t("sobre") : t("sobres") })
              : t("Las tres mejores cartas de tu colección se enseñan aquí.")}
          </p>
          {offerAction && (
            <NxButton
              variant={packs > 0 ? "primary" : "secondary"}
              accent={packs > 0 ? "gold" : "primary"}
              size="md"
              className="mt-3"
              href={packs > 0 ? "/inventario" : "/tienda"}
            >
              {packs > 0 ? t("Abrir sobres") : t("Ir a la tienda")}
            </NxButton>
          )}
        </div>
      </div>
    </div>
  );
}
