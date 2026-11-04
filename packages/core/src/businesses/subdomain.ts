import { schema, withSystem } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import {
  normalizeSubdomain,
  subdomainMessages,
  validateSubdomain,
  type SubdomainProblem,
} from './subdomain-rules';

export * from './subdomain-rules';

export type SubdomainAvailability =
  | { available: true; subdomain: string }
  | { available: false; subdomain: string; problem: SubdomainProblem; message: string };

/** Live availability check used by onboarding. */
export async function checkSubdomainAvailable(value: string): Promise<SubdomainAvailability> {
  const subdomain = normalizeSubdomain(value);
  const problem = validateSubdomain(subdomain);
  if (problem) return { available: false, subdomain, problem, message: subdomainMessages[problem] };

  // System query: availability must look across all businesses.
  const existing = await withSystem((tx) =>
    tx
      .select({ id: schema.businesses.id })
      .from(schema.businesses)
      .where(eq(schema.businesses.subdomain, subdomain))
      .limit(1),
  );
  if (existing.length > 0) {
    return { available: false, subdomain, problem: 'taken', message: subdomainMessages.taken };
  }
  return { available: true, subdomain };
}
