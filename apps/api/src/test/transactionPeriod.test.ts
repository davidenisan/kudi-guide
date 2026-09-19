import { expect, it } from "vitest";
import { transactionPeriodStart } from "../services/transactionPeriod.js";
it("uses Lagos midnight across UTC month and year boundaries",()=>{
 const now=new Date("2026-12-31T23:30:00Z");
 expect(transactionPeriodStart(now,"today")?.toISOString()).toBe("2026-12-31T23:00:00.000Z");
 expect(transactionPeriodStart(now,"month")?.toISOString()).toBe("2026-12-31T23:00:00.000Z");
 expect(transactionPeriodStart(now,"year")?.toISOString()).toBe("2026-12-31T23:00:00.000Z");
 expect(transactionPeriodStart(now,"week")?.toISOString()).toBe("2026-12-25T23:00:00.000Z");
 expect(transactionPeriodStart(now,"all")).toBeNull();
});
