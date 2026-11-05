'use client';

import { variantCombinations, variantLabel } from '@fulcra/core/rules';
import { Button, FieldMessage, Input, Label } from '@fulcra/ui';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import {
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import type { ProductFormValues, VariantFormValues } from './form-types';

type Props = {
  control: Control<ProductFormValues>;
  register: UseFormRegister<ProductFormValues>;
  errors: FieldErrors<ProductFormValues>;
};

const key = (v: { size: string | null; colour: string | null }) =>
  `${(v.size ?? '').trim().toLowerCase()}|${(v.colour ?? '').trim().toLowerCase()}`;

const splitList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Sizes × colours generator plus a table of options with stock, price and SKU. */
export function OptionsEditor({ control, register, errors }: Props) {
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'variants',
    keyName: 'key',
  });
  const [sizes, setSizes] = useState('');
  const [colours, setColours] = useState('');

  const generate = () => {
    const combos = variantCombinations(splitList(sizes), splitList(colours));
    if (combos.length === 0) return;
    // Keep rows that already exist (and their stock); add the missing combinations.
    const existing = new Map(fields.map((f) => [key({ size: f.size, colour: f.colour }), f]));
    const next: VariantFormValues[] = fields.map(({ key: _k, ...f }) => f);
    for (const combo of combos) {
      if (!existing.has(key(combo))) {
        next.push({
          size: combo.size ?? '',
          colour: combo.colour ?? '',
          stock: '',
          price: '',
          sku: '',
        });
      }
    }
    replace(next);
    setSizes('');
    setColours('');
  };

  const variantErrors = errors.variants;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md bg-muted/60 p-3">
        <p className="text-sm font-medium">
          Quick add: type sizes and colours, then create every combination.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="gen-sizes">Sizes</Label>
            <Input
              id="gen-sizes"
              value={sizes}
              onChange={(e) => setSizes(e.target.value)}
              placeholder="S, M, L, XL"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gen-colours">Colours</Label>
            <Input
              id="gen-colours"
              value={colours}
              onChange={(e) => setColours(e.target.value)}
              placeholder="Red, Black"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={generate}
          disabled={!sizes.trim() && !colours.trim()}
        >
          <Wand2 aria-hidden /> Create options
        </Button>
      </div>

      {fields.length > 0 && (
        <ul className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const rowErrors = Array.isArray(variantErrors) ? variantErrors[index] : undefined;
            const message =
              rowErrors?.size?.message ??
              rowErrors?.stock?.message ??
              rowErrors?.price?.message ??
              rowErrors?.sku?.message;
            return (
              <li key={field.key} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {variantLabel({ size: field.size || null, colour: field.colour || null })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Input
                    aria-label="Size"
                    placeholder="Size"
                    {...register(`variants.${index}.size`)}
                  />
                  <Input
                    aria-label="Colour"
                    placeholder="Colour"
                    {...register(`variants.${index}.colour`)}
                  />
                  <Input
                    aria-label="Stock"
                    placeholder="Stock"
                    inputMode="numeric"
                    aria-invalid={!!rowErrors?.stock}
                    {...register(`variants.${index}.stock`)}
                  />
                  <Input
                    aria-label="Price (optional)"
                    placeholder="Price (optional)"
                    inputMode="decimal"
                    aria-invalid={!!rowErrors?.price}
                    {...register(`variants.${index}.price`)}
                  />
                  <Input
                    aria-label="SKU (optional)"
                    placeholder="SKU (optional)"
                    className="col-span-2 sm:col-span-1"
                    {...register(`variants.${index}.sku`)}
                  />
                </div>
                {message && <FieldMessage error>{message}</FieldMessage>}
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="ghost"
        className="justify-start"
        onClick={() => append({ size: '', colour: '', stock: '', price: '', sku: '' })}
      >
        <Plus aria-hidden /> Add one option
      </Button>
      {variantErrors?.root?.message ||
      (typeof variantErrors?.message === 'string' && variantErrors.message) ? (
        <FieldMessage error>{variantErrors?.root?.message ?? variantErrors?.message}</FieldMessage>
      ) : (
        <FieldMessage>Leave price empty to use the product price.</FieldMessage>
      )}
    </div>
  );
}
