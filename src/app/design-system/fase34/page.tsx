"use client";

/**
 * ARNÉS QA · FASE 34 — `/design-system/fase34?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del Season Hub (`SeasonHub`, `SeasonHero`, paneles, `SeasonRecap`,
 * `SeasonArchive`, `SeasonHomeBlockView`) con fotos QA SYNTHETIC (`./fixtures`) de la misma forma que
 * `GET /api/game/season`. El reloj de servidor de cada escena es fijo; la cuenta atrás corre desde él.
 * Sin sesión, sin red, sin base de datos.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { SeasonHub } from "@/components/season/SeasonHub";
import { SeasonArchive } from "@/components/season/SeasonArchive";
import { SeasonHomeBlockView } from "@/components/season/SeasonHomeBlock";
import { NAV_SECTIONS } from "@/design/nav";
import type { ServerClock } from "@/domain/season/time";
import { hubAt, calendarAt, EVENTS, START, END, NOW_ACTIVE, QA_S2, S1 } from "./fixtures";

const D = 86_400_000; const H = 3_600_000;

export default function Fase34QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  const [mountedAt, setMountedAt] = useState(0);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); setMountedAt(Date.now()); }, []);
  const noop = () => {};

  const body = useMemo(() => {
    const clock = (serverNow: number, skewMs = 0): ServerClock => ({ serverNow, receivedAt: mountedAt + skewMs });
    const hub = (now: number, o: Parameters<typeof hubAt>[1] = {}, extra: { stale?: boolean; skew?: number; note?: string } = {}) => {
      const snap = hubAt(now, o);
      const c = clock(now, extra.skew ?? 0);
      return (
        <>
          {extra.note && <p className="mb-3 rounded border border-drl-gold/40 bg-drl-gold/10 px-3 py-1.5 text-caption text-drl-gold" data-synthetic="true">QA SYNTHETIC · {extra.note}</p>}
          <SeasonHub snap={snap} clock={c} onRefresh={noop} clientNow={extra.stale ? c.receivedAt + 11 * 60_000 : c.receivedAt} />
        </>
      );
    };
    switch (scene) {
      case "full": case "active": case "hero": case "countdown": case "pass": case "free-track": case "competitive-track":
      case "claimable": case "claimed": case "locked": case "pass-xp": case "account-xp": case "daily": case "weekly":
      case "competitive": case "recent-ranked": case "event-live": case "pickems-pending": case "collection": case "achievements":
      case "actions": case "calendar": case "keyboard": case "tablet":
        return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending" } });
      case "anonymous": return hub(NOW_ACTIVE, { personal: null });
      case "new-player": return hub(NOW_ACTIVE, { personal: { profile: "new", competitive: "none", pickems: "none", actions: "normal" } });
      case "upcoming": return hub(START - 3 * D - 5 * H, { personal: { profile: "new", competitive: "none", pickems: "none" }, events: EVENTS.upcomingOnly });
      case "ending-soon": return hub(END - 5 * D - 7 * H, { personal: { competitive: "established", pickems: "scored" } });
      case "final-day": return hub(END - 5 * H - 12 * 60_000, { personal: { competitive: "established", pickems: "scored" } });
      case "final-hour": return hub(END - 38 * 60_000, { personal: { competitive: "established", pickems: "scored" } });
      case "ended": case "recap-full": return hub(END + 2 * D, { seasonId: S1.id, personal: { competitive: "established", pickems: "scored", cardsReliable: false } });
      case "recap-minimal": return hub(END + 2 * D, { seasonId: S1.id, personal: { profile: "new", competitive: "none", pickems: "none", recapMinimal: true } });
      case "recap-cards": return hub(END + 2 * D, { seasonId: S1.id, personal: { competitive: "established", pickems: "scored", cardsReliable: true } }, { note: "ruta «cartas conseguidas» activada solo en el arnés: en producción la métrica está omitida (no fiable)" });
      case "off-season": return hub(END + 10 * D, { personal: { competitive: "established", pickems: "scored" }, events: EVENTS.none });
      case "next-known": return hub(NOW_ACTIVE, { entries: [...[S1], QA_S2], personal: { competitive: "provisional", pickems: "pending" } }, { note: "«Temporada 2» ficticia para fotografiar una próxima temporada conocida" });
      case "next-unknown": return hub(END - 5 * D, { personal: { competitive: "established", pickems: "scored" } });
      case "server-sync": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending" } }, { skew: 3 * D, note: "reloj del dispositivo adelantado 3 días: la cuenta atrás parte del serverNow de la foto" });
      case "no-objectives": return hub(NOW_ACTIVE, { personal: { objectives: "none", competitive: "provisional", pickems: "pending" } });
      case "provisional": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending" } });
      case "no-ranked": return hub(NOW_ACTIVE, { personal: { competitive: "none", pickems: "pending" } });
      case "event-upcoming": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "none" }, events: EVENTS.upcomingOnly });
      case "no-events": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "none", pendingPicks: 0 }, events: EVENTS.none });
      case "pickems-scored": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "scored", pendingPicks: 0 } });
      case "no-pickems": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "none", pendingPicks: 0 }, events: EVENTS.none });
      case "cards-season": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending", cardsReliable: true } }, { note: "ruta «cartas conseguidas esta temporada» activada solo en el arnés (en producción: no fiable, omitida)" });
      case "no-actions": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "none", actions: "none", pendingPicks: 0 } });
      case "stale": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending" } }, { stale: true });
      case "events-down": return hub(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "none" }, events: EVENTS.down });
      case "archive": case "archive-current": return <div className="mx-auto max-w-3xl"><SectionTitle as="h1">Temporadas de NEXUS</SectionTitle><SeasonArchive calendar={calendarAt(NOW_ACTIVE)} /></div>;
      case "archive-ended": return <div className="mx-auto max-w-3xl"><SectionTitle as="h1">Temporadas de NEXUS</SectionTitle><SeasonArchive calendar={calendarAt(END + 10 * D)} /></div>;
      case "invalid-season": return <EmptyState icon="🗓️" title="Temporada no encontrada" hint="Esa temporada no existe en el calendario de NEXUS." action={{ href: "/temporadas", label: "Ver el archivo" }} />;
      case "no-season": return <EmptyState icon="🗓️" title="Sin temporada configurada" hint="Todavía no hay ninguna temporada en el calendario de NEXUS." action={{ href: "/", label: "Volver al inicio" }} />;
      case "backend-error": return <ErrorState message="No se pudo leer la temporada" onRetry={noop} />;
      case "home-block": return (
        <div className="space-y-3">
          <SeasonHomeBlockView snap={calendarAt(NOW_ACTIVE)} clock={clock(NOW_ACTIVE)} />
          <SeasonHomeBlockView snap={calendarAt(END - 3 * D)} clock={clock(END - 3 * D)} />
          <SeasonHomeBlockView snap={calendarAt(END + 2 * D)} clock={clock(END + 2 * D)} />
          <SeasonHomeBlockView snap={calendarAt(START - 2 * D)} clock={clock(START - 2 * D)} />
        </div>
      );
      case "profile-block": return <SeasonHomeBlockView variant="profile" snap={calendarAt(NOW_ACTIVE)} clock={clock(NOW_ACTIVE)} />;
      case "navigation": return (
        <nav aria-label="Navegación (réplica de NAV_SECTIONS · Progreso)" className="max-w-sm rounded-xl border border-white/10 bg-[#0b0e17] p-3">
          <span className="nx-label">Progreso</span>
          <ul className="mt-2 space-y-1">{NAV_SECTIONS.find((s) => s.id === "progreso")!.items.map((i) => <li key={i.href} className={i.href === "/temporada" ? "rounded-md border border-drl-cyan/40 bg-drl-cyan/10 px-3 py-2" : "px-3 py-2"}><b className="block text-white">{i.label}</b></li>)}</ul>
        </nav>
      );
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase34?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  }, [scene, mountedAt]);

  if (!mountedAt) return null;
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-6" data-qa-scene={scene || "index"}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 34 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">calendario canónico real · carriles reales · cifras y eventos inventados · sin servidor</span>
        </div>
        {body}
      </div>
    </MotionConfig>
  );
}

const SCENES = [
  "full", "anonymous", "new-player", "upcoming", "active", "ending-soon", "final-day", "final-hour", "ended", "off-season",
  "next-known", "next-unknown", "hero", "countdown", "server-sync", "pass", "free-track", "competitive-track", "claimable",
  "claimed", "locked", "pass-xp", "account-xp", "daily", "weekly", "no-objectives", "competitive", "provisional", "no-ranked",
  "recent-ranked", "event-live", "event-upcoming", "no-events", "pickems-pending", "pickems-scored", "no-pickems", "collection",
  "cards-season", "achievements", "actions", "no-actions", "calendar", "recap-full", "recap-minimal", "recap-cards", "archive",
  "archive-current", "archive-ended", "invalid-season", "no-season", "home-block", "profile-block", "navigation", "backend-error",
  "stale", "events-down", "keyboard", "tablet",
] as const;
