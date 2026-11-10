"use client";

/**
 * CUADRO DEL EVENTO (Fase 30). REUTILIZA el motor de la Fase 24 (`buildBracketModel`: formato,
 * aristas confirmadas 0045, clasificaciones, conflictos) y el componente real `TournamentBracket`
 * en modo solo lectura. Sin formato de cuadro (liga, grupos, suizo, desconocido) no se dibuja
 * ninguno: se dice. Sin preguntas ni respuestas: aquí no se predice, para eso está el panel.
 */
import { useMemo, useState } from "react";
import { buildBracketModel, isBracketFormat, type TournamentFormat } from "@/domain/pickems/bracket";
import { TournamentBracket } from "@/components/pickems/bracket/TournamentBracket";
import { BracketStageTabs } from "@/components/pickems/bracket/BracketStageTabs";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { EventHubSnapshot } from "@/server/services/liveEvents";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  LEAGUE: "Liga", SINGLE_ELIMINATION: "Eliminación directa", DOUBLE_ELIMINATION: "Doble eliminación", GROUP_STAGE: "Fase de grupos", SWISS: "Sistema suizo", GROUP_PLAYOFF: "Grupos + playoffs", UNKNOWN: "Formato por confirmar",
};

export function EventBracket({ snap, now, forceMode }: { snap: EventHubSnapshot; now: number; forceMode?: "desktop" | "mobile" }) {
  useLocale();
  const model = useMemo(() => buildBracketModel({
    stages: snap.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, order_idx: s.orderIdx })),
    matches: snap.matches, questions: [], answers: {}, now,
  }), [snap.stages, snap.matches, now]);
  const bracketStages = model.stages.filter((s) => s.bracket);
  const [stageId, setStageId] = useState<string | null>(null);
  const selected = stageId ?? bracketStages[bracketStages.length - 1]?.id ?? null;
  const drawable = isBracketFormat(model.format) && bracketStages.length > 0 && snap.matches.length > 0;

  return (
    <section id="cuadro" aria-label={t("Cuadro")} data-testid="event-bracket" data-format={model.format} data-drawable={drawable ? "yes" : "no"}>
      <SectionTitle>{drawable ? t("Cuadro") : t("Formato")} <span className="ml-2 text-ink-faint">· {td(FORMAT_LABEL[model.format])}</span></SectionTitle>
      {!drawable ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{snap.matches.length === 0 ? t("Sin partidos publicados todavía.") : t("Este evento no tiene cuadro de eliminatoria: los partidos se listan por fase y ronda.")}</Plate>
      ) : (
        <>
          {bracketStages.length > 1 && <BracketStageTabs stages={bracketStages} selected={selected} onSelect={setStageId} className="mb-3" />}
          <TournamentBracket model={model} stageId={selected} saving={null} feedback={null} readOnly forceMode={forceMode} />
          {model.conflicts.length > 0 && <p className="mt-2 text-[11px] text-white/40">{t("Alguna conexión del cuadro no coincide con los resultados publicados y no se dibuja.")}</p>}
        </>
      )}
    </section>
  );
}
