"use client";
import { useEffect, useState } from "react";
import { ChevronRight, Ticket } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import { expiringResetCredits, type AiCenterSnapshot } from "./ai-center";

export function ResetCouponNotice({ client, onOpen }: { client?: Pick<GatewayClient, "call">; onOpen: () => void }) {
  const t = useUiText();
  const [sample, setSample] = useState<{ client: typeof client; snapshot: AiCenterSnapshot; now: number } | null>(null);
  useEffect(() => {
    if (!client) return;
    let stopped = false, pending = false;
    const load = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const snapshot = await client.call<AiCenterSnapshot>("office.usage", {});
        if (!Array.isArray(snapshot?.providers)) throw new Error("Usage unavailable");
        if (!stopped) setSample({ client, snapshot, now: Date.now() });
      } catch { if (!stopped) setSample(null); }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    document.addEventListener("visibilitychange", load);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [client]);
  const coupons = sample?.client === client && sample ? expiringResetCredits(sample.snapshot, sample.now) : [];
  if (!coupons.length) return null;
  const expiry = new Date(coupons[0].expiresAt! * 1000);
  return <aside className="reset-coupon-notice" aria-label={t("Reset coupon expiry reminder")}>
    <button type="button" onClick={onOpen} aria-label={t("View expiring reset coupons")}>
      <span className="reset-coupon-heading"><Ticket size={14} /><span role="status">{t("Reset coupons expiring soon")}</span><ChevronRight size={13} /></span>
      <span className="reset-coupon-count">{t("{count} expiring within 3 days", { count: coupons.length })}</span>
      <time dateTime={expiry.toISOString()} title={expiry.toLocaleString()}>{t("Next expiry: {time}", { time: expiry.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</time>
    </button>
  </aside>;
}
