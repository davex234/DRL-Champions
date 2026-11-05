/**
 * FASE 38 · RECUPERACIÓN Y GUARDAS DE PRESENTACIÓN — gesto pendiente y revelado guardado (sessionStorage simulado),
 * contrato de la capa de sync (una operación = una clave), guardas de la máquina de estados fuera de fase y casos
 * finos del plan (heraldo del #1, orden de sets, mensaje sin conexión).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import { rarityOf, teamKeyOf } from "@/domain/collection/room";
import {
  INITIAL_REVEAL, buildRevealPlan, classifyOpenFailure, revealReducer, beforeExcluding, toInstanceFact, toOpenedInstances, type RevealState,
} from "@/domain/packs/reveal";
import {
  clearOpenReveal, clearPendingOpen, loadOpenReveal, loadPendingOpen, newOpenGesture, saveOpenReveal, savePendingOpen,
} from "@/lib/game/openRecovery";
import type { OpenedResult } from "@/store/useGameStore";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
// ANTES de cualquier captura de `CARDS`: la carta de QA se da de alta y todo el proceso ve el mismo catálogo.
const SER = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  raw(k: string) { return this.m.get(k); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };
beforeEach(() => { clearPendingOpen(); clearOpenReveal(); });

const SYNC = readFileSync(join(process.cwd(), "src/lib/game/sync.ts"), "utf8");
const CAT = { cards: CARDS, getCard, getPlayer };
const card = CARDS[0];
const result = (uid: string): OpenedResult => ({ uid, card, serial: undefined, mintedVersion: 1, isNew: true, value: 0 });

/* ───────────── gesto pendiente ───────────── */

test("PENDIENTE · se guarda antes de pedir y se recupera para ESE sobre", () => {
  savePendingOpen("estandar", "g-1");
  assert.equal(loadPendingOpen("estandar"), "g-1");
});

test("PENDIENTE · un gesto de otro sobre no se reutiliza", () => {
  savePendingOpen("premium", "g-2");
  assert.equal(loadPendingOpen("estandar"), null);
});

test("PENDIENTE · caducado (> 10 min) no se reutiliza y se borra", () => {
  savePendingOpen("estandar", "g-old");
  const parsed = JSON.parse(storage.raw("drl-open-pending")!);
  storage.setItem("drl-open-pending", JSON.stringify({ ...parsed, at: Date.now() - 11 * 60 * 1000 }));
  assert.equal(loadPendingOpen("estandar"), null);
  assert.equal(storage.raw("drl-open-pending"), undefined);
});

test("PENDIENTE · borrar deja la siguiente apertura con clave NUEVA", () => {
  savePendingOpen("estandar", "g-3");
  clearPendingOpen();
  assert.equal(loadPendingOpen("estandar"), null);
});

test("PENDIENTE · valor corrupto no rompe: sin gesto", () => {
  storage.setItem("drl-open-pending", "{not json");
  assert.equal(loadPendingOpen("estandar"), null);
});

test("GESTO · cada apertura nueva tiene un gesto distinto con formato aceptado por la ruta", () => {
  const a = newOpenGesture(); const b = newOpenGesture();
  assert.notEqual(a, b);
  assert.match(a, /^[\w:-]{1,128}$/);
});

/* ───────────── revelado guardado ───────────── */

test("REVELADO GUARDADO · se recupera para ESE sobre", () => {
  saveOpenReveal("estandar", [result("u1"), result("u2")]);
  assert.deepEqual(loadOpenReveal("estandar")?.map((r) => r.uid), ["u1", "u2"]);
});

test("REVELADO GUARDADO · otro sobre no lo recupera y un resultado vacío no se guarda", () => {
  saveOpenReveal("estandar", [result("u1")]);
  assert.equal(loadOpenReveal("premium"), null);
  clearOpenReveal();
  saveOpenReveal("estandar", []);
  assert.equal(loadOpenReveal("estandar"), null);
});

