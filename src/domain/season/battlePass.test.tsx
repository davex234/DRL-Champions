/**
 * BATTLE PASS CLEANUP (2026-10-07) · `/temporada/pase` muestra SOLO lo necesario para usar el pase.
 *
 * Fixture = las recompensas REALES de la temporada (`CURRENT_SEASON`: carriles gratis, competitivo y premium), con el
 * estado `claimed/claimable` como lo marca el servidor. Nada de cifras escritas a mano.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CURRENT_SEASON } from "@/data/season";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { t2Draft } from "@/domain/seasonTrack/template";
import { passRows, claimableCount, laneOpen } from "./battlePass";
import { BattlePassScreen } from "@/components/season/BattlePassScreen";
import type { PassTrack, ProgressionView } from "@/lib/progression/client";

const ROOT = process.cwd();
const code = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Vista del pase como la sirve el servidor: nivel 7, niveles 1–3 reclamados, 4–7 reclamables (solo carriles abiertos). */
function view(o: Partial<ProgressionView> = {}): ProgressionView {
  const level = o.level ?? 7;
  const competitiveUnlocked = o.competitiveUnlocked ?? false;
  const premium = o.premium ?? false;
  const lane = (track: PassTrack) => Object.entries(CURRENT_SEASON[track] ?? {}).map(([l, reward]) => {
    const n = Number(l);
    const open = laneOpen({ competitiveUnlocked, premium }, track);
    return { level: n, reward, claimed: open && n <= 3, claimable: open && n > 3 && n <= level };
  });
  return {
    serverNow: 1_791_000_000_000, season: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, maxLevel: CURRENT_SEASON.maxLevel },
    level, xp: level * 1000 + 400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, premium, competitiveUnlocked,
    competitiveMinPoints: 400, points: 120, equipped: {}, tracks: { free: lane("free"), competitive: lane("competitive"), premium: lane("premium") },
    missions: [{ id: "d-duelo-1", label: "Juega un duelo", kind: "daily", current: 0, goal: 1, complete: false, claimed: false, rewardCredits: 250, xp: 200, metric: "duels_played" } as never],
    achievements: [], cosmetics: [], ...o,
  };
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const html = (v: ProgressionView) => renderToStaticMarkup(<BattlePassScreen view={v} busyKey={null} onClaim={() => {}} />);

test("BP-1 · el track: un nivel por fila/columna, cada carril con su recompensa REAL y su estado del servidor", () => {
  const rows = passRows(view());
  assert.equal(rows.length, CURRENT_SEASON.maxLevel);
  const l5 = rows.find((r) => r.level === 5)!;
  assert.deepEqual(l5.lanes.map((l) => l.track), ["free", "competitive", ...(CURRENT_SEASON.premium?.[5] ? ["premium"] : [])]);
  assert.deepEqual(l5.lanes[0].reward, CURRENT_SEASON.free[5], "la recompensa es la de la temporada, tal cual");
  assert.equal(rows.find((r) => r.level === 2)!.lanes[0].state, "CLAIMED");
  assert.equal(rows.find((r) => r.level === 6)!.lanes[0].state, "AVAILABLE");
  const far = rows.find((r) => r.level === 12)!.lanes[0];
  assert.equal(far.state, "LOCKED"); assert.equal(far.lockReason, "Nivel 12");
  assert.equal(l5.lanes[1].state, "LOCKED"); assert.equal(l5.lanes[1].lockReason, "Se abre en Oro");
  assert.ok(rows.every((r) => r.lanes.every((l) => l.reward)), "un carril sin recompensa en un nivel no aparece");
  assert.equal(rows.find((r) => r.current)!.level, 7);
});

test("BP-2 · reclamable = exactamente lo que el servidor marca `claimable` (ni más, ni menos)", () => {
  const v = view();
  const expected = (["free", "competitive", "premium"] as PassTrack[]).reduce((n, t) => n + v.tracks[t].filter((l) => l.claimable).length, 0);
  assert.equal(claimableCount(v), expected);
  assert.equal(claimableCount(view({ competitiveUnlocked: true })) > expected, true, "abrir Oro abre sus niveles alcanzados");
});

test("BP-3 · cabecera compacta con datos reales: temporada, nivel, XP, GRATIS y el premium según su estado real", () => {
  const h = html(view());
  assert.match(h, new RegExp(CURRENT_SEASON.name.replace(/[·]/g, ".")));
  assert.match(h, /data-testid="pass-level" data-level="7"/);
  assert.match(text(h), /400 \/ 1\.000 XP/);
  assert.match(h, /data-testid="pass-tier" data-premium="false"/);
  assert.match(text(h), /Gratis/);
  assert.equal(PAYMENTS_ENABLED, false);
  assert.match(text(h), /Pase premium · 5,99 € · próximamente/);
  assert.ok(!/comprar|checkout|comprado/i.test(text(h)), "sin compra, sin checkout, nunca «comprado»");
  const premium = html(view({ premium: true }));
  assert.match(premium, /data-premium="true"/);
  assert.ok(!premium.includes("pass-premium-offer"), "con el derecho real no se ofrece");
});

