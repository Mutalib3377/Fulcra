'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { nairaToKobo, type ProductInput } from '@fulcra/core/rules';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldMessage,
  Input,
  Label,
  Switch,
  Textarea,
} from '@fulcra/ui';
import { CheckCircle2, Copy, Trash2 } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { z } from 'zod';
import { goTo } from '@/lib/navigation';
import {
  archiveProductAction,
  createProductAction,
  duplicateProductAction,
  updateProductAction,
} from './actions';
import { emptyProductForm, type ProductFormValues } from './form-types';
import { OptionsEditor } from './options-editor';
import { PhotoPicker } from './photo-picker';

const money = (required: boolean, message = 'Enter an amount, e.g. 15000.') =>
  z
    .string()
    .trim()
    .refine((v) => (v === '' ? !required : nairaToKobo(v) !== null), message);
const wholeNumber = (message = 'Enter a whole number.') =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), message);

const formSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the product name.').max(120),
    description: z.string().max(2000, 'Keep the description under 2,000 characters.'),
    category: z.string().max(60),
    photos: z.array(z.any()),
    retailPrice: money(true, 'Enter the price, e.g. 15000.'),
    wholesaleEnabled: z.boolean(),
    wholesalePrice: money(false),
    wholesaleMinQty: wholeNumber(),
    minPrice: money(false),
    lowStockThreshold: wholeNumber(),
    isActive: z.boolean(),
    isFeatured: z.boolean(),
    hasOptions: z.boolean(),
    stock: wholeNumber('Enter how many you have, e.g. 10.'),
    sku: z.string().max(60),
    variants: z.array(
      z.object({
        id: z.string().optional(),
        size: z.string().max(40),
        colour: z.string().max(40),
        stock: wholeNumber('Stock must be a whole number.'),
        price: money(false, 'Enter a price or leave it empty.'),
        sku: z.string().max(60),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.wholesaleEnabled) {
      if (!v.wholesalePrice)
        ctx.addIssue({
          code: 'custom',
          path: ['wholesalePrice'],
          message: 'Enter the wholesale price.',
        });
      if (!v.wholesaleMinQty || Number(v.wholesaleMinQty) < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['wholesaleMinQty'],
          message: 'Wholesale starts from at least 2 items.',
        });
      }
    }
    if (v.hasOptions) {
      if (v.variants.length === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['variants'],
          message: 'Add at least one size or colour.',
        });
      v.variants.forEach((variant, i) => {
        if (!variant.size.trim() && !variant.colour.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: ['variants', i, 'size'],
            message: 'Enter a size or a colour.',
          });
        }
      });
    }
  });

const toNumber = (v: string) => (v.trim() === '' ? 0 : Number(v));
const toKobo = (v: string) => (v.trim() === '' ? null : nairaToKobo(v));

function toInput(v: ProductFormValues): ProductInput {
  return {
    name: v.name,
    description: v.description,
    category: v.category,
    photos: v.photos.map((p) => p.image),
    retailPrice: toKobo(v.retailPrice) ?? 0,
    wholesalePrice: v.wholesaleEnabled ? toKobo(v.wholesalePrice) : null,
    wholesaleMinQty: v.wholesaleEnabled && v.wholesaleMinQty ? Number(v.wholesaleMinQty) : null,
    minPrice: toKobo(v.minPrice),
    lowStockThreshold: v.lowStockThreshold === '' ? 3 : Number(v.lowStockThreshold),
    isActive: v.isActive,
    isFeatured: v.isFeatured,
    options: v.hasOptions
      ? {
          kind: 'variants',
          variants: v.variants.map((variant) => ({
            ...(variant.id ? { id: variant.id } : {}),
            size: variant.size,
            colour: variant.colour,
            sku: variant.sku,
            stock: toNumber(variant.stock),
            priceOverride: toKobo(variant.price),
          })),
        }
      : { kind: 'simple', stock: toNumber(v.stock), sku: v.sku },
  };
}

