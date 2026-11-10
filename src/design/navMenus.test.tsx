/**
 * NAVEGACIÓN GLOBAL LIMPIA (2026-10-07) · CONTRATO DE TODOS LOS MENÚS DE NAVEGACIÓN.
 *
 * Regla única: cada opción es SOLO su nombre (sin descripción ni subtítulo), en mayúsculas por CSS, centrada en horizontal
 * y en vertical, en una fila compacta; las insignias se conservan y se centran con el nombre. Se renderizan los
 * RENDERERS REALES — no una copia —: el desplegable de sección del armazón (`SectionPanel`, que pinta Colección, Equipos,
 * Tienda, Temporada, Mundo y «Más» = Jugar), la hoja «Menú» móvil (`MobileMenuNav`), «Administración» (`AdminEntryView`,
 * menú y hoja) y el «Más» de la portada (`MoreMenu`). Si alguien vuelve a pintar una línea bajo el nombre, esto cae.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_SECTIONS, NAV_MENU_ITEM, NAV_MENU_LABEL, NAV_MENU_ROW } from "@/design/nav";
import { mobileMenu, playSection, shellSections } from "@/design/gameShell";
import { SectionPanel, MobileMenuNav } from "@/components/layout/GameShell";
import { AdminEntryView } from "@/components/layout/AdminEntry";
import { MoreMenu } from "@/components/home/MoreMenu";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BADGES = { events: 5, news: 2, duel: 1, social: 3, live: 4, cup: 1 };
const textOf = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "\u0001").split("\u0001").map((t) => t.trim()).filter(Boolean);
const anchors = (h: string) => [...h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));
/** Una opción de menú válida: clases del patrón, nombre en <b> con `uppercase` y, aparte del nombre, solo un número. */
function assertNavOption(where: string, a: { attrs: string; inner: string }, label: string, badge = 0) {
  for (const cls of NAV_MENU_ITEM.split(" ")) assert.ok(a.attrs.includes(cls), `${where} · ${label}: falta «${cls}» (centrado)`);
  assert.match(a.inner, new RegExp(`<b class="[^"]*\\buppercase\\b[^"]*">${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</b>`), `${where} · ${label}: nombre en mayúsculas`);
  const rest = textOf(a.inner).filter((t) => t !== label);
  assert.deepEqual(rest, badge > 0 ? [String(badge)] : [], `${where} · ${label}: nada bajo el nombre salvo la insignia`);
}

