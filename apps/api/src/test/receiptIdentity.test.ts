import { expect, it } from "vitest";
import { receiptIdentity } from "../services/receiptIdentity.js";
it("uses the beneficiary instead of the sender or bank",()=>{
 expect(receiptIdentity("GTBank Transfer Receipt\nSender Name: David Money\nBeneficiary Name: AMINA BELLO\nAmount: NGN 4000")).toMatchObject({transfer:true,recipient:"AMINA BELLO",ambiguous:false});
});
it("reads receiving account names under recipient details",()=>{
 expect(receiptIdentity("Transfer successful\nSender Details\nAccount Name: DAVID MONEY\nRecipient Details\nAccount Name: SUYA SPOT LTD\nBank: Example Bank").recipient).toBe("SUYA SPOT LTD");
});
it("supports labels on a separate OCR line",()=>{
 expect(receiptIdentity("Transfer\nReceiver Name\nAMINA BELLO\nAccount Number: 1234567890").recipient).toBe("AMINA BELLO");
});
it("does not mistake sender-only account names or account numbers for the recipient",()=>{
 expect(receiptIdentity("Transfer\nSender Name: David\nAccount Name: David\nBeneficiary:\nAccount Number: 1234567890").recipient).toBeNull();
});
it("detects multiple recipients instead of silently choosing one",()=>{
 expect(receiptIdentity("Beneficiary Name: Amina Bello\nRecipient Name: Musa Bello").ambiguous).toBe(true);
});
it("does not infer transfers from shop customer names",()=>{
 expect(receiptIdentity("SUYA SPOT\nCustomer: David\nTOTAL NGN 4000")).toMatchObject({transfer:false,recipient:null});
});
