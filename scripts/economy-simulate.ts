/**
 * SIMULACIÓN ECONÓMICA — NEXUS (Fase 11).
 *
 *   npm run economy:simulate
 *   npm run economy:simulate -- --days 84 --pack premium
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Una herramienta de DESARROLLO. No se ejecuta en la aplicación, no toca la base de datos
 * y no forma parte del producto: sirve para responder con números —y no con intuición— a
 * las preguntas que la Fase 11 plantea.
 *
 *   ¿Cuántos créditos genera un jugador medio?
 *   ¿Cuántos sobres puede abrir?
 *   ¿Cuántas cartas consigue, y cuántas le salen repetidas?
 *   ¿Cuánto recupera desguazando?
 *   ¿La economía se infla o se seca?
 *
 * ────────────────────────── DE DÓNDE SALEN LOS NÚMEROS ──────────────────────────
 *
 * De los datos REALES del juego, no de constantes inventadas aquí:
 *
 *   · Recompensa por duelo y tope diario → `domain/progression/duelRewards`
 *   · Escalones de Pick'em               → `domain/pickems/rewards`
 *   · Carriles y misiones de la temporada→ `data/season`
 *   · Precio y contenido de los sobres   → `data/packs`
 *   · El SORTEO                          → el motor real (`runtimePackEngine`)
 *   · Valor de desguace                  → `domain/economy/salvage`
 *
 * Lo único que se modela aquí son los TRES PERFILES de jugador, que son una hipótesis de
 * comportamiento y están declarados arriba del todo para que se puedan discutir.
 */
