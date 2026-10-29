import { Suspense } from "react";
import { redirect } from "next/navigation";
import AgentsPageScreen from "@/features/agents/screens/AgentsPageScreen";
import { AgentStoreProvider } from "@/features/agents/state/store";

export default function AgentsPage() {
  if (process.env.NEXT_PUBLIC_CLAW3D_SESSION_VIEW === "1") redirect("/office");
  return (
    <AgentStoreProvider>
      <Suspense fallback={<p role="status">Loading chat...</p>}>
        <AgentsPageScreen />
      </Suspense>
    </AgentStoreProvider>
  );
}
