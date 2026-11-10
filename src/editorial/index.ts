/**
 * EDITORIAL WORKFLOW — API pública (Tournament Automation · Fase 4/5).
 *
 * Sistema editorial ENTRE el Card Generator y el Publisher: una generación se somete a
 * revisión (`submitGeneration`), se decide carta a carta o por lote (`decide`/`approve*`),
 * todo queda trazado (historial completo) y `publishApproved` publica SOLO lo aprobado
 * componiendo los motores existentes — jamás regenera cartas ni toca los motores.
 *
 * NOTA: el store (`useEditorialStore`) es client-only; se importa desde "./store" en la UI
 * para no arrastrar zustand/localStorage a los scripts de verificación.
 */
export * from "./types";
export { TRANSITIONS, canApply, nextState, availableActions } from "./workflow";
export { submitGeneration, cardsInState, stateCounts, searchCards, type SubmitOptions } from "./review";
export {
  decide, approve, reject, hide, block, backToReview, archive, approveBatch, approveTournament,
  approveCard, rejectCard, hideCard, blockCard, returnToReview, archiveCard, approveGeneration,
} from "./approvals";
export { makeEvent, nextSeq, historyForCard, historyByActor, lastEventForCard, auditHistory } from "./history";
export { publishApproved, EDITORIAL_SCHEMA_VERSION, type PublishApprovedCtx } from "./engine";
