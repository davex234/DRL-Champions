"use client";

/**
 * MANAGER CAREER STORE — la carrera del ENTRENADOR (Career Fase 1 + Fase 2).
 *
 * NO contiene lógica de simulación: orquesta el Manager Career Engine (puro, `@/career`) y
 * PERSISTE su salida. Fase 2 CONECTA la carrera con el Living World (`useWorldStore`): los
 * clubes, standings y mercado de entrenadores salen del mundo real; el entrenador se liga a
 * un `WorldTeam` y vive su ecosistema (contratos, objetivos, presión, despidos, ofertas).
 * Empuja hitos al buzón único `useNewsStore` y canaliza recompensas por `useGameStore`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  createCoach,
  applyMatchToCareer,
  runCareerSeason,
  runUnemployedSeason,
  acceptOffer as acceptOfferPure,
  renewContract,
  rejectOffer as rejectOfferPure,
  generateOffers,
  coachRating,
  clubViewFor,
  clubViewsFromWorld,
  seasonOutcomeFromWorld,
  initBoard,
  makeRng,
  seedOf,
  claimableReward,
  // Fase 3 — gestión del club
  runManagementSeason,
  upgradeFacility,
  generateStaffCandidates,
  hireStaff,
  staffSalaries,
  availableSponsors,
  signSponsor,
  runScouting,
  promoteProspect,
  trainPlayer,
  // Fase 5 — organización del club
  runAiOrganizations,
  orgNews,
  promoteStaffProspect,
  backfillFacilities,
  type ScoutPoolEntry,
  type ManagerCareer,
  type CoachCreateInput,
  type MatchOutcome,
  type FacilityId,
  type StaffMember,
  type Sponsor,
  type ClubManagement,
} from "@/career";
import type { TrainingSession } from "@/development";
import { advanceWorld, type WorldState } from "@/world";
import { runGlobalEcosystem, legacyNews } from "@/legacy";
import { buildEndgame, endgameNews, applyNewGamePlus, type EndgameState } from "@/endgame";
import {
  openTransferWindow, runAiMarket, marketNews,
  makeOffer as mktMakeOffer, counterOffer as mktCounter, acceptCounter as mktAcceptCounter,
  respondIncoming as mktRespond, renewPlayer as mktRenew, releasePlayer as mktRelease,
  loanOutPlayer as mktLoanOut, setListStatus as mktSetStatus, setLineup as mktSetLineup, refreshWindow as mktRefresh,
  type TransferWindow, type ListStatus, type LoanTerms, type MarketEvent,
} from "@/market";
import { useNewsStore } from "@/store/useNewsStore";
import { useGameStore } from "@/store/useGameStore";
import { useWorldStore } from "@/store/useWorldStore";
import { ns, td } from "@/i18n/runtime";

const tr = ns("store");

const USER_COACH_ID = "coach-user";

interface ManagerState {
  career: ManagerCareer | null;
  /** Ventana de fichajes interactiva del club del usuario (Career Fase 4). */
  window: TransferWindow | null;
  /** Estado CONGELADO de fin de carrera (Career Fase 7). No null = carrera retirada. */
  endgame: EndgameState | null;
  create: (input: Omit<CoachCreateInput, "now">) => void;
  applyMatch: (outcome: MatchOutcome) => void;
  /** Avanza UNA temporada conectada al Living World (resultado→objetivos→club→mercado). */
  advanceSeason: () => void;
  /** Acepta una oferta/renovación (se liga al club del mundo). */
  acceptOffer: (offerId: string) => void;
  rejectOffer: (offerId: string) => void;
  /** Refresca ofertas desde el mercado del mundo (para el dashboard estando libre). */
  refreshOffers: () => void;
  claimAchievement: (id: string) => void;
  // — Fase 3: gestión del club —
  upgradeFacility: (id: FacilityId) => void;
  hireStaff: (member: StaffMember) => void;
  signSponsor: (sponsor: Sponsor) => void;
  runScout: () => void;
  promoteProspect: (prospectId: string) => void;
  /** Fase 5: asciende un técnico de la academia al cuerpo técnico del club. */
  promoteStaffProspect: (prospectId: string) => void;
  trainPlayer: (playerId: string, session: TrainingSession) => void;
  // — Fase 4: mercado de fichajes interactivo —
  openMarket: () => void;
  marketOffer: (targetId: string, bid: { fee: number; salary: number; years: number }) => void;
  marketCounter: (offerId: string, bid: { fee: number; salary: number; years: number }) => void;
  marketAcceptCounter: (offerId: string) => void;
  marketRespond: (offerId: string, action: "accept" | "reject" | "counter", counterFee?: number) => void;
  marketRenew: (playerId: string, salary: number, years: number) => void;
  marketRelease: (playerId: string) => void;
  marketLoanOut: (playerId: string, loanClubId: string, terms: Omit<LoanTerms, "ownerClub">) => void;
  marketSetStatus: (playerId: string, status: ListStatus) => void;
  marketSetLineup: (starterIds: string[]) => void;
  marketRefresh: () => void;
  // — Fase 7: cierre de carrera —
  /** Retira al entrenador y genera su legado (documental/museo/HoF/récords). */
  retire: () => void;
  /** New Game+: el mundo continúa y recuerda; empieza una nueva carrera en el mismo universo. */
  newGamePlus: () => void;
  reset: () => void;
}

