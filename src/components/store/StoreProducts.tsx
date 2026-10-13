"use client";

/**
 * TIENDA 4.0 · LOS PRODUCTOS (Fase 49): sobre, caja, carta y pack especial.
 *
 * Todo sale de un `ResolvedProduct` (configuración + catálogo real). Ningún componente decide precios
 * ni disponibilidad: pintan lo que el resolvedor dice y abren el modal; el servidor decide al comprar.
 * Las cartas se enseñan con su ARTE COMPLETO (ya lleva OVR, nombre, rol y stats impresos): no se
 * reconstruye nada encima.
 */
import type { CSSProperties, ReactNode } from "react";
import { packArtwork } from "@/data/packArtwork";
import { getPack } from "@/data/packs";
import type { PackDef } from "@/domain/packs/types";
import type { ResolvedProduct } from "@/domain/store/types";
import { SealedPack } from "@/components/packs/SealedPack";
import { ACCENT } from "@/design/tokens";
import { accentStyle, cardFacts, catalogPrice, packOf, packTone, rarityColor } from "./storeView";
import { css } from "./storeClasses";
import { CreditGlyph } from "@/components/ui/game/GameGlyph";

// ───────────────────────────── piezas compartidas ─────────────────────────────

export function SectionHead({ id, title, subtitle, action }: { id: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} className="font-display text-[clamp(22px,2.6vw,30px)] font-bold uppercase leading-none tracking-wide text-white">{title}</h2>
        <p className="text-caption text-ink-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

const BADGE_TEXT = { FEATURED: "Destacado", NEW: "Nuevo" } as const;

export function StatusChip({ product, owned = 0, hideSoon = false }: { product: ResolvedProduct; owned?: number; hideSoon?: boolean }) {
  const chips: { text: string; tone: string }[] = [];
  if (product.badge) chips.push({ text: BADGE_TEXT[product.badge], tone: product.badge === "NEW" ? "text-ok border-ok/50" : "text-drl border-drl/60" });
  if (product.status === "COMING_SOON" && !hideSoon) chips.push({ text: "Próximamente", tone: "text-white/70 border-white/25" });
  if (owned > 0) chips.push({ text: `${owned} sin abrir`, tone: "text-drl-cyan border-drl-cyan/50" });
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c.text} className={`nx-clip-sm border bg-black/40 px-2 py-1 font-display text-label font-bold uppercase tracking-wide2 ${c.tone}`}>{c.text}</span>
      ))}
    </span>
  );
}

/**
 * F72.4 · EL PRECIO DE LA TARJETA: uno solo (`catalogPrice`), en su placa. Los demás métodos, el saldo y el «después»
 * viven en el detalle de compra.
 */
export function CatalogPrice({ product }: { product: ResolvedProduct }) {
  const price = catalogPrice(product);
  return (
    <span className={`${price.kind === "credits" ? css.priceCredits : css.priceMoney} nx-clip-sm flex min-h-[36px] items-center justify-center gap-1.5 px-2`} data-testid="store-price">
      {price.kind === "credits" && <CreditGlyph />}
      <span className={`whitespace-nowrap font-display font-bold tabular-nums ${price.kind === "credits" ? "text-readout-sm text-drl-gold" : price.kind === "money" ? "text-readout-sm text-white" : "text-label uppercase tracking-wide text-white/75"}`}>
        {price.text}
      </span>
      {price.kind === "credits" && <span className="sr-only">DRL Credits</span>}
    </span>
  );
}

function PackImage({ pack, width, className }: { pack: PackDef; width: number; className?: string }) {
  // F60 · un sobre del panel lleva su arte de Storage en el propio PackDef (también en la vista previa de un borrador).
  const art = pack.cms?.art ?? packArtwork(pack.id);
  if (!art) return <span className={className}><SealedPack pack={pack} cutProgress={0} width={width} /></span>;
  return <img src={art} alt="" width={width} height={Math.round((width * 1140) / 780)} loading="lazy" decoding="async" className={className} />;
}

const ctaClass = "nx-focus nx-clip-sm w-full px-3 py-2.5 font-display text-label font-bold uppercase tracking-wide2 transition-colors duration-fast";
const ctaPrimary = `${ctaClass} bg-drl text-white hover:brightness-110`;
const ctaMuted = `${ctaClass} border border-white/15 bg-white/[0.04] text-white/80 hover:border-white/35 hover:text-white`;

/**
 * F72.4 · LA TARJETA DEL CATÁLOGO, igual para TODA clase de producto (sobre, caja, carta, pack, y cualquier sobre que se
 * publique desde el panel): 1) arte, 2) nombre, 3) precio, 4) COMPRAR. Nada más en el primer nivel; las insignias son
 * fichas pequeñas sobre el arte. COMPRAR nunca cobra: abre el detalle (`onSelect`), donde están contenido,
 * probabilidades, saldo y la confirmación. Cada clase solo aporta su ARTE (`art`).
 */
