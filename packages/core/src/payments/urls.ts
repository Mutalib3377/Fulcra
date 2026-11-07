import { DEFAULT_ROOT_DOMAIN } from '@fulcra/config';

function rootDomain(env: NodeJS.ProcessEnv = process.env): string {
  return env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN;
}

/** A page on the business's store, e.g. `storeUrl('ada', '/p/<id>')`. */
export function storeUrl(
  subdomain: string,
  path = '/',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = rootDomain(env);
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${subdomain}.${root}${path.startsWith('/') ? path : `/${path}`}`;
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

/**
 * Email for the Paystack customer behind a dedicated account. One per business-customer pair,
 * so the same person buying from two businesses gets two separate Paystack customers.
 */
export function dedicatedAccountEmail(
  customerId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = rootDomain(env).replace(/:\d+$/, '');
  const domain = root.includes('.') && !root.endsWith('localhost') ? root : DEFAULT_ROOT_DOMAIN;
  return `dva-${customerId}@customers.${domain}`;
}
