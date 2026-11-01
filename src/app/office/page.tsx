import { Suspense } from "react";
import { OfficeConnectionScreen } from "@/features/office/components/OfficeConnectionScreen";
import { AgentStoreProvider } from "@/features/agents/state/store";
import { OfficeScreen } from "@/features/office/screens/OfficeScreen";

const ENABLED_RE = /^(1|true|yes|on)$/i;

const readDebugFlag = (value: string | undefined): boolean => {
  const normalized = (value ?? "").trim();
  if (!normalized) return true;
  return ENABLED_RE.test(normalized);
};

export default function OfficePage() {
  const showOpenClawConsole = readDebugFlag(process.env.DEBUG);

  return (
    <AgentStoreProvider>
      <Suspense fallback={<OfficeConnectionScreen />}>
        <OfficeScreen showOpenClawConsole={showOpenClawConsole} />
      </Suspense>
    </AgentStoreProvider>
  );
}
