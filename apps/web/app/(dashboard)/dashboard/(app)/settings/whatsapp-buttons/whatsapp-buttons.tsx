'use client';

import { formatNaira } from '@fulcra/config';
import {
  whatsAppButtonHtml,
  whatsAppFloatingHtml,
  whatsAppHelloMessage,
  whatsAppLink,
  whatsAppProductMessage,
} from '@fulcra/core/rules';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@fulcra/ui';
import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

type Product = { id: string; name: string; price: number; hasOptions: boolean };

const SHOWN_PRODUCTS = 30;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      window.prompt('Copy this:', text);
    }
  };
  return { copied, copy };
}

function CopyField({
  id,
  label,
  hint,
  value,
  copied,
  onCopy,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Textarea
        id={id}
        readOnly
        value={value}
        rows={value.length > 120 ? 4 : 2}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function WhatsAppButtons({
  businessName,
  whatsappNumber,
  colour,
  products,
}: {
  businessName: string;
  whatsappNumber: string;
  colour: string;
  products: Product[];
}) {
  const { copied, copy } = useCopy();
  const [label, setLabel] = useState('Chat with us on WhatsApp');
  const [message, setMessage] = useState(whatsAppHelloMessage(businessName));
  const [search, setSearch] = useState('');

  const link = whatsAppLink(whatsappNumber, message.trim() || undefined);
  const button = whatsAppButtonHtml({
    href: link,
    label: label.trim() || 'Chat on WhatsApp',
    colour,
  });
  const floating = whatsAppFloatingHtml({
    href: link,
    label: label.trim() || 'Chat on WhatsApp',
    colour,
  });
  const preview = `<!doctype html><html><body style="margin:0;padding:16px;font-family:system-ui;background:#f8fafc;min-height:140px">${button}${floating}</body></html>`;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(
      0,
      SHOWN_PRODUCTS,
    );
  }, [products, search]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>For your whole website</CardTitle>
          <CardDescription>A general &quot;chat with us&quot; button.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waLabel">Button text</Label>
            <Input
              id="waLabel"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waMessage">Message the customer sends</Label>
            <Textarea
              id="waMessage"
              value={message}
              maxLength={300}
              rows={2}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Preview</span>
            <iframe
              title="Button preview"
              srcDoc={preview}
              sandbox=""
              className="h-36 w-full rounded-md border bg-white"
            />
          </div>
          <CopyField
            id="waLink"
            label="Link"
            hint="For your Instagram bio, Facebook page, emails, flyers or a QR code."
            value={link}
            copied={copied === 'link'}
            onCopy={() => copy('link', link)}
          />
          <CopyField
            id="waButton"
            label="Button code"
            hint="Paste into your website where the button should appear."
            value={button}
            copied={copied === 'button'}
            onCopy={() => copy('button', button)}
          />
          <CopyField
            id="waFloating"
            label="Floating chat bubble code"
            hint="Paste once, before the end of your pages (</body>). A round button stays in the bottom-right corner."
            value={floating}
            copied={copied === 'floating'}
            onCopy={() => copy('floating', floating)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>For each product</CardTitle>
          <CardDescription>
            Put a button next to a product so the customer&apos;s message already says what they
            want.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add or import products to get a button for each one.
            </p>
          ) : (
            <>
              <Input
                aria-label="Search products"
                placeholder="Search products"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {matches.length === 0 && (
                <p className="text-sm text-muted-foreground">No products match.</p>
              )}
              <ul className="flex flex-col divide-y">
                {matches.map((product) => {
                  const href = whatsAppLink(
                    whatsappNumber,
                    whatsAppProductMessage({
                      productName: product.name,
                      price: product.price,
                      hasOptions: product.hasOptions,
                    }),
                  );
                  const code = whatsAppButtonHtml({ href, label: 'Order on WhatsApp', colour });
                  return (
                    <li
                      key={product.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {product.hasOptions ? 'From ' : ''}
                          {formatNaira(product.price)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => copy(`link-${product.id}`, href)}
                          aria-label={`Copy link for ${product.name}`}
                        >
                          {copied === `link-${product.id}` ? (
                            <Check aria-hidden />
                          ) : (
                            <Copy aria-hidden />
                          )}{' '}
                          Link
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => copy(`code-${product.id}`, code)}
                          aria-label={`Copy button code for ${product.name}`}
                        >
                          {copied === `code-${product.id}` ? (
                            <Check aria-hidden />
                          ) : (
                            <Copy aria-hidden />
                          )}{' '}
                          Button code
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {products.length > SHOWN_PRODUCTS && !search && (
                <p className="text-xs text-muted-foreground">
                  Showing {SHOWN_PRODUCTS} of {products.length}. Search to find others.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where to paste the code</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <details className="rounded-md bg-muted/60 px-3 py-2">
            <summary className="cursor-pointer font-medium">WordPress</summary>
            <p className="mt-2">
              Edit the page, add a <strong>Custom HTML</strong> block and paste the button code. For
              the floating bubble on every page, use a plugin such as &quot;WPCode&quot; and paste
              it in the footer section.
            </p>
          </details>
          <details className="rounded-md bg-muted/60 px-3 py-2">
            <summary className="cursor-pointer font-medium">Shopify</summary>
            <p className="mt-2">
              Online Store → Themes → Customize → add a <strong>Custom Liquid</strong> section and
              paste the button code. For the floating bubble: Themes → ⋯ → Edit code → theme.liquid,
              paste just before <code>&lt;/body&gt;</code>.
            </p>
          </details>
          <details className="rounded-md bg-muted/60 px-3 py-2">
            <summary className="cursor-pointer font-medium">Wix, Squarespace and others</summary>
            <p className="mt-2">
              Look for &quot;Embed code&quot;, &quot;Custom HTML&quot; or &quot;Code block&quot; and
              paste the button code. If your site builder doesn&apos;t allow code, use the link
              instead: make any button or text link point to it.
            </p>
          </details>
        </CardContent>
      </Card>
    </>
  );
}
