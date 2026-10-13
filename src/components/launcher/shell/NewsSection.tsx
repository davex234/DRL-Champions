"use client";

/**
 * LAUNCHER — NOVEDADES.
 *
 * Tres piezas que comparten la misma tarjeta: el carrusel de la portada (`NewsSection`), la
 * pantalla completa (`NewsView`) y el lector (`NewsReader`).
 *
 * Las noticias SE ABREN. Un launcher que enseña titulares sin cuerpo es un cartel; este
 * monta un lector con el artículo, su artwork y su ficha.
 */
import { AnimatePresence, motion } from "framer-motion";
import { CATEGORY_ACCENT, formatDate, getGame, getNews, type LauncherNews } from "@/launcher";
import { cn } from "@/lib/format";
import { NewsArtwork } from "./GameArtwork";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

/* ── Tarjeta ─────────────────────────────────────────────────────────────── */

export function NewsCard({
  item, onOpen, index, motionScale, tall,
}: { item: LauncherNews; onOpen: () => void; index: number; motionScale: number; tall?: boolean }) {
  useLocale();
  const accent = item.accent || CATEGORY_ACCENT[item.category];
  const game = getGame(item.gameId);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={motionScale > 0 ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      whileHover={motionScale > 0 ? { y: -4, scale: 1.015 } : undefined}
      className={cn(
        "nx-clip-sm group relative isolate flex flex-col justify-end overflow-hidden border border-white/[0.07] text-left",
        "transition-shadow duration-normal hover:border-white/20",
        tall ? "h-[260px]" : "h-[188px]",
      )}
      style={{ ["--nx-chamfer-sm" as string]: "16px" }}
    >
      <NewsArtwork seed={item.artSeed} accent={accent} className="transition-transform duration-slow ease-out group-hover:scale-[1.06]" />
      {/* Halo que se enciende al apuntar: la tarjeta se ilumina, no cambia de forma. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-normal group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 0 1px ${accent}66, inset 0 -60px 80px -60px ${accent}` }}
      />

      <div className="relative space-y-1.5 p-4">
        <div className="flex items-center gap-2">
          <span
            className="nx-clip-sm px-2 py-0.5 font-display text-[9px] font-black uppercase tracking-[0.22em]"
            style={{ color: "var(--nx-canvas)", background: accent }}
          >
            {td(item.category)}
          </span>
          {game && <Badge>{game.name}</Badge>}
        </div>
        <h3 className="font-display text-[16px] font-black uppercase leading-tight tracking-wide text-white">
          {td(item.title)}
        </h3>
        <p className={cn("text-[11.5px] leading-snug text-white/55", tall ? "line-clamp-3" : "line-clamp-2")}>{td(item.excerpt)}</p>
        <p className="pt-0.5 font-display text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/30">
          {formatDate(item.date)}
        </p>
      </div>
    </motion.button>
  );
}

/* ── Portada ─────────────────────────────────────────────────────────────── */

export function NewsSection({
  onOpen, onSeeAll, motionScale,
}: { onOpen: (item: LauncherNews) => void; onSeeAll: () => void; motionScale: number }) {
  useLocale();
  const items = getNews().slice(0, 3);
  return (
    <section>
      <SectionTitle
        action={
          <button
            type="button"
            onClick={onSeeAll}
            className="font-display text-label font-bold uppercase tracking-[0.2em] text-white/40 transition hover:text-white"
          >
            {t("Ver todas")}
          </button>
        }
      >
        {t("Novedades")}
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, i) => (
          <NewsCard key={item.id} item={item} index={i} motionScale={motionScale} onOpen={() => onOpen(item)} />
        ))}
      </div>
    </section>
  );
}

/* ── Pantalla completa ───────────────────────────────────────────────────── */

export function NewsView({
  onOpen, motionScale,
}: { onOpen: (item: LauncherNews) => void; motionScale: number }) {
  useLocale();
  const [lead, ...rest] = getNews();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-tight text-white">
          {t("Nove")}<span className="text-drl">{t("dades")}</span>
        </h1>
        <p className="mt-1.5 text-[13px] text-white/45">{t("Todo lo que ha cambiado en el catálogo, por orden de publicación.")}</p>
      </header>

      {lead && <NewsCard item={lead} index={0} motionScale={motionScale} onOpen={() => onOpen(lead)} tall />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rest.map((item, i) => (
          <NewsCard key={item.id} item={item} index={i + 1} motionScale={motionScale} onOpen={() => onOpen(item)} />
        ))}
      </div>
    </div>
  );
}

/* ── Lector ──────────────────────────────────────────────────────────────── */

export function NewsReader({
  item, onClose, motionScale,
}: { item: LauncherNews | null; onClose: () => void; motionScale: number }) {
  useLocale();
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          className="fixed inset-0 z-modal grid place-items-center bg-black/80 p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionScale > 0 ? 0.2 : 0 }}
          onClick={onClose}
        >
          <motion.article
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: motionScale > 0 ? 0.32 : 0, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="nx-clip relative max-h-[86vh] w-full max-w-[820px] overflow-hidden border border-white/10 bg-[#0a0c14]"
          >
            <div className="relative h-[220px] shrink-0">
              <NewsArtwork seed={item.artSeed} accent={item.accent} />
              <button
                type="button"
                onClick={onClose}
                aria-label={t("Cerrar")}
                className="nx-clip-sm absolute right-3 top-3 h-8 w-8 bg-black/60 text-white/60 transition hover:bg-black/85 hover:text-white"
              >
                ✕
              </button>
              <div className="absolute inset-x-0 bottom-0 space-y-2 p-6">
                <span
                  className="nx-clip-sm inline-block px-2.5 py-1 font-display text-[9.5px] font-black uppercase tracking-[0.24em]"
                  style={{ color: "var(--nx-canvas)", background: item.accent }}
                >
                  {td(item.category)}
                </span>
                <h2 className="font-display text-[30px] font-black uppercase leading-none tracking-tight text-white">
                  {td(item.title)}
                </h2>
              </div>
            </div>

            <div className="nx-scroll max-h-[calc(86vh-220px)] overflow-y-auto p-6">
              <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-white/[0.07] pb-4">
                <Badge>{getGame(item.gameId)?.name ?? t("Cliente")}</Badge>
                <span className="font-display text-label font-bold uppercase tracking-[0.2em] text-white/30">
                  {formatDate(item.date)}
                </span>
              </div>
              <p className="mb-4 text-[15px] font-semibold leading-relaxed text-white/80">{td(item.excerpt)}</p>
              {item.body.map((p, i) => (
                <p key={i} className="mb-3.5 text-[13.5px] leading-[1.75] text-white/55">
                  {td(p)}
                </p>
              ))}
            </div>
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
