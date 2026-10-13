"use client";

/**
 * PREVISUALIZACIÓN DE UNA DEFINICIÓN — Bloque 8.4.2, fases 8 y 9.
 *
 * ────────────────────────── NO ES UNA CARTA DE ADMIN ──────────────────────────
 *
 * No existe `AdminCard`, ni `AdminCardPreview`, ni `CardMock`. Lo que se pinta aquí es
 * **exactamente** lo que ve un jugador: `Card3D` envolviendo a `CardRenderer`, la misma pareja
 * que usan la colección, el álbum y la revelación de sobres. Rareza, sellos, micrografía,
 * material, geometría, tipografía y efectos salen del mismo sitio, porque son el mismo sitio.
 *
 * La consecuencia práctica: si mañana cambia el chaflán de la carta, esta pantalla cambia sola.
 * Una segunda representación habría empezado a divergir el primer día.
 *
 * ────────────────────────── POR QUÉ NO LLEVA NÚMERO DE SERIE ──────────────────────────
 *
 * Una definición NO es un ejemplar. No tiene dueño, ni número de serie, ni acuñación, ni
 * listado en el mercado: todo eso nace cuando alguien la obtiene. Inventar un «#1/25» para que
 * la previsualización quede bonita sería enseñar como real algo que no existe, y el panel de
 * un juego con cartas serializadas es justo el sitio donde esa confusión sale cara.
 *
 * Así que a `CardRenderer` se le pasa `serial` sin valor —la chapa de serie sencillamente no se
 * dibuja— y al lado se dice en palabras qué rango de series tendrá **cuando** exista un
 * ejemplar. La cifra que se enseña es la tirada de la variante, que es un dato real de la
 * definición; el número concreto no se enseña porque todavía no lo hay.
 */
import { Card3D } from "@/components/visual/Card3D";
import { CardRenderer, type CardSize } from "@/components/cards/CardRenderer";
import { Badge } from "@/components/ui/Badge";
import type { Player, PlayerStats, VariantDef } from "@/domain/cards/types";
import { COMBAT_STAT_META, type CombatStats } from "@/domain/cards/combat";

export function CardPreview({
  player,
  variant,
  stats,
  ovr,
  combat,
  size = "lg",
  nota,
}: {
  player: Player;
  variant: VariantDef;
  /** Las 6 heredadas, ya con el boost. Es lo que pinta la cara de la carta. */
  stats: PlayerStats;
  ovr: number;
  /** El trío final, con el boost aplicado. No sale en la cara: se lee al lado. */
  combat: CombatStats;
  size?: CardSize;
  /** Una línea de contexto bajo la carta. Por ejemplo, de qué versión se está hablando. */
  nota?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {/*
          El aviso va FUERA de la carta, no encima: tapar la carta para decir que es una
          previsualización estropea justo lo que se ha venido a mirar.
        */}
        <Badge tone="warn">Preview · sin ejemplar</Badge>
        <Badge tone="muted">{variant.label}</Badge>
      </div>

      <Card3D mode="hover" glow={variant.palette.primary} tilt={9}>
        <CardRenderer
          player={player}
          variant={variant}
          stats={stats}
          ovr={ovr}
          /* Sin `serial`: una definición no tiene ejemplar, así que no se dibuja la chapa. */
          size={size}
          interactive={false}
          effects
        />
      </Card3D>

      {/* El trío de combate no se pinta en la cara de la carta, y es lo que se está editando. */}
      <dl className="flex items-center gap-3" aria-label="Trío de combate de la carta">
        {(["stronghold", "gamesense", "entryfrag"] as const).map((k) => (
          <div key={k} className="text-center">
            <dt className="font-display text-label uppercase tracking-wider text-white/40">
              {COMBAT_STAT_META[k].label}
            </dt>
            <dd
              className="font-display text-xl font-bold tabular-nums"
              style={{ color: COMBAT_STAT_META[k].color }}
            >
              {combat[k]}
            </dd>
          </div>
        ))}
      </dl>

      <p className="max-w-[300px] text-center text-[11px] leading-relaxed text-white/40">
        {variant.serialized && variant.serialLimit
          ? `Serializada: cada ejemplar llevará un número del 1 al ${variant.serialLimit}. Aquí no se enseña ninguno porque todavía no existe.`
          : "Sin numerar: esta variante no lleva número de serie."}
        {nota ? ` ${nota}` : ""}
      </p>
    </div>
  );
}
