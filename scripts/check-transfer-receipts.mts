import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { prisma } from "../apps/api/src/db/prisma.js";
import { handleAssistantMessage } from "../apps/api/src/services/telegramAssistant.js";
import { readReceipt } from "../apps/api/src/services/receiptReader.js";
import { env } from "../apps/api/src/config/env.js";
const sharp = createRequire(import.meta.url)("../apps/api/node_modules/sharp");
const lines = ["EXAMPLE BANK", "TRANSFER RECEIPT", "Status: Successful", "Sender Name: DAVID MONEY", "Beneficiary Name: AMINA BELLO", "Beneficiary Bank: SAMPLE BANK", "Amount: NGN 4,000.00", "Fee: NGN 10.00", "Date: 19 September 2026", "Reference: QA-TRANSFER-123"];
function pdf(objects: Buffer[]) {
 const chunks=[Buffer.from("%PDF-1.4\n")]; const offsets=[0];let length=chunks[0].length;
 objects.forEach((body,i)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),body,Buffer.from("\nendobj\n")]);chunks.push(chunk);length+=chunk.length;});
 chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(chunks);
}
function stream(data:Buffer,extra=""){return Buffer.concat([Buffer.from(`<< /Length ${data.length} ${extra} >>\nstream\n`),data,Buffer.from("\nendstream")]);}
const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000"><rect width="100%" height="100%" fill="white"/>${lines.map((line,i)=>`<text x="80" y="${90+i*80}" font-family="sans-serif" font-size="35" fill="black">${line}</text>`).join("")}</svg>`)).png().toBuffer();
const jpg=await sharp(png).jpeg({quality:95}).toBuffer();
const root=Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");const pages=Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
const textPdf=pdf([root,pages,Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),stream(Buffer.from(`BT /F1 15 Tf 40 740 Td 30 TL ${lines.map((s,i)=>`${i?'T* ':''}(${s}) Tj`).join(" ")} ET`))]);
const scanPdf=pdf([root,pages,Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 500] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>"),stream(jpg,"/Type /XObject /Subtype /Image /Width 1400 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"),stream(Buffer.from("q 700 0 0 500 0 0 cm /Im Do Q"))]);
const user=await prisma.user.create({data:{authProvider:"oauth"}});const originalFetch=globalThis.fetch;
try {
 for (const [i,[name,bytes]] of [["image",png],["text PDF",textPdf],["scanned PDF",scanPdf]].entries()) {
  const receipt=await readReceipt(bytes);assert.match(receipt.text,/AMINA BELLO/);
  globalThis.fetch=async (url,options)=>{
   if(String(url)===`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`) return new Response(JSON.stringify({ok:true,result:{file_path:"qa/receipt",file_size:bytes.length}}));
   if(String(url)===`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/qa/receipt`) return new Response(bytes);
   return originalFetch(url,options);
  };
  const reply=await handleAssistantMessage({userId:user.id,chatId:`qa-${user.id}`,messageId:i+1,text:"",receivedAt:new Date(),file:{file_id:`qa-${i}`,file_unique_id:`qa-${i}`}});
  const rows=await prisma.transaction.findMany({where:{userId:user.id},include:{category:true}});
  assert.equal(rows.length,i+1,reply);
  assert.ok(rows.every(r=>r.merchant==="AMINA BELLO" && r.amount.toNumber()===4000 && r.category?.name==="Transfers" && r.status==="confirmed"),JSON.stringify(rows.map(r=>({merchant:r.merchant,amount:r.amount,category:r.category?.name,status:r.status}))));
  assert.doesNotMatch(reply,/\/confirm/); console.log(`PASS ${name}: beneficiary AMINA BELLO, NGN 4,000 excluding fee, Transfers category, saved immediately.`);
 }
} finally {globalThis.fetch=originalFetch;await prisma.user.delete({where:{id:user.id}});await prisma.$disconnect();}
