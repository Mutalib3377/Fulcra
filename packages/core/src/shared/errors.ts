export type CoreErrorCode = 'validation' | 'not_found' | 'forbidden' | 'conflict';

/**
 * An expected failure with a plain-language message that is safe to show the user.
 * `field` names the form field the message belongs to, when there is one.
 */
export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'CoreError';
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}

/** True when a Postgres error is a unique-constraint violation (optionally on one constraint). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return pg?.code === '23505' && (!constraint || pg.constraint_name === constraint);
}

type PgError = { code?: string; constraint_name?: string };

function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === 'string' && /^\d{5}$/.test(candidate.code)) return candidate;
    current = candidate.cause;
  }
  return undefined;
}