test("BP-4 · estados distinguibles SIN depender del color: RECLAMAR (botón), RECLAMADO (✓) y BLOQUEADO (candado + motivo)", () => {
  const h = html(view());
  const v = view();
  assert.equal((h.match(/data-testid="pass-claim"/g) ?? []).length, claimableCount(v));
  assert.match(h, /<button[^>]*data-testid="pass-claim"[^>]*>Reclamar<\/button>/);
  assert.match(h, /data-testid="pass-claimed"><svg[^>]*aria-hidden[\s\S]*?Reclamado/);
  assert.match(h, /data-testid="pass-locked"><svg[^>]*aria-hidden[\s\S]*?Nivel 12/);
  assert.match(h, /data-state="AVAILABLE"/); assert.match(h, /data-state="CLAIMED"/); assert.match(h, /data-state="LOCKED"/);
});

test("BP-5 · nada de Objetivos completos ni bloques ajenos dentro del pase; solo un enlace discreto a Objetivos", () => {
  const h = text(html(view()));
  assert.ok(!/Juega un duelo|Gana un duelo|Abre un sobre|Diarias|Semanales/.test(h), "los objetivos no se pintan aquí");
  assert.ok(!/Clasificaci[oó]n|Crafteo|Colecci[oó]n|Logros|Calendario|Eventos/.test(h));
  assert.equal((html(view()).match(/href="/g) ?? []).length, 1);
  assert.match(html(view()), /data-testid="pass-objectives-link" href="\/misiones"/);
});

test("BP-6 · estructura responsive: filas apiladas en móvil, columnas desplazables con imán desde md, centradas en tu nivel", () => {
  const h = html(view());
  assert.match(h, /data-testid="pass-track" class="[^"]*flex-col[^"]*md:flex-row[^"]*md:overflow-x-auto/);
  assert.match(h, /grid-cols-\[64px_minmax\(0,1fr\)\][^"]*md:w-\[208px\]/);
  assert.match(h, /data-current="true"/);
  const src = code("src/components/season/BattlePassScreen.tsx");
  assert.ok(src.includes("el.scrollWidth <= el.clientWidth") && !src.includes("scrollIntoView"), "solo se desplaza el track (nunca la página)");
});

test("BP-7 · la página: F83 en variante «pase» o el pase de la temporada; reclamo SERVIDOR + relectura + HUD", () => {
  const page = code("src/app/temporada/pase/page.tsx");
  assert.ok(page.includes('<SeasonTrackScreen data={track.data} onClaim={(l) => void onClaim(l)} claimingLevel={claiming} notice={notice} variant="pass" />'));
  const claim = page.slice(page.indexOf("const claim = useCallback"));
  assert.ok(claim.indexOf("await claimPassLevel(level, track)") < claim.indexOf("await load()") && claim.indexOf("await load()") < claim.indexOf("syncFromServer()"));
  assert.ok(!page.includes("SeasonHub") && !page.includes("SEASON_CALENDAR"), "ni tablero ni calendario resuelto en cliente");
  const f83 = code("src/components/seasonTrack/SeasonTrackScreen.tsx");
  assert.ok(f83.includes('variant === "full" && (data.daily || data.weekly)'), "los retos (objetivos) solo en la variante completa");
  assert.ok(f83.includes('variant === "full" && data.history.length > 0'));
});

test("BP-8 · sin cambios de economía ni de temporada: Temporada 2 sigue en DRAFT y la UI no escribe cifras", () => {
  assert.equal(t2Draft().status, "DRAFT");
  const src = code("src/components/season/BattlePassScreen.tsx") + code("src/domain/season/battlePass.ts");
  assert.ok(!/credits:\s*\d|packCount:\s*\d|xpPerLevel|1000\b/.test(src), "ninguna recompensa ni umbral escrito a mano");
});

test("BP-9 · Objetivos: «Objetivos» una sola vez (título); sin pestaña repetida ni encabezado duplicado", () => {
  const page = code("src/app/misiones/page.tsx");
  assert.ok(!page.includes("<HubNav"));
  assert.match(page, /<ForgeTitle title=\{(?:t|tr|i18nT)\("Objetivos"\)\} eyebrow=\{<Crumbs items=\{\[\{ href: "\/temporada", label: (?:t|tr|i18nT)\("← Temporada"\) \}\]\} \/>\} \/>/);
  const hub = code("src/components/progression/hub/ProgressionHub.tsx");
  assert.ok(hub.includes('{view === "full" && <SectionHead id="h-objetivos" kicker={t("Qué hacer ahora")} title={t("Objetivos")} />}'));
});
