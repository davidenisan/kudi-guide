export type OtpRecord = {
  code: string;
  expiresAt: Date;
  attempts: number;
  requestTimestamps: number[];
  resendTimestamps: number[];
};

export interface OtpStore {
  get(phone: string): Promise<OtpRecord | null>;
  set(phone: string, record: OtpRecord): Promise<void>;
  delete(phone: string): Promise<void>;
}

export class InMemoryOtpStore implements OtpStore {
  private records = new Map<string, OtpRecord>();

  async get(phone: string) {
    return this.records.get(phone) ?? null;
  }

  async set(phone: string, record: OtpRecord) {
    this.records.set(phone, record);
  }

  async delete(phone: string) {
    this.records.delete(phone);
  }
}
