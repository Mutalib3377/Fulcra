'use client';

import type { CatalogSourceKind } from '@fulcra/core/rules';
import { Button, FieldMessage, Input, Label } from '@fulcra/ui';
import { useState, useTransition } from 'react';
import { goTo } from '@/lib/navigation';
import {
  connectWooAction,
  disconnectShopAction,
  startShopImportAction,
  startUrlImportAction,
} from './actions';

/** "Import products now" and "Disconnect" for a connected shop. */
export function ShopButtons({ kind }: { kind: CatalogSourceKind }) {
  const [error, setError] = useState<string | null>(null);
  const [importing, startImport] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          loading={importing}
          onClick={() =>
            startImport(async () => {
              setError(null);
              const result = await startShopImportAction(kind);
              if (result.ok) goTo(result.data.redirectTo);
              else setError(result.message);
            })
          }
        >
          Import products now
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={disconnecting}
          onClick={() => {
            if (
              !window.confirm(
                'Disconnect this shop? Products you already imported stay in your catalog.',
              )
            )
              return;
            startDisconnect(async () => {
              const result = await disconnectShopAction(kind);
              if (!result.ok) setError(result.message);
            });
          }}
        >
          Disconnect
        </Button>
      </div>
      {error && <FieldMessage role="alert">{error}</FieldMessage>}
    </div>
  );
}

/** WooCommerce: website address and read-only REST API keys. */
export function WooConnectForm({ defaultUrl }: { defaultUrl: string }) {
  const [values, setValues] = useState({
    shopUrl: defaultUrl,
    consumerKey: '',
    consumerSecret: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (field: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await connectWooAction(values);
          if (!result.ok) setError(result.message);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wooUrl">Website address</Label>
        <Input
          id="wooUrl"
          inputMode="url"
          placeholder="mystore.com"
          value={values.shopUrl}
          onChange={set('shopUrl')}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wooKey">Consumer key</Label>
        <Input
          id="wooKey"
          placeholder="ck_…"
          autoComplete="off"
          value={values.consumerKey}
          onChange={set('consumerKey')}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wooSecret">Consumer secret</Label>
        <Input
          id="wooSecret"
          type="password"
          placeholder="cs_…"
          autoComplete="off"
          value={values.consumerSecret}
          onChange={set('consumerSecret')}
          required
        />
      </div>
      {error && <FieldMessage role="alert">{error}</FieldMessage>}
      <Button type="submit" loading={pending} className="self-start">
        Connect WooCommerce
      </Button>
    </form>
  );
}

/** Website link: we read the products and show them for review. */
export function UrlImportForm({ defaultUrl }: { defaultUrl: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await startUrlImportAction(url);
          if (result.ok) goTo(result.data.redirectTo);
          else setError(result.message);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="siteUrl">Link to the page that lists your products</Label>
        <Input
          id="siteUrl"
          inputMode="url"
          placeholder="mystore.com/shop"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
      </div>
      {error && <FieldMessage role="alert">{error}</FieldMessage>}
      <Button type="submit" loading={pending} className="self-start">
        Read my website
      </Button>
    </form>
  );
}
