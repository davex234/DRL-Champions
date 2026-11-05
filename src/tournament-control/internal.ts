/**
 * INTERNAL — puerta ÚNICA de escritura del ControlLedger (inmutable): inserta/sustituye un
 * registro y anexa eventos con secuencia monótona. Compartida por engine.ts y publish.ts;
 * no forma parte de la API pública del panel.
 */
import type {
  ControlActionMeta, ControlEvent, ControlEventKind, ControlLedger, GenerationRecord,
} from "./types";

export const nextControlSeq = (l: ControlLedger): number =>
  l.events.length ? l.events[l.events.length - 1].seq + 1 : 1;

/** Construye eventos consecutivos (seq monótona) a partir del ledger actual. */
export function makeEvents(
  l: ControlLedger, recordId: string, generationId: string, meta: ControlActionMeta,
  specs: { kind: ControlEventKind; detail?: string }[],
): ControlEvent[] {
  const base = nextControlSeq(l);
  return specs.map((s, i) => ({
    seq: base + i, at: meta.at, actor: meta.actor, kind: s.kind, recordId, generationId, detail: s.detail,
  }));
}

/** Inserta/sustituye un registro y anexa eventos. */
export function withRecord(l: ControlLedger, rec: GenerationRecord, events: ControlEvent[]): ControlLedger {
  return {
    ...l,
    records: { ...l.records, [rec.recordId]: rec },
    order: l.order.includes(rec.recordId) ? l.order : [...l.order, rec.recordId],
    events: [...l.events, ...events],
  };
}

/** Atajo: registro actualizado + UN evento. */
export function appendToLedger(
  l: ControlLedger, rec: GenerationRecord, kind: ControlEventKind, meta: ControlActionMeta, detail?: string,
): ControlLedger {
  return withRecord(l, rec, makeEvents(l, rec.recordId, rec.generationId, meta, [{ kind, detail }]));
}
