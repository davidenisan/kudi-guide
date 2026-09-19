"use client";
import * as React from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { useAuth } from "@/components/auth/auth-provider";
export function AppearanceProvider({children}:{children:React.ReactNode}){return <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>{children}</ThemeProvider>;}
export function ThemeSelect(){const {theme,setTheme}=useTheme();const [mounted,setMounted]=React.useState(false);React.useEffect(()=>setMounted(true),[]);return <select aria-label="Appearance" className="appearance-select" value={mounted?theme:"system"} onChange={e=>setTheme(e.target.value)}><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select>;}
export function useNickname(){const {user}=useAuth();return user?.nickname||user?.username||"";}