/** Server error field ("options.variants.2.size") → form field ("variants.2.size"). */
function formField(
  field: string | undefined,
  values: ProductFormValues,
): FieldPath<ProductFormValues> | null {
  if (!field) return null;
  if (field.startsWith('options.variants.'))
    return field.replace('options.', '') as FieldPath<ProductFormValues>;
  if (field === 'sku') return values.hasOptions ? null : 'sku';
  if (field === 'options') return null;
  return field in values ? (field as FieldPath<ProductFormValues>) : null;
}

type Props = {
  mode: 'create' | 'edit';
  productId?: string;
  initial?: ProductFormValues;
  categories: string[];
};

export function ProductForm({ mode, productId, initial, categories }: Props) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(formSchema) as never,
    defaultValues: initial ?? emptyProductForm(),
  });
  const { register, control, formState } = form;
  const { errors } = formState;
  const hasOptions = useWatch({ control, name: 'hasOptions' });
  const wholesaleEnabled = useWatch({ control, name: 'wholesaleEnabled' });

  const showResult = (
    result: { ok: false; message: string; field?: string },
    values: ProductFormValues,
  ) => {
    const field = formField(result.field, values);
    if (field) form.setError(field, { message: result.message }, { shouldFocus: true });
    else setFormError(result.message);
  };

  const save = (addAnother: boolean) =>
    form.handleSubmit((values) =>
      startTransition(async () => {
        setFormError(null);
        setNotice(null);
        const input = toInput(values);
        if (mode === 'create') {
          const result = await createProductAction(input);
          if (!result.ok) return showResult(result, values);
          if (addAnother) {
            form.reset(emptyProductForm(values.category));
            setNotice(`"${values.name}" saved. Add the next one.`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            goTo('/catalog');
          }
        } else if (productId) {
          const result = await updateProductAction(productId, input);
          if (!result.ok) return showResult(result, values);
          form.reset(result.data.values);
          setNotice('Changes saved.');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }),
    )();

  const runAndGo = (
    action: () => Promise<
      { ok: true; data: { redirectTo: string } } | { ok: false; message: string }
    >,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) goTo(result.data.redirectTo);
      else setFormError(result.message);
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {notice}
        </p>
      )}

      <Section title="Photos">
        <Controller
          control={control}
          name="photos"
          render={({ field }) => <PhotoPicker value={field.value} onChange={field.onChange} />}
        />
      </Section>

      <Section title="Details">
        <Field label="Product name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            placeholder="e.g. Ankara wrap dress"
            aria-invalid={!!errors.name}
            {...register('name')}
          />
        </Field>
        <Field
          label="Description (optional)"
          htmlFor="description"
          error={errors.description?.message}
          hint="Material, fit, what's included. The assistant uses this to answer questions."
        >
          <Textarea id="description" rows={3} {...register('description')} />
        </Field>
        <Field label="Category (optional)" htmlFor="category" error={errors.category?.message}>
          <Input
            id="category"
            list="category-suggestions"
            placeholder="e.g. Dresses"
            autoComplete="off"
            {...register('category')}
          />
          <datalist id="category-suggestions">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </Section>

      <Section title="Price">
        <Field label="Price" htmlFor="retailPrice" error={errors.retailPrice?.message}>
          <NairaInput
            id="retailPrice"
            invalid={!!errors.retailPrice}
            {...register('retailPrice')}
          />
        </Field>
        <ToggleRow control={control} name="wholesaleEnabled" label="I also sell wholesale" />
        {wholesaleEnabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Wholesale price (each)"
              htmlFor="wholesalePrice"
              error={errors.wholesalePrice?.message}
            >
              <NairaInput
                id="wholesalePrice"
                invalid={!!errors.wholesalePrice}
                {...register('wholesalePrice')}
              />
            </Field>
            <Field
              label="From how many items?"
              htmlFor="wholesaleMinQty"
              error={errors.wholesaleMinQty?.message}
            >
              <Input
                id="wholesaleMinQty"
                inputMode="numeric"
                placeholder="e.g. 6"
                aria-invalid={!!errors.wholesaleMinQty}
                {...register('wholesaleMinQty')}
              />
            </Field>
          </div>
        )}
        <Field
          label="Lowest price you accept (optional)"
          htmlFor="minPrice"
          error={errors.minPrice?.message}
          hint="Kept private. Used later when customers ask for a discount."
        >
          <NairaInput id="minPrice" invalid={!!errors.minPrice} {...register('minPrice')} />
        </Field>
      </Section>

      <Section title="Stock">
        <ToggleRow
          control={control}
          name="hasOptions"
          label="This product comes in different sizes or colours"
        />
        {hasOptions ? (
          <OptionsEditor control={control} register={register} errors={errors} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many do you have?" htmlFor="stock" error={errors.stock?.message}>
              <Input
                id="stock"
                inputMode="numeric"
                placeholder="e.g. 10"
                aria-invalid={!!errors.stock}
                {...register('stock')}
              />
            </Field>
            <Field
              label="SKU (optional)"
              htmlFor="sku"
              error={errors.sku?.message}
              hint="Your own product code, if you use one."
            >
              <Input id="sku" autoComplete="off" {...register('sku')} />
            </Field>
          </div>
        )}
        <Field
          label="Warn me when stock is at or below"
          htmlFor="lowStockThreshold"
          error={errors.lowStockThreshold?.message}
        >
          <Input
            id="lowStockThreshold"
            inputMode="numeric"
            className="max-w-32"
            {...register('lowStockThreshold')}
          />
        </Field>
      </Section>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <div className="flex flex-col gap-4">
            <ToggleRow control={control} name="isActive" label="Show this product to customers" />
            <ToggleRow control={control} name="isFeatured" label="Show on my store's home page" />
          </div>
        </CardContent>
      </Card>

      {formError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}
      {Object.keys(errors).length > 0 && !formError && (
        <p role="alert" className="text-sm text-danger">
          Please check the fields marked in red.
        </p>
      )}

      <div className="sticky bottom-16 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 sm:flex-row">
        <Button type="submit" size="lg" loading={pending} className="sm:flex-1">
          {mode === 'create' ? 'Save product' : 'Save changes'}
        </Button>
        {mode === 'create' && (
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={pending}
            onClick={() => save(true)}
            className="sm:flex-1"
          >
            Save and add another
          </Button>
        )}
      </div>

      {mode === 'edit' && productId && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => runAndGo(() => duplicateProductAction(productId))}
          >
            <Copy aria-hidden /> Duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  'Delete this product? It will be removed from your catalog. Past orders are not affected.',
                )
              ) {
                runAndGo(() => archiveProductAction(productId));
              }
            }}
          >
            <Trash2 aria-hidden /> Delete product
          </Button>
        </div>
      )}
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <FieldMessage error>{error}</FieldMessage>
      ) : hint ? (
        <FieldMessage>{hint}</FieldMessage>
      ) : null}
    </div>
  );
}

function NairaInput({ invalid, ...props }: React.ComponentProps<'input'> & { invalid: boolean }) {
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-md border border-input bg-card focus-within:outline-2 focus-within:outline-ring aria-invalid:border-danger"
      aria-invalid={invalid}
    >
      <span className="flex items-center bg-muted px-3 text-muted-foreground">₦</span>
      <input
        inputMode="decimal"
        placeholder="0"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none"
        {...props}
      />
    </div>
  );
}

function ToggleRow({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<ProductFormValues>>['control'];
  name: 'wholesaleEnabled' | 'hasOptions' | 'isActive' | 'isFeatured';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-base">{label}</span>
          <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={label} />
        </label>
      )}
    />
  );
}
