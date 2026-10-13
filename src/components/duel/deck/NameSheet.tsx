"use client";

/**
 * RENOMBRAR EQUIPO (Fase 32). Texto plano corto, validado aquí con la MISMA función que usa el
 * servidor (`checkDeckName`) y vuelto a validar allí. Sin descripción libre.
 */
import { useEffect, useId, useState } from "react";
import { checkDeckName, DECK_NAME_MAX } from "@/domain/deckBuilder/builder";
import { NxButton } from "@/components/ui/NxButton";
import { Sheet } from "./bits";

export function NameSheet({
  open, title, initial, busy, error, onSubmit, onClose,
}: {
  open: boolean;
  title: string;
  initial: string;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState(initial);
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);
  const check = checkDeckName(value);
  const submit = () => { if (check.ok && !busy) onSubmit(check.name); };

  return (
    <Sheet
      open={open}
      scene="name-sheet"
      eyebrow="Nombre del equipo"
      title={title}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <NxButton variant="primary" size="md" onClick={submit} disabled={!check.ok || busy} aria-busy={busy}>{busy ? "Guardando…" : "Guardar nombre"}</NxButton>
          <NxButton variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancelar</NxButton>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor={inputId} className="nx-label">Nombre</label>
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={DECK_NAME_MAX}
          autoComplete="off"
          aria-invalid={!check.ok}
          aria-describedby={hintId}
          className="nx-focus mt-1 min-h-[48px] w-full rounded-control border border-white/15 bg-white/[0.05] px-3 font-display text-lg uppercase text-white outline-none focus:border-drl/60"
        />
        <p id={hintId} className={check.ok ? "mt-1 text-[12px] text-ink-faint" : "mt-1 text-[12px] text-bad"}>
          {check.ok ? `${[...value.trim()].length}/${DECK_NAME_MAX} · letras, números, espacios y . _ ' # & -` : check.reason}
        </p>
        {error && <p role="alert" className="mt-2 rounded-lg border border-bad/40 bg-bad/[0.08] px-3 py-2 text-[13px] text-white">{error}</p>}
      </form>
    </Sheet>
  );
}