test("NAV-0 · el modelo ya no tiene descripciones (ni el armazón, ni la hoja móvil, ni el «Más» de la portada)", () => {
  for (const s of [playSection(), ...NAV_SECTIONS]) for (const it of s.items) assert.ok(!("hint" in it), `${s.id} · ${it.label}`);
  for (const g of mobileMenu()) for (const it of g.items) assert.ok(!("hint" in it), it.label);
  assert.ok(!/\bhint\b/.test(read("src/components/home/MoreMenu.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  assert.ok(!/\.hint\b/.test(read("src/components/layout/GameShell.tsx")), "el armazón no pinta ningún hint");
  assert.ok(NAV_MENU_ITEM.includes("justify-center") && NAV_MENU_ITEM.includes("items-center") && NAV_MENU_ITEM.includes("text-center"));
  assert.ok(NAV_MENU_LABEL.includes("uppercase") && NAV_MENU_LABEL.includes("whitespace-nowrap"));
});

test("NAV-1 · TODOS los desplegables del armazón (secciones + «Más») pintan solo nombres, centrados, con insignias", () => {
  const all = [playSection(), ...shellSections()];
  assert.deepEqual(all.map((s) => s.id).sort(), ["coleccion", "equipos", "jugar", "mundo", "progreso", "tienda"]);
  for (const s of all) {
    const h = renderToStaticMarkup(<SectionPanel id={`m-${s.id}`} section={s} pathname={s.items[0].href} badges={BADGES} />);
    assert.match(h, /data-menu-style="nav"/, s.id);
    assert.match(h, /w-max min-w-\[240px\]/, `${s.id}: ancho ajustado al nombre más largo, con mínimo común`);
    const as = anchors(h);
    assert.equal(as.length, s.items.length, s.id);
    s.items.forEach((it, i) => {
      assertNavOption(s.id, as[i], it.label, it.badge ? BADGES[it.badge] : 0);
      assert.ok(as[i].attrs.includes(NAV_MENU_ROW), `${s.id} · ${it.label}: fila compacta`);
      assert.ok(as[i].attrs.includes("nx-focus"), `${s.id} · ${it.label}: foco visible`);
    });
    assert.match(as[0].attrs, /aria-current="page"/, `${s.id}: la opción activa lo dice`);
    assert.equal(as.filter((a) => /aria-current/.test(a.attrs)).length, 1, `${s.id}: solo una activa`);
  }
});

test("NAV-2 · hoja «Menú» móvil: las mismas secciones, solo nombres, centrados, insignias conservadas", () => {
  const h = renderToStaticMarkup(<MobileMenuNav pathname="/tienda" badges={BADGES} />);
  const items = mobileMenu().flatMap((g) => g.items);
  const all = [playSection(), ...shellSections()].flatMap((s) => s.items);
  const as = anchors(h);
  assert.equal(as.length, items.length);
  items.forEach((it, i) => {
    const b = all.find((x) => x.href === it.href)?.badge;
    assertNavOption("móvil", as[i], it.label, b ? BADGES[b] : 0);
    assert.ok(as[i].attrs.includes("min-h-[48px]"), `móvil · ${it.label}: 48 px por tacto`);
  });
  assert.equal(as.filter((a) => /aria-current="page"/.test(a.attrs)).length, 1);
});

test("NAV-3 · «Administración» (menú y hoja): solo el nombre, centrado, con su escudo y su dorado; sin texto interno", () => {
  for (const variant of ["menu", "sheet"] as const) {
    const h = renderToStaticMarkup(<AdminEntryView gate="granted" variant={variant} />);
    const [a] = anchors(h);
    assertNavOption(`admin/${variant}`, a, "Administración");
    assert.match(a.inner, /<svg/, "conserva el escudo");
    assert.match(a.inner, /text-drl-gold/, "conserva el acento");
    assert.ok(!/Panel interno/.test(h));
  }
  for (const variant of ["menu", "sheet"] as const) assert.equal(renderToStaticMarkup(<AdminEntryView gate="denied" variant={variant} />), "", "permisos intactos");
});

test("NAV-4 · el «Más» de la portada: solo nombres, centrados, en mayúsculas", () => {
  const h = renderToStaticMarkup(<MoreMenu open onClose={() => {}} signedIn />);
  const as = anchors(h);
  assert.ok(as.length >= 10, String(as.length));
  for (const a of as) {
    const label = textOf(a.inner)[0];
    assertNavOption("portada/más", a, label);
  }
});

test("NAV-5 · ninguna descripción antigua sobrevive en las superficies de navegación", () => {
  const OLD = ["Todo el catálogo y lo que posees", "Descubre todos los sobres por categoría", "Sobres, cajas, cartas y packs especiales",
    "Consigue la moneda del juego", "Sobres y misiones de evento activo", "Tiempo restante, pase, objetivos", "Tu perfil de jugador: vitrina",
    "Sesión, avatar, región y ajustes", "Cuéntanos qué te ha costado", "Tu nivel de cuenta, la XP", "Tu posición global y europea",
    "Objetivos, misiones y pase de temporada", "Misiones, crafteo de sobres", "Lo que has ganado y cuándo", "Panel interno",
    "Standings, traspasos y crónica", "Qué ha pasado desde tu última sesión", "Road to Champions, partida rápida, competitivo y retos",
    "Tu mazo contra un rival", "Amigos, solicitudes", "El circuito real", "Torneos de jugadores:", "Equipo, mapas, pizarra",
    "Tus equipos de diez cartas", "El pase y sus recompensas", "Predice los partidos"];
  const files = ["src/design/nav.ts", "src/design/gameShell.ts", "src/components/layout/GameShell.tsx", "src/components/layout/AdminEntry.tsx", "src/components/home/MoreMenu.tsx"];
  for (const f of files) { const s = read(f); for (const t of OLD) assert.ok(!s.includes(t), `${f}: «${t}»`); }
});
