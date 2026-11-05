/**
 * AGENTES Y HABILIDADES EN LA PIZARRA — el roster REAL del juego, y lo guardado nunca se pierde.
 *
 * Tres cosas que no se pueden romper sin darse cuenta:
 *   · la puerta (`sanitizeStrat`): un id real o del modelo anterior SOBREVIVE al guardado; un id
 *     inventado, no;
 *   · el catálogo: 29 agentes, cuatro roles reales, cuatro habilidades por agente con su tecla,
 *     y los ids coinciden con el registro de agentes que ya tenía el importador de VLR;
 *   · la frontera: el entrenador NO toca el catálogo del motor de simulación.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeStrat, emptyStrat, DEFAULT_MAP_ID } from "./index";
import {
  TACTICAL_AGENTS, TACTICAL_ROLES, getTacticalAgent, getLegacyAgent, isSelectableAgentId,
  isKnownAgentId, searchAgents, abilityDisplayName,
} from "./roster";
import { VALORANT_ROSTER, VALORANT_SOURCE } from "./valorantRoster";
import { agentName } from "@/importer-vlr/agents";
import { AGENTS } from "@/agents/catalog";
import { ABILITIES } from "@/abilities/catalog";
import { abilitiesFor } from "@/abilities/agentAbilities";

/** Una jugada mínima con una ficha y una marca, para meterle datos por la puerta. */
const conFicha = (agentId: unknown, abilityId: unknown) => {
  const base = emptyStrat("t", DEFAULT_MAP_ID, "attack");
  const paso = base.steps[0];
  return {
    ...base,
    steps: [{
      ...paso,
      state: {
        ...paso.state,
        players: [{ id: "p1", role: "Duelista", label: "uno", x: 50, y: 50, agentId }],
        utilities: [{ id: "u1", kind: "smoke", label: "Humo", x: 40, y: 40, abilityId, ownerId: "p1" }],
      },
    }],
  };
};

// ─────────────────────────── LA PUERTA ───────────────────────────

test("un agente y una habilidad REALES se conservan", () => {
  const out = sanitizeStrat(conFicha("omen", "omen_e"), "t");
  assert.equal(out?.steps[0].state.players[0].agentId, "omen");
  assert.equal(out?.steps[0].state.utilities[0].abilityId, "omen_e");
});

test("lo guardado con el MODELO ANTERIOR se conserva: nada se borra al volver a guardar", () => {
  for (const viejo of AGENTS.map((a) => a.id)) {
    const out = sanitizeStrat(conFicha(viejo, ABILITIES[0].id), "t");
    assert.equal(out?.steps[0].state.players[0].agentId, viejo, `${viejo} se perdería`);
    assert.equal(out?.steps[0].state.utilities[0].abilityId, ABILITIES[0].id);
  }
});

test("un agente INVENTADO no llega a guardarse", () => {
  for (const falso of ["notanagent", "", "  ", "omen ", "Omen", "../../etc", "kay/o"]) {
    const out = sanitizeStrat(conFicha(falso, "omen_e"), "t");
    assert.equal(out?.steps[0].state.players[0].agentId, undefined, `debería descartar «${falso}»`);
  }
});

test("una habilidad INVENTADA no llega a guardarse", () => {
  for (const falsa of ["ultimate", "omen_z", "omen_p", "resurrect", ""]) {
    const out = sanitizeStrat(conFicha("omen", falsa), "t");
    assert.equal(out?.steps[0].state.utilities[0].abilityId, undefined, `debería descartar «${falsa}»`);
  }
});

test("la ficha sin agente sigue siendo válida: nada se rompe hacia atrás", () => {
  const out = sanitizeStrat(conFicha(undefined, undefined), "t");
  const p = out!.steps[0].state.players[0];
  assert.ok(!("agentId" in p));
  assert.equal(p.role, "Duelista");
  assert.equal(p.label, "uno");
});

test("quitar el agente devuelve la ficha a su estado anterior, byte a byte", () => {
  const sinAgente = sanitizeStrat(conFicha(undefined, undefined), "t");
  const conYSin = sanitizeStrat(conFicha("", ""), "t");
  assert.deepEqual(conYSin!.steps[0].state.players, sinAgente!.steps[0].state.players);
});

// ─────────────────────────── EL ROSTER REAL ───────────────────────────

test("29 agentes reales, con fuente declarada", () => {
  assert.equal(TACTICAL_AGENTS.length, 29);
  assert.equal(VALORANT_ROSTER.length, 29);
  assert.match(VALORANT_SOURCE.gameVersion, /^\d+\.\d+/);
  assert.equal(VALORANT_SOURCE.verifiedAgainst, "playvalorant.com/en-us/agents/");
});