import { runtimePackEngine } from "@/publisher/runtime";
import { PACKS } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { CURRENT_SEASON } from "@/data/season";
import { duelPoints, duelReward, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { salvageValue } from "@/domain/economy/salvage";
import { CARDS } from "@/data/catalog";
import { PRESTIGE_TIERS, PRESTIGE_TOTAL } from "@/domain/collection/prestige";
import { masterySets } from "@/domain/collection/mastery";
import { CHALLENGE_SETS, totalReward } from "@/domain/events/challenges";
import type { OwnedCard } from "@/domain/cards/types";

// ───────────────────────────── Los tres perfiles ─────────────────────────────

interface Profile {
  name: string;
  /** Partidas al día que llegan a terminarse. */
  duelsPerDay: number;
  /** Proporción de victorias contra el bot. */
  winRate: number;
  difficulty: "EASY" | "NORMAL" | "HARD";
  /** Torneos con predicciones al mes y escalón que suele alcanzar. */
  pickemsPerMonth: number;
  pickemTier: string;
  /** Misiones repetibles que reclama a la semana (de las 4 diarias + 4 semanales). */
  missionsPerWeek: number;
  /** Qué sobre compra cuando puede permitírselo. */
  pack: string;
  /** ¿Desguaza los duplicados? */
  salvages: boolean;
}

const PROFILES: Profile[] = [
  {
    name: "Casual", duelsPerDay: 2, winRate: 0.45, difficulty: "EASY",
    pickemsPerMonth: 1, pickemTier: "participacion", missionsPerWeek: 4,
    pack: "estandar", salvages: true,
  },
  {
    name: "Activo", duelsPerDay: 8, winRate: 0.55, difficulty: "NORMAL",
    pickemsPerMonth: 2, pickemTier: "acertante", missionsPerWeek: 12,
    pack: "premium", salvages: true,
  },
  {
    name: "Intensivo", duelsPerDay: DAILY_DUEL_AWARD_CAP, winRate: 0.65, difficulty: "HARD",
    pickemsPerMonth: 3, pickemTier: "analista", missionsPerWeek: 25,
    pack: "premium", salvages: true,
  },
];

// ───────────────────────────── Ingresos ─────────────────────────────

/** Créditos y XP que da un día de duelos, respetando el tope diario de pago. */
function duelIncome(p: Profile): { credits: number; points: number } {
  const paid = Math.min(p.duelsPerDay, DAILY_DUEL_AWARD_CAP);
  const wins = paid * p.winRate;
  const losses = paid - wins;
  const credits =
    wins * (duelReward("win", p.difficulty).credits ?? 0) +
    losses * (duelReward("loss", p.difficulty).credits ?? 0);
  const points = wins * duelPoints("win", p.difficulty);
  return { credits: Math.round(credits), points: Math.round(points) };
}

/** Créditos de un Pick'em al escalón que suele alcanzar este perfil. */
function pickemIncome(tierId: string): number {
  return REWARD_TIERS.find((t) => t.id === tierId)?.reward.credits ?? 0;
}

/** Créditos de las misiones repetibles que reclama a la semana (media del catálogo). */
function missionIncome(p: Profile): number {
  const repeatable = CURRENT_SEASON.missionPool.filter((m) => m.repeatable);
  if (repeatable.length === 0) return 0;
  const avg = repeatable.reduce((s, m) => s + (m.reward.credits ?? 0), 0) / repeatable.length;
  return Math.round(avg * p.missionsPerWeek);
}

/** Lo que reparte el pase a lo largo de la temporada, prorrateado por día. */
function passIncomePerDay(): number {
  const tracks = CURRENT_SEASON as unknown as Record<string, Record<number, { credits?: number }>>;
  const free = Object.values(tracks.free ?? {}).reduce((s, r) => s + (r.credits ?? 0), 0);
  // El carril competitivo solo se abre en Oro; se cuenta a la mitad como aproximación
  // honesta de que no todo el mundo llega.
  const comp = Object.values(tracks.competitive ?? {}).reduce((s, r) => s + (r.credits ?? 0), 0) * 0.5;
  return (free + comp) / (CURRENT_SEASON.durationDays ?? 84);
}

/**
 * Créditos y XP que reparte un EVENTO completo (Fase 12).
 *
 * Se usa el conjunto internacional, que es el mayor: mide el techo, no la media, porque lo
 * que interesa saber es cuánto puede llegar a añadir el contenido vivo al grifo — si el
 * techo no desequilibra, la media tampoco.
 *
 * `completion` modela que no todo el mundo cobra todos los desafíos: un Casual que juega
 * dos partidas al día no llega a «gana 3 duelos» tan fácilmente como un Intensivo.
 */
function eventIncome(p: Profile): { credits: number; xp: number } {
  const set = CHALLENGE_SETS.find((x) => x.id === "internacional") ?? CHALLENGE_SETS[0];
  const t = totalReward(set.challenges);
  const completion = p.duelsPerDay >= 8 ? 1 : p.duelsPerDay >= 4 ? 0.8 : 0.6;
  return {
    credits: Math.round((t.credits ?? 0) * completion),
    xp: Math.round((t.xp ?? 0) * completion),
  };
}

/** Días entre eventos. Tres por temporada de 84 días es lo que dice `data/events`. */
const EVENT_EVERY_DAYS = 28;

/**
 * SATURACIÓN — el escenario que la Fase 14 necesita medir.
 *
 * Los tres perfiles de arriba compran sobres MIENTRAS PUEDEN, y por eso acaban a cero: el
 * modelo gasta todo lo que entra. Eso esconde el problema real del endgame, que no es que
 * falten créditos sino que **cuando el jugador deja de querer sobres, no hay dónde
 * gastarlos**.
 *
 * Este modo apaga la compra de sobres en cuanto la colección pasa del umbral y mide lo que
 * de verdad importa para dimensionar un sumidero: **a qué ritmo se acumulan los créditos de
 * un jugador que ya no compra**.
 */
const SATURATION_AT = 0.85;
const CATALOG_SIZE = CARDS.length;

// ───────────────────────────── La simulación ─────────────────────────────

interface Result {
  profile: string;
  days: number;
  earned: number;
  spent: number;
  salvaged: number;
  packsOpened: number;
  cards: number;
  distinct: number;
  duplicates: number;
  balance: number;
  points: number;
  /** De dónde salió cada crédito ganado. Sin esto no se puede decir si el evento infla. */
  fromDuels: number;
  fromPass: number;
  fromMissions: number;
  fromPickems: number;
  fromEvents: number;
}

function simulate(p: Profile, days: number, seedBase: number, saturate = false): Result {
  const pack = PACKS.find((x) => x.id === p.pack)!;
  const owned = new Map<string, number>();
  let balance = 6000; // saldo inicial del perfil
  let earned = 0, spent = 0, salvaged = 0, packsOpened = 0, cards = 0, duplicates = 0, points = 0;
  let fromDuels = 0, fromPass = 0, fromMissions = 0, fromPickems = 0, fromEvents = 0;
  let pity = { version: 1, counters: {} } as never;
  const perDayPass = passIncomePerDay();

  for (let day = 1; day <= days; day++) {
    // ── Ingresos del día ──
    const d = duelIncome(p);
    let income = d.credits + perDayPass;
    fromDuels += d.credits;
    fromPass += perDayPass;
    points += d.points;
    if (day % 7 === 0) {
      const m = missionIncome(p);
      income += m; fromMissions += m;
    }
    if (day % 30 === 0) {
      const k = pickemIncome(p.pickemTier) * p.pickemsPerMonth;
      income += k; fromPickems += k;
    }
    // El evento paga al cerrarse su ventana, igual que en el producto: los desafíos de
    // predicción no se completan hasta que el torneo termina y se corrige.
    if (day % EVENT_EVERY_DAYS === 0) {
      const e = eventIncome(p);
      income += e.credits; fromEvents += e.credits;
    }

    earned += income;
    balance += income;

    /*
     * Gasto: compra sobres mientras pueda. En modo SATURACIÓN deja de comprar en cuanto la
     * colección pasa del umbral — que es lo que hace una persona real cuando el sobre ya
     * casi nunca trae algo nuevo.
     */
    const saturated = saturate && owned.size / CATALOG_SIZE >= SATURATION_AT;
    while (!saturated && balance >= pack.price) {
      balance -= pack.price;
      spent += pack.price;
      packsOpened++;

      const ownedList: OwnedCard[] = [...owned.keys()].map((cardId, i) => ({
        uid: `o${i}`, cardId, serial: undefined, obtainedAt: 0, origin: "pack" as const,
      }));
      const r = runtimePackEngine().open(pack, {
        seed: seedBase + day * 7919 + packsOpened, owned: ownedList,
        mintCounts: {}, pity, now: Date.now(),
      });
      pity = r.pityAfter as never;

      for (const ins of r.instances) {
        cards++;
        const had = owned.get(ins.cardId) ?? 0;
        owned.set(ins.cardId, had + 1);
        if (had > 0) {
          duplicates++;
          if (p.salvages) {
            const def = getCard(ins.cardId);
            const v = def ? salvageValue(def) : 0;
            salvaged += v;
            balance += v;
            owned.set(ins.cardId, had); // el duplicado se desguaza: no se conserva
          }
        }
      }
    }
  }

  return {
    profile: p.name, days, earned: Math.round(earned), spent, salvaged,
    packsOpened, cards, distinct: owned.size, duplicates,
    balance: Math.round(balance), points,
    fromDuels: Math.round(fromDuels), fromPass: Math.round(fromPass),
    fromMissions: Math.round(fromMissions), fromPickems: Math.round(fromPickems),
    fromEvents: Math.round(fromEvents),
  };
}

// ───────────────────────────── Salida ─────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };

  /*
   * Tres horizontes, no uno (Fase 12). Una temporada entera esconde el problema del
   * principio: los primeros días son los que deciden si alguien se queda, y en 84 días
   * quedan diluidos en la media. Se puede forzar uno solo con `--days`.
   */
  const only = args.indexOf("--days");
  const horizons = only >= 0 && args[only + 1]
    ? [Math.max(1, Math.min(365, Number(args[only + 1])))]
    : [7, 30, CURRENT_SEASON.durationDays ?? 84];

  const pad = (s: string | number, n: number) => String(s).padStart(n);

  console.log(`# Simulacion economica de NEXUS
`);
  console.log(`Tope diario de duelos pagados: ${DAILY_DUEL_AWARD_CAP}`);
  console.log(`Sobres del catalogo: ${PACKS.length} · Horizontes: ${horizons.join(" / ")} dias
`);

  const byHorizon = new Map<number, Result[]>();

  for (const days of horizons) {
    const rows = PROFILES.map((p, i) => simulate(p, days, 1_000_003 * (i + 1)));
    byHorizon.set(days, rows);

    console.log(`\n## ${days} dias
`);
    console.log("Perfil     Ganado    Gastado  Desguace   Sobres  Cartas  Distintas  Duplic.   Saldo   Puntos");
    for (const r of rows) {
      console.log(
        `${r.profile.padEnd(10)}${pad(r.earned, 8)}${pad(r.spent, 10)}${pad(r.salvaged, 10)}` +
        `${pad(r.packsOpened, 9)}${pad(r.cards, 8)}${pad(r.distinct, 11)}${pad(r.duplicates, 9)}` +
        `${pad(r.balance, 8)}${pad(r.points, 9)}`,
      );
    }

    console.log("\n   Velocidad de coleccion y coste");
    for (const r of rows) {
      const dupPct = r.cards > 0 ? ((r.duplicates / r.cards) * 100).toFixed(0) : "0";
      const recovery = r.spent > 0 ? ((r.salvaged / r.spent) * 100).toFixed(0) : "0";
      const perDistinct = r.distinct > 0 ? Math.round(r.spent / r.distinct) : 0;
      console.log(
        `   ${r.profile.padEnd(10)} ${pad(r.distinct, 4)} distintas de 772 (${((r.distinct / 772) * 100).toFixed(0).padStart(2)} %) · ` +
        `${dupPct.padStart(2)} % duplicados · recupera ${recovery.padStart(2)} % desguazando · ` +
        `${pad(perDistinct, 5)} cr por carta nueva`,
      );
    }
  }

  /*
   * DE DONDE VIENE CADA CREDITO.
   *
   * Es la tabla que la Fase 12 necesita para decidir si el contenido vivo infla la
   * economia. Si el evento pesara como los duelos, habriamos convertido un torneo en un
   * grifo; si pesa poco, es contenido.
   */
  const season = horizons[horizons.length - 1];
  console.log(`\n## De donde vienen los creditos (${season} dias)
`);
  console.log("Perfil       Duelos     Pase   Misiones  Pick'ems   Eventos   Desguace   % eventos");
  for (const r of byHorizon.get(season)!) {
    const total = r.earned + r.salvaged;
    const share = total > 0 ? (100 * r.fromEvents / total).toFixed(1) : "0.0";
    console.log(
      `${r.profile.padEnd(10)}${pad(r.fromDuels, 9)}${pad(r.fromPass, 9)}${pad(r.fromMissions, 11)}` +
      `${pad(r.fromPickems, 10)}${pad(r.fromEvents, 10)}${pad(r.salvaged, 11)}${pad(share + " %", 12)}`,
    );
  }

  console.log(`\n## Balance de la economia (${season} dias)
`);
  for (const r of byHorizon.get(season)!) {
    const net = r.earned + r.salvaged - r.spent;
    const verdict = r.balance > r.earned * 0.25
      ? "ACUMULA (falta sumidero)"
      : r.balance < 500 ? "SECO (todo se gasta)" : "EQUILIBRADO";
    console.log(
      `  ${r.profile.padEnd(10)} entra ${pad(r.earned + r.salvaged, 8)} · sale ${pad(r.spent, 8)} · ` +
      `neto ${pad(net, 8)} · saldo final ${pad(r.balance, 7)} -> ${verdict}`,
    );
  }

  /*
   * PUNTO DE SATURACION: cuando el coste de la siguiente carta nueva se dispara, el jugador
   * deja de comprar sobres — y ahi es donde hace falta el sumidero de fin de juego.
   */
  /*
   * EL ESCENARIO QUE DIMENSIONA EL SUMIDERO (Fase 14).
   *
   * Un jugador que deja de comprar sobres al 85 % de coleccion. Lo que se mide es a que
   * ritmo se le acumulan los creditos sin destino: es la cifra que cualquier sumidero de
   * fin de juego tiene que ser capaz de absorber.
   */
  console.log(`\n## Saturacion: que pasa cuando se deja de comprar sobres\n`);
  console.log("Perfil      Coleccion  Saldo acumulado   Por dia  Meses para 1M");
  for (const [i, p] of PROFILES.entries()) {
    const r = simulate(p, season, 1_000_003 * (i + 1), true);
    const perDay = r.balance / season;
    console.log(
      `${r.profile.padEnd(10)}${pad(((r.distinct / CATALOG_SIZE) * 100).toFixed(0) + " %", 10)}`
      + `${pad(r.balance, 17)}${pad(Math.round(perDay), 10)}`
      + `${pad(perDay > 0 ? (1_000_000 / perDay / 30).toFixed(1) : "—", 15)}`,
    );
  }

  /*
   * EL SUMIDERO, MEDIDO CONTRA ESA ACUMULACION (Fase 14).
   *
   * El prestigio es el primer sumidero de creditos que no es un sobre. Aqui se comprueba lo
   * unico que hay que comprobar de un sumidero: que absorbe MAS de lo que entra, y por
   * cuanto. Un sumidero que se agota vuelve a dejar el problema donde estaba.
   */
  console.log(`\n## El sumidero de prestigio frente a esa acumulacion\n`);
  const badges = masterySets().length;
  const capacity = badges * PRESTIGE_TOTAL;
  console.log(`Escalones: ${PRESTIGE_TIERS.map((t) => `${t.label} ${t.price.toLocaleString("es-ES")}`).join(" · ")}`);
  console.log(`Un conjunto a elite: ${PRESTIGE_TOTAL.toLocaleString("es-ES")} cr`);
  console.log(`Capacidad total (${badges} conjuntos): ${capacity.toLocaleString("es-ES")} cr\n`);
  console.log("Perfil      Acumula/temporada  Escalones que puede pagar  Absorbido  Capacidad (anos)");
  for (const [i, p] of PROFILES.entries()) {
    const r = simulate(p, season, 1_000_003 * (i + 1), true);
    const perDay = r.balance / season;
    /* Cuantos escalones consecutivos (plata, oro, elite, plata del siguiente...) paga. */
    let left = r.balance, steps = 0, spent = 0;
    while (steps < 200) {
      const price = PRESTIGE_TIERS[steps % PRESTIGE_TIERS.length].price;
      if (left < price) break;
      left -= price; spent += price; steps++;
    }
    const years = perDay > 0 ? capacity / perDay / 365 : Infinity;
    console.log(
      `${r.profile.padEnd(10)}${pad(r.balance, 19)}${pad(steps, 27)}` +
      `${pad(r.balance > 0 ? ((100 * spent) / r.balance).toFixed(0) + " %" : "—", 11)}` +
      `${pad(Number.isFinite(years) ? years.toFixed(0) : "inf", 18)}`,
    );
  }
  console.log(`\n## Punto de saturacion
`);
  for (const r of byHorizon.get(season)!) {
    const perNew = r.distinct > 0 ? Math.round(r.spent / r.distinct) : 0;
    const packPrice = PACKS.find((x) => x.id === PROFILES.find((p) => p.name === r.profile)!.pack)!.price;
    console.log(
      `  ${r.profile.padEnd(10)} ${((r.distinct / 772) * 100).toFixed(0).padStart(2)} % del catalogo · ` +
      `una carta nueva cuesta ya ${pad(perNew, 5)} cr, ${(perNew / packPrice).toFixed(1)} sobres`,
    );
  }
}

main();
