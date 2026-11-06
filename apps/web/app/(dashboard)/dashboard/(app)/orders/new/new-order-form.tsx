'use client';

import { formatNaira } from '@fulcra/config';
import { nairaToKobo, normalizePhoneNumber, unitPriceFor, variantLabel } from '@fulcra/core/rules';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldMessage,
  Input,
  Label,
  NativeSelect,
  Textarea,
  cn,
} from '@fulcra/ui';
import { ImageIcon, Minus, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { goTo } from '@/lib/navigation';
import { createOrderAction } from '../actions';

type Variant = {
  id: string;
  size: string | null;
  colour: string | null;
  isDefault: boolean;
  stock: number;
  priceOverride: number | null;
};
type Product = {
  id: string;
  name: string;
  isActive: boolean;
  thumb: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  variants: Variant[];
};
type Customer = {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  deliveryZoneId: string | null;
};
type Zone = { id: string; name: string; fee: number; estimatedTime: string };
type Line = { variantId: string; quantity: number };

type Props = {
  products: Product[];
  customers: Customer[];
  zones: Zone[];
  preselectedCustomerId: string | null;
};

const matches = (text: string, query: string) =>
  text.toLowerCase().includes(query.trim().toLowerCase());

export function NewOrderForm({ products, customers, zones, preselectedCustomerId }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  // Customer
  const [customerId, setCustomerId] = useState<string | null>(
    customers.some((c) => c.id === preselectedCustomerId) ? preselectedCustomerId : null,
  );
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const customer = customers.find((c) => c.id === customerId) ?? null;

  // Items
  const [lines, setLines] = useState<Line[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [choosing, setChoosing] = useState<Product | null>(null);
  const variantIndex = useMemo(() => {
    const map = new Map<string, { product: Product; variant: Variant }>();
    for (const product of products)
      for (const variant of product.variants) map.set(variant.id, { product, variant });
    return map;
  }, [products]);

  // Delivery
  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>(
    zones.length ? 'delivery' : 'pickup',
  );
  const [zoneId, setZoneId] = useState<string>(customer?.deliveryZoneId ?? zones[0]?.id ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');

  const pickCustomer = (c: Customer) => {
    setCustomerId(c.id);
    setNewCustomer(null);
    setCustomerQuery('');
    if (c.address) setAddress(c.address);
    if (c.deliveryZoneId && zones.some((z) => z.id === c.deliveryZoneId))
      setZoneId(c.deliveryZoneId);
  };

  const addVariant = (variantId: string) => {
    setLines((current) => {
      const existing = current.find((l) => l.variantId === variantId);
      return existing
        ? current.map((l) => (l.variantId === variantId ? { ...l, quantity: l.quantity + 1 } : l))
        : [...current, { variantId, quantity: 1 }];
    });
    setChoosing(null);
    setProductQuery('');
  };

  const setQuantity = (variantId: string, quantity: number) =>
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.variantId !== variantId)
        : current.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)),
    );

  // Totals (the server recalculates from the database; this is a preview).
  const priced = lines.flatMap((line) => {
    const entry = variantIndex.get(line.variantId);
    if (!entry) return [];
    const { unitPrice, isWholesale } = unitPriceFor(entry.product, entry.variant, line.quantity);
    return [{ ...line, ...entry, unitPrice, isWholesale, total: unitPrice * line.quantity }];
  });
  const subtotal = priced.reduce((sum, l) => sum + l.total, 0);
  const zone = zones.find((z) => z.id === zoneId);
  const deliveryFee = fulfilment === 'delivery' ? (zone?.fee ?? 0) : 0;
  const discountKobo = discount.trim() ? nairaToKobo(discount) : 0;
  const total = subtotal + deliveryFee - (discountKobo ?? 0);

  const customerMatches = customerQuery.trim()
    ? customers
        .filter(
          (c) =>
            matches(c.name, customerQuery) ||
            (c.phone ?? '').includes(customerQuery.replace(/\D/g, '').replace(/^0/, '')),
        )
        .slice(0, 8)
    : [];
  const productMatches = productQuery.trim()
    ? products.filter((p) => matches(p.name, productQuery)).slice(0, 10)
    : products.slice(0, 10);

  const submit = () => {
    setError(null);
    if (!customer && !newCustomer)
      return setError({ message: 'Choose a customer or add a new one.', field: 'customer' });
    if (newCustomer && !newCustomer.name.trim() && !newCustomer.phone.trim()) {
      return setError({ message: 'Enter the customer’s name or phone number.', field: 'customer' });
    }
    if (newCustomer?.phone.trim() && !normalizePhoneNumber(newCustomer.phone)) {
      return setError({
        message: 'Enter a valid phone number, e.g. 0803 123 4567.',
        field: 'customer',
      });
    }
    if (lines.length === 0) return setError({ message: 'Add at least one item.', field: 'items' });
    if (discountKobo === null)
      return setError({ message: 'Enter the discount as an amount, e.g. 500.', field: 'discount' });
    if (total < 0)
      return setError({
        message: 'The discount is bigger than the order total.',
        field: 'discount',
      });

    startTransition(async () => {
      const result = await createOrderAction({
        customer: customer
          ? { id: customer.id }
          : { name: newCustomer!.name, phone: newCustomer!.phone || null },
        items: lines,
        fulfilment,
        deliveryZoneId: fulfilment === 'delivery' ? zoneId || null : null,
        deliveryAddress: fulfilment === 'delivery' ? address : '',
        discount: discountKobo ?? 0,
        notes,
      });
      if (result.ok) goTo(result.data.redirectTo);
      else
        setError({
          message: result.message,
          ...(result.field ? { field: result.field.split('.')[0] } : {}),
        });
    });
  };

  const fieldError = (field: string) =>
    error?.field === field ? <FieldMessage error>{error.message}</FieldMessage> : null;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Customer">
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{customer.name || 'No name'}</p>
              <p className="text-sm text-muted-foreground">{customer.phone ?? 'No phone'}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCustomerId(null)}
              aria-label="Change customer"
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : newCustomer ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-name">Name</Label>
                <Input
                  id="new-name"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-phone">Phone (optional)</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="0803 123 4567"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                />
              </div>
            </div>
            <FieldMessage>
              If this phone number is already saved, we use that customer.
            </FieldMessage>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setNewCustomer(null)}
            >
              Choose an existing customer instead
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Find customer"
                placeholder="Search name or phone"
                className="pl-9"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
            </div>
            {customerMatches.length > 0 && (
              <ul className="flex flex-col divide-y rounded-md border">
                {customerMatches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-muted"
                    >
                      <span className="font-medium">{c.name || 'No name'}</span>
                      <span className="text-sm text-muted-foreground">{c.phone ?? 'No phone'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setNewCustomer({
                  name: customerQuery.match(/\d/) ? '' : customerQuery,
                  phone: customerQuery.match(/\d/) ? customerQuery : '',
                })
              }
            >
              <UserPlus aria-hidden /> New customer
            </Button>
          </div>
        )}
        {fieldError('customer')}
      </Section>

      <Section title="Items">
        {priced.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {priced.map((l) => {
              const label = l.variant.isDefault ? '' : variantLabel(l.variant);
              const over = l.quantity > l.variant.stock;
              return (
                <li key={l.variantId} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {label ? `${label} · ` : ''}
                        {formatNaira(l.unitPrice)} each{l.isWholesale ? ' (wholesale)' : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold">{formatNaira(l.total)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="One less"
                      onClick={() => setQuantity(l.variantId, l.quantity - 1)}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <Input
                      aria-label={`Quantity of ${l.product.name}`}
                      inputMode="numeric"
                      className="w-16 text-center"
                      value={l.quantity}
                      onChange={(e) =>
                        setQuantity(l.variantId, Number(e.target.value.replace(/\D/g, '')) || 0)
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="One more"
                      onClick={() => setQuantity(l.variantId, l.quantity + 1)}
                    >
                      <Plus aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${l.product.name}`}
                      onClick={() => setQuantity(l.variantId, 0)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  {over && <FieldMessage error>Only {l.variant.stock} in stock.</FieldMessage>}
                </li>
              );
            })}
          </ul>
        )}

        {choosing ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{choosing.name}: choose an option</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChoosing(null)}
                aria-label="Close"
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {choosing.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={v.stock === 0}
                  onClick={() => addVariant(v.id)}
                  className="flex flex-col rounded-md border px-3 py-2 text-left disabled:opacity-40"
                >
                  <span className="font-medium">{variantLabel(v)}</span>
                  <span className="text-xs text-muted-foreground">
                    {v.stock === 0 ? 'Out of stock' : `${v.stock} in stock`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Find product"
                placeholder="Search products"
                className="pl-9"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
              />
            </div>
            {products.length === 0 ? (
              <FieldMessage>
                No products yet.{' '}
                <Link href="/catalog/new" className="text-primary underline">
                  Add a product
                </Link>{' '}
                first.
              </FieldMessage>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {productMatches.map((p) => {
                  const stock = p.variants.reduce((sum, v) => sum + v.stock, 0);
                  const single =
                    p.variants.length === 1 && p.variants[0]!.isDefault ? p.variants[0]! : null;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={stock === 0}
                        onClick={() => (single ? addVariant(single.id) : setChoosing(p))}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted disabled:opacity-40"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                          {p.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                            <img src={p.thumb} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatNaira(p.retailPrice)} ·{' '}
                            {stock === 0 ? 'Out of stock' : `${stock} in stock`}
                          </span>
                        </span>
                        {!p.isActive && <Badge tone="neutral">Hidden</Badge>}
                        <Plus className="size-4 shrink-0 text-primary" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {fieldError('items')}
      </Section>

      <Section title="Delivery">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Delivery or pickup">
          {(['delivery', 'pickup'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={fulfilment === value}
              disabled={value === 'delivery' && zones.length === 0}
              onClick={() => setFulfilment(value)}
              className={cn(
                'h-11 rounded-md border font-medium disabled:opacity-40',
                fulfilment === value
                  ? 'border-primary bg-secondary text-primary'
                  : 'border-input bg-card',
              )}
            >
              {value === 'delivery' ? 'Delivery' : 'Pickup'}
            </button>
          ))}
        </div>
        {zones.length === 0 && (
          <FieldMessage>
            To deliver, first{' '}
            <Link href="/settings/delivery" className="text-primary underline">
              add your delivery areas
            </Link>
            .
          </FieldMessage>
        )}
        {fulfilment === 'delivery' && zones.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone">Area</Label>
              <NativeSelect id="zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} · {formatNaira(z.fee)}
                    {z.estimatedTime ? ` · ${z.estimatedTime}` : ''}
                  </option>
                ))}
              </NativeSelect>
              {fieldError('deliveryZoneId')}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                rows={2}
                placeholder="House number, street, landmark"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              {fieldError('deliveryAddress')}
            </div>
          </>
        )}
      </Section>

      <Section title="Extras">
        <div className="flex flex-col gap-2">
          <Label htmlFor="discount">Discount (₦, optional)</Label>
          <Input
            id="discount"
            inputMode="decimal"
            placeholder="0"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="max-w-40"
          />
          {fieldError('discount')}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Note (optional)</Label>
          <Textarea
            id="notes"
            rows={2}
            placeholder="e.g. Gift wrap, call before delivery"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Section>

      <Card>
        <CardContent className="flex flex-col gap-1 pt-4 sm:pt-6">
          <Row label="Items" value={formatNaira(subtotal)} />
          {fulfilment === 'delivery' && <Row label="Delivery" value={formatNaira(deliveryFee)} />}
          {(discountKobo ?? 0) > 0 && (
            <Row label="Discount" value={`−${formatNaira(discountKobo ?? 0)}`} />
          )}
          <div className="mt-1 flex justify-between border-t pt-2 text-lg font-bold">
            <span>Total</span>
            <span>{formatNaira(Math.max(total, 0))}</span>
          </div>
        </CardContent>
      </Card>

      {error &&
        !['customer', 'items', 'deliveryZoneId', 'deliveryAddress', 'discount'].includes(
          error.field ?? '',
        ) && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error.message}
          </p>
        )}
      {error &&
        ['customer', 'items', 'deliveryZoneId', 'deliveryAddress', 'discount'].includes(
          error.field ?? '',
        ) && (
          <p role="alert" className="text-sm text-danger">
            Please check the section marked in red.
          </p>
        )}

      <div className="sticky bottom-16 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
        <Button type="button" size="lg" fullWidth loading={pending} onClick={submit}>
          Create order · {formatNaira(Math.max(total, 0))}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
