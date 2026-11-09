import { describe, expect, it } from 'vitest';
import { messagePreview, replyWindow } from './rules';

describe('replyWindow', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('is open within 24 hours of the customer’s last message on WhatsApp and Instagram', () => {
    expect(replyWindow('whatsapp', '2026-11-08T13:00:00Z', now)).toEqual({
      open: true,
      closesAt: new Date('2026-11-09T13:00:00Z'),
    });
    expect(replyWindow('instagram', '2026-11-08T11:00:00Z', now)).toEqual({
      open: false,
      closedAt: new Date('2026-11-09T11:00:00Z'),
    });
    expect(replyWindow('whatsapp', null, now)).toEqual({ open: false, closedAt: null });
  });
  it('website chat has no window', () => {
    expect(replyWindow('web', null, now)).toEqual({ open: true, closesAt: null });
  });
});

describe('messagePreview', () => {
  it('shows text, or a label for media', () => {
    expect(messagePreview({ type: 'text', text: '  How much\nis this?  ' })).toBe(
      'How much is this?',
    );
    expect(messagePreview({ type: 'image', text: '' })).toBe('📷 Photo');
  });
});