function OfferCard({ product, name, owned = 0, index, tone, art, onSelect }: {
  product: ResolvedProduct; name: string; owned?: number; index: number; tone: string; art: ReactNode; onSelect: (p: ResolvedProduct) => void;
}) {
  const available = product.status === "AVAILABLE";
  const free = catalogPrice(product).text === "Gratis";
  const cta = !available ? "Ver" : free ? "Conseguir" : "Comprar";
  return (
    <article
      className={`${css.product} flex min-w-0 flex-col`}
      style={{ ...accentStyle(tone), ["--d" as string]: `${index * 40}ms` } as CSSProperties}
      aria-label={name}
      data-testid="store-product"
      data-kind={product.kind}
      data-product-id={product.productId}
    >
      {/* Flex con altura fija (no grid): así el `h-full` del arte resuelve contra una altura definida y el arte se CONTIENE
          entero en vez de crecer por su ancho y recortarse. */}
      <div data-product-art className="relative flex h-[176px] items-center justify-center overflow-hidden px-3 pt-3 sm:h-[220px] lg:h-[236px]">
        <span className="absolute left-2 top-2 z-10"><StatusChip product={product} owned={owned} /></span>
        {art}
      </div>
      <div className="flex flex-col gap-2 p-3 pt-2 sm:p-4 sm:pt-2">
        {/* Nombre entero en dos líneas como mucho (en móvil «Sobre Champions» no cabe en una); hueco fijo para dos en
            móvil y así precio y botón quedan alineados en toda la fila. */}
        <h3 className="line-clamp-2 min-h-[2.5em] break-words font-display text-readout-sm font-bold uppercase leading-tight tracking-wide text-white sm:min-h-0" title={name}>{name}</h3>
        <CatalogPrice product={product} />
        <button type="button" className={available ? ctaPrimary : ctaMuted} onClick={() => onSelect(product)} aria-label={`${cta} ${name}`} aria-haspopup="dialog">
          {cta}
        </button>
      </div>
    </article>
  );
}

// ───────────────────────────── SOBRE ─────────────────────────────

export function PackOfferCard({ product, owned, index, onSelect }: { product: ResolvedProduct; owned: number; index: number; onSelect: (p: ResolvedProduct) => void }) {
  const pack = packOf(product);
  if (!pack) return null;
  return (
    <OfferCard product={product} name={pack.name} owned={owned} index={index} tone={packTone(pack)} onSelect={onSelect}
      art={<PackImage pack={pack} width={160} className={`${css.packArt} h-full w-full object-contain`} />} />
  );
}

// ───────────────────────────── CAJA ─────────────────────────────

/**
 * La caja: un cajón metálico dibujado en SVG (sin assets externos). Tres caras con su luz, flejes,
 * esquineras y el ARTE REAL del sobre como emblema. El color es el tono del producto (`--acc-rgb`).
 */
export function BoxVisual({ pack, width = 200, fluid = false }: { pack: PackDef; width?: number; fluid?: boolean }) {
  const art = packArtwork(pack.id);
  const acc = (a: number) => `rgb(var(--acc-rgb) / ${a})`;
  const gid = `bx-${pack.id}`;
  return (
    <div className={`${css.boxStage} relative grid place-items-center ${fluid ? "h-full w-full" : ""}`} aria-hidden>
      <svg viewBox="0 0 200 140" width={fluid ? "100%" : width} height={fluid ? "100%" : (width * 140) / 200} preserveAspectRatio="xMidYMid meet" className={`${css.box} ${fluid ? "max-h-[78%] px-2" : ""}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={`${gid}-f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: acc(0.55) }} />
            <stop offset="0.28" style={{ stopColor: "rgb(22 28 44)" }} />
            <stop offset="1" style={{ stopColor: "rgb(8 11 20)" }} />
          </linearGradient>
          <linearGradient id={`${gid}-t`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: acc(0.35) }} />
            <stop offset="1" style={{ stopColor: "rgb(200 214 240 / 0.35)" }} />
          </linearGradient>
          <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "rgb(16 20 32)" }} />
            <stop offset="1" style={{ stopColor: acc(0.3) }} />
          </linearGradient>
          <radialGradient id={`${gid}-g`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: acc(0.55) }} />
            <stop offset="1" style={{ stopColor: acc(0) }} />
          </radialGradient>
        </defs>
        <ellipse cx="95" cy="138" rx="100" ry="10" fill={`url(#${gid}-g)`} />
        {/* caras */}
        <polygon points="0,50 30,20 190,20 160,50" fill={`url(#${gid}-t)`} />
        <polygon points="160,50 190,20 190,105 160,135" fill={`url(#${gid}-s)`} />
        <rect x="0" y="50" width="160" height="85" fill={`url(#${gid}-f)`} />
        {/* flejes */}
        <polygon points="26,50 56,20 68,20 38,50" fill="rgb(0 0 0 / 0.35)" />
        <polygon points="122,50 152,20 164,20 134,50" fill="rgb(0 0 0 / 0.35)" />
        <rect x="26" y="50" width="12" height="85" fill="rgb(0 0 0 / 0.38)" />
        <rect x="122" y="50" width="12" height="85" fill="rgb(0 0 0 / 0.38)" />
        {[62, 92, 122].map((y) => <g key={y}><circle cx="32" cy={y} r="1.6" fill={acc(0.9)} /><circle cx="128" cy={y} r="1.6" fill={acc(0.9)} /></g>)}
        {/* aristas con luz */}
        <g fill="none" stroke={acc(0.95)} strokeWidth="1.3" strokeLinejoin="round">
          <polyline points="0,135 0,50 30,20 190,20 190,105 160,135 0,135" />
          <polyline points="0,50 160,50 190,20" />
          <line x1="160" y1="50" x2="160" y2="135" />
        </g>
        <polyline points="30,21 188,21" stroke="rgb(255 255 255 / 0.6)" strokeWidth="0.8" fill="none" />
        {/* esquineras */}
        <g fill={acc(0.85)}>
          <polygon points="0,50 12,50 12,54 4,54 4,62 0,62" />
          <polygon points="160,50 148,50 148,54 156,54 156,62 160,62" />
          <polygon points="0,135 12,135 12,131 4,131 4,123 0,123" />
          <polygon points="160,135 148,135 148,131 156,131 156,123 160,123" />
        </g>
        {/* emblema: el arte real del sobre */}
        {art && <image href={art} x="62" y="60" width="44" height="64" preserveAspectRatio="xMidYMid meet" style={{ filter: "drop-shadow(0 0 6px rgb(var(--acc-rgb) / 0.8))" }} />}
        <text x="152" y="128" textAnchor="end" fontSize="9" fontWeight="700" letterSpacing="1.5" fill="rgb(255 255 255 / 0.85)" style={{ fontFamily: "var(--font-display)" }}>×10</text>
      </svg>
    </div>
  );
}

