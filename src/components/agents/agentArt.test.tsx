/**
 * F59 · COMPONENTES DE ARTE DE AGENTE + integración en las superficies reales.
 *
 * AgentPortrait (cara) y AgentFullBody (cuerpo) pintan el asset del manifiesto; sin arte caen al
 * emblema sin <img> (nunca una imagen rota, nunca la cara estirada). Y las pantallas que muestran
 * agentes usan ESTOS componentes, sin mezclar jugador (carta) con agente.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChip, AgentFaceSvg, AgentFullBody, AgentLineup, AgentPortrait } from "./AgentArt";
import { getAgentArtwork } from "@/domain/tactics/agentArt";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("AgentPortrait → la CARA del manifiesto, con alt, perezosa y dimensiones reservadas", () => {
  const face = getAgentArtwork("jett", "face")!;
  const out = html(<AgentPortrait agentId="jett" size={40} />);
  assert.match(out, /data-art="image"/);
  assert.match(out, new RegExp(`src="${esc(face.src)}"`));
  assert.match(out, /alt="Jett · Duelista"/);
  assert.match(out, /loading="lazy"/);
  assert.match(out, /width:40px;height:40px/);
  assert.match(out, new RegExp(`srcSet="${esc(face.small!.src)} 96w, ${esc(face.src)} 256w"`), "srcset: pequeña y grande");
  assert.match(out, /sizes="40px"/);
  assert.ok(!out.includes("/full.webp"), "la cara no pide el cuerpo entero");
});

test("AgentFullBody → el CUERPO ENTERO del manifiesto en marco 3:4 anclado arriba", () => {
  const full = getAgentArtwork("omen", "full")!;
  const out = html(<AgentFullBody agentId="omen" />);
  assert.match(out, /data-art="image"/);
  assert.match(out, new RegExp(`src="${esc(full.src)}"`));
  assert.match(out, /aspect-ratio:3 \/ 4/);
  assert.match(out, /object-position:50% 0%/);
  assert.ok(!out.includes("/face.webp"), "el cuerpo no usa la cara");
});

test("sin cara (legado / desconocido) → emblema, ninguna <img>, ninguna ruta de arte", () => {
  for (const id of ["veil", "notanagent"]) {
    const out = html(<AgentPortrait agentId={id} />);
    assert.match(out, /data-art="emblem"/);
    assert.ok(!out.includes("<img"), id);
    assert.ok(!out.includes("/agents/"), id);
    assert.match(out, /<svg/);
  }
});

test("sin cuerpo entero → emblema grande; la cara NO se estira para fingir un cuerpo", () => {
  const out = html(<AgentFullBody agentId="veil" />);
  assert.match(out, /data-art="emblem"/);
  assert.ok(!out.includes("<img"));
  assert.ok(!out.includes("face.webp"));
});

test("accesibilidad: decorativo = alt vacío (el nombre ya está al lado); por defecto, nombre y rol", () => {
  assert.match(html(<AgentPortrait agentId="sova" decorative />), /alt=""/);
  assert.match(html(<AgentFullBody agentId="sova" />), /alt="Sova · Iniciador"/);
  assert.match(html(<AgentFullBody agentId="sova" decorative showName />), /alt=""[\s\S]*>Sova</);
});

test("estados por CSS alrededor del asset (el original no se toca)", () => {
  assert.match(html(<AgentPortrait agentId="jett" state="selected" />), /data-state="selected"/);
  assert.match(html(<AgentPortrait agentId="jett" state="disabled" />), /grayscale/);
  assert.match(html(<AgentPortrait agentId="jett" state="dead" />), /✕/);
  assert.match(html(<AgentPortrait agentId="jett" state="enemy" />), /#ff3b5c/);
  assert.match(html(<AgentPortrait agentId="jett" state="ally" />), /#19e3ff/);
});

test("AgentChip: resuelve el dato tal cual viene («KAY/O», «kayo») y no adivina lo que no es agente", () => {
  assert.match(html(<AgentChip value="KAY/O" />), /data-agent="kayo"[\s\S]*KAY\/O/);
  assert.match(html(<AgentChip value="kayo" />), /data-agent="kayo"/);
  const raro = html(<AgentChip value="Mystery" />);
  assert.ok(!raro.includes("<img") && raro.includes("Mystery"));
  assert.match(html(<AgentChip value={null} />), /—/);
});

test("AgentFaceSvg (fichas del mapa): cara recortada en círculo; sin arte, el respaldo", () => {
  const con = html(<svg><AgentFaceSvg agentId="jett" r={10} fallback={<circle data-fb="1" />} /></svg>);
  assert.match(con, /<clipPath/);
  assert.match(con, /<image[^>]+href="\/agents\/jett\/face-96\.webp/, "en el mapa basta la cara de 96 px");
  const sin = html(<svg><AgentFaceSvg agentId="veil" r={10} fallback={<circle data-fb="1" />} /></svg>);
  assert.match(sin, /data-fb="1"/);
  assert.ok(!sin.includes("<image"));
});

test("AgentLineup: cuerpo entero desde sm, cara en móvil (cinco cuerpos de 60 px no se leen)", () => {
  const out = html(<AgentLineup agentIds={["jett", "sova", "omen", "killjoy", "breach"]} />);
  assert.equal(out.match(/data-testid="agent-full"/g)?.length, 5);
  assert.equal(out.match(/data-testid="agent-face"/g)?.length, 5);
  assert.match(out, /hidden sm:block/);
  assert.match(out, /sm:hidden/);
});

/* ═══════════ INTEGRACIÓN: las superficies reales usan el sistema canónico ═══════════ */

