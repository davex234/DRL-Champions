/** FASE 51 · instrumento (fuera de CI): genera una jugada QA rica con el dominio real. */
import * as T from "../src/domain/tactics";
import * as R from "../src/domain/tactics/roster";
const t = T as any, r = R as any;
if (process.argv.includes("--info")) {
  console.log(t.UTILITY_KINDS.join(","), "|", t.DRAW_KINDS.join(","), "|", t.DRAW_COLORS.join(","));
  for (const a of ["jett", "omen", "sova", "killjoy", "kayo"]) {
    const ag = r.getTacticalAgent(a);
    console.log(a, ag?.role, ag?.abilities.map((x: any) => `${x.id}:${JSON.stringify(x.kind ?? x.kinds ?? x.utility)}`).join(" "));
  }
}

if (process.argv.includes("--build")) {
  const map = t.getTacticalMap("ascent");
  const zonas = (map.zones ?? []).map((z: any) => {
    const c = z.polygon.reduce((s: number[], p: number[]) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v: number) => v / z.polygon.length);
    return { id: z.id, kind: z.kind, c };
  });
  if (process.argv.includes("--zones")) { console.log(JSON.stringify(zonas)); process.exit(0); }
  const site = zonas.find((z: any) => /a/i.test(z.id) && z.kind === "site")?.c ?? [84, 30];
  const agentes = ["jett", "omen", "sova", "killjoy", "kayo"];
  let s = t.emptyStrat("qa51", "ascent", "attack", "__QA_TRAINER51__ Ejecución A");
  s = { ...s, description: "Toma de A con humos de Omen, reconocimiento de Sova y entrada de Jett." };
  const setAgents = (st: any) => ({ ...st, players: st.players.map((p: any, i: number) => ({ ...p, agentId: agentes[i] })) });
  s = t.updateStep(s, 0, setAgents);
  s = t.renameStep(s, 0, "Setup", "Todos en spawn. Jett y Kay/O abren el camino a A.");
  const ab = (id: string, kind: string, owner: string, x: number, y: number, to?: [number, number]) => (st: any) => {
    const n = t.addUtility(st, kind, x, y);
    const u = n.utilities[n.utilities.length - 1];
    const a = r.getTacticalAbility(id);
    return { ...n, utilities: n.utilities.map((v: any) => v.id === u.id ? { ...v, abilityId: id, ownerId: owner, label: a?.name ?? v.label, ...(to ? { to: { x: to[0], y: to[1] } } : {}) } : v) };
  };
  // Paso 2 · utilidad
  s = t.addStep(s);
  s = t.renameStep(s, 1, "Utilidad", "Omen humea las esquinas del sitio; Sova lanza el dardo de reconocimiento.");
  s = t.updateStep(s, 1, (st: any) => {
    let x = st;
    x = t.moveObject(x, "p0", site[0] - 2, site[1] + 24);
    x = t.moveObject(x, "p1", site[0] - 12, site[1] + 30);
    x = t.moveObject(x, "p2", site[0] - 6, site[1] + 32);
    x = t.moveObject(x, "p4", site[0] + 2, site[1] + 27);
    x = ab("omen_q", "smoke", "p1", site[0] - 12, site[1] - 2)(x);
    x = ab("omen_e", "smoke", "p1", site[0] - 4, site[1] + 12)(x);
    x = ab("sova_e", "recon", "p2", site[0] + 2, site[1] + 2)(x);
    x = t.addDrawing(x, "arrow", "#19e3ff", [{ x: site[0] - 2, y: site[1] + 24 }, { x: site[0] + 2, y: site[1] + 14 }, { x: site[0], y: site[1] + 2 }]);
    return x;
  });
  // Paso 3 · entrada
  s = t.addStep(s);
  s = t.renameStep(s, 2, "Entrada A", "Flash de Kay/O y entrada de Jett por el pasillo principal.");
  s = t.updateStep(s, 2, (st: any) => {
    let x = st;
    x = t.moveObject(x, "p0", site[0] + 1, site[1] + 8);
    x = t.moveObject(x, "p4", site[0] - 1, site[1] + 16);
    x = ab("kayo_q", "flash", "p4", site[0] + 1, site[1] + 6)(x);
    x = t.setTarget(x, "p0", { x: site[0] - 4, y: site[1] - 3 });
    x = t.addAnnotation(x, "Entrada A", site[0] - 8, site[1] - 12);
    return x;
  });
  // Paso 4 · post-plant
  s = t.addStep(s);
  s = t.renameStep(s, 3, "Post-plant", "Killjoy cierra el flanco; el resto cruza fuegos sobre la spike.");
  s = t.updateStep(s, 3, (st: any) => {
    let x = st;
    x = t.moveObject(x, "p3", site[0] - 14, site[1] + 14);
    x = ab("killjoy_q", "molly", "p3", site[0] - 16, site[1] + 6)(x);
    x = t.addUtility(x, "spike", site[0] - 1, site[1] + 1);
    x = t.addDrawing(x, "zone", "#ffd35c", [{ x: site[0] - 8, y: site[1] - 6 }, { x: site[0] + 8, y: site[1] + 8 }]);
    return x;
  });
  const v = t.validateStrat(s);
  if (!v.ok) { console.error(JSON.stringify(v.issues)); process.exit(1); }
  console.log(JSON.stringify(s));
}
