export type SendOtpInput = {
  phone: string;
  code: string;
};

export interface SmsProvider {
  sendOtp(input: SendOtpInput): Promise<void>;
}

export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp({ phone, code }: SendOtpInput) {
    console.log(`[auth] OTP for ${phone}: ${code}`);
  }
}

export class TermiiSmsProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
  ) {}

  async sendOtp({ phone, code }: SendOtpInput) {
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: phone,
        from: this.senderId,
        sms: `Your Kudi Guide verification code is ${code}. It expires in 5 minutes.`,
        type: "plain",
        channel: "generic",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Termii SMS failed with ${response.status}: ${body}`);
    }
  }
}

export function createSmsProvider(input: {
  termiiApiKey?: string;
  termiiSenderId: string;
}): SmsProvider {
  if (input.termiiApiKey) {
    return new TermiiSmsProvider(input.termiiApiKey, input.termiiSenderId);
  }

  return new ConsoleSmsProvider();
}