/** Empuja eventos de mercado al buzón único de noticias (kind transfer/record). */
function pushMarketNews(events: MarketEvent[]): void {
  if (events.length) useNewsStore.getState().add(marketNews(events.map((e) => ({ ...e, at: Date.now() }))));
}

type MarketStep = { window: TransferWindow; event: MarketEvent | null; error?: string };

/** Ejecuta una acción del mercado: aplica la mutación al mundo, persiste ventana + mundo + noticia. */
function runMarketMove(
  get: () => ManagerState,
  set: (partial: Partial<ManagerState>) => void,
  fn: (world: WorldState, window: TransferWindow) => MarketStep,
): void {
  const win = get().window;
  if (!win) return;
  const w = useWorldStore.getState().ensure();
  const step = fn(w, win);
  useWorldStore.setState({ world: { ...w } });
  set({ window: step.window });
  pushMarketNews(step.event ? [step.event] : []);
}

/** Suma de sueldos del roster real del club (del Living World). */
function rosterWages(clubId: string): number {
  const w = useWorldStore.getState().world;
  const t = w?.teams[clubId];
  if (!w || !t) return 0;
  return t.roster.reduce((a, id) => a + (w.players[id]?.contract?.salary ?? 0), 0);
}

/** Aplica los deltas de gestión al WorldTeam (presupuesto/prestigio/fanbase). */
function applyClubDeltas(clubId: string, deltas: { budget: number; prestige: number; fanbase: number }): void {
  const w = useWorldStore.getState().world;
  const t = w?.teams[clubId];
  if (!w || !t) return;
  t.budget = Math.max(0, Math.round(deltas.budget));
  t.prestige = Math.max(0, Math.min(100, t.prestige + deltas.prestige));
  t.fanbase = Math.max(0, Math.round(t.fanbase + deltas.fanbase));
  useWorldStore.setState({ world: { ...w } });
}

/** Helper: muta la gestión del club del usuario de forma inmutable. */
function patchManagement(career: ManagerCareer, fn: (m: ClubManagement) => ClubManagement): ManagerCareer {
  if (!career.management) return career;
  return { ...career, management: fn(career.management) };
}

/** Liga al entrenador del usuario como `WorldCoach` real de su club (vive en el mundo). */
function bindUserToWorld(clubId: string, career: ManagerCareer): void {
  const w = useWorldStore.getState().ensure();
  const team = w.teams[clubId];
  if (!team) return;
  const prevCoach = team.coachId && team.coachId !== USER_COACH_ID ? w.coaches[team.coachId] : null;
  if (prevCoach) { prevCoach.teamId = null; if (!w.freeCoaches.includes(prevCoach.id)) w.freeCoaches.push(prevCoach.id); }
  w.coaches[USER_COACH_ID] = {
    id: USER_COACH_ID, name: career.coach.name, teamId: clubId,
    rating: coachRating(career), titles: career.stats.titles, seasons: career.stats.seasonsCoached,
  };
  team.coachId = USER_COACH_ID;
  w.freeCoaches = w.freeCoaches.filter((id) => id !== USER_COACH_ID);
  useWorldStore.setState({ world: { ...w } });
}

