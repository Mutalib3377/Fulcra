import { getTestChat } from '@fulcra/core';
import { jsonRoute } from '@/lib/api';

export function GET() {
  return jsonRoute(({ actor }) => getTestChat(actor));
}
