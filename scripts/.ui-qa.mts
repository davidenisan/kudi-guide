import "../apps/api/src/config/env.js";
import { prisma } from "../apps/api/src/db/prisma.js";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
if(process.argv[2]==="cleanup"){
 const id=readFileSync('/tmp/kudi-ui-qa-id','utf8');const user=await prisma.user.findUnique({where:{id}});if(user?.username!=="ui_qa_periods")throw new Error("Unexpected account");await prisma.user.delete({where:{id}});unlinkSync('/tmp/kudi-ui-qa-id');
}else{
 const r=await fetch('http://localhost:3001/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:'Period QA',username:'ui_qa_periods',email:'ui_qa_periods@example.test',password:'Temporary-UI-QA-periods-2026'})});const b=await r.json();if(r.status!==201)throw new Error(b.error);writeFileSync('/tmp/kudi-ui-qa-id',b.user.id,{mode:0o600});
 const now=new Date();for(const [merchant,amount,days] of [['Newest expense',1000,0],['Older expense',2000,3],['Previous month',3000,45]] as const){await prisma.transaction.create({data:{userId:b.user.id,source:'manual',merchant,amount,currency:'NGN',status:'confirmed',occurredAt:new Date(now.getTime()-days*86400000)}});}console.log('Synthetic UI account and dated transactions created.');
}
await prisma.$disconnect();
