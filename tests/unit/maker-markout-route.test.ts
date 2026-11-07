import {expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/maker-markout/source",()=>({getMakerMarkout:mocks.read}));
import {GET} from "@/app/api/monitoring/maker-markout/route";
it("serves bounded aggregate facts with no-store",async()=>{
 mocks.read.mockResolvedValueOnce({configured:false,points:[]});const r=await GET(new Request("http://localhost/api/monitoring/maker-markout?horizon=60m&hours=24&level=symbol&type=rpi&symbol=bybit.perp.btc_usdt"));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({horizon:"60m",hours:24,level:"symbol",type:"rpi",symbol:"bybit.perp.btc_usdt"}));
});
it("rejects unbounded or unknown filters before reading",async()=>{
 for(const q of ["hours=48","horizon=2h","type=ioc","level=account","symbol="+"a".repeat(513)]){expect((await GET(new Request("http://localhost/api/monitoring/maker-markout?"+q))).status).toBe(400);}
});
it("does not expose private source errors",async()=>{
 mocks.read.mockRejectedValueOnce(Error("private password"));const r=await GET(new Request("http://localhost/api/monitoring/maker-markout"));expect(r.status).toBe(503);expect(await r.text()).not.toContain("password");
});
