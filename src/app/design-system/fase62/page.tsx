"use client";

/**
 * ARNÉS QA · FASE 62 — `/design-system/fase62?scene=<escena>` · PROGRESSION & REWARDS (solo revisión y capturas).
 *
 * Base: la foto REAL de `GET /api/game/meta` de la cuenta QA 1ff2c0ef (2026-09-25, `snapshot.json`) + la colección que
 * el servidor calcula para esa cuenta (24 únicas / 331). Las variantes que no se pueden provocar a demanda (temporada
 * completa, cuenta nueva, subida de nivel, revelación mayor) se derivan de esa foto y se marcan `data-synthetic`.
 * Nada llama al servidor: los botones de reclamar de esta página no tienen sesión y fallarían (no se pulsan en QA).
 */
import { useEffect, useMemo, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { ProgressionHub } from "@/components/progression/hub/ProgressionHub";
import { PostMatchProgress } from "@/components/progression/PostMatchProgress";
import { RewardReveal } from "@/components/rewards/RewardReveal";
import { diffSnapshots, type MetaSnapshot } from "@/lib/progression/meta";
import { totalXpForLevel } from "@/domain/progression/levels";
import { accountLevel } from "@/domain/progression/meta";
import type { Claimable } from "@/domain/progression/hub";
import raw from "./snapshot.json";

const SCENES = ["hub", "hub-season-complete", "hub-new", "postmatch", "postmatch-levelup", "reveal-minor", "reveal-major"] as const;

export default function Fase62Page() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  const [go, setGo] = useState(false);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); const id = window.setTimeout(() => setGo(true), 1900); return () => window.clearTimeout(id); }, []);
  const base = useMemo(() => ({ ...(raw as unknown as MetaSnapshot), serverNow: Date.now() }), []);
  if (scene === null) return null;
  if (!(SCENES as readonly string[]).includes(scene)) {
    return <ul className="space-y-1 p-6 text-[13px] text-white/70">{SCENES.map((s) => <li key={s}><a className="underline" href={`?scene=${s}`}>{s}</a></li>)}</ul>;
  }
  if (!go) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-synthetic={scene === "hub" ? "false" : "true"} data-scene={scene}>
      <Scene id={scene} base={base} />
    </div>
  );
}

const noop = async () => {};

function Scene({ id, base }: { id: string; base: MetaSnapshot }) {
  const now = Date.now();
  switch (id) {
    case "hub": return <ProgressionHub snap={base} receivedAt={now} reload={noop} />;
    case "hub-season-complete": {
      const free = base.pass.tracks.free.map((l) => ({ ...l, claimed: true, claimable: false }));
      const s = { ...base, season: { ...base.season, level: 30, xpIntoLevel: 1000, progress: 1 }, pass: { ...base.pass, level: 30, xp: 30000, progress: 1, xpIntoLevel: 1000, tracks: { ...base.pass.tracks, free } } };
      return <ProgressionHub snap={s} receivedAt={now} reload={noop} />;
    }
    case "hub-new": {
      const s: MetaSnapshot = {
        ...base,
        account: { ...base.account, xp: 0, credits: 6000, packsOpened: 0 },
        level: { ...accountLevel(0) },
        season: { ...base.season, level: 0, xpIntoLevel: 0, progress: 0, missionsCompleted: 0 },
        pass: { ...base.pass, level: 0, xp: 0, xpIntoLevel: 0, progress: 0, missions: base.pass.missions.map((m) => ({ ...m, current: 0, complete: false, claimed: false })), achievements: base.pass.achievements.map((a) => ({ ...a, current: 0, complete: false, claimed: false })), tracks: { ...base.pass.tracks, free: base.pass.tracks.free.map((l) => ({ ...l, claimed: false, claimable: false })) } },
        rewards: [], ledger: [], rating: null, ladder: null, collection: { unique: 0, total: 331, instances: 0, progress: 0, milestones: [10, 50, 100, 150, 250, 331].map((at) => ({ at, reached: false })) },
      };
      return <ProgressionHub snap={s} receivedAt={now} reload={noop} />;
    }
    case "postmatch":
    case "postmatch-levelup": {
      const before: MetaSnapshot = {
        ...base,
        account: { ...base.account, xp: id === "postmatch-levelup" ? totalXpForLevel(8) - 40 : base.account.xp - 110 },
        objectives: base.objectives.map((o) => (o.id === "d-duelo-win" ? { ...o, current: 0, complete: false } : o.id === "s-duelos-25" ? { ...o, current: o.current - 1 } : o)),
        pass: { ...base.pass, missions: base.pass.missions.map((o) => (o.id === "d-duelo-win" ? { ...o, current: 0, complete: false } : o)) },
      };
      const after: MetaSnapshot = {
        ...base,
        account: { ...base.account, xp: id === "postmatch-levelup" ? totalXpForLevel(8) + 70 : base.account.xp },
        objectives: base.objectives.map((o) => (o.id === "d-duelo-win" ? { ...o, current: 1, complete: true } : o)),
        pass: { ...base.pass, missions: base.pass.missions.map((o) => (o.id === "d-duelo-win" ? { ...o, current: 1, complete: true } : o)) },
      };
      return <PostMatchProgress delta={diffSnapshots(before, after)} />;
    }
    case "reveal-minor":
    case "reveal-major": {
      const claimed: Claimable[] = id === "reveal-minor"
        ? [{ kind: "mission", key: "m1", id: "d-duelo-1", label: "Juega un duelo", reward: { credits: 250 }, seasonXp: 200 }]
        : [
          { kind: "mission", key: "m2", id: "s-duelos-25", label: "Juega 25 duelos en la temporada", reward: { packId: "estandar", packCount: 2 }, seasonXp: 2500 },
          { kind: "level", key: "l10", id: "10", label: "Temporada · nivel 10", reward: { packId: "premium", packCount: 1, credits: 1500 }, seasonXp: 0, track: "free", level: 10 },
        ];
      return <><ProgressionHub snap={base} receivedAt={now} reload={noop} /><RewardReveal claimed={claimed} onClose={() => {}} /></>;
    }
    default: return null;
  }
}
