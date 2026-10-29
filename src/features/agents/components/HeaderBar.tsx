import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { ArrowLeft, Plug } from "lucide-react";
import { resolveGatewayStatusBadgeClass } from "./colorSemantics";

type HeaderBarProps = {
  status: GatewayStatus;
  onConnectionSettings: () => void;
  showConnectionSettings?: boolean;
};

export const HeaderBar = ({
  status,
  onConnectionSettings,
  showConnectionSettings = true,
}: HeaderBarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="ui-topbar relative z-[180]">
      <div className="flex h-10 items-center justify-between px-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4 md:px-5">
        <div aria-hidden="true" className="hidden sm:block" />
        <Link
          href="/office"
          aria-label="返回3D办公室"
          className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold tracking-[0.01em] text-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">3D 办公室</span>
        </Link>
        <div className="flex items-center justify-end gap-1">
          {status !== "disconnected" ? (
            <span
              className={`ui-chip px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] ${resolveGatewayStatusBadgeClass(status)}`}
              data-testid="gateway-status-indicator"
              data-status={status}
              aria-label={`Gateway ${status}`}
            >
              {status === "connecting" ? "Connecting" : "Connected"}
            </span>
          ) : null}
          <ThemeToggle />
          {process.env.NEXT_PUBLIC_CLAW3D_WEB_ACCESS === "1" ? (
            <button type="button" data-logout className="ui-btn-ghost shrink-0 whitespace-nowrap px-2 text-xs">退出登录</button>
          ) : null}
          {showConnectionSettings ? (
            <div className="relative z-[210]" ref={menuRef}>
              <button
                type="button"
                className="ui-btn-icon ui-btn-icon-xs"
                data-testid="studio-menu-toggle"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <Plug className="h-3.5 w-3.5" />
                <span className="sr-only">Open studio menu</span>
              </button>
              {menuOpen ? (
                <div className="ui-card ui-menu-popover absolute right-0 top-9 z-[260] min-w-44 p-1">
                  <button
                    className="ui-btn-ghost w-full justify-start border-transparent px-3 py-2 text-left text-xs font-medium tracking-normal text-foreground"
                    type="button"
                    onClick={() => {
                      onConnectionSettings();
                      setMenuOpen(false);
                    }}
                    data-testid="gateway-settings-toggle"
                  >
                    Gateway connection
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
