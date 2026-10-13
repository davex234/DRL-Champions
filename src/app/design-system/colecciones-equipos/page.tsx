"use client";

/**
 * ARNÉS QA DE COLECCIONES POR EQUIPO (`/design-system/colecciones-equipos?scene=…`). 404 en producción (middleware),
 * salvo `NEXUS_QA_HARNESS=1`. Monta las pantallas REALES (`TrophyRoomScreen`, `TeamDetailScreen`) con vistas que
 * construye el MISMO dominio que usa el servidor, sobre el catálogo real y un inventario de mentira. Sin servidor ni BD.
 *
 *   scene = room            inventario a medias: un equipo completo, otros con una carta por jugador (no completos)
 *         | room-empty      sin cartas
 *         | room-china      todas las cartas de los equipos de China: su insignia, desbloqueada
 *         | room-all        todo el catálogo: las cuatro insignias
 *         | room-new-team   un equipo recién dado de alta (sin identidad ni región) y una región sin equipos
 *         | detail-progress | detail-complete | detail-empty
 */
import { useEffect, useState } from "react";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { TeamDetailScreen } from "@/components/trophies/TeamDetailScreen";
import { CARDS, getPlayer } from "@/data/catalog";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { buildTeamCollections, teamCollectionsView, teamDetail, type TeamCollectionsModel } from "@/domain/teamCollections/model";

const SCENES = ["room", "room-empty", "room-china", "room-all", "room-new-team", "detail-progress", "detail-complete", "detail-empty"] as const;
type Scene = (typeof SCENES)[number];

const model = (): TeamCollectionsModel => buildTeamCollections({ cards: CARDS, player: getPlayer });

/** Una carta por jugador de un equipo: con el criterio antiguo bastaba; con el nuevo, no. */
function onePerPlayer(m: TeamCollectionsModel, teamId: string): string[] {
  const seen = new Set<string>();
  return (m.teams.find((t) => t.id === teamId)?.cards ?? []).filter((c) => !seen.has(c.playerId) && !!seen.add(c.playerId)).map((c) => c.id);
}
const allOf = (m: TeamCollectionsModel, pick: (t: TeamCollectionsModel["teams"][number]) => boolean): string[] => m.teams.filter(pick).flatMap((t) => t.cards.map((c) => c.id));

function ownedFor(scene: Scene, m: TeamCollectionsModel): string[] {
  if (scene === "room-empty" || scene === "detail-empty") return [];
  if (scene === "room-all") return allOf(m, () => true);
  if (scene === "room-china") return [...allOf(m, (t) => t.region === "China"), ...onePerPlayer(m, "fnatic")];
  return [
    ...allOf(m, (t) => t.id === "karmine-corp" || t.id === "navi"),
    ...onePerPlayer(m, "g2"), ...onePerPlayer(m, "t1"), ...onePerPlayer(m, "team-heretics"),
    ...(m.teams.find((t) => t.id === "nrg")?.cards.slice(0, 15).map((c) => c.id) ?? []),
    ...(m.teams.find((t) => t.id === "xlg")?.cards.slice(0, 3).map((c) => c.id) ?? []),
  ];
}

export default function TeamCollectionsHarness() {
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene") as Scene;
    setScene(SCENES.includes(s) ? s : "room");
  }, []);
  if (!scene) return null;
  let m = model();
  if (scene === "room-new-team") {
    // Lo que pasa cuando el panel publica cartas de un equipo que el registro todavía no conoce, y cuando una región
    // se queda sin equipos: el equipo aparece solo, sin región; la insignia de la región vacía no se concede.
    const cards = CARDS.filter((c) => canonicalCardTeam(c, getPlayer(c.playerId)).identity?.region !== "China")
      .map((c, i) => (i < 6 ? { ...c, id: `qa-new-${i}`, team: "Nuevo Equipo QA" } : c));
    m = buildTeamCollections({ cards, player: getPlayer });
  }
  const owned = ownedFor(scene, m);
  const counts: Record<string, number> = {};
  for (const id of owned) counts[id] = (counts[id] ?? 0) + 1;
  // Copias repetidas de una misma carta: no completan nada más.
  if (scene === "detail-progress" || scene === "room") for (const id of onePerPlayer(m, "g2").slice(0, 2)) counts[id] = 7;
  const team = (id: string) => teamDetail(m.teams.find((t) => t.id === id)!, counts);
  return (
    <main data-harness="colecciones-equipos" data-scene={scene} className="min-h-screen">
      {scene.startsWith("room") && <TrophyRoomScreen room={teamCollectionsView(m, new Set(owned))} />}
      {scene === "detail-progress" && <TeamDetailScreen team={team("g2")} />}
      {scene === "detail-complete" && <TeamDetailScreen team={team("karmine-corp")} />}
      {scene === "detail-empty" && <TeamDetailScreen team={team("paper-rex")} />}
    </main>
  );
}
