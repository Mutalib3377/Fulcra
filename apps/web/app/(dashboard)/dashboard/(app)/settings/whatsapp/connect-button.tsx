'use client';

import { Button } from '@fulcra/ui';
import { useEffect, useRef, useState } from 'react';
import { completeEmbeddedSignupAction } from './actions';

type FacebookSdk = {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
};
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/** Loads Facebook's script only when the button is first used (keeps the page light). */
function loadFacebook(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Facebook could not load. Check your connection.'));
    document.body.appendChild(script);
  });
}

/**
 * "Connect WhatsApp" (Meta Embedded Signup): the seller logs in with Facebook in a popup and
 * picks their business number. The popup reports the chosen number by a window message and
 * returns a code; we need both, in whichever order they arrive.
 */
export function ConnectWhatsAppButton({
  appId,
  configId,
  version,
  onConnected,
}: {
  appId: string;
  configId: string;
  version: string;
  onConnected: (connection: { id: string; displayName: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const got = useRef<{ code?: string; phoneNumberId?: string; businessAccountId?: string }>({});

  const finish = async () => {
    const { code, phoneNumberId, businessAccountId } = got.current;
    if (!code || !phoneNumberId || !businessAccountId) return;
    got.current = {};
    const result = await completeEmbeddedSignupAction({ code, phoneNumberId, businessAccountId });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onConnected(result.data);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      let host = '';
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'CANCEL' || data.event === 'ERROR') {
        setBusy(false);
        if (data.event === 'ERROR')
          setError('WhatsApp could not finish connecting. Please try again.');
        return;
      }
      if (data.data?.phone_number_id && data.data.waba_id) {
        got.current.phoneNumberId = data.data.phone_number_id;
        got.current.businessAccountId = data.data.waba_id;
        void finish();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `finish` only reads refs
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        loading={busy}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            const fb = await loadFacebook(appId, version);
            fb.login(
              (response) => {
                const code = response.authResponse?.code;
                if (!code) {
                  setBusy(false);
                  return;
                }
                got.current.code = code;
                void finish();
              },
              {
                config_id: configId,
                response_type: 'code',
                override_default_response_type: true,
                extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
              },
            );
          } catch (err) {
            setBusy(false);
            setError(err instanceof Error ? err.message : 'Facebook could not load.');
          }
        }}
      >
        Connect WhatsApp
      </Button>
      <p className="text-xs text-muted-foreground">
        You will log in with Facebook and choose your business WhatsApp number.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
