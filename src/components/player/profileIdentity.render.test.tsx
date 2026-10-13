/**
 * PERFIL = IDENTIDAD — la tarjeta única del perfil y el CERRAR SESIÓN canónico.
 *
 *   · propio: avatar, nombre, rango (si lo hay), equipo (si lo hay), miembro desde + EDITAR PERFIL · CUENTA Y AJUSTES ·
 *     SALA DE TROFEOS · CERRAR SESIÓN; ajeno: lo mismo de identidad + acciones sociales F85, NUNCA acciones de cuenta;
 *   · nada de dashboard (XP, estadísticas, temporada, colección, historial, insignias, vitrina);
 *   · la página reutiliza `useAuth().signOut` (el mismo logout de /cuenta), suelta la foto ANTES y va a /cuenta, una vez.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileIdentityCard } from "./ProfileIdentityCard";
import { ProfileOwnerView, PublicProfileView } from "./ProfileViews";
import { OWN_FULL, PUBLIC_FULL, EMPTY_OWN, EMPTY_PUBLIC } from "@/app/design-system/fase89/fixtures";
import { RANKED_PLAYER, PLACEMENT_PLAYER } from "@/app/design-system/fase56/fixtures";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};
const owner = { onEdit: noop, onSignOut: noop };
const DASHBOARD = /Nivel de cuenta|XP|Partidas|Victorias|Derrotas|Empates|% de victorias|Temporada|Colecci[oó]n(?!es)|Historial|Insignias|Expón tus cartas|Elegir cartas|Cartas destacadas|Momentos|Pick'ems|Actividad/;

test("PI-1 · propio: identidad + EDITAR PERFIL, CUENTA Y AJUSTES, COLECCIONES y CERRAR SESIÓN (destructiva, sin competir con editar)", () => {
  const h = html(<ProfileOwnerView snap={OWN_FULL} onEdit={noop} onSignOut={noop} />);
  const t = text(h);
  assert.ok(h.includes('data-testid="profile-card"') && h.includes('data-view="SELF"'));
  assert.ok(t.includes(OWN_FULL.player.username) && /Miembro desde/.test(t));
  for (const a of ['data-action="edit"', 'data-action="account" class', 'href="/cuenta?seccion=cuenta"', 'data-action="trophy-room"', 'href="/coleccion/trofeos"', 'data-action="sign-out"']) assert.ok(h.includes(a), a);
  const signOut = h.slice(h.indexOf('data-action="sign-out"') - 400, h.indexOf('data-action="sign-out"') + 400);
  assert.ok(/border-drl\/45/.test(signOut) && /text-drl\b/.test(signOut) && !/bg-drl-cyan/.test(signOut), "salida con borde de color de salida, no primaria");
  assert.ok(h.indexOf('data-action="edit"') < h.indexOf('data-action="sign-out"'), "EDITAR primero; CERRAR SESIÓN al final");
  assert.ok(!DASHBOARD.test(t), `sin dashboard: ${t.match(DASHBOARD)?.[0]}`);
});

test("PI-2 · ajeno: identidad + acciones sociales F85; NUNCA editar, cuenta, cerrar sesión (ni aunque se le pasen manejadores)", () => {
  const social = <div data-testid="f85-actions">Añadir amigo</div>;
  const h = html(<PublicProfileView snap={PUBLIC_FULL} social={social} />);
  assert.ok(h.includes('data-testid="profile-social"') && h.includes('data-testid="f85-actions"'));
  for (const a of ['data-action="edit"', 'data-action="account"', 'data-action="sign-out"', "Cerrar sesión", "Cuenta y ajustes", "Editar perfil"]) assert.ok(!h.includes(a), a);
  // Defensa en profundidad: una foto PUBLIC nunca monta acciones de cuenta, ni aunque alguien las pase a la tarjeta.
  const forced = html(<ProfileIdentityCard snap={PUBLIC_FULL} owner={owner} />);
  assert.ok(!forced.includes('data-action="sign-out"') && !forced.includes('data-action="edit"'));
  assert.equal(html(<ProfileOwnerView snap={PUBLIC_FULL} onEdit={noop} onSignOut={noop} />), "");
  // y el propio no pinta acciones sociales
  assert.ok(!html(<ProfileIdentityCard snap={OWN_FULL} owner={owner} social={social} />).includes('data-testid="f85-actions"'));
  assert.ok(!DASHBOARD.test(text(h)));
});

test("PI-3 · rango: clasificado (emblema + rango + rating); en colocación X/5; sin clasificar no se pinta nada", () => {
  const r = html(<ProfileIdentityCard snap={RANKED_PLAYER} />);
  assert.ok(r.includes('data-rank-state="RANKED"') && r.includes(`data-tier="${RANKED_PLAYER.competitive!.rank!.tierId}"`));
  assert.ok(text(r).includes(RANKED_PLAYER.competitive!.rank!.label) && r.includes('data-field="rating"'));
  const p = html(<ProfileIdentityCard snap={PLACEMENT_PLAYER} />);
  assert.ok(p.includes('data-rank-state="PLACEMENT"') && /Colocación 3\/5/.test(text(p)));
  for (const s of [EMPTY_OWN, EMPTY_PUBLIC]) assert.ok(!html(<ProfileIdentityCard snap={s} />).includes('data-testid="profile-rank"'));
});

test("PI-4 · equipo favorito: con equipo, su sello (logo real con alt); sin equipo, nada (ni invitación)", () => {
  const h = html(<ProfileIdentityCard snap={PUBLIC_FULL} />);
  assert.ok(h.includes('data-testid="favorite-team"') && h.includes('alt="Escudo de Team Heretics"'));
  const e = html(<ProfileIdentityCard snap={EMPTY_OWN} owner={owner} />);
  assert.ok(!e.includes('data-testid="favorite-team"') && !/Elegir equipo favorito/.test(text(e)));
});

test("PI-5 · CERRAR SESIÓN = el logout CANÓNICO de useAuth (el de /cuenta): suelta la foto ANTES, una sola vez, y va a /cuenta", () => {
  const page = read("src", "components", "player", "PlayerProfileScreen.tsx");
  assert.ok(page.includes("const { user, loading, refreshProfile, signOut } = useAuth();"), "reutiliza signOut del proveedor de auth");
  assert.ok(!/auth\.signOut\(|getSupabase\(\)/.test(page), "sin una segunda implementación de logout");
  const body = page.slice(page.indexOf("const onSignOut = useCallback"), page.indexOf("}, [signOut, router]);"));
  assert.ok(body.includes("if (signingRef.current) return;"), "doble clic = un logout");
  assert.ok(body.indexOf("setLoaded(null);") < body.indexOf("await signOut();"), "la foto propia se suelta ANTES de cerrar sesión: ni un fotograma de la cuenta saliente");
  assert.ok(body.indexOf("await signOut();") < body.indexOf('router.replace("/cuenta");'), "después, a /cuenta (entrar o registrarse)");
  assert.ok(read("src", "app", "cuenta", "page.tsx").includes("onClick={() => signOut()}"), "/cuenta usa el mismo signOut");
  assert.ok(read("src", "lib", "supabase", "auth.tsx").includes("await getSupabase()?.auth.signOut();"), "el canónico es el de supabase-js (borra la sesión en todas las pestañas)");
  // F81.2 · al confirmarse «sin sesión», CloudSync vacía la caché privada de la cuenta (no se toca aquí).
  assert.ok(read("src", "components", "sync", "CloudSync.tsx").includes("s.resetGame();"));
  // F89 · la foto sigue atada a (perfil, cuenta): otra cuenta nunca ve la foto de la anterior.
  assert.ok(page.includes("const snap = loaded?.key === viewKey ? loaded.snap : null;"));
});

test("PI-6 · la página ya no monta temporada, campaña, compartir ni vitrina; el editor existente sigue (Editar perfil)", () => {
  const page = read("src", "components", "player", "PlayerProfileScreen.tsx");
  for (const s of ["<SeasonHomeBlock", "<CampaignProfileBadge", "shareProfile(", "showcase_card_view"]) assert.ok(!page.includes(s), s);
  assert.ok(page.includes("<ShowcaseEditor") && page.includes("onSaveTeam=") && page.includes("onSaveAvatar=") && page.includes("onSaveBadges="), "lo editable sigue editable");
  assert.ok(read("src", "components", "player", "PlayerIdentityView.tsx").includes('onEdit: () => onEdit("avatar")'), "Editar perfil abre el editor por la identidad (avatar)");
});
