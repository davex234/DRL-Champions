/**
 * DUEL GAMEPLAY UX 2.0 · ROL del jugador: dato canónico + mapa de iconos listo + respaldo de texto.
 *
 *   · ICONOS REALES: PENDIENTES (los entrega el usuario). Mientras tanto el mapa está entero a `null` y se pinta la
 *     abreviatura canónica (`ROLE_ABBR`, la misma del renderizador de cartas);
 *   · con icono, `<img>` sin texto inventado; si falla, vuelve al texto (el `onError` existe);
 *   · ni emojis ni Lucide en la marca;
 *   · el reverso del rival lleva su rol (y su pista) sin uid, jugador ni estadísticas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleMark } from "./RoleMark";
import { DuelCardBack } from "./DuelCard";
import { ROLE_ICON_SRC, ROLE_IDS, roleAbbr, isRoleId } from "@/lib/duel/roleIcons";
import { ROLE_ABBR } from "@/lib/flags";

test("UX2 ROLE-1 · el mapa rol → icono cubre los 5 roles canónicos y hoy está PENDIENTE (todo null)", () => {
  assert.deepEqual([...ROLE_IDS].sort(), Object.keys(ROLE_ICON_SRC).sort());
  for (const r of ROLE_IDS) assert.equal(ROLE_ICON_SRC[r], null, `${r}: sin asset inventado`);
  for (const r of ROLE_IDS) assert.equal(roleAbbr(r), ROLE_ABBR[r], "la abreviatura canónica");
  assert.equal(isRoleId("Duelista"), true);
  assert.equal(isRoleId("DUE"), false);
  assert.equal(isRoleId(undefined), false);
});

test("UX2 ROLE-2 · respaldo de texto: abreviatura canónica, sin <img>", () => {
  for (const r of ROLE_IDS) {
    const h = renderToStaticMarkup(<RoleMark role={r} />);
    assert.ok(h.includes('data-role-kind="text"') && h.includes(`data-role="${r}"`));
    assert.ok(h.includes(`>${ROLE_ABBR[r]}<`), `${r} → ${ROLE_ABBR[r]}`);
    assert.ok(!h.includes("<img") && !h.includes("<svg"));
  }
});

test("UX2 ROLE-3 · con asset: <img> decorativo y vuelta al texto si no carga; sin emoji ni Lucide", () => {
  const src = readFileSync(join(process.cwd(), "src", "components", "duel", "RoleMark.tsx"), "utf8");
  assert.ok(src.includes('alt=""') && src.includes("onError={() => setFailed(true)}"));
  assert.ok(!src.includes("lucide-react"));
  assert.ok(!/\p{Extended_Pictographic}/u.test(src), "sin emojis");
});

test("UX2 ROLE-4 · el reverso del rival lleva su rol en texto y lo anuncia; nada más de la carta", () => {
  const h = renderToStaticMarkup(<DuelCardBack role="Controlador" />);
  assert.ok(h.includes('data-testid="role-mark"') && h.includes(`>${ROLE_ABBR.Controlador}<`));
  assert.ok(/aria-label="[^"]*Controlador/.test(h), "accesible");
  const plain = renderToStaticMarkup(<DuelCardBack />);
  assert.ok(!plain.includes("role-mark"), "sin rol, sin marca");
});
