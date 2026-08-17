import type { Metadata } from "next";
import Link from "next/link";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { Separator } from "@/components/ui/separator";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kudi Guide",
  description: "Nigerian expense tracking foundation",
};

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="min-h-screen bg-background">
            <header className="border-b bg-card">
              <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
                <Link href="/dashboard" className="text-lg font-semibold tracking-normal">
                  Kudi Guide
                </Link>
                <nav className="flex items-center gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
            <Separator />
          </div>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
