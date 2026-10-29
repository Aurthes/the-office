import { Suspense } from "react";
import AgentsPageScreen from "@/features/agents/screens/AgentsPageScreen";
import { AgentStoreProvider } from "@/features/agents/state/store";

export default function AgentsPage() {
  return (
    <AgentStoreProvider>
      <Suspense fallback={<p role="status">Loading chat...</p>}>
        <AgentsPageScreen />
      </Suspense>
    </AgentStoreProvider>
  );
}