test("cuatro roles reales y ninguno más: el juego real no tiene «flex»", () => {
  assert.deepEqual([...new Set(TACTICAL_AGENTS.map((a) => a.role))].sort(), [...TACTICAL_ROLES].sort());
  assert.equal(TACTICAL_ROLES.length, 4);
  for (const r of TACTICAL_ROLES) assert.ok(TACTICAL_AGENTS.some((a) => a.role === r), `sin agentes de ${r}`);
});

test("cada agente tiene exactamente sus cuatro habilidades, una por tecla C/Q/E/X", () => {
  const ids = new Set<string>();
  for (const a of TACTICAL_AGENTS) {
    assert.deepEqual(a.abilities.map((x) => x.slot), ["C", "Q", "E", "X"], a.id);
    assert.deepEqual(a.abilities.map((x) => x.ultimate), [false, false, false, true], a.id);
    for (const ab of a.abilities) {
      assert.ok(ab.name.trim().length > 0 && !/ {2}/.test(ab.name), `${ab.id}: nombre vacío o mal espaciado`);
      assert.ok(!ids.has(ab.id), `habilidad repetida ${ab.id}`);
      ids.add(ab.id);
    }
  }
});

test("ids y códigos: únicos, estables y derivados por regla", () => {
  assert.equal(new Set(TACTICAL_AGENTS.map((a) => a.id)).size, TACTICAL_AGENTS.length);
  assert.equal(new Set(TACTICAL_AGENTS.map((a) => a.code)).size, TACTICAL_AGENTS.length, "dos agentes con el mismo código");
  for (const a of TACTICAL_AGENTS) {
    assert.match(a.id, /^[a-z0-9]+$/);
    assert.equal(a.code, a.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3), `${a.id}: código fuera de regla`);
  }
});

test("los ids coinciden con el registro de agentes que ya usaba el importador de VLR", () => {
  // El importador es la otra fuente del repo; si discrepan, uno de los dos está mal.
  for (const a of TACTICAL_AGENTS) assert.equal(agentName(a.id), a.name, `${a.id} → «${agentName(a.id)}»`);
});

test("el modelo anterior NUNCA se ofrece para elegir", () => {
  for (const viejo of AGENTS) {
    assert.equal(getTacticalAgent(viejo.id), undefined);
    assert.equal(isSelectableAgentId(viejo.id), false);
    assert.equal(isKnownAgentId(viejo.id), true, "pero sí se reconoce, para conservarlo");
    assert.ok(getLegacyAgent(viejo.id));
  }
  assert.equal(searchAgents("").length, 29);
  assert.ok(searchAgents("veil").length === 0 && searchAgents("haze").length === 0);
});

test("búsqueda y filtro por rol del Composition Manager", () => {
  assert.deepEqual(searchAgents("kay").map((a) => a.id), ["kayo"]);
  assert.deepEqual(searchAgents("KAY/O").map((a) => a.id), ["kayo"]);
  assert.ok(searchAgents("", "controller").every((a) => a.role === "controller"));
  assert.equal(TACTICAL_ROLES.reduce((n, r) => n + searchAgents("", r).length, 0), 29);
});

test("el nombre de una habilidad guardada se enseña siempre, sea real o antigua", () => {
  assert.equal(abilityDisplayName("sova_e"), "Recon Bolt (E)");
  assert.equal(abilityDisplayName(ABILITIES[0].id), ABILITIES[0].name);
  assert.equal(abilityDisplayName("desconocida"), "desconocida");
});

// ─────────────────────────── LAS FRONTERAS ───────────────────────────

test("el catálogo del MOTOR sigue intacto: el entrenador no toca gameplay", () => {
  assert.equal(AGENTS.length, 10);
  for (const a of AGENTS) {
    for (const ab of abilitiesFor(a)) assert.ok(a.utility.kinds.includes(ab.kind), `${a.id}/${ab.id}`);
  }
});

test("ningún artwork de Riot: ni URLs de imagen ni ficheros de agentes en el roster", () => {
  const fuentes = ["src/domain/tactics/valorantRoster.ts", "src/domain/tactics/roster.ts", "src/components/tactics/AgentEmblem.tsx"]
    .map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n");
  assert.ok(!/media\.valorant-api|displayicon|fullportrait|killfeed|\.png|\.webp|<img/i.test(fuentes), "hay una referencia a artwork");
});
