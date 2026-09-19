"use client";
import Link from "next/link";
import { useRequireAuth } from "@/components/auth/auth-provider";
import { TelegramConnection } from "@/components/telegram-connection";
export default function ConnectionsPage() {
 const { user, isLoading } = useRequireAuth();
 if (isLoading || !user) return <p role="status">Loading your connections…</p>;
 return <><header className="settings-header"><span className="eyebrow">YOUR ACCOUNT, CONNECTED</span><h1>Connections</h1><p>Hi {user.nickname || user.username}. Connect Telegram to log expenses from a message, photo or PDF.</p></header><div className="connections-content"><TelegramConnection/><p className="connection-login-note">Telegram is an optional connection. Use your username or email and password to log in to Kudi Guide.</p><Link className="button outline" href="/dashboard">Continue to dashboard →</Link></div></>;
}