/** Desliga al entrenador (tras un despido): su WorldCoach queda libre. */
function unbindUserFromWorld(clubId: string | null): void {
  const w = useWorldStore.getState().world;
  if (!w) return;
  const uc = w.coaches[USER_COACH_ID];
  if (uc) uc.teamId = null;
  if (clubId && w.teams[clubId]?.coachId === USER_COACH_ID) w.teams[clubId].coachId = null;
  if (uc && !w.freeCoaches.includes(USER_COACH_ID)) w.freeCoaches.push(USER_COACH_ID);
  useWorldStore.setState({ world: { ...w } });
}

export const useManagerStore = create<ManagerState>()(
  persist(
    (set, get) => ({
      career: null,
      window: null,
      endgame: null,

      create: (input) => {
        const career = createCoach({ ...input, now: Date.now() });
        const events = [{
          type: "first_contract" as const, season: 1, magnitude: 60,
          detail: tr("{name} comienza su carrera como entrenador.", { name: career.coach.name }), at: Date.now(),
        }];
        set({ career: { ...career, events }, window: null, endgame: null });
        useNewsStore.getState().add(events.map((e) => ({
          id: `career:${e.season}:${e.type}:${e.at}`, at: e.at, kind: "event" as const,
          title: tr("Nuevo entrenador en escena"), body: e.detail, tags: ["carrera", e.type],
        })));
        // Ofertas iniciales del mercado del mundo.
        get().refreshOffers();
      },

      applyMatch: (outcome) => {
        const career = get().career;
        if (!career) return;
        const step = applyMatchToCareer(career, outcome, Date.now());
        set({ career: step.career });
        if (step.news.length) useNewsStore.getState().add(step.news);
      },

      advanceSeason: () => {
        const career = get().career;
        if (!career || get().endgame) return; // un entrenador retirado no avanza (usar New Game+)
        const worldStore = useWorldStore.getState();
        const w = worldStore.ensure();
        const at = Date.now();

        // Caso EN PARO: el mundo avanza (con ecosistema global) y solo llegan ofertas.
        if (!career.clubId) {
          worldStore.advance();
          const wEco = useWorldStore.getState().ensure();
          const legacyEvents = runGlobalEcosystem(wEco, null, at);
          useWorldStore.setState({ world: { ...wEco } });
          const clubs = clubViewsFromWorld(wEco);
          const step = runUnemployedSeason(career, clubs, at);
          set({ career: step.career });
          useNewsStore.getState().add([...step.news, ...legacyNews(legacyEvents.map((e) => ({ ...e, at })))]);
          return;
        }

        // Caso CON CLUB: liga al usuario, corre el MERCADO (Fase 4) y la temporada del mundo.
        bindUserToWorld(career.clubId, career);
        const wForMarket = useWorldStore.getState().ensure();
        // 1) MERCADO: los 499 clubes negocian (blindando al usuario, que ya actuó en su ventana).
        const mktEvents = runAiMarket(wForMarket, career.clubId, at);
        // 2) TEMPORADA del mundo SIN su mercado interno (la capa rica ya lo movió).
        const adv = advanceWorld(wForMarket, { skipTransferMarket: true });
        useWorldStore.setState({ world: { ...wForMarket } });
        const w2 = useWorldStore.getState().ensure();
        const club = clubViewFor(w2, career.clubId);
        const outcome = seasonOutcomeFromWorld(w2, career.clubId);
        if (!club || !outcome) return;
        const clubs = clubViewsFromWorld(w2);
        const rng = makeRng(seedOf(career.seed, "season-decision", career.season));
        const playedSeason = career.season;
        const step = runCareerSeason(career, club, clubs, outcome, rng, at);
        let nextCareer = step.career;
        const win = get().window;
        const allNews = [...step.news, ...adv.news, ...marketNews(mktEvents.map((e) => ({ ...e, at })))];

        // FLUJO DE GESTIÓN (Fase 3+4): economía con FICHAJES reales (ventas/compras de la ventana).
        if (nextCareer.clubId === career.clubId && nextCareer.management) {
          const wages = rosterWages(career.clubId);
          const sales = win && win.clubId === career.clubId ? win.earnedThisSeason : 0;
          const purchases = win && win.clubId === career.clubId ? win.spentThisSeason : 0;
          const mgmtStep = runManagementSeason(
            career, club, nextCareer.management, outcome,
            { playerWages: wages, sales, purchases },
            playedSeason, makeRng(seedOf(career.seed, "mgmt", playedSeason)), at,
          );
          nextCareer = { ...nextCareer, management: mgmtStep.management, events: [...nextCareer.events, ...mgmtStep.events].slice(-400) };
          applyClubDeltas(career.clubId, mgmtStep.clubDeltas);
          allNews.push(...mgmtStep.news, ...orgNews(mgmtStep.orgEvents.map((e) => ({ ...e, at }))));
        }

        // ORGANIZACIONES RIVALES (Fase 5): los 499 clubes invierten/recortan/construyen solos.
        const wOrg = useWorldStore.getState().ensure();
        const orgEvents = runAiOrganizations(wOrg, career.clubId, at);
        useWorldStore.setState({ world: { ...wOrg } });
        if (orgEvents.length) allNews.push(...orgNews(orgEvents.map((e) => ({ ...e, at }))));

        // ECOSISTEMA GLOBAL (Fase 6): economía/rivalidades/competiciones/redes cambian el universo.
        const wEco = useWorldStore.getState().ensure();
        const legacyEvents = runGlobalEcosystem(wEco, career.clubId, at);
        useWorldStore.setState({ world: { ...wEco } });
        if (legacyEvents.length) allNews.push(...legacyNews(legacyEvents.map((e) => ({ ...e, at }))));

        // La ventana se marca cerrada; conserva las cesiones para procesar retornos al reabrir.
        set({ career: nextCareer, window: win ? { ...win, open: false } : null });
        if (allNews.length) useNewsStore.getState().add(allNews);

        // Sincroniza el mundo con el desenlace de empleo.
        if (!nextCareer.clubId) unbindUserFromWorld(career.clubId);
        else bindUserToWorld(nextCareer.clubId, nextCareer);
      },

      acceptOffer: (offerId) => {
        const career = get().career;
        if (!career) return;
        const offer = career.offers.find((o) => o.id === offerId);
        if (!offer || offer.status !== "pending") return;
        const at = Date.now();
        let result;
        if (offer.clubId === career.clubId) {
          result = renewContract(career, offer, at);
        } else {
          const w = useWorldStore.getState().ensure();
          const club = clubViewFor(w, offer.clubId);
          if (!club) return;
          result = acceptOfferPure(career, offer, club, at);
          bindUserToWorld(club.id, result.career);
        }
        set({ career: result.career });
        useNewsStore.getState().add(
          result.events.map((e) => ({ id: `career:${e.season}:${e.type}:${e.at}`, at: e.at, kind: "transfer" as const, title: tr("Mercado de entrenadores"), body: e.detail, tags: ["carrera", e.type] })),
        );
      },

      rejectOffer: (offerId) => {
        const career = get().career;
        if (!career) return;
        const result = rejectOfferPure(career, offerId, Date.now());
        set({ career: result.career });
      },

      refreshOffers: () => {
        const career = get().career;
        if (!career) return;
        const w = useWorldStore.getState().ensure();
        const clubs = clubViewsFromWorld(w);
        const offers = generateOffers(career, clubs, career.season);
        const existing = career.offers.filter((o) => o.status === "pending");
        const merged = [...existing];
        for (const of of offers) if (!existing.some((e) => e.clubId === of.clubId)) merged.push(of);
        set({ career: { ...career, offers: merged.slice(0, 6) } });
      },

      claimAchievement: (id) => {
        const career = get().career;
        if (!career) return;
        const reward = claimableReward(career, id);
        if (reward <= 0) return;
        useGameStore.getState().addCredits(reward);
        set({ career: { ...career, claimedAchievements: [...career.claimedAchievements, id] } });
      },

      // ── Fase 3: gestión del club ──

      upgradeFacility: (id) => {
        const career = get().career;
        if (!career?.management) return;
        const up = upgradeFacility(career.management.facilities, id);
        if (!up || career.management.balance < up.cost) return;
        const next = patchManagement(career, (m) => ({ ...m, facilities: up.facilities, balance: m.balance - up.cost }));
        set({ career: next });
        if (career.clubId) applyClubDeltas(career.clubId, { budget: next.management!.balance, prestige: 0, fanbase: 0 });
        useNewsStore.getState().add([{ id: `career:${career.season}:facility_upgraded:${id}:${Date.now()}`, at: Date.now(), kind: "event", title: tr("Mejora de instalaciones"), body: `${career.currentTeam} mejora ${id}.`, tags: ["carrera", "facility_upgraded"] }]);
      },

      hireStaff: (member) => {
        const career = get().career;
        if (!career?.management) return;
        if (career.management.balance < member.salary) return;
        const next = patchManagement(career, (m) => ({ ...m, staff: hireStaff(m.staff, member), balance: m.balance - member.salary }));
        set({ career: next });
        if (career.clubId) applyClubDeltas(career.clubId, { budget: next.management!.balance, prestige: 0, fanbase: 0 });
      },

      signSponsor: (sponsor) => {
        const career = get().career;
        if (!career?.management) return;
        set({ career: patchManagement(career, (m) => ({ ...m, sponsors: signSponsor(m.sponsors, sponsor) })) });
        useNewsStore.getState().add([{ id: `career:${career.season}:sponsor_signed:${sponsor.id}`, at: Date.now(), kind: "event", title: tr("Nuevo patrocinador"), body: tr("{currentTeam} firma con {name}.", { currentTeam: td(career.currentTeam), name: sponsor.name }), tags: ["carrera", "sponsor_signed"] }]);
      },

      runScout: () => {
        const career = get().career;
        if (!career?.management) return;
        const w = useWorldStore.getState().world;
        if (!w) return;
        const pool = w.freeAgents.map((id) => w.players[id]).filter(Boolean) as ScoutPoolEntry[];
        const targets = runScouting(career.management, career, pool, makeRng(seedOf(career.seed, "scout", career.season + career.management.scouting.length)));
        set({ career: patchManagement(career, (m) => ({ ...m, scouting: targets })) });
      },

      promoteProspect: (prospectId) => {
        const career = get().career;
        if (!career?.management || !career.clubId) return;
        const res = promoteProspect(career.management, prospectId);
        if (!res) return;
        const w = useWorldStore.getState().world;
        const team = w?.teams[career.clubId];
        if (w && team && team.roster.length < 5) {
          const p = res.prospect;
          w.players[p.id] = {
            id: p.id, nick: p.name, region: p.region, role: p.role, teamId: team.id,
            innate: p.innate, dev: p.dev, status: "active", value: p.value, titles: 0, mvps: 0, origin: "academy", prevValue: p.value,
            contract: { salary: Math.max(200, Math.round(p.value * 0.12)), years: 2, releaseClause: Math.round(p.value * 2), happiness: 70, loyalty: 60, ambition: p.innate.ambition, relCoach: 60, relTeam: 60 },
          };
          team.roster.push(p.id);
          useWorldStore.setState({ world: { ...w } });
        }
        set({ career: { ...career, management: res.management } });
        useNewsStore.getState().add([{ id: `career:${career.season}:rookie_promoted:${prospectId}`, at: Date.now(), kind: "transfer", title: tr("Rookie promovido"), body: tr("{name} asciende al primer equipo de {currentTeam}.", { name: res.prospect.name, currentTeam: td(career.currentTeam) }), tags: ["carrera", "rookie_promoted"] }]);
      },

      trainPlayer: (playerId, session) => {
        const career = get().career;
        if (!career?.management) return;
        const w = useWorldStore.getState().world;
        const p = w?.players[playerId];
        if (!w || !p) return;
        const { state } = trainPlayer(p.innate, p.dev, session, career.management, career.season);
        p.dev = state;
        useWorldStore.setState({ world: { ...w } });
      },

      promoteStaffProspect: (prospectId) => {
        const career = get().career;
        if (!career?.management) return;
        const res = promoteStaffProspect(career.management, prospectId);
        if (!res) return;
        const withStaff = { ...res.management, staff: hireStaff(res.management.staff, res.member) };
        set({ career: { ...career, management: withStaff } });
        useNewsStore.getState().add([{ id: `career:${career.season}:staff_hired:${prospectId}`, at: Date.now(), kind: "transfer", title: tr("Técnico de cantera"), body: tr("{name} asciende al cuerpo técnico de {currentTeam}.", { name: res.member.name, currentTeam: td(career.currentTeam) }), tags: ["carrera", "staff_hired"] }]);
      },

      // ── Fase 4: mercado de fichajes interactivo ──

      openMarket: () => {
        const career = get().career;
        if (!career?.clubId) return;
        const w = useWorldStore.getState().ensure();
        const prev = get().window;
        const carry = prev && prev.clubId === career.clubId ? prev.loans : [];
        const { window, events } = openTransferWindow(w, career.clubId, career.season, career.seed, carry, Date.now());
        useWorldStore.setState({ world: { ...w } });
        set({ window });
        pushMarketNews(events);
      },

      marketOffer: (targetId, bid) => runMarketMove(get, set, (w, win) => mktMakeOffer(w, win, targetId, bid, Date.now())),
      marketCounter: (offerId, bid) => runMarketMove(get, set, (w, win) => mktCounter(w, win, offerId, bid, Date.now())),
      marketAcceptCounter: (offerId) => runMarketMove(get, set, (w, win) => mktAcceptCounter(w, win, offerId, Date.now())),
      marketRespond: (offerId, action, counterFee = 0) => runMarketMove(get, set, (w, win) => mktRespond(w, win, offerId, action, counterFee, Date.now())),
      marketRenew: (playerId, salary, years) => runMarketMove(get, set, (w, win) => mktRenew(w, win, playerId, salary, years, Date.now())),
      marketRelease: (playerId) => runMarketMove(get, set, (w, win) => mktRelease(w, win, playerId, Date.now())),
      marketLoanOut: (playerId, loanClubId, terms) => runMarketMove(get, set, (w, win) => mktLoanOut(w, win, playerId, loanClubId, terms, Date.now())),
      marketSetStatus: (playerId, status) => runMarketMove(get, set, (w, win) => mktSetStatus(w, win, playerId, status)),
      marketSetLineup: (starterIds) => runMarketMove(get, set, (w, win) => mktSetLineup(w, win, starterIds)),
      marketRefresh: () => {
        const win = get().window;
        if (!win) return;
        const w = useWorldStore.getState().ensure();
        set({ window: mktRefresh(w, win) });
      },

      // ── Fase 7: cierre de carrera ──

      retire: () => {
        const career = get().career;
        if (!career || get().endgame) return;
        const w = useWorldStore.getState().ensure();
        const at = Date.now();
        // Si dirige un club, liga y sincroniza el mundo para que el legado sea completo.
        if (career.clubId) bindUserToWorld(career.clubId, career);
        const { endgame, events } = buildEndgame(career, w, at);
        set({ endgame });
        useNewsStore.getState().add(endgameNews(events.map((e) => ({ ...e, at }))));
      },

      newGamePlus: () => {
        const eg = get().endgame;
        if (!eg) return;
        const career = get().career;
        const w = useWorldStore.getState().ensure();
        if (career) applyNewGamePlus(w, career); // el mundo recuerda: el entrenador queda como leyenda
        useWorldStore.setState({ world: { ...w } });
        // Nueva carrera en el MISMO universo evolucionado (leyendas/récords/HoF permanecen).
        set({ career: null, window: null, endgame: null });
      },

      reset: () => set({ career: null, window: null, endgame: null }),
    }),
    {
      name: "drl-manager-v1",
      version: 6,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ career: s.career, window: s.window, endgame: s.endgame }),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { career: ManagerCareer | null; window?: TransferWindow | null; endgame?: EndgameState | null };
        // v1 → v2: añade los campos de Fase 2 (Club & Contract) si faltan.
        if (version < 2 && state?.career) {
          const c = state.career as Partial<ManagerCareer> & ManagerCareer;
          state.career = {
            ...c,
            clubId: c.clubId ?? null,
            contract: c.contract ?? null,
            board: c.board ?? initBoard(),
            offers: c.offers ?? [],
            unemployedSeasons: c.unemployedSeasons ?? 0,
          };
        }
        // v2 → v3: añade la gestión integral del club (Fase 3) si falta.
        if (version < 3 && state?.career) {
          const c = state.career as Partial<ManagerCareer> & ManagerCareer;
          state.career = { ...c, management: c.management ?? null };
        }
        // v3 → v4: añade la ventana de fichajes (Fase 4). Se reconstruye al abrir el mercado.
        if (version < 4) state.window = state.window ?? null;
        // v4 → v5: organización (Fase 5) — instalaciones nuevas, academia de staff, ánimo de afición.
        if (version < 5 && state?.career?.management) {
          const m = state.career.management;
          state.career = { ...state.career, management: { ...m, facilities: backfillFacilities(m.facilities), academyStaff: m.academyStaff ?? [], fanbaseMood: m.fanbaseMood ?? 50 } };
        }
        // v5 → v6: cierre de carrera (Fase 7). El estado de endgame se genera al retirarse.
        if (version < 6) state.endgame = state.endgame ?? null;
        return state;
      },
    },
  ),
);

/** ¿El usuario ya creó su entrenador? */
export const hasCoach = (s: ManagerState): boolean => s.career != null;
