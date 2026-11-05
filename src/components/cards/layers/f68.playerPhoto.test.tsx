/**
 * FASE 68 · BUG F68-005: el partido del Tactical Coach dejaba un 404 por jugador rival (`/players/<id>.png`): la capa
 * antigua de retrato pedía SIEMPRE el PNG y caía al sigilo con `onError`, y `public/players/` no tiene ningún retrato.
 * Arreglo con el patrón de F64 (`TEAM_LOGOS_AVAILABLE`): solo se pide lo que existe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PLAYERS } from "@/data/players";
import { PLAYER_PHOTOS_AVAILABLE, hasPlayerPhoto } from "@/data/playerPhotos";
import { PlayerPhoto } from "./PlayerPhoto";

const ROOT = process.cwd();
const palette = { primary: "#ff2e63", secondary: "#ffd1dc", text: "#1a0008", background: "#000" };

test("F68 B005 · la lista de retratos coincide EXACTAMENTE con los PNG de public/players", () => {
  const files = readdirSync(join(ROOT, "public/players")).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, "")).sort();
  assert.deepEqual([...PLAYER_PHOTOS_AVAILABLE].sort(), files);
});

test("F68 B005 · sin retrato publicado no se pide el PNG: se pinta el sigilo directamente (0 peticiones a 404)", () => {
  const p = PLAYERS.find((x) => !x.image && !PLAYER_PHOTOS_AVAILABLE.has(x.id))!;
  assert.ok(p, "hay jugadores sin retrato");
  const h = renderToStaticMarkup(<PlayerPhoto player={p} palette={palette} />);
  assert.ok(!h.includes(`/players/${p.id}.png`), "ningún <img> hacia el PNG inexistente");
  assert.equal(hasPlayerPhoto(p), false);
});

test("F68 B005 · una imagen EXPLÍCITA del jugador (CMS) se sigue pidiendo tal cual", () => {
  const p = { ...PLAYERS[0], image: "/cms/foto-propia.webp" };
  assert.equal(hasPlayerPhoto(p), true);
  assert.match(renderToStaticMarkup(<PlayerPhoto player={p} palette={palette} />), /src="\/cms\/foto-propia\.webp"/);
});

test("F68 B005 · contrato: PlayerPhoto consulta la lista antes de montar el <img>", () => {
  const src = readFileSync(join(ROOT, "src/components/cards/layers/PlayerPhoto.tsx"), "utf8");
  assert.match(src, /const known = hasPlayerPhoto\(player\);/);
  assert.match(src, /useState\(\(\) => !known \|\| missingPhotos\.has\(src\)\)/);
});

test("F68 B005 · el roster del Tactical Coach no lleva URL de retrato inexistente (antes ~11 × 404 por jugador y partido)", async () => {
  const { resolveImage } = await import("@/lib/match/playerMapper");
  const p = PLAYERS.find((x) => !x.image && !PLAYER_PHOTOS_AVAILABLE.has(x.id))!;
  assert.equal(resolveImage(p), "", "sin retrato publicado: cadena vacía (los consumidores no pintan <img>)");
  assert.equal(resolveImage({ ...p, image: "/cms/foto.webp" }), "/cms/foto.webp");
  for (const f of ["src/components/coach/PlayerStatusCard.tsx", "src/components/coach/MatchCeremony.tsx", "src/components/broadcast/ProPlayerStrip.tsx"]) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.match(s, /(card\.image \?|image && \(|meta\?\.image &&)/, `${f} comprueba la imagen antes de montar el <img>`);
  }
});
