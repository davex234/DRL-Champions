/**
 * FASE 69 · pulido con causa medida. (1) /cuenta: CLS ≈ 0,22 porque los resúmenes competitivo, social y de perfil
 * pintaban `null` hasta su fetch y al llegar empujaban la página; ahora reservan el mismo hueco con «—». (2) Constructor
 * a 1024: el rol partía la palabra («CONTRO/LADOR»); ahora baja el recuento, no la palabra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitiveSummary } from "@/components/competitive/CompetitiveSummary";
import { SocialSummary } from "@/components/social/SocialSummary";
import { ProfilePreviewCard } from "@/components/player/ProfilePreviewCard";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("F69 · /cuenta CLS: con sesión, los tres resúmenes reservan su hueco mientras cargan (aria-busy, «—», sin cifras inventadas)", () => {
  const comp = renderToStaticMarkup(<CompetitiveSummary enabled />);
  assert.match(comp, /aria-busy="true"/); assert.match(comp, /Rating ranked \(Elo\)/); assert.match(comp, /href="\/competitivo"/);
  assert.ok(!/\d{3,}/.test(comp.replace(/<[^>]+>/g, " ").replace(/\[[^\]]*\]/g, "")), "ninguna cifra mientras carga");
  const soc = renderToStaticMarkup(<SocialSummary enabled />);
  assert.match(soc, /aria-busy="true"/); assert.match(soc, /href="\/social"/);
  const prof = renderToStaticMarkup(<ProfilePreviewCard enabled />);
  assert.match(prof, /data-testid="profile-preview-loading"/); assert.match(prof, /Tu perfil/);
});

test("F69 · sin sesión los resúmenes no pintan nada (como antes)", () => {
  assert.equal(renderToStaticMarkup(<CompetitiveSummary enabled={false} />), "");
  assert.equal(renderToStaticMarkup(<SocialSummary enabled={false} />), "");
  assert.equal(renderToStaticMarkup(<ProfilePreviewCard enabled={false} />), "");
});

test("F69 · constructor a 1024: el nombre del rol no se parte; baja el recuento (lg:flex-wrap, tipografía estrecha solo en lg)", () => {
  const s = read("src/components/duel/deck/TeamBoard.tsx");
  assert.match(s, /lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-2/);
  assert.match(s, /lg:text-\[10\.5px\] lg:tracking-\[0\.02em\] xl:text-\[12px\] xl:tracking-\[0\.08em\]/);
});

test("F69 · /cuenta CLS (reanudación): la carga reserva la pantalla y la tira de cifras no se sustituye por un cargador", () => {
  const s = read("src/app/cuenta/page.tsx");
  assert.match(s, /if \(loading\) return <><Header \/><div className="min-h-screen"><Loading label="Cargando tu perfil" \/><\/div><\/>;/);
  assert.ok(!/statsLoading \? \(\s*<Loading/.test(s), "sin cargador de otra altura en lugar de la tira");
  assert.match(s, /aria-busy=\{statsLoading\} data-testid="cuenta-stats"/);
  // Mientras carga, lo que viene del servidor sale como «—» (nunca una cifra inventada).
  for (const k of ["pickems.events", "rewards", "packs"]) assert.ok(s.includes(`statsLoading ? "—" : String(${k})`), k);
});

test("F69 · /mundo a 390: las tarjetas de la rejilla pueden encoger (min-w-0) y no se salen de la pantalla", () => {
  const s = read("src/app/mundo/page.tsx");
  assert.match(s, /function Panel\([^)]*\) \{[\s\S]*?<div className="min-w-0 rounded-2xl border border-white\/10 bg-base-700\/30 p-4">/);
});
