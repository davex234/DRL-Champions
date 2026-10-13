"use client";

/**
 * MAPA DE ROAD TO CHAMPIONS (Fase 35).
 *
 * Escritorio: cada capítulo es una banda con sus nodos sobre una línea que ondula (sin scroll horizontal).
 * Móvil: la misma banda en vertical, un nodo por fila. Los nodos son BOTONES reales (teclado, foco, 44 px) y su
 * estado se lee en TEXTO («Bloqueado», «Disponible», «Completado»), no solo por color: bloqueado = apagado con
 * candado; disponible = cian con pulso; completado = marca ✓; jefe = más grande, con halo y ◆.
 *
 * Decoración: SVG/CSS estático; lo animado (`nx-node-pulse`, `nx-energy`) se apaga con movimiento reducido.
 */
import { cn } from "@/lib/format";
import type { CampaignChapterView, CampaignNodeView, CampaignSnapshot } from "@/domain/campaign/snapshot";
import { STATUS_LABEL, chapterLayout, nodeAriaLabel, nodeCode } from "@/lib/campaign/presentation";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("campaign");

export const CHAPTER_THEME: Record<string, { rgb: string; label: string }> = {
  clasificatorio: { rgb: "25,227,255", label: "Clasificatorio" },
  circuito: { rgb: "150,120,255", label: "Circuito" },
  campeones: { rgb: "255,211,92", label: "Campeones" },
};
const themeOf = (key: string) => CHAPTER_THEME[key] ?? CHAPTER_THEME.clasificatorio;

const OK_RGB = "63,192,122";

function hexPoints(r: number, cx = 50, cy = 50): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function NodeGlyph({ node, rgb, size }: { node: CampaignNodeView; rgb: string; size: number }) {
  const locked = node.status === "LOCKED";
  const done = node.status === "COMPLETED";
  const stroke = locked ? "rgba(255,255,255,0.22)" : done ? `rgba(${OK_RGB},0.95)` : `rgba(${rgb},0.95)`;
  const fill = locked ? "rgba(255,255,255,0.03)" : done ? `rgba(${OK_RGB},0.16)` : `rgba(${rgb},0.18)`;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {node.status === "AVAILABLE" && (
        <span aria-hidden className="nx-node-pulse absolute rounded-full" style={{ inset: -7, boxShadow: `0 0 0 2px rgba(${rgb},0.55), 0 0 22px rgba(${rgb},0.45)` }} />
      )}
      {node.type === "BOSS" && !locked && (
        <span aria-hidden className="absolute rounded-full" style={{ inset: -16, background: `radial-gradient(circle, rgba(${done ? OK_RGB : rgb},0.32), transparent 68%)` }} />
      )}
      <svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 h-full w-full">
        <polygon points={hexPoints(46)} fill={fill} stroke={stroke} strokeWidth={node.type === "BOSS" ? 5 : 4} />
        {node.type !== "MATCH" && <polygon points={hexPoints(34)} fill="none" stroke={stroke} strokeOpacity={0.6} strokeWidth={2} />}
      </svg>
      <span aria-hidden className={cn("relative font-display font-bold leading-none", locked ? "text-white/40" : "text-white")} style={{ fontSize: node.type === "BOSS" ? 26 : 18 }}>
        {locked ? <LockIcon className="h-5 w-5" /> : node.type === "BOSS" ? "◆" : node.type === "ELITE" ? "◈" : node.order}
      </span>
      {done && (
        <span aria-hidden className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full text-[13px] font-bold text-black" style={{ background: `rgb(${OK_RGB})` }}>
          ✓
        </span>
      )}
    </span>
  );
}

const glyphSize = (n: CampaignNodeView) => (n.type === "BOSS" ? 84 : n.type === "ELITE" ? 66 : 56);

function statusTone(n: CampaignNodeView): string {
  return n.status === "LOCKED" ? "text-white/45" : n.status === "COMPLETED" ? "text-[#6fe0a0]" : "text-drl-cyan";
}

export function NodeButton({
  node, rgb, selected, onSelect, layout,
}: { node: CampaignNodeView; rgb: string; selected: boolean; onSelect: (id: string) => void; layout: "stack" | "row" }) {
  useLocale();
  const locked = node.status === "LOCKED";
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-label={nodeAriaLabel(node)}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-node={node.id}
      data-status={node.status}
      data-type={node.type}
      className={cn(
        "nx-focus group relative flex min-h-[44px] items-center rounded-control transition duration-fast",
        layout === "stack" ? "w-[136px] flex-col gap-2 px-1 py-1.5 text-center" : "w-full gap-3.5 px-2 py-2 text-left hover:bg-white/[0.04]",
        selected && "bg-white/[0.06]",
        locked && "opacity-75",
      )}
    >
      <NodeGlyph node={node} rgb={rgb} size={glyphSize(node)} />
      <span className={cn("block min-w-0", layout === "row" && "flex-1", layout === "stack" && "rounded-[4px] bg-[#070a12]/85 px-1.5 py-0.5")}>
        <span className="block font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
          {nodeCode(node)} · {td(node.typeLabel)}
        </span>
        <span className={cn("block font-display text-[14px] font-bold uppercase leading-tight", locked ? "text-white/60" : "text-white", layout === "stack" && "line-clamp-2")}>
          {node.name}
        </span>
        {layout === "row" && (
          <span className="block truncate text-caption text-ink-muted">
            {node.opponent.playable ? t("vs {name}", { name: node.opponent.name }) : t("Rival no disponible")} · {td(node.tierLabel)}
          </span>
        )}
        <span className={cn("mt-0.5 block text-[11px] font-bold uppercase tracking-[0.12em]", statusTone(node))}>
          {td(STATUS_LABEL[node.status])}
          {node.isNext && (" " + t("· Siguiente"))}
        </span>
      </span>
    </button>
  );
}

