/**
 * AGENT ENGINE — CATÁLOGO (datos).
 *
 * Roster de agentes propios (inspirados en el juego profesional, NO copia de Valorant).
 * Cada uno es un perfil de capacidades distinto: cambian la TÁCTICA, el RITMO, el
 * ESPACIO, la INFO y las DECISIONES — no son "+10% aim". Añadir un agente = añadir un
 * objeto aquí (o un archivo que se concatene a AGENTS). El núcleo no se toca.
 */
import { makeProfile } from "./capabilities";
import type { AgentDef } from "./types";

export const AGENTS: AgentDef[] = [
  // ---- Controladores (humos / control de espacio) ----
  {
    id: "veil", name: "Veil", codename: "VEIL", class: "controller",
    capabilities: makeProfile({ control: 92, space: 82, postplant: 64, utility: 78, rotation: 44, fake: 50, survival: 50 }),
    utility: { charges: 4, kinds: ["smoke", "cover"], objective: "space" },
    tags: ["humos", "control de mapa", "defaults lentos"],
  },
  {
    id: "haze", name: "Haze", codename: "HAZE", class: "controller",
    capabilities: makeProfile({ control: 80, space: 64, fake: 74, rotation: 62, utility: 70, pressure: 44, postplant: 50 }),
    utility: { charges: 4, kinds: ["smoke"], objective: "space" },
    tags: ["humos móviles", "fakes", "tempo"],
  },

  // ---- Iniciadores (info / iniciación) ----
  {
    id: "probe", name: "Probe", codename: "PRB", class: "initiator",
    capabilities: makeProfile({ information: 94, initiation: 72, utility: 76, rotation: 52, retake: 46, trading: 50, survival: 44 }),
    utility: { charges: 3, kinds: ["recon"], objective: "info" },
    tags: ["recon", "lecturas", "info para retake"],
  },
  {
    id: "pulse", name: "Pulse", codename: "PLS", class: "initiator",
    capabilities: makeProfile({ initiation: 90, information: 62, entry: 66, utility: 72, pressure: 62, trading: 60, space: 52 }),
    utility: { charges: 3, kinds: ["flash", "recon"], objective: "blind" },
    tags: ["flashes de entrada", "iniciación", "abre sitios"],
  },

  // ---- Duelistas (entrada / presión) ----
  {
    id: "spear", name: "Spear", codename: "SPR", class: "duelist",
    capabilities: makeProfile({ entry: 94, pressure: 82, space: 72, trading: 66, rotation: 40, fake: 40, survival: 30 }),
    utility: { charges: 2, kinds: ["flash"], objective: "blind" },
    tags: ["entry fragger", "abre con flashes propios", "toma espacio"],
  },
  {
    id: "blitz", name: "Blitz", codename: "BLZ", class: "duelist",
    capabilities: makeProfile({ entry: 86, pressure: 90, space: 60, trading: 56, lurk: 30, survival: 26 }),
    utility: { charges: 2, kinds: ["flash"], objective: "blind" },
    tags: ["agresivo", "presión constante", "duelos rápidos"],
  },

  // ---- Centinelas (anclaje / retake / supervivencia) ----
  {
    id: "warden", name: "Warden", codename: "WRD", class: "sentinel",
    capabilities: makeProfile({ anchor: 90, retake: 76, survival: 82, information: 60, utility: 70, postplant: 70, control: 40 }),
    utility: { charges: 3, kinds: ["cover", "molly"], objective: "deny" },
    tags: ["ancla", "retake", "información defensiva"],
  },
  {
    id: "tripwire", name: "Tripwire", codename: "TRP", class: "sentinel",
    capabilities: makeProfile({ anchor: 86, postplant: 82, retake: 60, survival: 72, utility: 66, information: 50, control: 36 }),
    utility: { charges: 3, kinds: ["molly", "cover"], objective: "deny" },
    tags: ["trampas", "niega espacio", "post-plant"],
  },

  // ---- Flex / lurk (rotación / fake / lurk) ----
  {
    id: "specter", name: "Specter", codename: "SPC", class: "flex",
    capabilities: makeProfile({ lurk: 92, rotation: 76, information: 56, survival: 72, trading: 60, fake: 62, pressure: 50 }),
    utility: { charges: 2, kinds: ["recon", "smoke"], objective: "info" },
    tags: ["lurker", "flanco", "timings"],
  },
  {
    id: "echo", name: "Echo", codename: "ECO", class: "flex",
    capabilities: makeProfile({ fake: 86, rotation: 72, utility: 62, initiation: 52, information: 52, control: 44, pressure: 52, entry: 46 }),
    utility: { charges: 3, kinds: ["flash", "smoke", "recon"], objective: "stall" },
    tags: ["flexible", "fakes", "se adapta a la comp"],
  },
];

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

export function getAgent(id: string): AgentDef | undefined {
  return BY_ID.get(id);
}
export function agentsByClass(cls: AgentDef["class"]): AgentDef[] {
  return AGENTS.filter((a) => a.class === cls);
}
