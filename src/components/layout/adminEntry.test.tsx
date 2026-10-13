/**
 * F58.2 · ACCESO «ADMINISTRACIÓN» DENTRO DEL JUEGO.
 *
 * Visibilidad por rol (la vista recibe el veredicto del servidor), sin parpadeo (el HTML de servidor/hidratación no
 * trae nada de admin), una sola fuente de verdad (`useAdminSession` → `/api/admin/session`), ubicación discreta,
 * «Volver al juego» sin redirecciones abiertas, y que nada de esto relaja la barrera de /admin ni de /api/admin/*.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminEntry, AdminEntryView, safeReturnPath } from "./AdminEntry";
import { AdminGuard } from "./AdminGuard";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test("ANÓNIMO y USUARIO normal → no ven el acceso (ni en el menú ni en la hoja móvil)", () => {
  for (const gate of ["denied", "unconfigured"] as const) for (const variant of ["menu", "sheet"] as const) {
    assert.equal(html(<AdminEntryView gate={gate} variant={variant} />), "", `${gate}/${variant}`);
  }
});

test("SIN PARPADEO → mientras se comprueba no se pinta nada, y el HTML de servidor/hidratación va vacío", () => {
  assert.equal(html(<AdminEntryView gate="checking" variant="menu" />), "");
  // El componente real renderizado en servidor usa el snapshot de servidor (`checking`): nada de admin en el HTML.
  assert.equal(html(<AdminEntry variant="menu" />), "");
  assert.equal(html(<AdminEntry variant="sheet" />), "");
});

test("ADMIN → ve «Administración» y el enlace lleva a /admin", () => {
  for (const variant of ["menu", "sheet"] as const) {
    const out = html(<AdminEntryView gate="granted" variant={variant} />);
    assert.match(out, /Administración/);
    assert.match(out, /href="\/admin"/);
    assert.match(out, /data-testid="admin-entry"/);
  }
});

test("UNA SOLA FUENTE → el acceso usa useAdminSession (servidor: /api/admin/session → profiles.is_admin); sin emails ni flags locales", () => {
  const entry = src("src/components/layout/AdminEntry.tsx");
  assert.match(entry, /useAdminSession\(\)/);
  assert.ok(!/localStorage|@[a-z0-9.-]+\.[a-z]{2,}|NEXT_PUBLIC_ADMIN|ADMIN_ENABLED|isAdmin\s*=/.test(entry.replace(/\/\*[\s\S]*?\*\//g, "")), "nada de emails, flags ni isAdmin locales");
  const hook = src("src/lib/supabase/useAdminSession.ts");
  assert.match(hook, /fetch\("\/api\/admin\/session"/);
  assert.match(hook, /body\?\.admin === true \? "granted" : "denied"/, "solo un sí explícito del servidor concede");
  assert.match(hook, /useSyncExternalStore\(subscribe, \(\) => gateState, \(\) => "checking"\)/, "servidor/hidratación = checking");
});

test("CAMBIO DE SESIÓN → cierre de sesión deniega al instante (y anula comprobaciones en vuelo); cambio de usuario vuelve a checking; volver a la pestaña revalida", () => {
  const hook = src("src/lib/supabase/useAdminSession.ts");
  assert.match(hook, /if \(event === "SIGNED_OUT" \|\| !uid\) \{ seq\+\+; setGate\("denied"\); return; \}/);
  assert.match(hook, /if \(!sameUser\) setGate\("checking"\);/);
  assert.match(hook, /visibilitychange[\s\S]*REVALIDATE_MS\) void comprobar\(\)/);
  assert.match(hook, /const apply = \(g: AdminGate\) => \{ if \(my === seq\) setGate\(g\); \};/, "una respuesta vieja no pisa a la nueva");
});

test("UBICACIÓN → junto a Mi perfil/Cuenta (desplegable «Temporada») y al pie de la hoja «Menú»; NO en la barra principal", () => {
  const shell = src("src/components/layout/GameShell.tsx");
  assert.match(shell, /section\.id === "progreso" && <AdminEntry variant="menu" \/>/);
  assert.match(shell, /<AdminEntry variant="sheet" onNavigate=\{onClose\} \/>/);
  const nav = src("src/design/nav.ts");
  assert.ok(!/href: "\/admin"/.test(nav), "no es una entrada del menú principal");
});

test("USUARIO escribe /admin → AdminGuard no pinta el panel sin un «granted» del servidor", () => {
  const out = html(<AdminGuard><p>CONTENIDO-SECRETO-ADMIN</p></AdminGuard>);
  assert.ok(!out.includes("CONTENIDO-SECRETO-ADMIN"));
  assert.match(out, /Comprobando permisos/);
  const guard = src("src/components/layout/AdminGuard.tsx");
  assert.match(guard, /if \(gate === "granted"\) return <>\{children\}<\/>;/);
});

test("USUARIO llama a /api/admin/* → las rutas siguen verificando por su cuenta (intacto)", async () => {
  for (const r of ["dashboard", "users", "moderation", "system", "session"]) {
    const mod = await import(`@/app/api/admin/${r}/route`);
    const res: Response = await mod.GET(new Request(`http://t/api/admin/${r}`, { headers: { authorization: "Bearer user-token" } }));
    assert.equal(res.status, 401, r);
  }
});

test("ADMIN desde /admin → «Volver al juego» regresa a la pantalla de origen validada (sin redirección abierta) o al lobby", () => {
  const shell = src("src/components/admin/cc/AdminShell.tsx");
  assert.match(shell, /data-testid="admin-back-to-game"/);
  assert.match(shell, /href=\{gameHref\}/);
  assert.equal(safeReturnPath("/temporada"), "/temporada");
  assert.equal(safeReturnPath("/packs?cat=equipos"), "/packs?cat=equipos");
  for (const bad of ["//evil.example", "https://evil.example", "/admin", "/admin/users", "javascript:alert(1)", "/a\\b", "/a b", "", null, undefined]) {
    assert.equal(safeReturnPath(bad as string | null | undefined), "/", String(bad));
  }
});
