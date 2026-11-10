/**
 * ROAD TO CHAMPIONS · DEFINICIÓN `rtc-1` (Fase 35).
 *
 * Campaña de NEXUS, no historia de la VCT: los nombres de nodo son ficción de producto y NO afirman ningún
 * resultado real. Lo real es el RIVAL: cada nodo apunta a un equipo del registro canónico de identidades
 * (`data/teamIdentities`, estado `verified`, con roster actual) y su mazo se construye con cartas reales del
 * catálogo (`domain/campaign/opponent`).
 *
 * Reglas (las comprueba `validateCampaign` y `campaign-content:verify`):
 *   · 3 capítulos × 5 nodos = 15 (rango permitido 12–18). Último nodo de cada capítulo = BOSS.
 *   · Grafo lineal: cada nodo exige el anterior; el primero de un capítulo exige el jefe del anterior.
 *   · Dificultad y recompensa siguen `difficulty.ts` y `rewards.ts` al pie de la letra.
 *   · Los `id` de nodo son ESTABLES: una versión nueva puede añadir nodos, nunca reutilizar un id para otra cosa.
 *
 * `rtc-2` (2026-09-21, catálogo diseñado de `Cartas\`): BLG, TE y JDG no tienen ni una carta en el catálogo
 * nuevo, así que sus nodos (c1-n3, c1-n4, c1-n5) no podían formar rival y bloqueaban 13 de los 15 nodos. Se
 * sustituyen por identidades VERIFICADAS que la campaña no usaba y cuyo roster actual sí tiene cartas: 100T
 * (núcleo 4), M8 (5) y Team Heretics (5). Mismos ids, tipo, dificultad y recompensa: el nodo es el mismo
 * escalón de la progresión con otro rival; no se inventa ninguna carta.
 */
import type { CampaignDefinition } from "@/domain/campaign/types";

const WIN = "Gana la partida de diez turnos. Mismas reglas que cualquier duelo.";

