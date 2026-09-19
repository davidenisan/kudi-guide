"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
type Notice={id:string;title:string;merchant:string;amount:number;currency:string;date:string;read:boolean};
type Inbox={items:Notice[];error:string;loading:boolean;markRead:(ids:string[])=>Promise<boolean>;refresh:()=>Promise<void>};
const Context=React.createContext<Inbox | null>(null);
export function NotificationProvider({children}:{children:React.ReactNode}){
 const {user}=useAuth();
 const [items,setItems]=React.useState<Notice[]>([]);const [error,setError]=React.useState("");const [loading,setLoading]=React.useState(false);
 const seen=React.useRef<Set<string>|null>(null);const account=React.useRef<string|null>(null);const inFlight=React.useRef(false);
 const refresh=React.useCallback(async()=>{
  if(!user||inFlight.current)return;
  const userId=user.id;inFlight.current=true;
  try{const r=await fetch("/api/notifications",{cache:"no-store"});if(!r.ok)throw new Error("Could not load notifications.");const b=await r.json();if(account.current!==userId)return;const next=b.notifications as Notice[];
   if(seen.current&&user.transactionAlerts!==false){const fresh=next.filter(n=>!n.read&&!seen.current!.has(n.id));if(fresh.length)toast.success(fresh.length===1?`${fresh[0].merchant}: expense tracked`:`${fresh.length} new expenses tracked`);}
   seen.current=new Set(next.map(n=>n.id));setItems(next);setError("");
  }catch(e){setError(e instanceof Error?e.message:"Could not load notifications.");}finally{inFlight.current=false;setLoading(false);}
 },[user]);
 React.useEffect(()=>{account.current=user?.id??null;seen.current=null;setItems([]);setError("");},[user?.id]);
 React.useEffect(()=>{setLoading(Boolean(user));void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh,user]);
 async function markRead(ids:string[]){if(!ids.length)return true;try{{const r=await fetch("/api/notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({ids})});if(!r.ok)throw new Error("Could not mark notifications as read.");}setItems(current=>current.map(n=>ids.includes(n.id)?{...n,read:true}:n));setError("");return true;}catch(e){setError(e instanceof Error?e.message:"Could not update notifications.");return false;}}
 return <Context.Provider value={{items,error,loading,markRead,refresh}}>{children}</Context.Provider>;
}
export function NotificationBell(){
 const inbox=React.useContext(Context);const [open,setOpen]=React.useState(false);const [busy,setBusy]=React.useState(false);const router=useRouter();if(!inbox)return null;const {items,error,loading,markRead,refresh}=inbox;const unread=items.filter(n=>!n.read).length;
 async function readAll(){setBusy(true);await markRead(items.filter(n=>!n.read).map(n=>n.id));setBusy(false);}
 async function inspect(item:Notice){if(await markRead([item.id])){setOpen(false);router.push(`/transactions?transaction=${encodeURIComponent(item.id)}`);}}
 return <><button className="icon-button" aria-label={`Notifications${unread?`, ${unread} unread`:""}`} onClick={()=>{setOpen(true);void refresh();}}><Bell size={23}/>{unread>0&&<b>{unread>99?"99+":unread}</b>}</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="notification-dialog"><DialogTitle>Notifications</DialogTitle><DialogDescription>Recent transaction activity in your account.</DialogDescription><div className="notification-actions"><span>{unread?`${unread} unread`:"You’re all caught up"}</span><button className="text-link" disabled={!unread||busy} onClick={readAll}><CheckCheck size={15}/>Mark all read</button></div>{error&&<p role="alert" className="error-text">{error} <button onClick={()=>void refresh()}>Try again</button></p>}<div className="notification-list">{loading?<p className="empty-state">Loading notifications…</p>:items.length?items.map(n=><button key={n.id} className={`notification-item ${n.read?"":"unread"}`} onClick={()=>void inspect(n)}><span className="notification-dot"/><div><strong>{n.title}</strong><p>{n.merchant} · {new Intl.NumberFormat("en-NG",{style:"currency",currency:n.currency}).format(n.amount)}</p><small>{new Date(n.date).toLocaleString()}</small></div><ArrowUpRight size={16}/></button>):<div className="empty-state"><Bell size={25}/><h3>No notifications yet</h3><p>Your next tracked expense will appear here.</p></div>}</div></DialogContent></Dialog></>;
}
