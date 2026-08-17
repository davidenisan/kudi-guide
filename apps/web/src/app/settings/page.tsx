"use client";

import { useRequireAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const { user, isLoading } = useRequireAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-normal">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and notification preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp receipt logging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Linking status</p>
              <p className="text-sm text-muted-foreground">
                {isLoading || !user ? "Checking..." : `Linked - using ${user.phone}`}
              </p>
            </div>
            <Badge variant="secondary">Linked</Badge>
          </div>
          <Separator />
          <p className="text-sm text-muted-foreground">
            This is the same phone number verified during OTP login.
          </p>
          {/* This is intentionally not a separate WhatsApp linking flow; it only displays users.phone. */}
        </CardContent>
      </Card>
    </div>
  );
}
