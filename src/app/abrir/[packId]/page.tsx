import { HydrationGate } from "@/components/layout/HydrationGate";
import { PackOpeningExperience } from "@/components/packs/PackOpeningExperience";
import { PACKS } from "@/data/packs";

/** Export estático (desktop): pre-genera la apertura de cada sobre del catálogo. */
export function generateStaticParams() {
  return PACKS.map((p) => ({ packId: p.id }));
}

export default async function AbrirPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  return (
    <HydrationGate>
      <PackOpeningExperience packId={packId} />
    </HydrationGate>
  );
}
