import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CoreError } from '../shared/errors';

/**
 * Paystack API client. Only the calls we use. Swappable for tests with `setPaystackClient`.
 * Docs: https://paystack.com/docs/api/
 */
export type PaystackBank = { name: string; code: string };

export type PaystackVerifiedTransaction = {
  id: number;
  reference: string;
  status: string; // "success", "failed", "abandoned", …
  amount: number; // kobo
  currency: string;
  channel: string | null; // card, bank_transfer, ussd, …
  paidAt: string | null;
  raw: Record<string, unknown>;
};

export interface PaystackClient {
  listBanks(): Promise<PaystackBank[]>;
  resolveAccount(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{ accountName: string }>;
  createSubaccount(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<{ subaccountCode: string }>;
  updateSubaccount(
    code: string,
    input: { businessName: string; bankCode: string; accountNumber: string },
  ): Promise<{ subaccountCode: string }>;
  initializeTransaction(input: {
    email: string;
    amount: number;
    reference: string;
    subaccount: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verifyTransaction(reference: string): Promise<PaystackVerifiedTransaction>;
}

const envSchema = z.object({
  PAYSTACK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/, 'PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_'),
  PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
});

export function getPaystackSecretKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const parsed = envSchema.safeParse(env);
  return parsed.success ? parsed.data.PAYSTACK_SECRET_KEY : null;
}

/** Checks the x-paystack-signature header: HMAC-SHA512 of the raw body with the secret key. */
export function verifyPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string,
): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const envelope = z.object({
  status: z.boolean(),
  message: z.string().default(''),
  data: z.unknown(),
});

class HttpPaystackClient implements PaystackClient {
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CoreError('conflict', 'Could not reach Paystack. Please try again.');
    }
    const json: unknown = await res.json().catch(() => ({}));
    const parsed = envelope.safeParse(json);
    if (!res.ok || !parsed.success || !parsed.data.status) {
      const message = parsed.success ? parsed.data.message : `Paystack error ${res.status}`;
      throw new PaystackError(message, res.status);
    }
    return schema.parse(parsed.data.data);
  }

  async listBanks() {
    const banks = await this.call(
      'GET',
      '/bank?country=nigeria&currency=NGN&perPage=200',
      z.array(
        z.object({
          name: z.string(),
          code: z.string(),
          active: z.boolean().optional(),
          is_deleted: z.boolean().nullish(),
        }),
      ),
    );
    return banks
      .filter((b) => b.active !== false && !b.is_deleted)
      .map(({ name, code }) => ({ name, code }));
  }

  async resolveAccount({ accountNumber, bankCode }: { accountNumber: string; bankCode: string }) {
    const data = await this.call(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      z.object({ account_name: z.string() }),
    );
    return { accountName: data.account_name };
  }

  async createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }) {
    const data = await this.call('POST', '/subaccount', z.object({ subaccount_code: z.string() }), {
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      // Fulcra takes nothing from sales (docs/decisions/0001).
      percentage_charge: 0,
    });
    return { subaccountCode: data.subaccount_code };
  }

  async updateSubaccount(
    code: string,
    input: { businessName: string; bankCode: string; accountNumber: string },
  ) {
    const data = await this.call(
      'PUT',
      `/subaccount/${encodeURIComponent(code)}`,
      z.object({ subaccount_code: z.string() }),
      {
        business_name: input.businessName,
        settlement_bank: input.bankCode,
        account_number: input.accountNumber,
      },
    );
    return { subaccountCode: data.subaccount_code };
  }

  async initializeTransaction(input: {
    email: string;
    amount: number;
    reference: string;
    subaccount: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }) {
    const data = await this.call(
      'POST',
      '/transaction/initialize',
      z.object({ authorization_url: z.url(), reference: z.string() }),
      {
        email: input.email,
        amount: input.amount,
        currency: 'NGN',
        reference: input.reference,
        subaccount: input.subaccount,
        // The seller pays Paystack's fee from their settlement (docs/decisions/0006).
        bearer: 'subaccount',
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      },
    );
    return { authorizationUrl: data.authorization_url, reference: data.reference };
  }

  async verifyTransaction(reference: string) {
    const data = await this.call(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
      z.looseObject({
        id: z.number(),
        reference: z.string(),
        status: z.string(),
        amount: z.number().int(),
        currency: z.string(),
        channel: z.string().nullish(),
        paid_at: z.string().nullish(),
      }),
    );
    return {
      id: data.id,
      reference: data.reference,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      channel: data.channel ?? null,
      paidAt: data.paid_at ?? null,
      raw: data as Record<string, unknown>,
    };
  }
}

export class PaystackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

let override: PaystackClient | null = null;

/** Tests only: replace the Paystack client (pass null to restore the real one). */
export function setPaystackClient(client: PaystackClient | null): void {
  override = client;
}

export function getPaystackClient(): PaystackClient {
  if (override) return override;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new CoreError(
      'conflict',
      'Online payments are not set up yet (PAYSTACK_SECRET_KEY is missing).',
    );
  }
  return new HttpPaystackClient(parsed.data.PAYSTACK_SECRET_KEY, parsed.data.PAYSTACK_BASE_URL);
}
