import { HydrationGate } from "@/components/layout/HydrationGate";
import { PackOpeningExperience } from "@/components/packs/PackOpeningExperience";

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