export const ROAD_TO_CHAMPIONS: CampaignDefinition = {
  campaignId: "road-to-champions",
  version: "rtc-2",
  name: "Road to Champions",
  tagline: "Tu equipo contra los rosters reales del circuito, capítulo a capítulo.",
  chapters: [
    {
      id: "c1", order: 1, name: "Clasificatorio", theme: "clasificatorio",
      description: "Rosters reales con sus versiones base y bots que todavía perdonan. Aprende a leer al rival.",
      nodes: [
        { id: "c1-n1", chapterId: "c1", order: 1, type: "MATCH", name: "Primer contacto", objective: WIN, opponent: { teamId: "navi" }, difficulty: "ROOKIE", requirements: { completed: [] }, nextNodes: ["c1-n2"], rewards: { firstClear: { credits: 50 } } },
        { id: "c1-n2", chapterId: "c1", order: 2, type: "MATCH", name: "Presión alta", objective: WIN, opponent: { teamId: "loud" }, difficulty: "ROOKIE", requirements: { completed: ["c1-n1"] }, nextNodes: ["c1-n3"], rewards: { firstClear: { credits: 50 } } },
        { id: "c1-n3", chapterId: "c1", order: 3, type: "MATCH", name: "Lectura de mapa", objective: WIN, opponent: { teamId: "100t" }, difficulty: "ROOKIE", requirements: { completed: ["c1-n2"] }, nextNodes: ["c1-n4"], rewards: { firstClear: { credits: 50 } } },
        { id: "c1-n4", chapterId: "c1", order: 4, type: "ELITE", name: "Ritmo de élite", objective: WIN, opponent: { teamId: "m8" }, difficulty: "PRO", requirements: { completed: ["c1-n3"] }, nextNodes: ["c1-n5"], rewards: { firstClear: { credits: 100 } } },
        { id: "c1-n5", chapterId: "c1", order: 5, type: "BOSS", name: "Guardián del clasificatorio", objective: WIN, opponent: { teamId: "team-heretics" }, difficulty: "PRO", requirements: { completed: ["c1-n4"] }, nextNodes: ["c2-n1"], rewards: { firstClear: { credits: 200 } } },
      ],
    },
    {
      id: "c2", order: 2, name: "Circuito", theme: "circuito",
      description: "Tres regiones, versiones intermedias y bots que ya castigan los errores.",
      nodes: [
        { id: "c2-n1", chapterId: "c2", order: 1, type: "MATCH", name: "Nueva liga", objective: WIN, opponent: { teamId: "fut" }, difficulty: "PRO", requirements: { completed: ["c1-n5"] }, nextNodes: ["c2-n2"], rewards: { firstClear: { credits: 50 } } },
        { id: "c2-n2", chapterId: "c2", order: 2, type: "MATCH", name: "Viaje al Pacífico", objective: WIN, opponent: { teamId: "ge" }, difficulty: "PRO", requirements: { completed: ["c2-n1"] }, nextNodes: ["c2-n3"], rewards: { firstClear: { credits: 50 } } },
        { id: "c2-n3", chapterId: "c2", order: 3, type: "MATCH", name: "Doble filo", objective: WIN, opponent: { teamId: "xlg" }, difficulty: "PRO", requirements: { completed: ["c2-n2"] }, nextNodes: ["c2-n4"], rewards: { firstClear: { credits: 50 } } },
        { id: "c2-n4", chapterId: "c2", order: 4, type: "ELITE", name: "Muro táctico", objective: WIN, opponent: { teamId: "karmine-corp" }, difficulty: "CHAMPION", requirements: { completed: ["c2-n3"] }, nextNodes: ["c2-n5"], rewards: { firstClear: { credits: 100 } } },
        { id: "c2-n5", chapterId: "c2", order: 5, type: "BOSS", name: "Señor del circuito", objective: WIN, opponent: { teamId: "fnatic" }, difficulty: "CHAMPION", requirements: { completed: ["c2-n4"] }, nextNodes: ["c3-n1"], rewards: { firstClear: { credits: 200 } } },
      ],
    },
    {
      id: "c3", order: 3, name: "Campeones", theme: "campeones",
      description: "Las mejores versiones de cada jugador y el bot canónico más exigente. Aquí no hay atajos.",
      nodes: [
        { id: "c3-n1", chapterId: "c3", order: 1, type: "MATCH", name: "Escenario mayor", objective: WIN, opponent: { teamId: "ns" }, difficulty: "CHAMPION", requirements: { completed: ["c2-n5"] }, nextNodes: ["c3-n2"], rewards: { firstClear: { credits: 50 } } },
        { id: "c3-n2", chapterId: "c3", order: 2, type: "MATCH", name: "Sin margen", objective: WIN, opponent: { teamId: "g2" }, difficulty: "CHAMPION", requirements: { completed: ["c3-n1"] }, nextNodes: ["c3-n3"], rewards: { firstClear: { credits: 50 } } },
        { id: "c3-n3", chapterId: "c3", order: 3, type: "MATCH", name: "Noche larga", objective: WIN, opponent: { teamId: "tyl" }, difficulty: "CHAMPION", requirements: { completed: ["c3-n2"] }, nextNodes: ["c3-n4"], rewards: { firstClear: { credits: 50 } } },
        { id: "c3-n4", chapterId: "c3", order: 4, type: "ELITE", name: "Antesala", objective: WIN, opponent: { teamId: "paper-rex" }, difficulty: "CHAMPION", requirements: { completed: ["c3-n3"] }, nextNodes: ["c3-n5"], rewards: { firstClear: { credits: 100 } } },
        { id: "c3-n5", chapterId: "c3", order: 5, type: "BOSS", name: "Corona NEXUS", objective: WIN, opponent: { teamId: "leviatan" }, difficulty: "CHAMPION", requirements: { completed: ["c3-n4"] }, nextNodes: [], rewards: { firstClear: { credits: 200 } } },
      ],
    },
  ],
};
