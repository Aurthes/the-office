import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ServerRackInfo } from "@/features/ring-ship/ServerRackInfo";
import type { ServerRow } from "@/lib/monitoring/types";
afterEach(cleanup);
const row: ServerRow = { alias: "YSTKO01", group: "online", active: true, status: "ready", sampledAt: 1000, checkedAt: 1000, error: null,
 metrics: { cores: 4, cpuPercent: 25, load1: 1, memoryTotal: 8*1024**3, memoryUsed: 4*1024**3, disks: [{mount:"/",total:1000,used:900,percent:90}],rxBytesPerSecond:0,txBytesPerSecond:0,uptimeSeconds:7200 } };
it("shows the actual host family, resource pressure and an exact-host terminal action",()=>{
 const terminal=vi.fn();render(createElement(ServerRackInfo,{row,onTerminal:terminal}));
 expect(screen.getByText("YSTKO series")).toBeInTheDocument();expect(screen.getByText("25.0%")).toBeInTheDocument();expect(screen.getByText("50.0%")).toBeInTheDocument();expect(screen.getByText("90.0%")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Terminal"}));expect(terminal).toHaveBeenCalledWith("YSTKO01");
});
it("keeps missing readings unknown and cannot open a terminal for a disabled host",()=>{
 render(createElement(ServerRackInfo,{row:{...row,active:false,status:"disabled",metrics:null,sampledAt:null},onTerminal:vi.fn()}));
 expect(screen.getByRole("button",{name:"Terminal"})).toBeDisabled();expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
});
