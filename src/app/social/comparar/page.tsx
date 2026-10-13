"use client";

/**
 * `/social/comparar?id=<jugador>` — F85 · comparación ligera lado a lado (solo datos públicos). Atada a la cuenta: al
 * cambiar de cuenta no se pinta la comparación de la anterior.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchSocialCompare, type SocialCompare } from "@/lib/social/client";
import { CompareView } from "@/components/social/CompareView";
import { Loading, ErrorState, NeedsAccount, EmptyState } from "@/components/ui/States";

function Compare() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const uid = user?.id ?? null;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  const [owned, setOwned] = useState<{ owner: string; id: string; data: SocialCompare } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const owner = uid;
    if (!online || !owner || !id) return;
    setError(null);
    fetchSocialCompare(id)
      // FULL GAME AUDIT · una respuesta vacía ya no deja «Comparando…» para siempre.
      .then((d) => { if (uidRef.current !== owner) return; if (d) setOwned({ owner, id, data: d }); else setError("Jugador no encontrado"); })
      .catch((e) => { if (uidRef.current === owner) setError(e instanceof Error ? e.message : "No se pudo comparar"); });
  }, [online, uid, id]);

  if (loading) return <Loading label="Comparando…" />;
  if (!online || !user) return <NeedsAccount what="comparar perfiles" />;
  // FULL GAME AUDIT · sin `?id=` no hay nada que comparar (antes: «Comparando…» infinito).
  if (!id) return <EmptyState icon="👥" title="Elige un jugador para comparar" hint="Abre el perfil de un amigo o búscalo en Social." action={{ href: "/social", label: "Ir a Social" }} />;
  if (error) return <ErrorState message={error} />;
  const data = owned && owned.owner === uid && owned.id === id ? owned.data : null;
  if (!data) return <Loading label="Comparando…" />;
  return <CompareView data={data} />;
}

export default function ComparePage() {
  return <Suspense fallback={<Loading label="Comparando…" />}><Compare /></Suspense>;
}
