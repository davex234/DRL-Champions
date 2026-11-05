import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RANKS, RANK_REGIONS, EUROPE_REGION, DIVISION_I_IS_ENTRY,
  rankFromPoints, rankProgress, rankDisplay, isChampion, isRankRegion,
} from "./rank";

test("la escalera de rangos es coherente: empieza en 0 y sube de forma estricta", () => {
  assert.equal(RANKS[0].min, 0);
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i].min > RANKS[i - 1].min, `${RANKS[i].id} no supera a ${RANKS[i - 1].id}`);
  }
});

/*
 * CAMBIO DELIBERADO (Fase 9D). Antes, 0 puntos ya era «Bronce»: se tenía un rango por
 * existir. Ahora el primer escalón es «Sin clasificar» y hay que puntuar para entrar en
 * la escalera. Las expectativas se actualizan; la INTENCIÓN del test —que la función
 * nunca devuelva undefined, ni con entradas basura— se conserva intacta.
 */
test("rankFromPoints devuelve siempre un rango, incluso con entradas basura", () => {
  assert.equal(rankFromPoints(0).id, "unranked");
  assert.equal(rankFromPoints(-500).id, "unranked");
  assert.equal(rankFromPoints(Number.NaN).id, "unranked");
  assert.equal(rankFromPoints(Number.POSITIVE_INFINITY).id, "unranked"); // no finito → 0
  assert.equal(rankFromPoints(1).id, "bronce");
});

test("cada umbral entra exactamente en su rango", () => {
  for (const r of RANKS) {
    assert.equal(rankFromPoints(r.min).id, r.id, `${r.min} debería ser ${r.id}`);
    if (r.min > 0) {
      assert.notEqual(rankFromPoints(r.min - 1).id, r.id, `${r.min - 1} no debería ser ya ${r.id}`);
    }
  }
});

test("la progresión avanza dentro del rango y llega a 1 justo antes del salto", () => {
  const bronce = RANKS.find((r) => r.id === "bronce")!;
  const plata = RANKS.find((r) => r.id === "plata")!;

  const p = rankProgress(bronce.min);
  assert.equal(p.tier.id, "bronce");
  assert.equal(p.next?.id, "plata");
  assert.equal(p.progress, 0);
  assert.equal(p.toNext, plata.min - bronce.min);

  // Se mide el medio en Plata→Oro, cuyo tramo es par: el de Bronce empieza en 1 y su
  // mitad exacta no cae en un entero, así que ahí la comparación estricta sería frágil.
  const oro = RANKS.find((r) => r.id === "oro")!;
  const span = oro.min - plata.min;
  const mid = rankProgress(plata.min + span / 2);
  assert.equal(mid.tier.id, "plata");
  assert.equal(mid.progress, 0.5);
  assert.equal(mid.toNext, span / 2);

  // Justo antes del salto el progreso roza 1 pero el rango sigue siendo el mismo.
  const edge = rankProgress(plata.min - 1);
  assert.equal(edge.tier.id, "bronce");
  assert.ok(edge.progress > 0.99 && edge.progress < 1);
});

test("el rango máximo no tiene siguiente y su progreso es 1", () => {
  const top = RANKS[RANKS.length - 1];
  const p = rankProgress(top.min + 5000);
  assert.equal(p.tier.id, top.id);
  assert.equal(p.next, null);
  assert.equal(p.toNext, 0);
  assert.equal(p.progress, 1);
});

test("el progreso nunca se sale de 0..1 en todo el recorrido", () => {
  for (let pts = 0; pts <= 6000; pts += 7) {
    const p = rankProgress(pts);
    assert.ok(p.progress >= 0 && p.progress <= 1, `progress fuera de rango en ${pts}`);
    assert.ok(p.divisionProgress >= 0 && p.divisionProgress <= 1, `divisionProgress fuera de rango en ${pts}`);
    assert.ok(p.toNext >= 0, `toNext negativo en ${pts}`);
    assert.ok(p.toNextDivision >= 0, `toNextDivision negativo en ${pts}`);
  }
});

