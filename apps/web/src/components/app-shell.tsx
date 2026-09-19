"use client";
import * as React from "react";
import { useNickname } from "@/components/preferences";
import { useAuth } from "@/components/auth/auth-provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, ReceiptText, Settings, ChevronRight, LogOut } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
export function AppShell({ children }: { children: React.ReactNode }) {
 const path=usePathname();const router=useRouter();const nickname=useNickname();const {refresh}=useAuth();
 const [open,setOpen]=React.useState(false);const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState("");
 async function logout(){setBusy(true);setError("");try{const r=await fetch("/api/auth/logout",{method:"POST"});if(!r.ok)throw new Error();setOpen(false);await refresh();router.replace("/onboarding");}catch{setError("Could not log out. Please try again.");}finally{setBusy(false);}}
 if(path==="/onboarding")return <main>{children}</main>;
 return <div className="workspace"><aside className="sidebar"><Link className="brand" href="/dashboard">KW<span>Kudi Guide</span></Link><div className="nav-label">YOUR WORKSPACE</div><nav><Link className={`nav-link ${path==="/dashboard"?"selected":""}`} href="/dashboard"><LayoutGrid size={19}/> Overview</Link><Link className={`nav-link ${path==="/transactions"?"selected":""}`} href="/transactions"><ReceiptText size={19}/> Transactions</Link><Link className={`nav-link ${path==="/settings"||path==="/connections"?"selected":""}`} href="/settings"><Settings size={19}/> Settings</Link></nav><div className="sidebar-bottom"><button className="profile profile-button" aria-label="Open account menu" aria-haspopup="dialog" onClick={()=>{setError("");setOpen(true);}}><span className="avatar">{nickname.slice(0,1).toUpperCase()||"?"}</span><span><strong>{nickname||"My account"}</strong><small>Personal workspace</small></span><ChevronRight size={16}/></button></div></aside><main className="main-content">{children}</main><Dialog open={open} onOpenChange={setOpen}><DialogContent className="account-dialog"><DialogTitle>{nickname||"My account"}</DialogTitle><DialogDescription>Manage your profile or log out of this browser.</DialogDescription><Link className="button outline" href="/settings" onClick={()=>setOpen(false)}><Settings size={18}/> Settings</Link><button className="logout-button" onClick={()=>void logout()} disabled={busy}><LogOut size={18}/>{busy?"Logging out…":"Log out"}</button>{error&&<p className="error-text" role="alert">{error}</p>}</DialogContent></Dialog></div>;
}
