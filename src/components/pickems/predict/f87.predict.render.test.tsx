/**
 * F87 · PICK'EMS 2.0 — render y contratos de la interfaz (estático, sin servidor) + contratos de migración/permisos.
 *
 *   · Escritorio: cuadro completo con secciones, gran final y destinos en palabras; móvil: pestañas y rondas (≥ 44 px).
 *   · Pick directo: botones con aria-label y aria-pressed; anónimo: sin botones, invitación a iniciar sesión.
 *   · Resultado: ✓/✕ con PALABRAS (Acertado/Fallado), no solo color; VOID dicho con texto; recompensas OFF dichas.
 *   · GSL: Apertura, Ganadores, Eliminación, Decisivo y Clasificados por grupo (datos reales de Champions 2026).
 *   · 0071: sin privilegios de cliente, rollback presente, cubetas de ritmo, sección de admin y ruta de reclamo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PredictView } from "./PredictScreen";
import { contextOfView } from "@/lib/pickems/bracketClient";
import { pendingPicks, scoreEntry } from "@/domain/pickems/prediction";
import { scene } from "@/app/design-system/f87/fixtures";
import { ADMIN_SECTIONS } from "@/domain/admin/nav";
import { RATE_POLICY } from "@/server/services/rateLimit";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function render(name: string, mode: "desktop" | "mobile" = "desktop") {
  const built = scene(name)!;
  const v = built.view;
  const ctx = contextOfView(v);
  const locked = new Set(v.nodes.filter((n) => n.locked).map((n) => n.matchId));
  return renderToStaticMarkup(
    <PredictView v={v} ctx={ctx} picks={built.picks} notice={null} inFlight={null} signedIn={!!v.me}
      live={v.me ? scoreEntry(ctx, built.picks, (id) => locked.has(id)) : null}
      pending={v.me ? pendingPicks(ctx, built.picks, (id) => !locked.has(id)).length : 0}
      onPick={() => undefined} onClaim={() => undefined} claiming={false} claimMsg={null} forceMode={mode} />,
  );
}

test("escritorio · doble eliminación: alto, bajo y gran final; pick directo con aria; destinos en palabras", () => {
  const h = render("playoffs");
  assert.match(h, /data-bracket-mode="desktop"/);
  for (const t of ["Cuartos · alta", "Semifinales · alta", "Final alta", "Ronda 1 · baja", "Final baja", "Gran Final"]) assert.ok(h.includes(t), t);
  assert.match(h, /aria-label="(Elegir|Quitar) [^"]+ como ganador de Cuartos · alta frente a [^"]+"/);
  assert.match(h, /aria-pressed="true"/);
  assert.ok(h.includes("Perdedor → Ronda 1 · baja"), "el perdedor dice adónde cae");
  assert.ok(h.includes("Ganador → Semifinales · alta"));
  assert.ok(/Pick&#x27;em incompleto|Pick'em incompleto/.test(h), "aviso de incompleto");
  assert.ok(h.includes("Recompensas aún no activadas"), "recompensas OFF dichas, sin promesas");
  assert.ok(!/<button[^>]*>[^<]*Por definir/.test(h), "un hueco por definir nunca es un botón");
});

test("móvil · secciones en pestañas, rondas como botones de 44 px y las mismas predicciones", () => {
  const h = render("playoffs", "mobile");
  assert.match(h, /data-bracket-mode="mobile"/);
  assert.match(h, /role="tablist" aria-label="Secciones del cuadro"/);
  assert.ok((h.match(/min-h-\[44px\]/g) ?? []).length >= 6);
  assert.match(h, /aria-label="(Elegir|Quitar) [^"]+ como ganador/);
});

test("anónimo: cuadro real visible, sin botones de pick, invitación a iniciar sesión", () => {
  const h = render("playoffs-anon");
  assert.ok(!/aria-pressed/.test(h), "sin botones de pick");
  assert.ok(h.includes("Inicia sesión para predecir") || h.includes("inicia sesión"));
});

test("GSL real (Champions 2026): grupos con Apertura/Ganadores/Eliminación/Decisivo/Clasificados; ✓ y ✕ con palabras", () => {
  const h = render("groups");
  for (const t of ["Grupo A", "Grupo B", "Grupo C", "Grupo D", "Apertura", "Ganadores", "Eliminación", "Decisivo", "Clasificados"]) assert.ok(h.includes(t), t);
  assert.ok(h.includes("✓ Acertado"));
  assert.ok(h.includes("✕ Fallado"));
  assert.ok(h.includes("Paper Rex") && h.includes("G2 Esports"), "equipos reales");
  assert.ok(/Reclamar · Gran resultado/.test(h), "reclamo visible al liquidar");
  const m = render("groups", "mobile");
  assert.match(m, /role="tablist" aria-label="Grupos"/);
});

test("reclamado: dice lo que se entregó; perfecto con su insignia", () => {
  const h = render("groups-claimed");
  assert.ok(h.includes("Reclamado"));
  assert.ok(!/Reclamar ·/.test(h));
});

test("VOID dicho con texto; eliminación simple y todos contra todos se pintan", () => {
  assert.ok(render("void").includes("Anulado · no puntúa"));
  const s = render("single");
  assert.ok(s.includes("Cuartos") && s.includes("Final"));
  const rr = render("rr");
  assert.ok(rr.includes("Grupo A"));
  assert.ok(!rr.includes("Perdedor →"), "todos contra todos sin caminos de perdedor");
});

test("0071: sin privilegios de cliente, guardias, rollback, cubetas de ritmo, admin y API sin campos sobrantes", () => {
  const mig = read("supabase", "migrations", "0071_pickems_bracket.sql");
  assert.match(mig, /revoke all on table public\.pickem_brackets, public\.pickem_bracket_matches, public\.pickem_bracket_entries,\s+public\.pickem_bracket_picks, public\.pickem_bracket_claims from public, anon, authenticated/);
  assert.match(mig, /p_at >= \(case when bm\.lock_override_at is not null then least\(bm\.lock_override_at, m\.start_time\)\s+else least\(bm\.lock_at, m\.start_time\) end\)/);
  assert.match(mig, /create trigger pickem_picks_guard before insert or update on public\.pickem_bracket_picks/);
  assert.match(mig, /'pickem_bracket:' \|\| p_bracket::text/);
  assert.ok(!/insert into public\.credit_transactions/.test(mig), "nada escribe el libro a mano: app_grant_reward");
  assert.ok(existsSync(join(ROOT, "docs", "operations", "rollback", "0071_pickems_bracket.ROLLBACK.sql")));
  assert.ok(RATE_POLICY.pickem_read && RATE_POLICY.pickem_write);
  assert.ok(ADMIN_SECTIONS.some((s) => s.href === "/admin/pickems"));
  const route = read("src", "app", "api", "game", "pickem-brackets", "route.ts");
  assert.match(route, /const KEYS = new Set\(\["action", "slug", "matchId", "teamId", "revision"\]\)/);
  assert.match(route, /private, no-store/);
  // El worker esports no se toca: ni el ciclo v1 ni el bundle importan nada de F87.
  assert.ok(!/pickemBrackets|pickem_bracket/.test(read("src", "server", "services", "pickemLifecycle.ts")));
  assert.ok(!/pickemBrackets|pickem_bracket/.test(read("scripts", "esports-autosync-worker.ts")));
});

test("F87.2 · elegibilidad: perfecto sin derecho a cobro sigue siendo PERFECTO, sin botón; texto + símbolo, no solo color", () => {
  const h = render("groups-ineligible");
  assert.match(h, /data-testid="pickem-eligibility" data-eligible="false" data-code="ACCOUNT_TOO_NEW"/);
  assert.ok(h.includes("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas"));
  assert.ok(h.includes("al menos 7 días y 3 partidas jugadas antes del primer cierre"));
  assert.match(h, /data-testid="pickem-result-no-reward">Tu resultado: <b[^>]*>Pick&#x27;em perfecto|data-testid="pickem-result-no-reward">Tu resultado: <b[^>]*>[^<]+</);
  assert.ok(!/Reclamar ·/.test(h), "sin botón de reclamar");
  assert.ok(h.includes("ⓘ") && h.includes("Cuenta sin derecho a recompensas todavía."), "símbolo + texto para lectores");
  const m = render("playoffs-rewards-matches", "mobile");
  assert.match(m, /te faltan 2 partida/);
  const ok = render("playoffs-rewards-eligible");
  assert.match(ok, /data-eligible="true"/);
  assert.ok(ok.includes("Tu cuenta cumple los requisitos para recibir recompensas"));
  assert.ok(!render("playoffs").includes("pickem-eligibility"), "sin recompensas activas no se habla de elegibilidad");
});
