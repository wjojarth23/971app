import MaterialThickness from "./MaterialThickness";
import { MaterialEventsProvider } from "./materialEvents";

export default async function PC({
  params,
}: {
  params: Promise<{ id: string; teamid: string }>;
}) {
  const { id, teamid } = await params;
  return (
    <MaterialEventsProvider>
      <MaterialThickness pcid={id} teamid={teamid} />
    </MaterialEventsProvider>
  );
}
