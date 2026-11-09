import { describe, expect, it } from 'vitest';
import {
  adapterFor,
  outboundMessage,
  registerAdapter,
  toPlainText,
  type ChannelAdapter,
} from './index';

describe('channels', () => {
  it('turns buttons and lists into numbered text', () => {
    expect(
      toPlainText({
        type: 'buttons',
        text: 'Which size?',
        buttons: [
          { id: 's', title: 'S' },
          { id: 'm', title: 'M' },
        ],
      }),
    ).toBe('Which size?\n\n1. S\n2. M');
    expect(
      toPlainText({
        type: 'list',
        text: 'Pick one',
        buttonLabel: 'See',
        rows: [{ id: 'a', title: 'Ankara', description: '₦25,000' }],
      }),
    ).toBe('Pick one\n\n1. Ankara – ₦25,000');
  });

  it('checks outgoing messages against platform limits', () => {
    expect(
      outboundMessage.safeParse({
        type: 'buttons',
        text: 'x',
        buttons: [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: `${i}` })),
      }).success,
    ).toBe(false);
    expect(outboundMessage.safeParse({ type: 'text', text: '   ' }).success).toBe(false);
  });

  it('finds registered adapters', () => {
    expect(adapterFor('instagram')).toBeNull();
    const fake: ChannelAdapter = {
      channel: 'instagram',
      capabilities: { images: true, buttons: false, lists: false },
      verifyWebhook: () => true,
      parseWebhook: () => ({ messages: [], statuses: [] }),
      send: async () => ({ externalId: 'x' }),
    };
    registerAdapter(fake);
    expect(adapterFor('instagram')).toBe(fake);
  });
});
