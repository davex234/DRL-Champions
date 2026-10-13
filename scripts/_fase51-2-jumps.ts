/** FASE 51.2 · instrumento: salto visual máximo por tick (px del asset) con NavTracker, en rondas simuladas. */
import * as S0 from "../src/sim";
import { NavTracker, maxStepPerTick } from "../src/domain/tactics/navigation/tracker";
import { availableMaps } from "../src/domain/tactics/maps";
const S = S0 as any;
const setup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
for (const m of availableMaps()) {
  let worst = 0, lag = 0;
  for (const seed of [3, 11, 29]) {
    let s = S.createRound(seed, setup);
    const tr = new Map<string, NavTracker>(); const prev = new Map<string, any>();
    for (let t = 0; t < 1500; t++) {
      s = S.tick(s);
      for (const p of s.players) {
        if (!p.alive) continue;
        if (!tr.has(p.id)) tr.set(p.id, new NavTracker(m.id));
        const q = tr.get(p.id)!.update(p.pos, s.tick);
        const o = prev.get(p.id);
        if (o) worst = Math.max(worst, Math.hypot((q.x - o.x) * m.width, (q.y - o.y) * m.height));
        prev.set(p.id, q);
      }
    }
  }
  console.log(m.id, "saltoMax/tick", Math.round(worst), "px · tope", Math.round(maxStepPerTick(m.id) * m.height), "px");
}
