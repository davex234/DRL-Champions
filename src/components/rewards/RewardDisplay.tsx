/**
 * FASE 62 · LA REPRESENTACIÓN COMÚN DE UNA RECOMPENSA.
 *
 * Hub, post-partida, reclamos y portada pintan las recompensas con ESTA pieza (y la lógica de `domain/rewards/display`):
 *   · sobre   → su ARTE REAL (`packArtwork`); sin arte, el nombre del sobre (no se inventa imagen);
 *   · carta   → `CardArt` con la imagen del catálogo;
 *   · créditos → la moneda real del producto (`DrlCoin`);
 *   · XP      → «XP de cuenta» (cian) y «XP de temporada» (dorado), SIEMPRE con su nombre: nunca «XP» a secas;
 *   · cosmético → texto (no hay asset propio);
 *   · puntos  → puntos de rango.
 * No calcula nada: pinta la recompensa que decidió el servidor o el contenido.
 */
import { cn } from "@/lib/format";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { packArtwork } from "@/data/packArtwork";
import { CardArt } from "@/components/cards/CardArt";
import { DrlCoin } from "@/components/credits/CreditsPieces";
import { rewardItems, rewardTier, type RewardItem, type RewardLike } from "@/domain/rewards/display";

export type RewardDisplaySize = "sm" | "md" | "lg";
const ART_H: Record<RewardDisplaySize, number> = { sm: 40, md: 64, lg: 120 };

export function rewardItemsFor(reward: RewardLike | null | undefined, extra: { seasonXp?: number; points?: number } = {}): RewardItem[] {
  return rewardItems(reward, {
    ...extra,
    packName: (id) => getPack(id)?.name ?? null,
    cardName: (id) => { const c = getCard(id); return c ? c.id.split("__")[0].toUpperCase() : null; },
  });
}

export function RewardDisplay({
  reward, seasonXp, points, size = "md", layout = "row", className, dim = false,
}: {
  reward: RewardLike | null | undefined;
  seasonXp?: number;
  points?: number;
  size?: RewardDisplaySize;
  layout?: "row" | "stack";
  className?: string;
  dim?: boolean;
}) {
  const items = rewardItemsFor(reward, { seasonXp, points });
  if (items.length === 0) return <span className={cn("text-[12px] text-white/45", className)}>Sin recompensa</span>;
  const tier = rewardTier(items);
  return (
    <span
      className={cn("inline-flex items-center gap-2", layout === "stack" ? "flex-col" : "flex-wrap", dim && "opacity-45 grayscale", className)}
      data-reward-display={tier}
      data-reward-kinds={items.map((i) => i.kind).join(",")}
      aria-label={items.map((i) => i.label).join(", ")}
    >
      {items.map((i) => <Piece key={`${i.kind}:${i.ref ?? ""}`} item={i} size={size} />)}
    </span>
  );
}

function Piece({ item, size }: { item: RewardItem; size: RewardDisplaySize }) {
  const h = ART_H[size];
  switch (item.kind) {
    case "pack": {
      const art = packArtwork(item.ref!);
      const w = Math.round((h * 780) / 1140);
      return (
        <span className="relative inline-flex items-center gap-1.5" data-reward-item="pack" title={item.label}>
          {art
            ? <img src={art} alt="" width={w} height={h} loading="lazy" decoding="async" className="object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)]" style={{ height: h, width: w }} data-pack-art={item.ref} />
            : null}
          {item.amount > 1 && <b className="absolute -right-1.5 -top-1 rounded-full bg-[#ffd35c] px-1.5 font-display text-[11px] leading-5 text-[#1a1204]">×{item.amount}</b>}
          <span className={cn("font-display font-bold uppercase tracking-[0.06em] text-white/85", size === "sm" ? "text-[10px]" : "text-[12px]", art && size === "sm" && "sr-only")}>{item.label}</span>
        </span>
      );
    }
    case "card": {
      const c = getCard(item.ref!);
      const w = Math.round((h * 750) / 1048);
      return (
        <span className="inline-flex items-center gap-1.5" data-reward-item="card" title={item.label}>
          {c?.image ? <span className="inline-block" style={{ height: h, width: w }}><CardArt src={c.image} alt="" shadow="rest" /></span> : null}
          <span className="font-display text-[12px] font-bold uppercase text-white/85">{item.label}</span>
        </span>
      );
    }
    case "credits":
      return (
        <span className={cn("inline-flex items-center gap-1 font-display font-extrabold tabular-nums text-[#ffd35c]", size === "lg" ? "text-[22px]" : size === "md" ? "text-[15px]" : "text-[12px]")} data-reward-item="credits">
          <DrlCoin size={size === "lg" ? 26 : size === "md" ? 18 : 13} />
          +{item.amount.toLocaleString("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions)}
          <span className="sr-only"> créditos</span>
        </span>
      );
    case "accountXp":
    case "seasonXp":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display font-bold tabular-nums",
            size === "sm" ? "text-[10px]" : "text-[12px]",
            item.kind === "accountXp" ? "bg-[#2fe0ff]/12 text-[#7ff0ff] ring-1 ring-[#2fe0ff]/40" : "bg-[#ffd35c]/12 text-[#ffe08a] ring-1 ring-[#ffd35c]/40",
          )}
          data-reward-item={item.kind}
        >
          +{item.label}
        </span>
      );
    case "cosmetic":
      return <span className="rounded-md px-2 py-0.5 text-[11px] text-white/75 ring-1 ring-white/20" data-reward-item="cosmetic">{item.label}</span>;
    case "points":
      return <span className="font-display text-[12px] font-bold text-drl-cyan" data-reward-item="points">+{item.label}</span>;
  }
}
