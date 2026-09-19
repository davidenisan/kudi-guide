import { AppearanceProvider } from "@/components/preferences";
import { NotificationProvider } from "@/components/notifications";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/auth-provider";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
export const metadata: Metadata = { title: "Kudi Guide — Every naira, accounted for", description: "Your everyday money, made clear. Track transactions with Telegram." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en" suppressHydrationWarning><body><AppearanceProvider><AuthProvider><NotificationProvider><AppShell>{children}</AppShell><Toaster richColors position="top-right" /></NotificationProvider></AuthProvider></AppearanceProvider></body></html>;
}