const IMPORT = /from "@\/components\/agents\/AgentArt"/;

test("Tactical Coach: constructor, quick play, selector, teatro, pizarra, pre-partido y hub usan AgentArt", () => {
  const b = src("src/components/tactics/CompositionBuilder.tsx");
  assert.match(b, IMPORT);
  assert.match(b, /<AgentFullBody agentId=\{agente\.id\}/, "hueco de la composición: cuerpo entero");
  assert.match(b, /<span className="grid h-full place-items-center sm:hidden"><AgentPortrait/, "móvil: cara");
  assert.match(b, /export function CompositionStrip[\s\S]*<AgentPortrait key=\{id\}/, "tiras de composición: caras");
  for (const f of ["src/components/tactics/QuickComposer.tsx", "src/components/tactics/AgentPicker.tsx", "src/components/tactics/TacticalTheater.tsx", "src/app/entrenador/strats/page.tsx", "src/app/entrenador/page.tsx"]) {
    const c = src(f);
    assert.match(c, IMPORT, f);
    assert.match(c, /<AgentPortrait/, f);
    assert.ok(!/<AgentEmblem\b/.test(c), `${f} ya no pinta el emblema de código`);
  }
  assert.match(src("src/app/entrenador/partido/page.tsx"), /<AgentLineup agentIds=\{comp\.agentIds\}/);
  assert.match(src("src/components/tactics/StrategyBoard.tsx"), /<AgentFaceSvg agentId=\{agentId\}/, "fichas del mapa: cara");
});

test("Estadísticas: el Match Center pinta cara + nombre del agente de cada fila (y cara en móvil)", () => {
  const mc = src("src/components/liveEvents/MatchCenter.tsx");
  assert.match(mc, IMPORT);
  assert.match(mc, /<AgentChip value=\{s\.agent\} size=\{22\} \/>/);
  assert.match(mc, /<AgentChip value=\{s\.agent\} size=\{16\} hideName className="mr-1\.5 sm:hidden" \/>/);
});

test("JUGADOR ≠ AGENTE: el arte de agente no entra en cartas ni jugadores, y viceversa", () => {
  const art = src("src/components/agents/AgentArt.tsx");
  assert.ok(!/domain\/cards|CardArt|PlayerPhoto|playerImageSrc|\/players\//.test(art), "AgentArt no sabe nada de cartas");
  for (const f of ["CardArt", "CardViewer", "CardVisual", "CardRenderer", "CardThumb", "PlayerCard"].map((n) => `src/components/cards/${n}.tsx`)) {
    let c = "";
    try { c = src(f); } catch { continue; }
    assert.ok(!IMPORT.test(c), `${f}: una carta de jugador no lleva arte de agente`);
  }
  // Pre-partido: el equipo (cartas) y la composición (agentes) siguen siendo bloques separados.
  const p = src("src/app/entrenador/partido/page.tsx");
  assert.match(p, /<TeamCardStrip starters=\{starters\}/);
  assert.match(p, /<AgentLineup/);
});
