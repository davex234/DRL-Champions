"use client";

/**
 * `/duelos/mazos` — MIS MAZOS Y CONSTRUCTOR (Fase 8).
 *
 * Lista los mazos guardados con su estado REAL —la validación la hace el servidor contra el
 * inventario, no esta pantalla— y abre el constructor para crear o editar.
 *
 * Las cartas disponibles son las del inventario del usuario (`user_cards`), nunca una lista local.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { DeckBuilder } from "@/components/duel/DeckBuilder";
import { DuelCard } from "@/components/duel/DuelCard";
import { fetchMyPacks } from "@/lib/game/client";
import { fetchDuelDecks, saveDuelDeck, deleteDuelDeck } from "@/lib/duel/client";
import { DUEL_ROLES } from "@/domain/cardgame";
import type { DuelDeckCardDTO, DuelDeckDTO } from "@/lib/duel/types";

export default function MazosPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Cargando mazos…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="crear mazos de duelo" />;
  return (
    <Suspense fallback={<Loading label="Cargando mazos…" />}>
      <Decks />
    </Suspense>
  );
}

function Decks() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast, notify } = useToast();

  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [collection, setCollection] = useState<DuelDeckCardDTO[]>([]);

  /*
   * Sobres sin abrir. El constructor solo lo usa para una frase, pero es la frase que le
   * dice a un jugador nuevo DONDE estan sus cartas (Fase 15): dentro de los sobres de
   * bienvenida, no en la tienda.
   *
   * Se piden al SERVIDOR, no al almacen local. Hay un invariante que lo exige
   * (`duel.test.ts`): en Duelos la propiedad la manda `user_cards`, y un contador local
   * podria ensenar sobres que el servidor ya no reconoce. Falla en silencio: si no llega,
   * la frase cae al texto generico en vez de dejar la pantalla a medias.
   */
  const [unopenedPacks, setUnopenedPacks] = useState(0);
  useEffect(() => {
    // `MazosPage` ya ha comprobado que hay sesion antes de montar esto.
    let alive = true;
    fetchMyPacks()
      .then((p) => { if (alive) setUnopenedPacks(Object.values(p).reduce((n, q) => n + q, 0)); })
      .catch(() => { if (alive) setUnopenedPacks(0); });
    return () => { alive = false; };
  }, []);
  const [error, setError] = useState<string | null>(null);

  /** Mazo en edición. `null` = la lista. */
  const [editing, setEditing] = useState<DuelDeckDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await fetchDuelDecks();
      setDecks(d.decks);
      setCollection(d.collection);
      return d.decks;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudieron cargar tus mazos";
      setError(msg);
      // Si ya había mazos cargados se CONSERVAN: vaciar la lista aquí enseñaría «no tienes
      // ningún mazo» cuando lo que ha fallado es la petición. Solo la primera carga deja vacío.
      setDecks((cur) => cur ?? []);
      return null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Abrir directamente un mazo si viene por la URL (`?deck=<id>`). Solo la primera vez.
  const deckParam = params.get("deck");
  const deckParamRef = useRef(deckParam);
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (applied || !deckParam || !decks) return;
    const d = decks.find((x) => x.id === deckParam);
    setApplied(true);
    if (d) openEdit(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckParam, decks, applied]);

  function openEdit(d: DuelDeckDTO) {
    setEditing(d);
    setCreating(false);
    setName(d.name);
    setSelected(d.cardUids);
    setFormError(null);
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setName(`Mazo ${(decks?.length ?? 0) + 1}`);
    setSelected([]);
    setFormError(null);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setFormError(null);
    // Solo se navega si hay algo que limpiar en la URL. Un `replace` a la ruta actual remonta la
    // pantalla y tira el estado que se acaba de cargar.
    if (deckParamRef.current) router.replace("/duelos/mazos");
  }

  function toggle(uid: string) {
    setSelected((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]));
  }

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      const res = await saveDuelDeck({ id: editing?.id, name, cardUids: selected });
      notify(res.deck.valid ? "Mazo guardado y listo para duelo" : "Mazo guardado (incompleto)", res.deck.valid);
      closeForm();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo guardar el mazo");
    } finally {
      setSaving(false);
    }
  }

  async function remove(d: DuelDeckDTO) {
    try {
      await deleteDuelDeck(d.id);
      await load();
      notify("Mazo eliminado");
      if (editing?.id === d.id) closeForm();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo eliminar", false);
    }
  }

  if (error && decks === null) return <ErrorState message={error} onRetry={load} />;
  if (decks === null) return <Loading label="Cargando mazos…" />;

  const inForm = creating || editing !== null;

  return (
    <div className="mx-auto max-w-6xl">
      <Toast toast={toast} />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/duelos" className="-ml-2 inline-flex min-h-[36px] items-center rounded-control px-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 transition duration-fast hover:bg-white/[0.06] hover:text-white">
            ‹ Duelos
          </Link>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            {inForm ? (creating ? "Nuevo mazo" : "Editar mazo") : "Mis mazos"}
          </h1>
          <p className="text-xs text-white/45">
            10 cartas · 2 de cada rol · sin repetir jugador
          </p>
        </div>
        {!inForm && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-drl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition hover:brightness-110"
          >
            + Nuevo mazo
          </button>
        )}
      </header>

      {inForm ? (
        <DeckBuilder
          collection={collection}
          unopenedPacks={unopenedPacks}
          deck={editing}
          name={name}
          selected={selected}
          onNameChange={setName}
          onToggle={toggle}
          onClear={() => setSelected([])}
          onSave={save}
          onCancel={closeForm}
          saving={saving}
          error={formError}
        />
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 px-6 py-14 text-center">
          <p className="font-display text-xl text-white/70">Todavía no tienes ningún mazo</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-white/40">
            Un mazo de duelo son diez cartas: dos Duelistas, dos Controladores, dos Iniciadores,
            dos Centinelas y dos Flex.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 rounded-xl bg-drl px-6 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition hover:brightness-110"
          >
            Crear mi primer mazo
          </button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {decks.map((d) => (
            <article key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <b className="block truncate font-display text-xl">{d.name}</b>
                  <span className="text-[11px] text-white/40">
                    {d.cards.length}/10 cartas · Σ OVR {d.sumOvr}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${
                    d.valid ? "bg-emerald-400/15 text-emerald-300" : "bg-drl/15 text-drl-glow"
                  }`}
                >
                  {d.valid ? "Listo para duelo" : d.status === "INCOMPLETE" ? "Incompleto" : "Revisar"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.cards.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
                {Array.from({ length: Math.max(0, 10 - d.cards.length) }, (_, i) => (
                  <div key={`s${i}`} className="grid aspect-[5/7] w-[54px] place-items-center rounded-md border border-dashed border-white/15 text-white/20">+</div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {DUEL_ROLES.map((r) => (
                  <span key={r} className={d.roleCounts[r] === 2 ? "text-white/45" : "text-drl-glow"}>
                    {r} {d.roleCounts[r]}/2
                  </span>
                ))}
              </div>

              {d.errors.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {d.errors.slice(0, 3).map((e, i) => (
                    <li key={i} className="text-[11px] text-drl-glow">✕ {e.message}</li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(d)}
                  className="flex-1 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.07]"
                >
                  Editar
                </button>
                {d.valid && (
                  <Link
                    href={`/duelos/jugar?deck=${d.id}`}
                    className="flex-1 rounded-lg bg-drl px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide transition hover:brightness-110"
                  >
                    Jugar
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => remove(d)}
                  aria-label={`Eliminar ${d.name}`}
                  className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-white/40 transition hover:border-drl/50 hover:text-drl-glow"
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
