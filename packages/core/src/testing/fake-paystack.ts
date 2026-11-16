import { createHmac } from 'node:crypto';
import type { PaystackClient, PaystackVerifiedTransaction } from '../payments/paystack';

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
  customers = new Map<
    string,
    { email: string; firstName: string; lastName: string; phone: string }
  >();
  dedicated = new Map<
    string,
    { accountNumber: string; subaccount: string; preferredBank: string }
  >();
  failDedicated: string | null = null;
  /** Fulcra's subscription plans and subscriptions (B1). */
  plans = new Map<string, { name: string; amount: number; interval: string }>();
  planCheckouts: {
    email: string;
    amount: number;
    planCode: string;
    reference: string;
    metadata: Record<string, unknown>;
  }[] = [];
  subscriptions = new Map<
    string,
    {
      customerCode: string;
      planCode: string;
      authorizationCode: string;
      startDate?: Date;
      disabled: boolean;
    }
  >();
  disabled: string[] = [];
  /** Transfers received into dedicated accounts: reference → details. */
  transfers = new Map<string, { customerCode: string; amount: number; currency: string }>();

  async listBanks() {
    return [
      { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'Access Bank', code: '044' },
    ];
  }

  async resolveAccount({ accountNumber }: { accountNumber: string; bankCode: string }) {
    if (accountNumber === '0000000000') {
      const { PaystackError } = await import('../payments/paystack');
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

  async createCustomer(input: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  }) {
    const existing = [...this.customers.entries()].find(([, c]) => c.email === input.email);
    if (existing) return { customerCode: existing[0] };
    const code = `CUS_${this.customers.size + 1}_${Math.random().toString(36).slice(2, 8)}`;
    this.customers.set(code, input);
    return { customerCode: code };
  }

  async createDedicatedAccount(input: {
    customerCode: string;
    preferredBank: string;
    subaccount: string;
  }) {
    if (this.failDedicated) {
      const { PaystackError } = await import('../payments/paystack');
      throw new PaystackError(this.failDedicated, 400);
    }
    const accountNumber = String(9_000_000_000 + Math.floor(Math.random() * 999_999_999));
    this.dedicated.set(input.customerCode, {
      accountNumber,
      subaccount: input.subaccount,
      preferredBank: input.preferredBank,
    });
    const c = this.customers.get(input.customerCode)!;
    return {
      accountNumber,
      accountName: `FULCRA/${c.firstName} ${c.lastName}`.toUpperCase(),
      bankName: 'Test Bank',
    };
  }

  /** Simulates a customer transferring into their dedicated account; returns the webhook to send. */
  transfer(customerCode: string, amount: number, currency = 'NGN') {
    const reference = `T${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    this.transfers.set(reference, { customerCode, amount, currency });
    const id = 7_000_000 + this.transfers.size + Math.floor(Math.random() * 1_000_000);
    return signedWebhook('charge.success', {
      id,
      reference,
      amount,
      channel: 'dedicated_nuban',
      customer: { customer_code: customerCode },
    });
  }

  async createPlan(input: { name: string; amount: number; interval: 'monthly' | 'annually' }) {
    const planCode = `PLN_${this.plans.size + 1}_${Math.random().toString(36).slice(2, 7)}`;
    this.plans.set(planCode, input);
    return { planCode };
  }

  async initializePlanCheckout(input: {
    email: string;
    amount: number;
    planCode: string;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }) {
    this.planCheckouts.push(input);
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      reference: input.reference,
    };
  }

  async createSubscription(input: {
    customerCode: string;
    planCode: string;
    authorizationCode: string;
    startDate?: Date;
  }) {
    const code = `SUB_${this.subscriptions.size + 1}_${Math.random().toString(36).slice(2, 7)}`;
    this.subscriptions.set(code, { ...input, disabled: false });
    return {
      subscriptionCode: code,
      emailToken: `tok_${code}`,
      nextPaymentDate: input.startDate?.toISOString() ?? null,
    };
  }

  async disableSubscription(input: { code: string; token: string }) {
    this.disabled.push(input.code);
    const sub = this.subscriptions.get(input.code);
    if (sub) sub.disabled = true;
  }

  /**
   * What Paystack sends when a plan is paid (first checkout or a renewal): verify reports the
   * plan, the card and the customer. Returns the signed webhook.
   */
  subscriptionCharge(input: {
    reference: string;
    planCode: string;
    amount: number;
    customerCode: string;
    email: string;
    metadata?: Record<string, unknown>;
  }) {
    this.verifyResult.set(input.reference, {
      amount: input.amount,
      customerCode: input.customerCode,
      channel: 'card',
      raw: {
        plan: { plan_code: input.planCode },
        authorization: { authorization_code: `AUTH_${input.customerCode}`, reusable: true },
        customer: { customer_code: input.customerCode, email: input.email },
        metadata: input.metadata ?? {},
      },
    });
    return signedWebhook('charge.success', {
      id: 8_000_000 + Math.floor(Math.random() * 1_000_000),
      reference: input.reference,
      amount: input.amount,
      plan: { plan_code: input.planCode },
      customer: { customer_code: input.customerCode, email: input.email },
      metadata: input.metadata ?? {},
    });
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifiedTransaction> {
    this.verifyCalls.push(reference);
    const transfer = this.transfers.get(reference);
    if (transfer) {
      return {
        id: 1,
        reference,
        status: 'success',
        amount: transfer.amount,
        currency: transfer.currency,
        channel: 'dedicated_nuban',
        paidAt: new Date().toISOString(),
        customerCode: transfer.customerCode,
        raw: {},
        ...this.verifyResult.get(reference),
      };
    }
    const init = this.initialized.find((i) => i.reference === reference);
    return {
      id: 9_000_000 + this.verifyCalls.length,
      reference,
      status: 'success',
      amount: init?.amount ?? 0,
      currency: 'NGN',
      channel: 'bank_transfer',
      paidAt: new Date().toISOString(),
      customerCode: null,
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
