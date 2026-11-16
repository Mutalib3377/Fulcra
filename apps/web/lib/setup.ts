import type { SetupStepKey } from '@fulcra/core';

/** Cookie that hides the "Get set up" card for one business. */
export function setupHiddenCookie(businessId: string): string {
  return `fulcra_setup_hidden_${businessId}`;
}

type StepText = { title: string; description: string; href: string; action: string };

/** What each checklist step says and where it leads. */
export function setupStepText(key: SetupStepKey, hasExternalWebsite: boolean): StepText {
  switch (key) {
    case 'store':
      return hasExternalWebsite
        ? {
            title: 'Add your website',
            description: 'Tell us your website address so we can connect it.',
            href: '/settings/store',
            action: 'Add website',
          }
        : {
            title: 'Your store is live',
            description: 'Customers can see your products and order at your store link.',
            href: '/settings/store',
            action: 'Change',
          };
    case 'brand':
      return {
        title: 'Set up your brand',
        description: 'Logo, colours and how the assistant should sound.',
        href: '/settings/brand',
        action: 'Open brand kit',
      };
    case 'products':
      return {
        title: 'Add your products',
        description: hasExternalWebsite
          ? 'Import them from your website or shop, or add them one by one.'
          : 'Add photos, prices and stock, or import a list.',
        href: hasExternalWebsite ? '/catalog/import' : '/catalog/new',
        action: hasExternalWebsite ? 'Import products' : 'Add a product',
      };
    case 'delivery':
      return {
        title: 'Set delivery fees',
        description: 'Areas you deliver to, with the fee and how long it takes.',
        href: '/settings/delivery',
        action: 'Add delivery areas',
      };
    case 'payouts':
      return {
        title: 'Get paid',
        description: 'Add the bank account where customer payments should land.',
        href: '/settings/payments',
        action: 'Add bank account',
      };
    case 'channel':
      return hasExternalWebsite
        ? {
            title: 'Connect a chat',
            description: 'Put the chat on your website, or connect WhatsApp or Instagram.',
            href: '/settings/website-chat',
            action: 'Add website chat',
          }
        : {
            title: 'Connect WhatsApp',
            description: 'So the assistant can answer your customers. Instagram works too.',
            href: '/settings/whatsapp',
            action: 'Connect WhatsApp',
          };
    case 'test_chat':
      return {
        title: 'Try the assistant',
        description: 'Chat with it as if you were a customer and see how it answers.',
        href: '/inbox/test',
        action: 'Start a test chat',
      };
  }
}