test("es determinista: misma entrada, misma salida", () => {
  assert.deepEqual(rankProgress(742), rankProgress(742));
});

// ───────────────────────────── Divisiones (Fase 9D) ─────────────────────────────

test("las divisiones cubren el rango entero y nunca se salen de 1..divisions", () => {
  for (const r of RANKS) {
    if (r.divisions <= 1) continue;
    const next = RANKS[RANKS.indexOf(r) + 1];
    for (let p = r.min; p < next.min; p++) {
      const prog = rankProgress(p);
      assert.equal(prog.tier.id, r.id);
      assert.ok(
        prog.division >= 1 && prog.division <= r.divisions,
        `división ${prog.division} fuera de 1..${r.divisions} en ${p} puntos`,
      );
    }
  }
});

test("dentro de un rango la división nunca retrocede al subir puntos", () => {
  const oro = RANKS.find((r) => r.id === "oro")!;
  const platino = RANKS.find((r) => r.id === "platino")!;
  let last = 0;
  for (let p = oro.min; p < platino.min; p++) {
    const d = rankProgress(p).division;
    assert.ok(d >= last, `la división bajó de ${last} a ${d} en ${p} puntos`);
    last = d;
  }
  assert.equal(last, oro.divisions, "no se llega a la última división antes del ascenso");
});

test("la I es la división de entrada mientras DIVISION_I_IS_ENTRY sea true", () => {
  assert.equal(DIVISION_I_IS_ENTRY, true);
  const bronce = RANKS.find((r) => r.id === "bronce")!;
  assert.equal(rankProgress(bronce.min).division, 1);
  assert.equal(rankProgress(bronce.min).label, "Bronce I");
});

test("los rangos sin divisiones no inventan una", () => {
  assert.equal(rankProgress(0).division, 0);
  assert.equal(rankProgress(0).label, "Sin clasificar");
  const nexus = RANKS.find((r) => r.id === "nexus")!;
  assert.equal(rankProgress(nexus.min).division, 0);
  assert.equal(rankProgress(nexus.min).label, "Nexus");
});

test("«sin clasificar» solo lo es quien no ha puntuado", () => {
  assert.equal(rankProgress(0).unranked, true);
  assert.equal(rankProgress(1).unranked, false);
});

// ───────────────────────────── Champion (posicional) ─────────────────────────────

test("Champion exige ser primero Y estar en Nexus", () => {
  const nexus = RANKS.find((r) => r.id === "nexus")!;
  assert.equal(isChampion(nexus.min, 1), true);
  assert.equal(isChampion(nexus.min, 2), false, "el segundo de Nexus no es campeón");
  assert.equal(isChampion(nexus.min - 1, 1), false, "el primero fuera de Nexus no es campeón");
  assert.equal(isChampion(nexus.min, null), false, "sin posición conocida no se corona a nadie");
});

test("rankDisplay corona al campeón y respeta al resto", () => {
  const nexus = RANKS.find((r) => r.id === "nexus")!;
  const champ = rankDisplay(nexus.min, 1);
  assert.equal(champ.champion, true);
  assert.equal(champ.label, "Champion");

  const normal = rankDisplay(500, 12);
  assert.equal(normal.champion, false);
  assert.equal(normal.label, rankProgress(500).label);
  assert.equal(normal.color, rankProgress(500).tier.color);
});

// ───────────────────────────── Ámbitos ─────────────────────────────

test("las regiones de clasificación son las cuatro del circuito y Europa es EMEA", () => {
  assert.deepEqual([...RANK_REGIONS], ["EMEA", "Americas", "Pacific", "China"]);
  assert.equal(EUROPE_REGION, "EMEA");
  assert.equal(isRankRegion("EMEA"), true);
  assert.equal(isRankRegion("Europa"), false);
  assert.equal(isRankRegion(null), false);
});
