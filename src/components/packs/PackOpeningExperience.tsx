"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { getPack } from "@/data/packs";
import { useGameStore, type OpenedResult } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";
import { getVariant } from "@/domain/cards/variants";
import { SealedPack } from "./SealedPack";
import { AmbientParticles, ParticleBurst } from "./Particles";
import { CardReveal } from "./CardReveal";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { primeAudio, playCutTick, playBurst } from "@/lib/sound";
import { formatCredits } from "@/lib/format";

type Phase = "sealed" | "burst" | "reveal" | "summary";

const CUT_DISTANCE = 220; // px de deslizamiento para abrir

export function PackOpeningExperience({ packId }: { packId: string }) {
  const router = useRouter();
  const pack = getPack(packId);
  const available = useGameStore((s) => s.unopenedPacks[packId] ?? 0);
  const openFromInventory = useGameStore((s) => s.openPackFromInventory);
  const quickSellMany = useGameStore((s) => s.quickSellMany);

  const [phase, setPhase] = useState<Phase>("sealed");
  const [cutProgress, setCutProgress] = useState(0);
  const [results, setResults] = useState<OpenedResult[]>([]);
  const [revealIndex, setRevealIndex] = useState(0);

  const cutting = useRef(false);
  const startX = useRef(0);
  const lastTick = useRef(0);
  const opened = useRef(false);

  const accent = pack?.accent ?? "#ff2e63";

  const triggerOpen = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    const res = openFromInventory(packId);
    if (!res || res.length === 0) {
      router.push("/tienda");
      return;
    }
    setResults(res);
    useEventsStore.getState().recordPackOpened(packId, res);
    playBurst();
    setPhase("burst");
    setTimeout(() => {
      setPhase("reveal");
      setRevealIndex(0);
    }, 900);
  }, [openFromInventory, packId, router]);

  // --- Interacción de corte (ratón / táctil) ---
  function onPointerDown(e: React.PointerEvent) {
    if (phase !== "sealed") return;
    primeAudio();
    cutting.current = true;
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!cutting.current || phase !== "sealed") return;
    const delta = e.clientX - startX.current;
    const progress = Math.max(0, Math.min(1, delta / CUT_DISTANCE));
    setCutProgress(progress);
    if (progress - lastTick.current > 0.08) {
      lastTick.current = progress;
      playCutTick();
    }
    if (progress >= 0.92) {
      cutting.current = false;
      setCutProgress(1);
      triggerOpen();
    }
  }
  function onPointerUp() {
    if (phase !== "sealed") return;
    cutting.current = false;
    if (cutProgress < 0.92) {
      setCutProgress(0);
      lastTick.current = 0;
    }
  }

  const handleNext = useCallback(() => {
    setRevealIndex((i) => {
      if (i + 1 >= results.length) {
        setPhase("summary");
        return i;
      }
      return i + 1;
    });
  }, [results.length]);

  // --- Estados límite ---
  if (!pack) {
    return (
      <Centered>
        <p className="text-white/70">Sobre no encontrado.</p>
        <BackButton onClick={() => router.push("/tienda")} />
      </Centered>
    );
  }
  if (available <= 0 && phase === "sealed") {
    return (
      <Centered>
        <p className="font-display text-xl text-white">No tienes este sobre</p>
        <p className="text-sm text-white/50">Compra uno en la tienda para abrirlo.</p>
        <BackButton onClick={() => router.push("/tienda")} label="Ir a la tienda" />
      </Centered>
    );
  }

  const totalValue = results.reduce((s, r) => s + r.value, 0);
  const newCount = results.filter((r) => r.isNew).length;
  const duplicates = results.filter((r) => !r.isNew);

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-base-900">
      {/* Fondo dinámico */}
      <div
        className="absolute inset-0 opacity-70 transition-opacity"
        style={{
          background: `radial-gradient(900px 600px at 50% 40%, ${accent}22, transparent 70%)`,
        }}
      />
      <AmbientParticles color={accent} />

      {/* Botón cerrar */}
      <button
        onClick={() => router.push(phase === "summary" ? "/coleccion" : "/tienda")}
        className="absolute right-4 top-4 z-50 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/70 backdrop-blur transition hover:bg-black/70 hover:text-white"
        aria-label="Cerrar"
      >
        ✕
      </button>

      {/* FASE 1 + 2: sobre sellado y corte */}
      <AnimatePresence>
        {phase === "sealed" && (
          <motion.div
            key="sealed"
            className="absolute inset-0 grid touch-none place-items-center"
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.4 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <motion.div
              animate={{ y: [0, -14, 0], rotateZ: [-1.5, 1.5, -1.5] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <SealedPack accent={accent} name={pack.name} cutProgress={cutProgress} />
            </motion.div>

            <motion.div
              className="absolute bottom-16 flex flex-col items-center gap-2 px-6 text-center"
              animate={{ opacity: cutProgress > 0.05 ? 0 : 1 }}
            >
              <p className="font-display text-lg uppercase tracking-[0.25em] text-white">
                Desliza para abrir
              </p>
              <p className="text-sm text-white/50">Arrastra el ratón o el dedo sobre el sobre →</p>
              <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${cutProgress * 100}%`, background: accent }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FASE 3: explosión */}
      {phase === "burst" && (
        <div className="absolute inset-0 grid place-items-center">
          <ParticleBurst color={accent} big count={110} />
          <motion.div
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.7, times: [0, 0.25, 1] }}
          />
        </div>
      )}

      {/* FASE 4: revelado carta a carta */}
      {phase === "reveal" && results[revealIndex] && (
        <CardReveal
          key={results[revealIndex].uid}
          result={results[revealIndex]}
          index={revealIndex}
          total={results.length}
          onNext={handleNext}
        />
      )}

      {/* FASE 5: resumen */}
      {phase === "summary" && (
        <motion.div
          className="absolute inset-0 overflow-y-auto px-4 py-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center font-display text-3xl font-bold uppercase tracking-wide text-white">
              ¡Sobre abierto!
            </h2>
            <p className="mt-1 text-center text-white/50">{pack.name}</p>

            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Stat label="Cartas" value={String(results.length)} />
              <Stat label="Nuevas" value={String(newCount)} accent="#37e6a0" />
              <Stat label="Valor total" value={`🪙 ${formatCredits(totalValue)}`} accent="#ffd35c" />
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-4">
              {results
                .slice()
                .sort((a, b) => getVariant(b.card.variantId).rank - getVariant(a.card.variantId).rank)
                .map((r) => (
                  <motion.div
                    key={r.uid}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative"
                  >
                    {r.isNew && (
                      <span className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-drl px-2 py-0.5 font-display text-[10px] font-bold uppercase text-white shadow-glow">
                        Nueva
                      </span>
                    )}
                    <PlayerCard card={r.card} size="sm" serial={r.serial} />
                  </motion.div>
                ))}
            </div>

            <div className="mt-10 flex flex-wrap justify-center gap-3">
              {duplicates.length > 0 && (
                <button
                  onClick={() => {
                    quickSellMany(duplicates.map((d) => d.uid));
                    router.push("/coleccion");
                  }}
                  className="rounded-xl border border-drl-gold/40 bg-drl-gold/10 px-5 py-3 font-display text-sm uppercase tracking-wide text-drl-gold transition hover:bg-drl-gold/20"
                >
                  Vender {duplicates.length} duplicado(s) · 🪙{" "}
                  {formatCredits(duplicates.reduce((s, d) => s + Math.round(d.value * 0.8), 0))}
                </button>
              )}
              <button
                onClick={() => router.push("/coleccion")}
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-display text-sm uppercase tracking-wide text-white transition hover:bg-white/10"
              >
                Ver colección
              </button>
              <button
                onClick={() => router.push("/tienda")}
                className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-3 font-display text-sm uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
              >
                Abrir otro
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = "#ffffff" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-700/60 px-5 py-3 text-center">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="font-display text-xl font-bold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-base-900">
      <div className="flex flex-col items-center gap-3 text-center">{children}</div>
    </div>
  );
}

function BackButton({ onClick, label = "Volver" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm uppercase tracking-wide text-white shadow-glow"
    >
      {label}
    </button>
  );
}
