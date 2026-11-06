import { DEFAULT_ROOT_DOMAIN } from '@fulcra/config';

function rootDomain(env: NodeJS.ProcessEnv = process.env): string {
  return env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN;
}

/** Customer-facing receipt link on the business's store address. */
export function receiptUrl(
  subdomain: string,
  receiptToken: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = rootDomain(env);
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${subdomain}.${root}/receipt/${receiptToken}`;
}

/**
 * Paystack needs an email for every payment. Customers without one get a made-up address
 * on our domain (docs/decisions/0006). Never used to send email.
 */
export function paymentEmailFor(
  customer: { email: string | null; phone: string | null },
  fallbackId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (customer.email) return customer.email;
  const root = rootDomain(env).replace(/:\d+$/, '');
  // Paystack rejects unusual domains such as "localhost"; fall back to the placeholder domain.
  const domain = root.includes('.') && !root.endsWith('localhost') ? root : DEFAULT_ROOT_DOMAIN;
  const local = customer.phone ? customer.phone.replace(/\D/g, '') : `order-${fallbackId}`;
  return `${local}@customers.${domain}`;
}