test("REVELADO GUARDADO · conserva la versión acuñada y el serial de cada instancia", () => {
  saveOpenReveal("estandar", [{ ...result("u9"), serial: 42, mintedVersion: 7 }]);
  const r = loadOpenReveal("estandar")![0];
  assert.deepEqual([r.serial, r.mintedVersion], [42, 7]);
});

/* ───────────── capa de sync ───────────── */

test("SYNC · `openPackOutcome`: guardar gesto → pedir → confirmar; nunca otra clave para el mismo intento", () => {
  const body = SYNC.slice(SYNC.indexOf("export async function openPackOutcome("));
  const save = body.indexOf("savePendingOpen(packId, gesture);");
  const req = body.indexOf("res = await apiOpenPack(packId, gesture);");
  const clear = body.lastIndexOf("clearPendingOpen();", body.indexOf("await syncFromServer();"));
  assert.ok(save > 0 && req > save && clear > req);
});

test("SYNC · un fallo de red o del servidor CONSERVA el gesto pendiente (el reintento repite la operación)", () => {
  const body = SYNC.slice(SYNC.indexOf("} catch (e) {", SYNC.indexOf("export async function openPackOutcome(")));
  const catchBlock = body.slice(0, body.indexOf("throw e;"));
  assert.match(catchBlock, /if \(e instanceof Error && \/No tienes ese sobre\/i\.test\(e\.message\)\) clearPendingOpen\(\);/);
});

test("SYNC · el aviso de «repetida» llega a la ceremonia y `openPackOnline` sigue siendo la misma operación", () => {
  assert.ok(SYNC.includes("return { results, repeated: res.repeated === true };"));
  assert.ok(SYNC.includes("return (await openPackOutcome(packId, ref)).results;"));
  assert.ok(SYNC.includes("export const hasPendingOpen = (packId: string): boolean => loadPendingOpen(packId) !== null;"));
});

test("SYNC · la versión acuñada del servidor viaja al resultado de la pantalla", () => {
  assert.ok(SYNC.includes("mintedVersion: o.mintedVersion ?? null,"));
});

/* ───────────── guardas de la máquina de estados ───────────── */

const at = (phase: RevealState["phase"], extra: Partial<RevealState> = {}): RevealState => ({ ...INITIAL_REVEAL, phase, ...extra });

test("GUARDA · un éxito que llega sin haber pedido nada se ignora", () => {
  const s = at("ready");
  assert.equal(revealReducer(s, { type: "OPEN_SUCCEEDED", count: 5, repeated: false }), s);
});

test("GUARDA · un fallo tardío durante la ceremonia no la rompe", () => {
  const s = at("hero", { count: 5 });
  assert.equal(revealReducer(s, { type: "OPEN_FAILED", failure: classifyOpenFailure("x") }), s);
});

test("GUARDA · un resultado recuperado no pisa una ceremonia en curso", () => {
  const s = at("buildup", { count: 5 });
  assert.equal(revealReducer(s, { type: "RECOVERED", count: 3 }), s);
});

test("GUARDA · los pasos de la cinemática solo en su fase (F81)", () => {
  const ready = at("ready");
  for (const type of ["INTRO_DONE", "BUILDUP_DONE", "HERO_SHOWN", "ADVANCE", "CONTINUE", "REST_DONE"] as const) assert.equal(revealReducer(ready, { type }), ready, type);
});

test("GUARDA · no se «recupera» encima de una petición en curso", () => {
  const s = at("requesting", { requests: 1 });
  assert.equal(revealReducer(s, { type: "RECOVER_STARTED" }), s);
});

/* ───────────── plan: casos finos ───────────── */


test("HERALDO · el serial #1 manda sobre el nombre de la rareza", () => {
  const it = buildRevealPlan([{ uid: "a", cardId: SER.id, serial: 1, mintedVersion: 1 }], [], CAT).items[0];
  assert.equal(it.herald, "Serial #1");
  assert.equal(it.rarityLabel.length > 0, true);
});

