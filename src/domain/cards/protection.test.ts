/**
 * F79.1 · CARTA PROTEGIDA — la regla canónica (`domain/cards/protection`) y que el selector de NEXUS FORGE la cumple
 * EXACTAMENTE (la auto-selección nunca propone algo que el servidor rechazaría por protección).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { getPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import { autoFill, buildMaterials, validateSelection, type OwnedCopy } from "@/domain/forge/selector";
import { checkConsumable, copyProtection, EMPTY_PROTECTION, type ProtectionContext } from "./protection";

const c = (uid: string, cardId: string, locked = false): OwnedCopy => ({ uid, cardId, locked });
const ctx = (p: Partial<ProtectionContext> = {}): ProtectionContext => ({ ...EMPTY_PROTECTION, ...p });

test("F79.1 P1 · bloqueos ABSOLUTOS en orden estable: ajena → en venta → equipo → última copia (ninguna confirmación los levanta)", () => {
  const owned = [c("a1", "x"), c("a2", "x"), c("a3", "x", true), c("b1", "y"), c("b2", "y")];
  assert.deepEqual(checkConsumable(["zz"], owned, ctx()), { ok: false, error: "NOT_OWNED", uids: ["zz"] });
  assert.equal(checkConsumable(["a3"], owned, ctx(), ["a3"]).ok, false, "en venta: ni confirmándolo");
  assert.equal((checkConsumable(["a3"], owned, ctx()) as { error: string }).error, "MARKET_LISTED");
  assert.equal((checkConsumable(["b1"], owned, ctx({ inDeck: new Set(["b1"]) }), ["b1"]) as { error: string }).error, "IN_DECK");
  // x: a1, a2 desbloqueadas + a3 en venta → entregar a1 y a2 dejaría solo la que está en venta.
  assert.equal((checkConsumable(["a1", "a2"], owned, ctx(), ["a1", "a2"]) as { error: string }).error, "LAST_COPY");
  assert.equal((checkConsumable(["b1", "b1"], owned, ctx()) as { error: string }).error, "DUPLICATE_INPUT");
  assert.deepEqual(checkConsumable(["a1"], owned, ctx()), { ok: true, protectedUsed: [] });
});

test("F79.1 P2 · favorita (por carta) y vitrina (por copia): solo confirmándolas UNA A UNA; confirmar de más no amplía nada", () => {
  const owned = [c("f1", "fav"), c("f2", "fav"), c("f3", "fav"), c("s1", "show"), c("s2", "show")];
  const p = ctx({ favoriteCardIds: new Set(["fav"]), showcaseUids: new Set(["s2"]) });
  assert.deepEqual(copyProtection("f2", "fav", p), ["FAVORITE"]);
  assert.deepEqual(copyProtection("s2", "show", p), ["SHOWCASE"]);
  assert.deepEqual(copyProtection("s1", "show", p), []);
  assert.deepEqual(checkConsumable(["f1", "f2"], owned, p, ["f1"]), { ok: false, error: "PROTECTED_COPY", uids: ["f2"] });
  assert.deepEqual(checkConsumable(["f1", "f2"], owned, p, ["f1", "f2"]), { ok: true, protectedUsed: ["f1", "f2"] });
  assert.deepEqual(checkConsumable(["s1"], owned, p, ["s2", "nadie"]), { ok: true, protectedUsed: [] }, "confirmar otra copia no cambia esta");
  assert.equal((checkConsumable(["s2"], owned, p) as { error: string }).error, "PROTECTED_COPY");
});

/* ═══════ el selector de la Forja y la regla canónica dicen EXACTAMENTE lo mismo ═══════ */

const teamOf = (def: Pick<CardDef, "playerId"> & { team?: string }) => canonicalCardTeam(def, getPlayer(def.playerId) as never).key;
const plata = CARDS.filter((d) => packCardClass(d) === "plata").sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8);
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test("F79.1 P3 · 300 inventarios aleatorios: la auto-selección SIEMPRE es consumible sin confirmar, y el servidor acepta y rechaza lo mismo que la regla", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const owned: OwnedCopy[] = [];
    for (const d of plata) for (let i = 0, n = Math.floor(r() * 4); i < n; i++) owned.push(c(`${d.id}#${i}`, d.id, r() < 0.15));
    const p = ctx({
      favoriteCardIds: new Set(plata.filter(() => r() < 0.2).map((d) => d.id)),
      showcaseUids: new Set(owned.filter(() => r() < 0.1).map((o) => o.uid)),
      inDeck: new Set(owned.filter(() => r() < 0.1).map((o) => o.uid)),
    });
    const mats = buildMaterials({ owned, inDeck: p.inDeck, favoriteCardIds: p.favoriteCardIds, showcaseUids: p.showcaseUids, slots: [{ qty: 3, class: "plata" }], cardOf: (id) => CARDS.find((d) => d.id === id), teamOf });
    const auto = autoFill(mats);
    if (auto.missing === 0) {
      const chk = checkConsumable(auto.uids, owned, p, []);
      assert.ok(chk.ok, `semilla ${seed}: la auto-selección propuso algo que la regla rechaza: ${JSON.stringify(chk)}`);
      assert.ok(validateSelection(auto.uids, mats, []).ok, `semilla ${seed}`);
    }
    // Una selección MANUAL cualquiera (también maliciosa): el servidor la acepta ⇔ la regla canónica la acepta.
    const pick = owned.filter(() => r() < 0.5).slice(0, 3).map((o) => o.uid);
    if (pick.length === 3) {
      const confirm = pick.filter(() => r() < 0.5);
      const v = validateSelection(pick, mats, confirm);
      const k = checkConsumable(pick, owned, p, confirm);
      assert.equal(v.ok, k.ok, `semilla ${seed}: servidor=${JSON.stringify(v)} regla=${JSON.stringify(k)}`);
    }
  }
});
