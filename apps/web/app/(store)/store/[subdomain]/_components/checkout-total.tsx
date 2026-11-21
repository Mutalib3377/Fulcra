'use client';

import { formatNaira } from '@fulcra/config';
import { useEffect, useState } from 'react';

/**
 * Subtotal, delivery and total on the checkout page. Without JavaScript it shows the subtotal
 * and says delivery is added for the chosen area (Paystack shows the final amount); with it,
 * the total follows the shopper's choice. The server works the real total out again.
 */
export function CheckoutTotal({ subtotal }: { subtotal: number }) {
  const [delivery, setDelivery] = useState<number | null>(null);

  useEffect(() => {
    const form = document.getElementById('checkout') as HTMLFormElement | null;
    if (!form) return;
    const update = () => {
      const fulfilment = (form.elements.namedItem('fulfilment') as RadioNodeList | null)?.value;
      if (fulfilment === 'pickup') return setDelivery(0);
      const select = form.elements.namedItem('deliveryZoneId') as HTMLSelectElement | null;
      const fee = Number(select?.selectedOptions[0]?.dataset.fee);
      setDelivery(Number.isFinite(fee) && select?.value ? fee : null);
    };
    update();
    form.addEventListener('change', update);
    return () => form.removeEventListener('change', update);
  }, []);

  return (
    <dl className="flex flex-col gap-1.5 border-t border-black/10 pt-3 text-sm">
      <div className="flex justify-between">
        <dt>Items</dt>
        <dd>{formatNaira(subtotal)}</dd>
      </div>
      <div className="flex justify-between">
        <dt>Delivery</dt>
        <dd>
          {delivery === null ? 'For your area' : delivery === 0 ? 'Free' : formatNaira(delivery)}
        </dd>
      </div>
      <div className="flex justify-between pt-1.5 text-base font-semibold">
        <dt>Total</dt>
        <dd>
          {formatNaira(subtotal + (delivery ?? 0))}
          {delivery === null ? ' + delivery' : ''}
        </dd>
      </div>
    </dl>
  );
}
