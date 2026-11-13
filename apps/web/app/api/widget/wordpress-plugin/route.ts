import { getWebChat, WIDGET_KEY } from '@fulcra/core';
import { getActionContext } from '@/lib/auth';
import { dashboardUrl } from '@/lib/urls';
import { zipFiles } from '@/lib/zip';

/** A ready WordPress plugin with the business's chat key filled in (owner and staff). */
export async function GET() {
  const context = await getActionContext();
  if (!context || context.membership.role === 'rider')
    return new Response('Not allowed', { status: 403 });
  const chat = await getWebChat(context.actor);
  if (!chat?.enabled || !WIDGET_KEY.test(chat.key))
    return new Response('Turn on the website chat first.', { status: 409 });
  const script = dashboardUrl('/widget.js').replace(/'/g, '');
  const php = `<?php
/**
 * Plugin Name: Fulcra Chat
 * Description: Adds your Fulcra chat assistant to every page of this website.
 * Version: 1.0.0
 * Author: Fulcra
 * License: GPLv2 or later
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_footer', function () {
    echo '<script async src="' . esc_url('${script}') . '" data-fulcra="' . esc_attr('${chat.key}') . '"></script>';
});
`;
  const zip = zipFiles([{ name: 'fulcra-chat/fulcra-chat.php', content: php }]);
  return new Response(new Blob([new Uint8Array(zip)]), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="fulcra-chat.zip"',
      'cache-control': 'no-store',
    },
  });
}
