"use client";

/**
 * F58 · FORMULARIO DE EVENTO (asistente de /admin/events/new y edición de borradores).
 *
 * Fechas: el admin escribe en SU zona horaria (datetime-local) y se envían en UTC ISO; se muestran las dos para que no
 * haya dudas. La validación de verdad es la del servidor (`parseEventDraft`); aquí solo se guía.
 */
import { useId } from "react";
import { EVENT_TYPES, EVENT_TYPE_LABEL, EVENT_REGIONS } from "@/domain/admin/events";
import { Field, Input, Select, Textarea } from "./ui";

export interface EventFormState { name: string; description: string; imageUrl: string; type: string; region: string; startsAt: string; endsAt: string }
export const EMPTY_EVENT: EventFormState = { name: "", description: "", imageUrl: "", type: "masters", region: "", startsAt: "", endsAt: "" };

/** `datetime-local` (hora local) ⇄ ISO UTC. */
export const localToIso = (v: string): string => (v ? new Date(v).toISOString() : "");
export const isoToLocal = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const tzName = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "local"; } };

export function toPayload(s: EventFormState) {
  return { name: s.name, description: s.description || null, imageUrl: s.imageUrl || null, type: s.type, region: s.region || null, startsAt: localToIso(s.startsAt), endsAt: localToIso(s.endsAt) };
}

export function EventInfoFields({ s, set }: { s: EventFormState; set: (p: Partial<EventFormState>) => void }) {
  const id = useId();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nombre" htmlFor={`${id}n`} hint="3–80 caracteres"><Input id={`${id}n`} value={s.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Tipo" htmlFor={`${id}t`} hint="Decide los desafíos (y sus recompensas) que el juego le asignará"><Select id={`${id}t`} value={s.type} onChange={(e) => set({ type: e.target.value })}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}</Select></Field>
      <Field label="Región" htmlFor={`${id}r`}><Select id={`${id}r`} value={s.region} onChange={(e) => set({ region: e.target.value })}><option value="">Global</option>{EVENT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
      <Field label="Imagen (opcional)" htmlFor={`${id}i`} hint="Ruta del proyecto (/…) o URL https. Metadato del panel."><Input id={`${id}i`} value={s.imageUrl} maxLength={300} onChange={(e) => set({ imageUrl: e.target.value.trim() })} placeholder="/branding/…" /></Field>
      <div className="md:col-span-2"><Field label="Descripción (opcional)" htmlFor={`${id}d`} hint="Hasta 600 caracteres. Metadato del panel: el juego muestra nombre, tipo, región y fechas."><Textarea id={`${id}d`} value={s.description} maxLength={600} onChange={(e) => set({ description: e.target.value })} /></Field></div>
    </div>
  );
}

export function EventDateFields({ s, set }: { s: EventFormState; set: (p: Partial<EventFormState>) => void }) {
  const id = useId();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={`Inicio (${tzName()})`} htmlFor={`${id}s`} hint={s.startsAt ? `UTC: ${localToIso(s.startsAt).replace("T", " ").slice(0, 16)}` : undefined}><Input id={`${id}s`} type="datetime-local" value={s.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
      <Field label={`Fin (${tzName()})`} htmlFor={`${id}e`} hint={s.endsAt ? `UTC: ${localToIso(s.endsAt).replace("T", " ").slice(0, 16)}` : "Entre 1 hora y 120 días después del inicio"}><Input id={`${id}e`} type="datetime-local" value={s.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
    </div>
  );
}
