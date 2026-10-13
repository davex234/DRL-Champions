"use client";

/**
 * TIENDA 4.0 · EL DETALLE DE COMPRA (Fase 49 → F72.4). Nada de `window.confirm`.
 *
 * F72.4 · El catálogo solo enseña imagen, nombre, precio y COMPRAR; TODO lo demás vive aquí y se ve ANTES de gastar:
 * contenido (nº de cartas, lo que trae una caja o un pack), las PROBABILIDADES reales (`productOdds`: la misma derivación
 * que la ficha `/packs/[id]` y, en la línea principal, la tabla con la que sortea el servidor), el precio por método, el
 * saldo actual y el saldo después. Con créditos y un sobre, «Confirmar compra» llama a `onConfirm` (la compra real,
 * validada y cobrada en el servidor). Todo lo demás —dinero real sin pasarela, productos sin precio o sin entrega por
 * créditos— se enseña como pendiente, con el botón desactivado: no se simula ningún cobro.
 *
 * `PurchaseDetails` es el cuerpo puro (se prueba con render estático); `PurchaseModal` pone el portal, el foco y Escape.
 */
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ACCENT } from "@/design/tokens";
import { formatCredits } from "@/lib/format";
import type { PurchaseOption, ResolvedProduct } from "@/domain/store/types";
import { NxButton } from "@/components/ui/NxButton";
import { BoxVisual, BundleArt } from "./StoreProducts";
import { packArtwork } from "@/data/packArtwork";
import {
  METHOD_LABEL, accentStyle, cardFacts, contentsLines, formatGame, formatMoney, packOf, packTone, productName, productOdds,
  rarityColor, rarityLabel, type OddsGroup,
} from "./storeView";
import { css } from "./storeClasses";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("store");

export type PurchasePhase =
  | { at: "confirm" }
  | { at: "working" }
  | { at: "done"; balance: number }
  | { at: "failed"; message: string };

interface Props {
  product: ResolvedProduct;
  credits: number;
  owned: number;
  phase: PurchasePhase;
  onConfirm: () => void;
  onOpenNow: () => void;
  onClose: () => void;
}

const PENDING_COPY: Record<Exclude<PurchaseOption["status"], "AVAILABLE">, string> = {
  CHECKOUT_PENDING: "El pago con dinero real todavía no está activo. No se te cobrará nada.",
  PRICE_PENDING: "Aún no tiene precio. Lo anunciaremos aquí.",
  FULFILMENT_PENDING: "Todavía no se puede comprar con créditos.",
};

const KIND_LABEL = { PACK: "Sobre", BOX: "Caja · 10 sobres", CARD: "Carta de la tienda", BUNDLE: "Pack especial" } as const;

const SOURCE_NOTE: Record<OddsGroup["source"], string> = {
  "class-table": "Media por carta del sobre.",
  "measured": "Probabilidad de cada carta, medida con el motor real (20.000 aperturas).",
  "weights": "Probabilidad de cada carta según los pesos del sobre.",
};

