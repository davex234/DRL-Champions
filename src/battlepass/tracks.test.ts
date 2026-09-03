/**
 * LOS TRES CARRILES DEL PASE (Fase 9E).
 *
 * El motor del pase no tenía tests. Estos cubren lo que la Fase 9E le añade —el carril
 * competitivo— y, de paso, lo que ya hacía con los otros dos, para que la ampliación no
 * pueda romperlos en silencio.
 *
 * La invariante que más importa es la de §29: el carril de PAGO no puede repartir nada
 * que dé ventaja en un duelo. Aquí se comprueba sobre la temporada real del juego.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassEngine, freshPassState } from "./engine";
import { migratePassState } from "./migrate";
import { trackOf } from "./rewards";
import type { SeasonDef } from "./types";

/** Temporada mínima de laboratorio: un nivel por carril, sin misiones. */
const SEASON: SeasonDef = {
  id: "test-season",
  name: "Temporada de prueba",
  maxLevel: 5,
  xpPerLevel: 100,
  free: { 1: { credits: 100 } },
  competitive: { 1: { credits: 500 } },
  competitiveMinPoints: 150,
  premium: { 1: { cosmetics: ["avatar:test"] } },
  missionPool: [],
};

const atLevel2 = () => {
  const e = new PassEngine(freshPassState(SEASON.id), SEASON);
  e.gainXp(200, 0); // 2 niveles con xpPerLevel = 100
  return e;
};

test("el carril libre se reclama sin condiciones", () => {
  const e = atLevel2();
  const r = e.claimReward(1, "free", 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rewards, [SEASON.free[1]]);
});

test("el carril competitivo está cerrado hasta que el servidor lo abre", () => {
  const e = atLevel2();

  const denied = e.claimReward(1, "competitive", 0);
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? "", /competitivo/i);
  assert.deepEqual(denied.rewards, []);

  const opened = e.unlockCompetitive(0);
  assert.equal(opened.ok, true);
  assert.equal(opened.events[0].type, "competitive_unlocked");

  const granted = e.claimReward(1, "competitive", 0);
  assert.equal(granted.ok, true);
  assert.deepEqual(granted.rewards, [SEASON.competitive![1]]);
});

test("el carril premium sigue exigiendo su desbloqueo, y son desbloqueos independientes", () => {
  const e = atLevel2();
  e.unlockCompetitive(0);

  assert.equal(e.claimReward(1, "premium", 0).ok, false, "competitivo abierto no abre premium");
  e.unlockPremium(0);
  assert.equal(e.claimReward(1, "premium", 0).ok, true);
});

test("un carril no se puede reclamar dos veces", () => {
  const e = atLevel2();
  assert.equal(e.claimReward(1, "free", 0).ok, true);
  assert.equal(e.claimReward(1, "free", 0).ok, false);
});

test("no se puede reclamar un nivel no alcanzado", () => {
  const e = new PassEngine(freshPassState(SEASON.id), SEASON); // nivel 1, sin XP
  assert.equal(e.claimReward(4, "free", 0).ok, false);
});

test("el auto-reclamo recorre los tres carriles y respeta los cierres", () => {
  const state = { ...freshPassState(SEASON.id), autoClaim: true };
  const e = new PassEngine(state, SEASON);
  e.unlockCompetitive(0);

  const r = e.gainXp(200, 0);
  assert.equal(r.ok, true);
  // Libre y competitivo sí; premium no, porque nadie lo ha desbloqueado.
  assert.deepEqual(r.rewards, [SEASON.free[1], SEASON.competitive![1]]);
});

test("la validación detecta un reclamo competitivo sin desbloqueo", () => {
  const e = new PassEngine(
    { ...freshPassState(SEASON.id), xp: 400, claimedCompetitive: [1] },
    SEASON,
  );
  const v = e.validateSeason();
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i: { code: string }) => i.code === "COMPETITIVE_CLAIM"), "no se detecta el reclamo indebido");
});

test("trackOf devuelve un track vacío si la temporada no define el competitivo", () => {
  const sin: SeasonDef = { ...SEASON, competitive: undefined };
  assert.deepEqual(trackOf(sin, "competitive"), {});
  assert.deepEqual(trackOf(SEASON, "competitive"), SEASON.competitive);
});

test("un estado anterior a la Fase 9E migra con el carril competitivo cerrado y vacío", () => {
  // Exactamente la forma que tenía `PassState` antes de esta fase.
  const viejo = {
    version: 1, seasonId: "vieja", xp: 350, premium: true, boost: 1, autoClaim: false,
    claimedFree: [1, 2], claimedPremium: [1], missions: [], missionsCompleted: 4, archive: [],
  };
  const m = migratePastEstado(viejo);
  assert.deepEqual(m.claimedFree, [1, 2], "no se pierde el progreso libre");
  assert.deepEqual(m.claimedPremium, [1], "no se pierde el progreso premium");
  assert.equal(m.premium, true, "no se pierde el premium comprado");
  assert.deepEqual(m.claimedCompetitive, []);
  assert.equal(m.competitiveUnlocked, false);
});

function migratePastEstado(raw: unknown) {
  return migratePassState(raw, "fallback");
}

test("el carril de pago de la temporada real no reparte ventaja competitiva (§29)", async () => {
  const { CURRENT_SEASON } = await import("@/data/season");

  // Todo lo que influye en un duelo o en la economía: prohibido en el carril de pago.
  const VENTAJA = ["credits", "tokens", "packId", "packCount", "cardId", "materials", "xp"] as const;

  const niveles = Object.entries(CURRENT_SEASON.premium);
  assert.ok(niveles.length > 0, "la temporada real no define ningún nivel de pago");

  for (const [level, reward] of niveles) {
    for (const campo of VENTAJA) {
      assert.equal(
        reward[campo],
        undefined,
        `el nivel ${level} del carril de pago reparte «${campo}», que da ventaja competitiva`,
      );
    }
    assert.ok(
      (reward.cosmetics?.length ?? 0) > 0,
      `el nivel ${level} del carril de pago no reparte nada: o da cosmética o no debería existir`,
    );
  }
});
