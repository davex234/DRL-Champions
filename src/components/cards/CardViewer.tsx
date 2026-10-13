"use client";

/**
 * CARD VIEWER — visor de cartas AAA (estilo Hearthstone / Marvel Snap / FUT).
 *
 * ARQUITECTURA CLAVE: se renderiza mediante React Portal directamente en `document.body`,
 * de modo que NUNCA depende del layout donde esté la carta. Esto resuelve la causa raíz del
 * bug anterior: las páginas usan `.animate-rise`, cuyo `animation-fill-mode: both` dejaba un
 * `transform: translateY(0)` permanente en la `<section>`; ese transform convertía a la
 * sección en "containing block" de los `position:fixed`, así que el modal se posicionaba
 * respecto a la sección (alta y scrolleable) y acababa fuera de la pantalla. Con el portal a
 * body, el visor es hijo directo de <body> (sin ancestros transformados) → `fixed` es
 * relativo al viewport siempre.
 *
 * Bloquea el scroll del fondo, cierra con ESC y con click fuera, y funciona en cualquier
 * tamaño de ventana (desktop, maximizado, pequeño, ultrapanorámico).
 *
 * Rendimiento: monta solo cuando está abierto (AnimatePresence en el llamante); el tilt 3D
 * usa MotionValues (no provoca re-render de React); datos derivados memoizados; capas
 * decorativas con pointer-events:none; un único backdrop-filter (en el overlay).
 */
