"use client";
import { Suspense } from "react";
import { useRequireAuth } from "@/components/auth/auth-provider";
import { DashboardView } from "@/components/dashboard-view";
export default function DashboardPage(){const {user,isLoading}=useRequireAuth();if(isLoading||!user)return <div className="empty-state">Loading your workspace…</div>;return <Suspense><DashboardView/></Suspense>;}
