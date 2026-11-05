/**
 * ROSTER REAL DE VALORANT — datos para el Tactical Coach. FICHERO GENERADO: no se edita a mano.
 *
 * F60 · LA FUENTE ES `public.agents` (se gestiona en /admin/agents). Este fichero es la INSTANTÁNEA derivada que usan el
 * primer pintado, las pruebas y los scripts sin red; se regenera con `npm run agents:snapshot` (y `-- --check` la
 * compara con la BD). El juego aplica el catálogo real encima en tiempo de ejecución (`applyAgentCatalog`).
 * Origen de los 29 iniciales:
 *
 * Fuente de datos: valorant-api.com/v1/agents?isPlayableCharacter=true
 *   versión del juego 13.05.00.5350494, compilada 2026-08-20; descargado 2026-09-21.
 * Verificación: playvalorant.com/en-us/agents/ (2026-09-21) lista los mismos 29 nombres.
 * Ranuras: Grenade/Ability1/Ability2/Ultimate = teclas por defecto C/Q/E/X. Pasivas fuera.
 *
 * SÓLO DATOS: nombres, rol y nombres de habilidad (referencia nominativa). Ningún retrato ni
 * icono de Riot: el proyecto no tiene licencia para su artwork (criterio de la Fase 16).
 * `code` = tres primeras letras del nombre, por regla (sin tabla elegida a mano).
 * `uuid` = identificador de la fuente, para poder re-verificar cada fila.
 * Único retoque sobre la fuente: espacios dobles colapsados en los nombres («Nebula / Dissipate»).
 */
import type { ValorantRosterRow } from "./roster";

export const VALORANT_SOURCE = { api: "valorant-api.com/v1/agents", gameVersion: "13.05.00.5350494", buildDate: "2026-08-20", fetched: "2026-09-21", verifiedAgainst: "playvalorant.com/en-us/agents/" } as const;