import { lockScroll } from "@/lib/gameExperience/scrollLock";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { getTeam } from "@/data/teams";
import { countryName } from "@/data/countries";
import { displayedStats } from "@/domain/cards/ovr";
import { instanceValue } from "@/domain/economy/pricing";
import { formatCredits } from "@/lib/format";
import { CardRenderer } from "./CardRenderer";
import { CardFace, CardVisual } from "./CardVisual";
import { TeamLogo } from "./layers/TeamLogo";
import { Flag } from "./layers/Flag";
import { PriceSparkline } from "@/components/market/PriceSparkline";
import { ROLE_KIT, accoladeLabels, recommendedAgent, buildDescription } from "./cardLore";
import { CreditGlyph, GameGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("cards");

const SEASON = "Temporada 2025";

export interface CardViewerAction {
  label: string;
  icon: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
}

export interface CardViewerProps {
  card: CardDef;
  serial?: number;
  /**
   * El ejemplar que se está mirando, cuando se mira uno concreto. Con él, el visor enseña el
   * artwork hecho a mano de SU versión; sin él —una carta del catálogo que aún no tienes—
   * enseña el dibujado por capas, que es lo que siempre hizo.
   */
  uid?: string;
  ownership?: { owned?: boolean; count?: number; locked?: boolean };
  priceSeries?: number[];
  onClose: () => void;
  /** Acciones extra (Equipar/Mejorar/Mercado…). "Cerrar" se añade siempre. */
  actions?: CardViewerAction[];
  /** Contenido contextual extra (p.ej. UI de venta de la colección). */
  children?: React.ReactNode;
}

export function CardViewer({ card, serial, uid, ownership, priceSeries, onClose, actions, children }: CardViewerProps) {
  useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ESC para cerrar + bloqueo de scroll del fondo. F64 · y el FOCO: entra en la ficha al abrirla y vuelve al que la abrió.
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Fase 44.1 · bloqueo compartido con contador (antes guardaba/restauraba body por su cuenta y podía fugarse).
    const release = lockScroll();
    const t = window.setTimeout(() => layer.current?.focus({ preventScroll: true }), 30);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      release();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [onClose]);

  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);

  const data = useMemo(() => {
    if (!player) return null;
    const team = getTeam(player.team);
    const rol = card.role ?? player.role;
    const kit = ROLE_KIT[rol];
    const value = instanceValue(card, serial);
    const variation =
      priceSeries && priceSeries.length >= 2
        ? ((priceSeries[priceSeries.length - 1] - priceSeries[0]) / (priceSeries[0] || 1)) * 100
        : null;
    return {
      team,
      kit,
      value,
      variation,
      accolades: accoladeLabels(player),
      agent: recommendedAgent(rol),
      description: buildDescription(player, variant, canonicalCardTeam(card, player).label, rol),
    };
  }, [player, variant, card, serial, priceSeries]);

  if (!mounted || !player || !data) return null;
  const { kit, value, variation, accolades, agent, description } = data;
  const color = variant.palette.primary;
  const owned = ownership?.owned ?? true;
  const count = ownership?.count ?? 0;
  const locked = ownership?.locked ?? false;

  const overlay = (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center p-3 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      style={{
        background: `radial-gradient(120% 90% at 50% 30%, ${color}26, transparent 60%), rgba(3,4,9,0.82)`,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={tr("Ficha de la carta {id}", { id: card.id })}
      ref={layer}
      tabIndex={-1}
    >
      <motion.div
        className="relative flex max-h-[94vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-base-900/70 shadow-2xl lg:flex-row"
        initial={{ scale: 0.88, y: 28, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 20, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botón cerrar flotante */}
        <button
          onClick={onClose}
          aria-label={tr("Cerrar")}
          className="nx-clip-sm nx-press nx-focus absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center border border-white/15 bg-black/40 text-white/70 backdrop-blur transition hover:bg-white/10 hover:text-white"
        >
          <GameGlyph name="close" className="h-4 w-4" />
        </button>

        {/* ───────── Escenario de la carta (izquierda) ───────── */}
        <div className="relative flex shrink-0 items-center justify-center overflow-hidden p-8 lg:w-[44%]">
          {/* Glow dinámico por rareza */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[80px]"
            style={{ background: `radial-gradient(circle, ${color}, transparent 65%)` }}
          />
          <Particles color={color} />

          <div className="relative">
            <motion.div
              initial={{ rotateY: -18, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ delay: 0.08, type: "spring", stiffness: 120, damping: 16 }}
              style={{ transformPerspective: 1200 }}
            >
              {card.image ? (
                /* Catálogo diseñado: la carta ES su imagen (con OVR, rol y estadísticas impresos). */
                <CardFace artwork={{ url: card.image, cardId: card.id, cardVersion: 1, format: "webp" }}
                  alt={tr("Carta de {nick} · {label}", { nick: player.nick, label: td(variant.label) })} chamfer="25px" className="w-[360px]">
                  <CardRenderer player={player} variant={variant} stats={card.stats} ovr={card.ovr} serial={serial} size="xl" interactive effects />
                </CardFace>
              ) : (
                <CardVisual uid={uid} alt={tr("Carta de {id}", { id: card.id })} chamfer="25px" className="w-[360px]">
                  <CardRenderer
                    player={player}
                    variant={variant}
                    stats={card.stats}
                    ovr={card.ovr}
                    serial={serial}
                    size="xl"
                    interactive
                    effects
                  />
                </CardVisual>
              )}
            </motion.div>
            {/* Reflejo en el suelo */}
            <div
              className="pointer-events-none mx-auto mt-2 h-16 w-[80%] rounded-[50%] opacity-50 blur-xl"
              style={{ background: `radial-gradient(ellipse, ${color}88, transparent 70%)` }}
            />
          </div>
        </div>

        {/* ───────── Panel de información (derecha) ───────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-8 lg:px-8">
            {/* Cabecera */}
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-4xl font-black uppercase leading-none text-white">
                  {player.nick}
                </h2>
                {player.fullName && <p className="mt-1 text-sm text-white/45">{td(player.fullName)}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-5xl font-black leading-none" style={{ color }}>
                  {card.ovr}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-white/40">{tr("Rating")}</p>
              </div>
            </div>

            {/* Badges */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-3 py-1 font-display text-sm font-bold uppercase tracking-wide"
                style={{ background: color, color: variant.palette.text }}
              >
                {td(variant.label)}
              </span>
              <RankStars rank={variant.rank} color={color} />
              {variant.serialized && serial != null && (
                <span className="rounded-full bg-drl/20 px-3 py-1 font-display text-sm font-bold text-drl">
                  #{serial}/{variant.serialLimit}
                </span>
              )}
              <StateChips owned={owned} locked={locked} count={count} serialized={variant.serialized} />
            </div>

            {/* Meta grid */}
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Meta label={tr("Equipo")}>
                <TeamLogo team={player.team} size={18} />
                <span className="truncate">{td(canonicalCardTeam(card, player).label)}</span>
              </Meta>
              <Meta label={tr("Nacionalidad")}>
                <Flag iso={player.country} width={18} />
                <span className="truncate">{countryName(player.country)}</span>
              </Meta>
              <Meta label={tr("Rol")}>{td(card.role) ?? td(player.role)}</Meta>
              <Meta label={tr("Región")}>{td(player.region)}</Meta>
              <Meta label={tr("Edición")}>{td(variant.label)}</Meta>
              <Meta label={tr("Temporada")}>{td(SEASON)}</Meta>
              <Meta label={tr("Agente")}>{td(agent)}</Meta>
              <Meta label={tr("Estado")}>{owned ? (locked ? tr("Bloqueada") : tr("En posesión")) : tr("No obtenida")}</Meta>
              {count > 1 && <Meta label={tr("Copias")}>x{count}</Meta>}
            </div>

            {/* Estadísticas */}
            <Section title={tr("Estadísticas")}>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {displayedStats(card).map(({ key, full, value }) => (
                  <div key={key}>
                    <div className="flex justify-between text-xs">
                      <span className="text-white/60">{td(full)}</span>
                      <span className="font-display font-bold tabular-nums text-white">{value}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${value}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Kit recomendado (habilidades + traits por rol) */}
            <Section title={tr("Kit recomendado · {v}", { v: td(card.role) ?? td(player.role) })}>
              <div className="space-y-1.5">
                {kit.abilities.map((a) => (
                  <div key={a.name} className="flex gap-2 text-[13px]">
                    <span className="font-semibold text-white">{td(a.name)}</span>
                    <span className="text-white/45">— {td(a.desc)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {kit.traits.map((t) => (
                  <span key={t} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] text-white/70">
                    {td(t)}
                  </span>
                ))}
              </div>
            </Section>

            {/* Historial competitivo / palmarés */}
            {accolades.length > 0 && (
              <Section title={tr("Historial competitivo")}>
                <div className="flex flex-wrap gap-1.5">
                  {accolades.map((a) => (
                    <span key={a} className="rounded-lg border border-drl-gold/30 bg-drl-gold/10 px-2.5 py-1 text-[11px] font-semibold text-drl-gold">
                      🏆 {td(a)}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Mercado */}
            <Section title={tr("Mercado")}>
              <div className="flex items-center justify-between rounded-xl border border-drl-gold/30 bg-drl-gold/10 px-4 py-2.5">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/40">{tr("Valor estimado")}</p>
                  <p className="font-display text-xl font-bold text-drl-gold"><CreditGlyph className="align-[-3px]" /> {formatCredits(value)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {variation != null && (
                    <span className={`font-display text-sm font-bold ${variation >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {variation >= 0 ? "▲" : "▼"} {Math.abs(variation).toFixed(1)}%
                    </span>
                  )}
                  {priceSeries && priceSeries.length >= 2 && (
                    <PriceSparkline values={priceSeries} color={variation != null && variation < 0 ? "#ff5c8a" : "#37e6a0"} />
                  )}
                </div>
              </div>
            </Section>

            {/* Descripción */}
            <Section title={tr("Descripción")}>
              <p className="text-[13px] leading-relaxed text-white/65">{td(description)}</p>
            </Section>

            {children && <div className="mt-4 space-y-2">{children}</div>}
          </div>

          {/* ───────── Barra de acciones ───────── */}
          {(actions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-white/10 bg-base-900/80 px-6 py-3 lg:px-8">
              {actions!.map((a) => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className={
                    a.variant === "primary"
                      ? "nx-clip-sm nx-press flex min-h-[44px] items-center gap-1.5 bg-drl px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
                      : "nx-clip-sm nx-press flex min-h-[44px] items-center gap-1.5 border border-white/15 bg-white/5 px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-white/75 transition hover:bg-white/10 hover:text-white"
                  }
                >
                  <GameGlyph symbol={a.icon} className="h-4 w-4" />
                  {td(a.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, document.body);
}

// ───────── Subcomponentes ─────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="mt-5">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{td(title)}</p>
      {children}
    </div>
  );
}
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-lg border border-white/10 bg-base-700/40 px-3 py-2">
      <p className="text-[9px] uppercase tracking-widest text-white/40">{td(label)}</p>
      <div className="mt-0.5 flex items-center gap-1.5 font-display text-sm font-semibold capitalize text-white">
        {children}
      </div>
    </div>
  );
}
function RankStars({ rank, color }: { rank: number; color: string }) {
  useLocale();
  const stars = Math.max(1, Math.min(5, Math.ceil(rank / 3)));
  return (
    <span className="flex items-center gap-0.5" title={tr("Rareza {rank}", { rank })}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="text-sm" style={{ color: i < stars ? color : "rgba(255,255,255,0.2)" }}>
          ★
        </span>
      ))}
    </span>
  );
}
function StateChips({ owned, locked, count, serialized }: { owned: boolean; locked: boolean; count: number; serialized: boolean }) {
  useLocale();
  return (
    <>
      {!owned && <Chip className="border-white/20 bg-white/5 text-white/60"><GameGlyph name="lock" className="mr-1 align-[-2px]" />{tr("No obtenida")}</Chip>}
      {locked && <Chip className="border-amber-400/40 bg-amber-400/10 text-amber-300">{tr("Bloqueada")}</Chip>}
      {count > 1 && <Chip className="border-drl/40 bg-drl/15 text-drl">{tr("Repetida ×")}{count}</Chip>}
      {serialized && <Chip className="border-drl-cyan/40 bg-drl-cyan/10 text-drl-cyan">{tr("Serie limitada")}</Chip>}
    </>
  );
}
function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function Particles({ color }: { color: string }) {
  const dots = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        x: 8 + ((i * 37) % 84),
        size: 2 + ((i * 13) % 4),
        duration: 4 + ((i * 7) % 5),
        delay: (i % 6) * 0.6,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d) => (
        <motion.span
          key={d.id}
          className="absolute rounded-full"
          style={{ left: `${d.x}%`, bottom: -8, width: d.size, height: d.size, background: color, boxShadow: `0 0 ${d.size * 2}px ${color}` }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: [-10, -340], opacity: [0, 0.8, 0] }}
          transition={{ duration: d.duration, delay: d.delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
