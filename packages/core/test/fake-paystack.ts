import { createHmac } from 'node:crypto';
import type { PaystackClient, PaystackVerifiedTransaction } from '../src/payments/paystack';

export const TEST_SECRET = 'sk_test_fulcra_fake_key';

/** In-memory Paystack: records calls; tests decide what verify returns. */
export class FakePaystack implements PaystackClient {
  subaccounts = new Map<
    string,
    { businessName: string; bankCode: string; accountNumber: string }
  >();
  initialized: {
    reference: string;
    amount: number;
    email: string;
    subaccount: string;
    callbackUrl: string;
  }[] = [];
  verifyCalls: string[] = [];
  /** reference → what verify reports; defaults to success with the initialized amount. */
  verifyResult = new Map<string, Partial<PaystackVerifiedTransaction>>();
  failInitialize = false;

  async listBanks() {
    return [
      { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'Access Bank', code: '044' },
    ];
  }

  async resolveAccount({ accountNumber }: { accountNumber: string; bankCode: string }) {
    if (accountNumber === '0000000000') {
      const { PaystackError } = await import('../src/payments/paystack');
      throw new PaystackError('Could not resolve account name', 422);
    }
    return { accountName: 'ADA STYLES ENTERPRISES' };
  }

  async createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }) {
    const code = `ACCT_${this.subaccounts.size + 1}`;
    this.subaccounts.set(code, input);
    return { subaccountCode: code };
  }

  async updateSubaccount(
    code: string,
    input: { businessName: string; bankCode: string; accountNumber: string },
  ) {
    this.subaccounts.set(code, input);
    return { subaccountCode: code };
  }

  async initializeTransaction(input: {
    email: string;
    amount: number;
    reference: string;
    subaccount: string;
    callbackUrl: string;
  }) {
    if (this.failInitialize) throw new Error('network down');
    this.initialized.push(input);
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      reference: input.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifiedTransaction> {
    this.verifyCalls.push(reference);
    const init = this.initialized.find((i) => i.reference === reference);
    return {
      id: 9_000_000 + this.verifyCalls.length,
      reference,
      status: 'success',
      amount: init?.amount ?? 0,
      currency: 'NGN',
      channel: 'bank_transfer',
      paidAt: new Date().toISOString(),
      raw: {},
      ...this.verifyResult.get(reference),
    };
  }
}

/** A Paystack-style webhook body and its signature. */
export function signedWebhook(event: string, data: Record<string, unknown>, secret = TEST_SECRET) {
  const body = JSON.stringify({ event, data });
  return { body, signature: createHmac('sha512', secret).update(body).digest('hex') };
}
