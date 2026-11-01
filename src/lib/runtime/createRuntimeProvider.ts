import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { DemoRuntimeProvider } from "@/lib/runtime/demo/provider";
import { OpenClawRuntimeProvider } from "@/lib/runtime/openclaw/provider";
import type { RuntimeProvider } from "@/lib/runtime/types";

export const createRuntimeProvider = (
  providerId: RuntimeProvider["id"],
  client: GatewayClient
): RuntimeProvider => providerId === "demo"
  ? new DemoRuntimeProvider(client)
  : new OpenClawRuntimeProvider(client);
