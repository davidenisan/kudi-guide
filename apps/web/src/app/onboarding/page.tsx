"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/components/auth/auth-provider";

type AuthStep = "phone" | "otp";

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [step, setStep] = React.useState<AuthStep>("phone");
  const [phone, setPhone] = React.useState("");
  const [normalizedPhone, setNormalizedPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [resendCooldown, setResendCooldown] = React.useState(0);

  React.useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function requestOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Could not send code.");
      }

      setNormalizedPhone(body.phone);
      setStep("otp");
      setResendCooldown(30);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not send code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone || phone, code }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Could not verify code.");
      }

      await refresh();
      router.replace("/dashboard");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not verify code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendCode() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/otp/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone || phone }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Could not resend code.");
      }

      setCode("");
      setResendCooldown(30);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not resend code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-normal">Verify your phone</h1>
        <p className="text-sm text-muted-foreground">
          Your verified number is also the WhatsApp sender identity for receipt logging.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Authentication error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{step === "phone" ? "Enter phone number" : "Enter verification code"}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form className="space-y-5" onSubmit={requestOtp}>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  inputMode="tel"
                  placeholder="+234 801 234 5678"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Sending..." : "Send code"}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={verifyOtp}>
              <div className="grid gap-2">
                <Label>Verification code</Label>
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <p className="text-sm text-muted-foreground">
                  We sent a 6-digit code to {normalizedPhone || phone}.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="submit" disabled={isSubmitting || code.length !== 6} className="flex-1">
                  {isSubmitting ? "Verifying..." : "Verify and continue"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting || resendCooldown > 0}
                  onClick={resendCode}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
