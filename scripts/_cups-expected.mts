/**
 * F86 · INSTRUMENTO (fuera de CI): resultados ESPERADOS del cuadro según el dominio TS, para que el ensayo de 0069
 * (`scripts/ops/_cups-dryrun.sh`) compare la SQL con la especificación, tamaño a tamaño.
 *
 *   npx tsx scripts/_cups-expected.mts > scripts/ops/_cups-expected.tsv
 *
 * Mundo fijo: usuarios `c0000000-0000-4000-8000-0000000000NN` (1..84), copa de N inscritos = `cccccccc-0000-4000-8000-0000000000NN`
 * con los usuarios 1..N, ratings fijos con empates y cuentas sin ranked (ver `ratingOf`). Salida (TSV):
 *   R1   <n> <slot> <player_a|-> <player_b|->     (ronda 1)
 *   CH   <n> <campeón> - -                          (si siempre gana el mejor seed; 5 columnas siempre)
 *   SEED <n> <user> <seed> <rating>                 (foto de seeds)
 */
import { createHash } from "node:crypto";
import { planBracket, playable, applyOutcome, type BracketState } from "../src/domain/cups/bracket";
import { seedEntries } from "../src/domain/cups/seeding";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const user = (i: number) => `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const cup = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Ratings con empates (grupos de 3) y sin ranked (null → 1000) cada 5.º usuario. */
export const ratingOf = (i: number): number | null => (i % 5 === 0 ? null : 1300 - Math.floor(i / 3) * 10);

const SIZES = Array.from({ length: 61 }, (_, k) => k + 4);
const out: string[] = [];
for (const n of SIZES) {
  const ids = Array.from({ length: n }, (_, k) => user(k + 1));
  const seeded = seedEntries(cup(n), ids.map((u, k) => ({ userId: u, rating: ratingOf(k + 1) })), md5);
  for (const s of seeded) out.push(["SEED", n, s.userId, s.seed, s.seedRating].join("\t"));
  let st: BracketState = planBracket(seeded.map((s) => s.userId));
  for (const m of st.matches.filter((x) => x.round === 1)) {
    out.push(["R1", n, m.slot, m.a.kind === "PLAYER" ? m.a.userId : "-", m.b.kind === "PLAYER" ? m.b.userId : "-"].join("\t"));
  }
  const seedOf = new Map(seeded.map((s) => [s.userId, s.seed]));
  while (!st.complete) {
    const m = playable(st)[0];
    const a = (m.a as { userId: string }).userId, b = (m.b as { userId: string }).userId;
    const r = applyOutcome(st, m.round, m.slot, { winnerId: seedOf.get(a)! < seedOf.get(b)! ? a : b }, "PLAYED");
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  out.push(["CH", n, st.championId, "-", "-"].join("\t"));
}
process.stdout.write(out.join("\n") + "\n");