export function BoxOfferCard({ product, index, onSelect }: { product: ResolvedProduct; index: number; onSelect: (p: ResolvedProduct) => void }) {
  const pack = packOf(product);
  if (!pack) return null;
  return <OfferCard product={product} name={product.name} index={index} tone={packTone(pack)} onSelect={onSelect} art={<BoxVisual pack={pack} fluid />} />;
}

// ───────────────────────────── CARTA ─────────────────────────────

/** La carta se enseña con su ARTE COMPLETO (ya lleva OVR, nombre, rol y stats impresos). Edición y rareza: en el detalle. */
export function CardOfferCard({ product, index, onSelect }: { product: ResolvedProduct; index: number; onSelect: (p: ResolvedProduct) => void }) {
  const f = product.cardId ? cardFacts(product.cardId) : null;
  if (!f) return null;
  return (
    <OfferCard product={product} name={f.nick} index={index} tone={rarityColor(f.rarity)} onSelect={onSelect}
      art={<img data-card-art className={`${css.packArt} nx-card-art h-full w-full object-contain`} src={f.image} alt={`Carta de ${f.nick}`} width={750} height={1048} loading="lazy" decoding="async" />} />
  );
}

// ───────────────────────────── PACK ESPECIAL ─────────────────────────────

/** El arte de un pack: sus sobres reales en abanico y, si trae carta garantizada, su arte delante. Tarjeta y detalle. */
export function BundleArt({ product }: { product: ResolvedProduct }) {
  const packs = product.grant.packs.map((x) => getPack(x.packId)).filter((p): p is PackDef => !!p);
  const card = product.grant.cardIds[0] ? cardFacts(product.grant.cardIds[0]) : null;
  return (
    <span aria-hidden className="relative block h-full w-full">
      {packs.slice(0, 2).map((p, i) => (
        <span key={p.id} className="absolute bottom-[4%] h-[88%]" style={{ left: `${14 + i * 24}%`, transform: `rotate(${i ? 7 : -6}deg)`, zIndex: i }}>
          <PackImage pack={p} width={120} className={`${css.packArt} h-full w-auto`} />
        </span>
      ))}
      {card && <img src={card.image} alt="" width={750} height={1048} loading="lazy" decoding="async" data-card-art className="nx-card-art absolute bottom-[4%] right-[8%] z-10 h-[68%] w-auto rotate-[9deg] drop-shadow-[0_8px_12px_rgba(0,0,0,0.6)]" />}
    </span>
  );
}

/** El pack en el catálogo: su arte, nombre, precio y COMPRAR. El contenido, en el detalle. */
export function BundleOfferCard({ product, index, onSelect }: { product: ResolvedProduct; index: number; onSelect: (p: ResolvedProduct) => void }) {
  const packs = product.grant.packs.map((x) => getPack(x.packId)).filter((p): p is PackDef => !!p);
  const lead = packs[packs.length - 1] ?? packs[0];
  return <OfferCard product={product} name={product.name} index={index} tone={lead ? packTone(lead) : ACCENT.cyan} onSelect={onSelect} art={<BundleArt product={product} />} />;
}