test("SETS · completados primero; después equipo antes que región", () => {
  const by = new Map<string, CardDef[]>();
  for (const c of CARDS) { const k = teamKeyOf(getPlayer(c.playerId)!.team).key; by.set(k, [...(by.get(k) ?? []), c]); }
  const team = [...by.values()].filter((v) => v.length >= 5).sort((a, b) => a.length - b.length)[0];
  const s = buildRevealPlan([{ uid: "z", cardId: team[team.length - 1].id, serial: null, mintedVersion: 1 }], team.slice(0, -1).map((c, i) => ({ uid: `o${i}`, cardId: c.id, serial: null, mintedVersion: 1 })), CAT).summary;
  assert.equal(s.sets[0].completed, true);
  const kinds = s.sets.filter((d) => !d.completed).map((d) => d.kind);
  if (kinds.includes("team") && kinds.includes("region")) assert.ok(kinds.indexOf("team") < kinds.indexOf("region"));
});

test("PLAN · el movimiento reducido solo cambia el ritmo, nunca qué se cuenta", () => {
  const opened = CARDS.slice(10, 15).map((c, i) => ({ uid: `r${i}`, cardId: c.id, serial: null, mintedVersion: 1 }));
  const a = buildRevealPlan(opened, [], CAT);
  const b = buildRevealPlan(opened, [], CAT, { reduced: true });
  assert.deepEqual(a.items.map((i) => [i.cardId, i.status, i.rarity, i.herald]), b.items.map((i) => [i.cardId, i.status, i.rarity, i.herald]));
  assert.deepEqual(a.summary.collection, b.summary.collection);
});

test("PLAN · un sobre de equipo no cambia la presentación: el plan no conoce el sobre", () => {
  const src = readFileSync(join(process.cwd(), "src/domain/packs/reveal.ts"), "utf8");
  assert.ok(!/packId|PackDef|team pack|boost/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("MAPEOS · `toOpenedInstances` y `toInstanceFact` leen, no inventan", () => {
  const rs: OpenedResult[] = [{ uid: "u", card, serial: 12, mintedVersion: 3, isNew: false, value: 0 }];
  assert.deepEqual(toOpenedInstances(rs), [{ uid: "u", cardId: card.id, serial: 12, mintedVersion: 3 }]);
  assert.deepEqual(toInstanceFact({ uid: "v", cardId: card.id }), { uid: "v", cardId: card.id, serial: null, mintedVersion: null });
  assert.deepEqual(beforeExcluding([toInstanceFact({ uid: "v", cardId: card.id })], []), [{ uid: "v", cardId: card.id, serial: null, mintedVersion: null }]);
});

test("FALLO · «sin conexión» se trata como red (reintento con la misma clave)", () => {
  assert.equal(classifyOpenFailure(new Error("Sin conexión")).kind, "NETWORK");
});

test("RAREZA · las rarezas del plan son exactamente las del catálogo para todas las cartas", () => {
  const items = buildRevealPlan(CARDS.map((c, i) => ({ uid: `all${i}`, cardId: c.id, serial: null, mintedVersion: 1 })), null, CAT).items;
  assert.ok(items.every((it) => it.rarity === rarityOf(it.card)));
  assert.equal(items.length, CARDS.length);
});

test("FASE 40 · salir de un resumen ya visto (navegación del cliente) borra el revelado: «Abrir el siguiente sobre» enseña un sobre sellado", () => {
  const src = readFileSync(join(process.cwd(), "src/components/packs/PackOpeningExperience.tsx"), "utf8");
  assert.match(src, /useEffect\(\(\) => \(\) => \{ if \(phaseRef\.current === "summary"\) clearOpenReveal\(\); \}, \[\]\);/);
  assert.match(src, /useEffect\(\(\) => \{ phaseRef\.current = phase; \}, \[phase\]\);/);
  // La recuperación por RECARGA sigue: la limpieza no corre en una recarga completa y `loadOpenReveal` no borra al leer.
  assert.match(src, /const saved = loadOpenReveal\(packId, \{ allowSeen: isReloadOf\(window\.location\.pathname\) \}\);/);
  assert.match(src, /if \(phase === "summary"\) markOpenRevealSeen\(packId\);/);
});
