"use client";

/**
 * OBJETIVOS DE COLECCIÓN (Fase 27) — la colección alimenta el meta sin tocar la colección.
 *
 * Una tira autocontenida para `/coleccion`: lee el meta-snapshot y enseña los logros de la categoría
 * Colección y los objetivos cuya métrica es de colección (`distinct_cards`), con el progreso que el
 * SERVIDOR evalúa sobre `user_cards`. Si no hay sesión o falla, no pinta nada: nunca inventa.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import { achievementCategory, achievementStatus, ACHIEVEMENT_STATUS_LABEL, objectivePct } from "@/domain/progression/meta";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { GameGlyph } from "@/components/ui/game/GameGlyph";

const COLLECTION_METRICS = new Set(["distinct_cards", "owned_cards"]);

export function CollectionObjectives({ enabled, className }: { enabled: boolean; className?: string }) {
  const [snap, setSnap] = useState<MetaSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchMetaSnapshot().then((s) => { if (alive) setSnap(s); }).catch(() => { /* silencio: la colección sigue */ });
    return () => { alive = false; };
  }, [enabled]);
  if (!snap) return null;

  const achievements = snap.pass.achievements.filter((a) => achievementCategory(a.id) === "COLECCION" && !a.claimed).slice(0, 3);
  const objectives = snap.objectives.filter((o) => !o.claimed && COLLECTION_METRICS.has(o.metric)).slice(0, 2);
  if (achievements.length === 0 && objectives.length === 0) return null;

  return (
    <section aria-label="Objetivos de colección" className={className} data-collection-objectives={achievements.length + objectives.length}>
      <SectionTitle action={<Link href="/misiones" className="nx-action">Objetivos →</Link>}>Objetivos de colección</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {objectives.map((o) => (
          <div key={o.id} className="nx-clip-sm border border-white/[0.09] bg-white/[0.025] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <b className="font-display text-[14px] font-bold text-white">{o.label}</b>
              <Badge tone={o.complete ? "gold" : "info"}>{o.complete ? "Pendiente de recoger" : "Objetivo"}</Badge>
            </div>
            <Meter className="mt-2" height={6} tone="info" value={objectivePct(o)} label={`${o.label}: ${o.current} de ${o.goal}`} />
            <span className="nx-readout mt-1 block text-[12px] text-white/50">{o.current} / {o.goal}</span>
          </div>
        ))}
        {achievements.map((a) => {
          const st = achievementStatus(a);
          return (
            <div key={a.id} className="nx-clip-sm border border-white/[0.09] bg-white/[0.025] p-3.5">
              <div className="flex items-start justify-between gap-2">
                <b className="font-display text-[14px] font-bold text-white"><GameGlyph symbol={a.icon} className="mr-1.5 h-4 w-4 align-[-2px] text-drl-cyan" />{a.name}</b>
                <Badge tone={st === "PENDIENTE_DE_RECOGER" ? "gold" : st === "EN_PROGRESO" ? "info" : "muted"}>{ACHIEVEMENT_STATUS_LABEL[st]}</Badge>
              </div>
              <Meter className="mt-2" height={6} tone="gold" value={a.goal > 0 ? (a.current / a.goal) * 100 : 0} label={`${a.name}: ${a.current} de ${a.goal}`} />
              <span className="nx-readout mt-1 block text-[12px] text-white/50">{a.current} / {a.goal}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

