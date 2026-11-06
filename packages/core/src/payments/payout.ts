import { schema, withTenant } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import { getPaystackClient, PaystackError, type PaystackBank } from './paystack';

export type PayoutSettings = {
  configured: boolean;
  bankName: string | null;
  accountName: string | null;
  accountLast4: string | null;
};

export async function getPayoutSettings(actor: ActorContext): Promise<PayoutSettings> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const [b] = await tx
      .select({
        code: schema.businesses.paystackSubaccountCode,
        bankName: schema.businesses.payoutBankName,
        accountName: schema.businesses.payoutAccountName,
        last4: schema.businesses.payoutAccountLast4,
      })
      .from(schema.businesses)
      .limit(1);
    return {
      configured: Boolean(b?.code),
      bankName: b?.bankName ?? null,
      accountName: b?.accountName ?? null,
      accountLast4: b?.last4 ?? null,
    };
  });
}

let bankCache: { at: number; banks: PaystackBank[] } | null = null;

/** Nigerian banks Paystack can pay into (cached for a day). */
export async function listBanks(): Promise<PaystackBank[]> {
  if (bankCache && Date.now() - bankCache.at < 24 * 60 * 60 * 1000) return bankCache.banks;
  const banks = (await getPaystackClient().listBanks()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  bankCache = { at: Date.now(), banks };
  return banks;
}

/** Tests only. */
export function clearBankCache(): void {
  bankCache = null;
}

export const payoutAccountInput = z.object({
  bankCode: z.string().trim().min(1, 'Choose your bank.').max(20),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account numbers have 10 digits.'),
});
export type PayoutAccountInput = z.input<typeof payoutAccountInput>;

async function resolve(data: z.output<typeof payoutAccountInput>): Promise<string> {
  try {
    return (await getPaystackClient().resolveAccount(data)).accountName;
  } catch (error) {
    if (error instanceof PaystackError) {
      throw new CoreError(
        'validation',
        'We could not find this account. Check the number and the bank.',
        'accountNumber',
      );
    }
    throw error;
  }
}

/** Looks up the account name so the owner can confirm it before saving. Owner only. */
export async function resolveBankAccount(
  actor: ActorContext,
  input: PayoutAccountInput,
): Promise<{ accountName: string }> {
  const data = payoutAccountInput.parse(input);
  await withTenant(actor.businessId, (tx) => requireMember(tx, actor, ['owner']));
  return { accountName: await resolve(data) };
}

/**
 * Saves where the business is paid: creates (or updates) its Paystack subaccount so payments
 * settle straight to the seller (docs/decisions/0001). Owner only.
 */
export async function savePayoutAccount(
  actor: ActorContext,
  input: PayoutAccountInput,
): Promise<PayoutSettings> {
  const data = payoutAccountInput.parse(input);
  const business = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [b] = await tx
      .select({ name: schema.businesses.name, code: schema.businesses.paystackSubaccountCode })
      .from(schema.businesses)
      .limit(1);
    return b!;
  });

  const accountName = await resolve(data);
  const bank = (await listBanks()).find((b) => b.code === data.bankCode);
  if (!bank) throw new CoreError('validation', 'Choose your bank from the list.', 'bankCode');

  const paystack = getPaystackClient();
  const details = {
    businessName: business.name,
    bankCode: data.bankCode,
    accountNumber: data.accountNumber,
  };
  let subaccountCode: string;
  try {
    subaccountCode = business.code
      ? (await paystack.updateSubaccount(business.code, details)).subaccountCode
      : (await paystack.createSubaccount(details)).subaccountCode;
  } catch (error) {
    if (error instanceof PaystackError) {
      throw new CoreError('conflict', `Paystack could not save this account: ${error.message}`);
    }
    throw error;
  }

  await withTenant(actor.businessId, (tx) =>
    tx
      .update(schema.businesses)
      .set({
        paystackSubaccountCode: subaccountCode,
        payoutBankCode: data.bankCode,
        payoutBankName: bank.name,
        payoutAccountName: accountName,
        payoutAccountLast4: data.accountNumber.slice(-4),
      })
      .where(eq(schema.businesses.id, actor.businessId)),
  );
  return {
    configured: true,
    bankName: bank.name,
    accountName,
    accountLast4: data.accountNumber.slice(-4),
  };
}