export const VALORANT_ROSTER: ValorantRosterRow[] = [
  { id: "astra", name: "Astra", code: "AST", role: "controller", uuid: "41fb69c1-4189-7b37-f117-bcaf1e96f1bf", abilities: [{ slot: "C", name: "Gravity Well" }, { slot: "Q", name: "Nova Pulse" }, { slot: "E", name: "Nebula / Dissipate" }, { slot: "X", name: "Astral Form / Cosmic Divide" }] },
  { id: "breach", name: "Breach", code: "BRE", role: "initiator", uuid: "5f8d3a7f-467b-97f3-062c-13acf203c006", abilities: [{ slot: "C", name: "Aftershock" }, { slot: "Q", name: "Flashpoint" }, { slot: "E", name: "Fault Line" }, { slot: "X", name: "Rolling Thunder" }] },
  { id: "brimstone", name: "Brimstone", code: "BRI", role: "controller", uuid: "9f0d8ba9-4140-b941-57d3-a7ad57c6b417", abilities: [{ slot: "C", name: "Stim Beacon" }, { slot: "Q", name: "Incendiary" }, { slot: "E", name: "Sky Smoke" }, { slot: "X", name: "Orbital Strike" }] },
  { id: "chamber", name: "Chamber", code: "CHA", role: "sentinel", uuid: "22697a3d-45bf-8dd7-4fec-84a9e28c69d7", abilities: [{ slot: "C", name: "Trademark" }, { slot: "Q", name: "Headhunter" }, { slot: "E", name: "Rendezvous" }, { slot: "X", name: "Tour De Force" }] },
  { id: "clove", name: "Clove", code: "CLO", role: "controller", uuid: "1dbf2edd-4729-0984-3115-daa5eed44993", abilities: [{ slot: "C", name: "Pick-me-up" }, { slot: "Q", name: "Meddle" }, { slot: "E", name: "Ruse" }, { slot: "X", name: "Not Dead Yet" }] },
  { id: "cypher", name: "Cypher", code: "CYP", role: "sentinel", uuid: "117ed9e3-49f3-6512-3ccf-0cada7e3823b", abilities: [{ slot: "C", name: "Trapwire" }, { slot: "Q", name: "Cyber Cage" }, { slot: "E", name: "Spycam" }, { slot: "X", name: "Neural Theft" }] },
  { id: "deadlock", name: "Deadlock", code: "DEA", role: "sentinel", uuid: "cc8b64c8-4b25-4ff9-6e7f-37b4da43d235", abilities: [{ slot: "C", name: "Barrier Mesh" }, { slot: "Q", name: "Sonic Sensor" }, { slot: "E", name: "GravNet" }, { slot: "X", name: "Annihilation" }] },
  { id: "fade", name: "Fade", code: "FAD", role: "initiator", uuid: "dade69b4-4f5a-8528-247b-219e5a1facd6", abilities: [{ slot: "C", name: "Prowler" }, { slot: "Q", name: "Seize" }, { slot: "E", name: "Haunt" }, { slot: "X", name: "Nightfall" }] },
  { id: "gekko", name: "Gekko", code: "GEK", role: "initiator", uuid: "e370fa57-4757-3604-3648-499e1f642d3f", abilities: [{ slot: "C", name: "Mosh Pit" }, { slot: "Q", name: "Wingman" }, { slot: "E", name: "Dizzy" }, { slot: "X", name: "Thrash" }] },
  { id: "harbor", name: "Harbor", code: "HAR", role: "controller", uuid: "95b78ed7-4637-86d9-7e41-71ba8c293152", abilities: [{ slot: "C", name: "Storm Surge" }, { slot: "Q", name: "High Tide" }, { slot: "E", name: "Cove" }, { slot: "X", name: "Reckoning" }] },
  { id: "iso", name: "Iso", code: "ISO", role: "duelist", uuid: "0e38b510-41a8-5780-5e8f-568b2a4f2d6c", abilities: [{ slot: "C", name: "Contingency" }, { slot: "Q", name: "Undercut" }, { slot: "E", name: "Double Tap" }, { slot: "X", name: "Kill Contract" }] },
  { id: "jett", name: "Jett", code: "JET", role: "duelist", uuid: "add6443a-41bd-e414-f6ad-e58d267f4e95", abilities: [{ slot: "C", name: "Cloudburst" }, { slot: "Q", name: "Updraft" }, { slot: "E", name: "Tailwind" }, { slot: "X", name: "Blade Storm" }] },
  { id: "kayo", name: "KAY/O", code: "KAY", role: "initiator", uuid: "601dbbe7-43ce-be57-2a40-4abd24953621", abilities: [{ slot: "C", name: "FRAG/ment" }, { slot: "Q", name: "FLASH/drive" }, { slot: "E", name: "ZERO/point" }, { slot: "X", name: "NULL/cmd" }] },
  { id: "killjoy", name: "Killjoy", code: "KIL", role: "sentinel", uuid: "1e58de9c-4950-5125-93e9-a0aee9f98746", abilities: [{ slot: "C", name: "Nanoswarm" }, { slot: "Q", name: "ALARMBOT" }, { slot: "E", name: "TURRET" }, { slot: "X", name: "Lockdown" }] },
  { id: "miks", name: "Miks", code: "MIK", role: "controller", uuid: "7c8a4701-4de6-9355-b254-e09bc2a34b72", abilities: [{ slot: "C", name: "M-pulse" }, { slot: "Q", name: "Harmonize" }, { slot: "E", name: "Waveform" }, { slot: "X", name: "Bassquake" }] },
  { id: "neon", name: "Neon", code: "NEO", role: "duelist", uuid: "bb2a4828-46eb-8cd1-e765-15848195d751", abilities: [{ slot: "C", name: "Fast Lane" }, { slot: "Q", name: "Relay Bolt" }, { slot: "E", name: "High Gear" }, { slot: "X", name: "Overdrive" }] },
  { id: "omen", name: "Omen", code: "OME", role: "controller", uuid: "8e253930-4c05-31dd-1b6c-968525494517", abilities: [{ slot: "C", name: "Shrouded Step" }, { slot: "Q", name: "Paranoia" }, { slot: "E", name: "Dark Cover" }, { slot: "X", name: "From the Shadows" }] },
  { id: "phoenix", name: "Phoenix", code: "PHO", role: "duelist", uuid: "eb93336a-449b-9c1b-0a54-a891f7921d69", abilities: [{ slot: "C", name: "Blaze" }, { slot: "Q", name: "Hot Hands" }, { slot: "E", name: "Curveball" }, { slot: "X", name: "Run it Back" }] },
  { id: "raze", name: "Raze", code: "RAZ", role: "duelist", uuid: "f94c3b30-42be-e959-889c-5aa313dba261", abilities: [{ slot: "C", name: "Boom Bot" }, { slot: "Q", name: "Blast Pack" }, { slot: "E", name: "Paint Shells" }, { slot: "X", name: "Showstopper" }] },
  { id: "reyna", name: "Reyna", code: "REY", role: "duelist", uuid: "a3bfb853-43b2-7238-a4f1-ad90e9e46bcc", abilities: [{ slot: "C", name: "Leer" }, { slot: "Q", name: "Devour" }, { slot: "E", name: "Dismiss" }, { slot: "X", name: "Empress" }] },
  { id: "sage", name: "Sage", code: "SAG", role: "sentinel", uuid: "569fdd95-4d10-43ab-ca70-79becc718b46", abilities: [{ slot: "C", name: "Barrier Orb" }, { slot: "Q", name: "Slow Orb" }, { slot: "E", name: "Healing Orb" }, { slot: "X", name: "Resurrection" }] },
  { id: "skye", name: "Skye", code: "SKY", role: "initiator", uuid: "6f2a04ca-43e0-be17-7f36-b3908627744d", abilities: [{ slot: "C", name: "Regrowth" }, { slot: "Q", name: "Trailblazer" }, { slot: "E", name: "Guiding Light" }, { slot: "X", name: "Seekers" }] },
  { id: "sova", name: "Sova", code: "SOV", role: "initiator", uuid: "320b2a48-4d9b-a075-30f1-1f93a9b638fa", abilities: [{ slot: "C", name: "Owl Drone" }, { slot: "Q", name: "Shock Bolt" }, { slot: "E", name: "Recon Bolt" }, { slot: "X", name: "Hunter's Fury" }] },
  { id: "tejo", name: "Tejo", code: "TEJ", role: "initiator", uuid: "b444168c-4e35-8076-db47-ef9bf368f384", abilities: [{ slot: "C", name: "Stealth Drone" }, { slot: "Q", name: "Special Delivery" }, { slot: "E", name: "Guided Salvo" }, { slot: "X", name: "Armageddon" }] },
  { id: "veto", name: "Veto", code: "VET", role: "sentinel", uuid: "92eeef5d-43b5-1d4a-8d03-b3927a09034b", abilities: [{ slot: "C", name: "Crosscut" }, { slot: "Q", name: "Chokehold" }, { slot: "E", name: "Interceptor" }, { slot: "X", name: "Evolution" }] },
  { id: "viper", name: "Viper", code: "VIP", role: "controller", uuid: "707eab51-4836-f488-046a-cda6bf494859", abilities: [{ slot: "C", name: "Snake Bite" }, { slot: "Q", name: "Poison Cloud" }, { slot: "E", name: "Toxic Screen" }, { slot: "X", name: "Viper's Pit" }] },
  { id: "vyse", name: "Vyse", code: "VYS", role: "sentinel", uuid: "efba5359-4016-a1e5-7626-b1ae76895940", abilities: [{ slot: "C", name: "Razorvine" }, { slot: "Q", name: "Shear" }, { slot: "E", name: "Arc Rose" }, { slot: "X", name: "Steel Garden" }] },
  { id: "waylay", name: "Waylay", code: "WAY", role: "duelist", uuid: "df1cb487-4902-002e-5c17-d28e83e78588", abilities: [{ slot: "C", name: "Saturate" }, { slot: "Q", name: "Lightspeed" }, { slot: "E", name: "Refract" }, { slot: "X", name: "Convergent Paths" }] },
  { id: "yoru", name: "Yoru", code: "YOR", role: "duelist", uuid: "7f94d92c-4234-0a36-9646-3a87eb8b5c89", abilities: [{ slot: "C", name: "FAKEOUT" }, { slot: "Q", name: "BLINDSIDE" }, { slot: "E", name: "GATECRASH" }, { slot: "X", name: "DIMENSIONAL DRIFT" }] },
];
