"use client";
import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard-view";
import { useRequireAuth } from "@/components/auth/auth-provider";
export default function TransactionsPage(){const {user,isLoading}=useRequireAuth();if(isLoading||!user)return <div className="empty-state">Loading transactions…</div>;return <Suspense><DashboardView transactionsPage /></Suspense>;}