/** Una tabla de probabilidades: lista vertical (legible en móvil), color + texto (nunca solo color). */
function OddsTable({ group, titled }: { group: OddsGroup; titled: boolean }) {
  useLocale();
  return (
    <div data-odds-source={group.source} data-pack-id={group.packId}>
      <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">
        {t("Probabilidades")}{titled ? ` · ${group.packName}` : ""}
      </p>
      <ul className="mt-1.5 divide-y divide-white/[0.06]">
        {group.rows.map((r) => (
          <li key={r.key} data-testid="odds-row" data-key={`${group.packId}:${r.key}`} data-pct={r.pct} className="flex items-center gap-2 py-1">
            <span aria-hidden className="h-2 w-2 shrink-0 rotate-45" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}` }} />
            <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
              <span className="font-display font-bold uppercase tracking-wide text-white">{td(r.label)}</span>
              {r.scope && <span className="text-ink-faint"> · {td(r.scope)}</span>}
            </span>
            <span className="font-display text-readout-sm font-bold tabular-nums text-white">{td(r.pct)}</span>
          </li>
        ))}
      </ul>
      {/* Icon por sobre (2026-10-09): la frase y las cifras salen del plan que sortea el servidor. */}
      {group.icon && (
        <div className="mt-1.5" data-testid="odds-icon">
          <p className="text-caption font-bold text-white">{td(group.icon.text)}</p>
          {group.icon.cards.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-label text-ink-secondary" data-testid="odds-icon-cards">
              {group.icon.cards.map((line) => <li key={line}>{td(line)}</li>)}
            </ul>
          )}
          {group.icon.method && <p className="mt-0.5 text-label text-ink-faint" data-testid="odds-icon-method">{td(group.icon.method)}</p>}
        </div>
      )}
      <p className="mt-1 text-label text-ink-faint">{td(SOURCE_NOTE[group.source])}{group.guarantee ? ` ${group.guarantee}.` : ""}</p>
      {group.slots && (
        <ul className="mt-1.5 space-y-0.5 text-label text-ink-secondary" data-testid="odds-slots">
          {group.slots.map((line) => <li key={line}>{td(line)}</li>)}
        </ul>
      )}
      {group.teamBoost && <p className="mt-1 text-label text-ink-faint">{td(group.teamBoost)}</p>}
    </div>
  );
}

export function PurchaseDetails({ product, credits, owned, phase, onConfirm, onOpenNow, onClose, titleId }: Props & { titleId: string }) {
  useLocale();
  const pack = packOf(product);
  const card = product.cardId ? cardFacts(product.cardId) : null;
  const game = product.options.find((o) => o.method === "GAME_CURRENCY");
  const money = product.options.find((o) => o.method === "REAL_MONEY");
  const canPayCredits = game?.status === "AVAILABLE" && game.price !== null;
  const price = game?.price ?? 0;
  const short = canPayCredits && credits < price;
  const working = phase.at === "working";
  const lines = contentsLines(product);
  const art = pack ? pack.cms?.art ?? packArtwork(pack.id) : null;
  const odds = productOdds(product);

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-5 sm:p-7">
      {/* Imagen grande del producto */}
      <div className="grid place-items-center">
        {product.kind === "CARD" && card && <img src={card.image} alt={t("Carta de {nick}", { nick: card.nick })} width={750} height={1048} data-card-art className="nx-card-art h-[180px] w-auto drop-shadow-[0_16px_24px_rgba(0,0,0,0.6)] sm:h-[260px]" />}
        {product.kind === "BOX" && pack && <div className="py-4 sm:py-8"><BoxVisual pack={pack} width={170} /></div>}
        {product.kind === "PACK" && art && <img src={art} alt={t("Arte de {v}", { v: td(pack?.name) ?? td(product.name) })} width={780} height={1140} className={`${css.packArt} h-[170px] w-auto sm:h-[250px]`} />}
        {product.kind === "BUNDLE" && <div className="h-[170px] w-[200px] sm:h-[250px]"><BundleArt product={product} /></div>}
      </div>

      <div className="min-w-0">
        <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">{td(KIND_LABEL[product.kind])}</p>
        <h2 id={titleId} className="mt-1 font-display text-[clamp(22px,3vw,30px)] font-bold uppercase leading-none tracking-wide text-white">
          {td(productName(product))}
        </h2>
        {card && <p className="mt-1 text-caption" style={{ color: rarityColor(card.rarity) }}>{td(card.edition)} · {rarityLabel(card.rarity)} {t("· OVR")} {card.ovr}{card.team ? ` · ${card.team}` : ""}{card.role ? ` · ${card.role}` : ""}</p>}

        {/* Contenido */}
        <ul className="mt-3 space-y-1 text-body text-ink-secondary">
          {product.kind === "PACK" && pack && <li><span className="font-bold text-white">{pack.cardCount === 1 ? t("1 carta") : t("{cardCount} cartas", { cardCount: pack.cardCount })}</span> · {td(pack.description)}</li>}
          {(product.kind === "BOX" || product.kind === "BUNDLE") && lines.map((l) => <li key={l}>{td(l)}</li>)}
          {product.kind === "BOX" && <li className="text-ink-muted">{t("Los 10 sobres se añaden a tu inventario sin abrir: tú decides cuándo abrirlos.")}</li>}
          {product.kind === "CARD" && <li className="text-ink-muted">{t("Una carta concreta vendida por NEXUS. No es el Marketplace.")}</li>}
        </ul>

        {/* Probabilidades reales, ANTES de confirmar */}
        {odds.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
            {odds.map((g) => <OddsTable key={g.packId} group={g} titled={odds.length > 1 || product.kind === "BOX"} />)}
          </div>
        )}

        {/* Pago por créditos: precio, saldo y saldo después */}
        {game && phase.at !== "done" && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">{td(METHOD_LABEL.GAME_CURRENCY)}</p>
            {canPayCredits ? (
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="nx-clip-sm bg-white/[0.04] px-2 py-2"><dt className="text-label uppercase tracking-wide2 text-ink-faint">{t("Precio")}</dt><dd className="font-display text-readout-sm font-bold text-drl-gold">{formatGame(price)}</dd></div>
                <div className="nx-clip-sm bg-white/[0.04] px-2 py-2"><dt className="text-label uppercase tracking-wide2 text-ink-faint">{t("Tu saldo")}</dt><dd data-testid="balance-now" className="font-display text-readout-sm font-bold text-white">{formatCredits(credits)}</dd></div>
                <div className={`nx-clip-sm px-2 py-2 ${short ? "bg-bad/15" : "bg-white/[0.04]"}`}><dt className="text-label uppercase tracking-wide2 text-ink-faint">{t("Después")}</dt><dd data-testid="balance-after" className={`font-display text-readout-sm font-bold ${short ? "text-bad" : "text-white"}`}>{short ? "—" : formatCredits(credits - price)}</dd></div>
              </dl>
            ) : (
              <p className="mt-1 text-caption text-ink-secondary">{formatGame(game.price)} · {td(PENDING_COPY[game.status as keyof typeof PENDING_COPY])}</p>
            )}
            {short && (
              <p role="alert" className="mt-2 text-caption text-bad">{t("Saldo insuficiente: te faltan")} {formatCredits(price - credits)} {t("DRL Credits.")}</p>
            )}
          </div>
        )}

        {/* Pago con dinero real */}
        {money && phase.at !== "done" && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">{td(METHOD_LABEL.REAL_MONEY)}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-readout-sm font-bold text-white">{formatMoney(money.price)}</span>
              <span className="nx-clip-sm border border-white/20 bg-white/[0.04] px-2 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/70">{t("Próximamente")}</span>
            </div>
            {money.status !== "AVAILABLE" && <p className="mt-1 text-caption text-ink-muted">{td(PENDING_COPY[money.status])}</p>}
          </div>
        )}

        {/* Resultado */}
        {phase.at === "done" && (
          <p role="status" className="mt-4 border border-ok/40 bg-ok/10 px-3 py-2 text-caption text-ok">
            {t("Sobre añadido a tu inventario. Saldo:")} {formatCredits(phase.balance)} {t("DRL Credits.")}
          </p>
        )}
        {phase.at === "failed" && <p role="alert" className="mt-4 border border-bad/40 bg-bad/10 px-3 py-2 text-caption text-bad">{playerMessage(phase.message)}</p>}

        {/* Acciones */}
        <div className="mt-5 flex flex-wrap justify-end gap-2.5">
          {phase.at === "done" ? (
            <>
              <NxButton variant="ghost" size="md" onClick={onClose}>{t("Seguir comprando")}</NxButton>
              <NxButton variant="primary" size="md" onClick={onOpenNow}>{t("Abrir ahora")}</NxButton>
            </>
          ) : (
            <>
              <NxButton variant="ghost" size="md" onClick={onClose} disabled={working}>{t("Cancelar")}</NxButton>
              {owned > 0 && pack && product.kind === "PACK" && <NxButton variant="secondary" size="md" onClick={onOpenNow} disabled={working}>{t("Abrir uno (")}{owned})</NxButton>}
              {canPayCredits ? (
                <NxButton variant="primary" size="md" onClick={onConfirm} disabled={working || short} aria-describedby={short ? undefined : titleId}>
                  {working ? t("Procesando…") : price === 0 ? t("Conseguir gratis") : t("Confirmar compra · {price}", { price: formatGame(price) })}
                </NxButton>
              ) : (
                <NxButton variant="secondary" size="md" disabled>{t("Próximamente")}</NxButton>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PurchaseModal(props: Props) {
  const { product, phase, onClose } = props;
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const pack = packOf(product);
  const card = product.cardId ? cardFacts(product.cardId) : null;
  const tone = card ? rarityColor(card.rarity) : pack ? packTone(pack) : ACCENT.cyan;
  const working = phase.at === "working";

  const latest = useRef({ onClose, working });
  latest.current = { onClose, working };

  // Foco dentro del diálogo, Escape para cerrar y el foco vuelve a donde estaba (una vez por apertura).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const focusables = () => [...(root?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])") ?? [])];
    // F72.4 · el foco entra SIN desplazar: en un detalle más alto que la pantalla el jugador empieza arriba (imagen,
    // contenido y probabilidades) y no saltando directo a los botones.
    focusables()[0]?.focus({ preventScroll: true });
    root?.parentElement?.scrollTo?.({ top: 0 });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !latest.current.working) { e.preventDefault(); latest.current.onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);

  // Portal al <body>: la página aísla su propio contexto de apilamiento y el diálogo tiene que quedar por
  // encima de TODO el cromo (barra superior y dock móvil). F72.4: centrado con `m-auto`, NO `place-items-center`:
  // un detalle más alto que la pantalla (un pack con dos tablas, un móvil) empieza arriba y se recorre con scroll,
  // en vez de desbordar hacia arriba fuera de alcance.
  return createPortal(
    <div className={`${css.scrim} fixed inset-0 z-modal grid overflow-y-auto p-3 sm:p-6`} onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="store-purchase-modal"
        className={`${css.modal} relative m-auto w-full max-w-[760px]`}
        style={accentStyle(tone) as CSSProperties}
      >
        <PurchaseDetails {...props} titleId={titleId} />
      </div>
    </div>,
    document.body,
  );
}