function ChapterBand({ chapter, selectedId, onSelect }: { chapter: CampaignChapterView; selectedId: string | null; onSelect: (id: string) => void }) {
  useLocale();
  const theme = themeOf(chapter.theme);
  const pts = chapterLayout(chapter.nodes.length);
  const lit = (i: number) => chapter.nodes[i].status === "COMPLETED";

  return (
    <section
      aria-labelledby={`chapter-${chapter.id}`}
      data-chapter={chapter.id}
      data-unlocked={chapter.unlocked}
      className="nx-clip relative isolate overflow-hidden border px-4 py-5 sm:px-6 sm:py-6"
      style={{
        borderColor: chapter.unlocked ? `rgba(${theme.rgb},0.32)` : "rgba(255,255,255,0.08)",
        background: chapter.unlocked
          ? `radial-gradient(70% 120% at 100% 0%, rgba(${theme.rgb},0.16), transparent 62%), radial-gradient(50% 90% at 0% 100%, rgba(${theme.rgb},0.08), transparent 70%), linear-gradient(180deg, #0a0e18, #06070d)`
          : "linear-gradient(180deg, #0a0c12, #06070b)",
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      {chapter.unlocked && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, rgba(${theme.rgb},0.9), transparent)` }} />
      )}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="nx-label" style={{ color: chapter.unlocked ? `rgb(${theme.rgb})` : undefined }}>{t("Capítulo")} {chapter.order}</p>
          <h2 id={`chapter-${chapter.id}`} className="font-display text-[clamp(22px,3vw,32px)] font-bold uppercase leading-none text-white">
            {chapter.name}
          </h2>
          <p className="mt-1 max-w-[62ch] text-caption text-ink-muted">{td(chapter.description)}</p>
        </div>
        <p className="flex items-center gap-2 font-display text-[12px] font-bold uppercase tracking-[0.14em]" data-testid={`chapter-progress-${chapter.id}`}>
          <span className="nx-readout text-[18px] text-white">{chapter.completed}/{chapter.total}</span>
          <span className="text-white/50">{t("nodos")}</span>
          <span className={cn("rounded-[3px] border px-2 py-0.5", chapter.complete ? "border-[#3fc07a]/60 text-[#6fe0a0]" : chapter.unlocked ? "border-white/20 text-white/70" : "border-white/10 text-white/40")}>
            {chapter.complete ? t("Completado") : chapter.unlocked ? t("En curso") : t("Bloqueado")}
          </span>
        </p>
      </header>

      {/* ── Escritorio / tableta: línea ondulada ── */}
      <div className="relative mt-3 hidden h-[248px] md:block">
        <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {pts.slice(1).map((p, i) => (
            <line
              key={i}
              x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y}
              vectorEffect="non-scaling-stroke"
              stroke={lit(i) ? `rgba(${theme.rgb},0.85)` : "rgba(255,255,255,0.16)"}
              strokeWidth={lit(i) ? 2.5 : 1.5}
              strokeDasharray={lit(i) ? undefined : "5 7"}
              className={lit(i) ? "nx-energy" : undefined}
            />
          ))}
        </svg>
        {chapter.nodes.map((n, i) => (
          <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${pts[i].x}%`, top: `${pts[i].y}%` }}>
            <NodeButton node={n} rgb={theme.rgb} selected={selectedId === n.id} onSelect={onSelect} layout="stack" />
          </div>
        ))}
      </div>

      {/* ── Móvil: vertical, un nodo por fila ── */}
      <ol className="relative mt-4 space-y-1.5 md:hidden" aria-label={t("Nodos del capítulo {order}", { order: chapter.order })}>
        <span aria-hidden className="absolute bottom-6 left-[37px] top-6 w-px" style={{ background: `linear-gradient(180deg, rgba(${theme.rgb},0.6), rgba(255,255,255,0.08))` }} />
        {chapter.nodes.map((n) => (
          <li key={n.id} className="relative">
            <NodeButton node={n} rgb={theme.rgb} selected={selectedId === n.id} onSelect={onSelect} layout="row" />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CampaignMap({
  snapshot, selectedId, onSelect, className,
}: { snapshot: CampaignSnapshot; selectedId: string | null; onSelect: (id: string) => void; className?: string }) {
  return (
    <div className={cn("space-y-4", className)} data-testid="campaign-map" data-available={snapshot.available}>
      {snapshot.chapters.map((c) => (
        <ChapterBand key={c.id} chapter={c} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
