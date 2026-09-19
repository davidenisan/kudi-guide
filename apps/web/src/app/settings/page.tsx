"use client";
import { useRequireAuth } from "@/components/auth/auth-provider";
import { SettingsView } from "@/components/settings-view";
export default function SettingsPage(){const {user,isLoading}=useRequireAuth();if(isLoading||!user)return <div className="empty-state">Loading your settings…</div>;return <SettingsView/>;}
