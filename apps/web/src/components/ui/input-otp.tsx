"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type InputOTPContextValue = {
  value: string;
  maxLength: number;
  setDigit: (index: number, digit: string) => void;
};

const InputOTPContext = React.createContext<InputOTPContextValue | null>(null);

function InputOTP({
  className,
  value = "",
  onChange,
  maxLength = 6,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
}) {
  const setDigit = React.useCallback(
    (index: number, digit: string) => {
      const digits = value.padEnd(maxLength).slice(0, maxLength).split("");
      digits[index] = digit.replace(/\D/g, "").slice(-1);
      onChange?.(digits.join("").trim());
    },
    [maxLength, onChange, value],
  );

  return (
    <InputOTPContext.Provider value={{ value, maxLength, setDigit }}>
      <div className={cn("flex items-center gap-2", className)} {...props} />
    </InputOTPContext.Provider>
  );
}

function InputOTPGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center", className)} {...props} />;
}

function InputOTPSlot({ index, className }: { index: number; className?: string }) {
  const context = React.useContext(InputOTPContext);

  return (
    <input
      aria-label={`Digit ${index + 1}`}
      inputMode="numeric"
      value={context?.value[index] ?? ""}
      onChange={(event) => {
        context?.setDigit(index, event.target.value);
        const nextInput = event.currentTarget.nextElementSibling as HTMLInputElement | null;

        if (event.target.value && nextInput) {
          nextInput.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && !event.currentTarget.value) {
          const previousInput = event.currentTarget.previousElementSibling as HTMLInputElement | null;
          previousInput?.focus();
        }
      }}
      maxLength={1}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center border-y border-r border-input bg-background text-center text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md focus:z-10 focus:outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
    />
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
