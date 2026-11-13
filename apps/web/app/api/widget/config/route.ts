import { corsHeaders, json, widgetConfig } from '@/lib/widget';

/** What the chat bubble shows: business name, brand colour, logo and greeting. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key') ?? '';
  const config = await widgetConfig(key);
  const cors = corsHeaders(request.headers.get('origin'), config);
  if (!config || !cors) return json({ error: 'Not available' }, 404);
  return json(
    {
      businessName: config.businessName,
      colour: config.colour,
      logoUrl: config.logoUrl,
      greeting: config.greeting,
    },
    200,
    cors,
  );
}
