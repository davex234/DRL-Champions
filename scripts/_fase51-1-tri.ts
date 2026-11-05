/** FASE 51.1 · instrumento: comprueba la orientación de la triangulación por mapa. */
import * as M0 from "../src/domain/tactics/matchMap";
import * as S0 from "../src/sim";
const M = M0 as any, S = S0 as any;
console.log("triángulos", M.SIM_TRIANGLES.length);
for (const [id, a] of Object.entries(M.MATCH_MAP_ANCHORS) as any) {
  const signs = M.SIM_TRIANGLES.map((t: any) => {
    const s = (z: string) => [S.ZONES[z].x, S.ZONES[z].y];
    const cr = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const ss = Math.sign(cr(s(t[0]), s(t[1]), s(t[2])));
    const rs = cr(a[t[0]], a[t[1]], a[t[2]]);
    return { t: t.join("/"), rel: Math.sign(rs) * ss, area: Math.abs(rs) };
  });
  const bad = signs.filter((x: any) => x.rel !== -1 || x.area < 1);
  console.log(id, bad.length ? "PLIEGA " + bad.map((b: any) => `${b.t}(${b.rel},${b.area.toFixed(1)})`).join(" ") : "ok");
}
