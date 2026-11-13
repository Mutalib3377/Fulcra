import { getBusiness, getWebChat, widgetScriptTag } from '@fulcra/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { getDashboardContext } from '@/lib/auth';
import { dashboardUrl, storeUrl } from '@/lib/urls';
import { setWebChatAction } from './actions';
import { CopyCode } from './copy-code';

export const metadata: Metadata = { title: 'Website chat' };

export default async function WebsiteChatPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Website chat is for the owner and staff.</p>;
  }
  const [chat, business] = await Promise.all([getWebChat(actor), getBusiness(actor)]);
  const isOwner = membership.role === 'owner';
  const on = chat?.enabled ?? false;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Website chat</h1>
        <p className="text-muted-foreground">
          A chat bubble on your website. Visitors chat with your assistant, and the chats appear in
          your inbox. It also shows on your Fulcra store.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{on ? 'Website chat is on' : 'Website chat is off'}</CardTitle>
          <CardDescription>
            {on
              ? 'Visitors can chat with you from your website and your store.'
              : 'Turn it on to get the code for your website.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isOwner ? (
            <ActionButton
              variant={on ? 'outline' : 'primary'}
              action={setWebChatAction.bind(null, !on)}
              redirectTo="/settings/website-chat"
              className="self-start"
            >
              {on ? 'Turn off' : 'Turn on website chat'}
            </ActionButton>
          ) : (
            <p className="text-sm text-muted-foreground">Only the owner can turn it on or off.</p>
          )}
          {on && (
            <a
              href={storeUrl(business.subdomain)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              See it on your store
            </a>
          )}
        </CardContent>
      </Card>

      {on && chat && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add it to your website</CardTitle>
              <CardDescription>
                Paste this line just before the closing &lt;/body&gt; tag of your website, or in
                your website builder’s “custom code” box. It loads after your page, so it never
                slows your site down.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CopyCode code={widgetScriptTag(dashboardUrl('/widget.js'), chat.key)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">WordPress</CardTitle>
              <CardDescription>
                Download the plugin (your code is already inside), then in WordPress go to Plugins →
                Add New → Upload Plugin, choose the file and press Activate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="/api/widget/wordpress-plugin"
                className="inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                Download WordPress plugin
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where it can be used</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {business.websiteUrl ? (
                <>
                  Only on <strong>{business.websiteUrl.replace(/^https?:\/\//, '')}</strong> and
                  your Fulcra store, so nobody can put your chat on another site.
                </>
              ) : (
                <>
                  Any website can use this code. To allow only yours, add your website address in{' '}
                  <Link href="/settings/store" className="text-primary underline-offset-4">
                    Store or website
                  </Link>
                  .
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
