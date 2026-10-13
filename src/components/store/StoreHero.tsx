"use client";

/**
 * TIENDA 4.0 · EL DESTACADO (Fase 49).
 *
 * Una edición REAL del catálogo con sus cartas REALES (arte original, sin retocar: solo se colocan,
 * inclinan y escalan con CSS) y el sobre real que las contiene. Sin cuenta atrás: la configuración
 * no tiene rotación con fecha; si algún día la tiene, se enseña la fecha de fin, no un reloj.
 */
import type { CSSProperties } from "react";
import { getPack } from "@/data/packs";
import { packArtwork } from "@/data/packArtwork";
import type { FeaturedHeroConfig } from "@/domain/store/types";
import { NxButton } from "@/components/ui/NxButton";
import { cardFacts, rarityColor, rgbVar } from "./storeView";
import { css } from "./storeClasses";

/** Posiciones del abanico (en % del ancho del escenario): la primera carta es la protagonista. */
const FAN = [
  { x: 28, w: 30, r: -4, z: 6 },
  { x: 49, w: 25, r: 5, z: 5 },
  { x: 66, w: 21, r: 9, z: 4 },
  { x: 78, w: 18, r: 13, z: 3 },
  { x: 12, w: 20, r: -11, z: 2 },
];

export function StoreHero({ hero, onCta }: { hero: FeaturedHeroConfig; onCta: () => void }) {
  const pack = getPack(hero.packId);
  const art = pack ? packArtwork(pack.id) : null;
  const cards = hero.cardIds.map(cardFacts).filter((c): c is NonNullable<typeof c> => !!c).slice(0, FAN.length);
  const rarity = cards[0]?.rarity ?? "epic";
  const heroRgb = rgbVar(rarityColor(rarity));
  const endDate = hero.endAt ? new Date(hero.endAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : null;

  return (
    <section
      id="destacado"
      aria-labelledby="store-hero-title"
      className={`${css.hero} ${css.section} grid gap-0 lg:min-h-[380px] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-2`}
      style={{ ["--hero-rgb" as string]: heroRgb } as CSSProperties}
    >
      <span aria-hidden className={css.heroBeams} />
      <span aria-hidden className={css.heroShards} />

      <div className={`${css.heroText} relative z-10 flex flex-col justify-center px-5 pb-0 pt-6 sm:px-8 lg:px-12 lg:py-10`}>
        {/* F72.4 · arte dominante + título + CTA: la línea «edición · rareza · N cartas» repetía el título y sale. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-label font-bold uppercase tracking-wide2">
          <span style={{ color: rarityColor(rarity) }}>{hero.eyebrow}</span>
          {endDate && <span className="text-ink-muted">Hasta el {endDate}</span>}
        </p>
        <h1 id="store-hero-title" className={`${css.heroTitle} mt-2 font-display text-[clamp(40px,7vw,84px)] font-bold uppercase leading-[0.9] tracking-tight`}>
          {hero.title}
        </h1>
        <p className="mt-3 font-display text-[clamp(15px,1.6vw,20px)] font-bold uppercase tracking-[0.14em] text-white">
          {hero.subtitle}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <NxButton variant="primary" size="lg" onClick={onCta}>{hero.ctaLabel}</NxButton>
          <NxButton variant="ghost" size="lg" href="#cartas">Ver cartas</NxButton>
        </div>
      </div>

      {/* El escenario: sobre real detrás, cartas reales en abanico. Decorativo: la información está a la izquierda. */}
      <div aria-hidden className={`${css.fan} relative h-[250px] sm:h-[340px] lg:h-auto`}>
        {art && (
          <div className={`${css.fanItem} ${css.fanPack}`} style={{ ["--x" as string]: "0%", ["--w" as string]: "19%", ["--r" as string]: "-14deg", ["--z" as string]: 1, ["--d" as string]: "80ms" } as CSSProperties}>
            <img src={art} alt="" width={780} height={1140} decoding="async" fetchPriority="high" />
          </div>
        )}
        {cards.map((c, i) => {
          const f = FAN[i];
          return (
            <div
              key={c.id}
              className={`${css.fanItem} ${css.fanCard}`}
              style={{
                ["--x" as string]: `${f.x}%`, ["--w" as string]: `${f.w}%`, ["--r" as string]: `${f.r}deg`, ["--z" as string]: f.z,
                ["--d" as string]: `${140 + i * 70}ms`, ["--glow-rgb" as string]: rgbVar(rarityColor(c.rarity)),
              } as CSSProperties}
            >
              <img data-card-art className="nx-card-art" src={c.image} alt="" width={750} height={1048} decoding="async" fetchPriority={i < 2 ? "high" : "auto"} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
