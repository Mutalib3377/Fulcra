import type { schema } from '@fulcra/db';
import { productInput, toImportInput } from '../catalog/products';

/** Problems that would stop the product form from saving this product, in plain words. */
export function checkImportedProduct(data: schema.ImportedProduct): schema.ImportProblem[] {
  const result = productInput.safeParse(toImportInput(data, []));
  if (result.success) return [];
  const messages = [...new Set(result.error.issues.map((issue) => issue.message))];
  return messages.map((message) => ({ level: 'error' as const, message }));
}
