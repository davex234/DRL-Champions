/**
 * TRANSFER MARKET & SQUAD MANAGEMENT ENGINE — API pública (Career Fase 4/7).
 *
 * El mercado de fichajes VIVO de DRL Champions: necesidades de plantilla, valor de mercado
 * dinámico, negociación (oferta/contraoferta/aceptación), cesiones, director deportivo, IA de
 * los 499 clubes, plantillas (titulares/suplentes/cedidos), química y dashboard. EXTIENDE el
 * ecosistema (Living World + Player Development + News/Timeline) sin duplicar ningún motor.
 */
export * from "./types";
export { ALL_ROLES, IDEAL_COMP, ROLE_LABEL, roleCounts, roleFits } from "./roles";
export { marketValue, wageFor, askingFee } from "./value";
export { squadNeeds, needsRole } from "./needs";
export { philosophyOf, directorStance, directorAcceptsSale, directorReview } from "./director";
export { evaluateBid, applyRound, affordable, type BidContext, type BidVerdict } from "./negotiate";
export {
  applySigning, applySale, applyRenewal, applyRelease, applyLoanOut, applyLoanReturn, applySwap,
} from "./apply";
export { runAiMarket, generateIncomingOffers, generateRumors } from "./clubAI";
export {
  openTransferWindow, closeTransferWindow, buildTargets, refreshWindow,
  setLineup, setListStatus, makeOffer, counterOffer, acceptCounter,
  respondIncoming, renewPlayer, releasePlayer, loanOutPlayer, loanDestinations,
} from "./window";
export { squadView, marketBroadcast, type MarketDashboard } from "./broadcast";
export { marketNews } from "./news";
