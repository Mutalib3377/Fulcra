import 'server-only';
import { koboToNairaInput, type ProductWithVariants } from '@fulcra/core';
import { withUrls } from '@/lib/images';
import type { ProductFormValues } from './form-types';

/** Turns a saved product into form values (server side, so photo URLs can be built). */
export function toFormValues({ product, variants }: ProductWithVariants): ProductFormValues {
  const simple = variants.length === 1 && variants[0]!.isDefault;
  const defaultVariant = simple ? variants[0]! : undefined;
  return {
    name: product.name,
    description: product.description,
    category: product.category ?? '',
    photos: product.photos.map(withUrls),
    retailPrice: koboToNairaInput(product.retailPrice),
    wholesaleEnabled: product.wholesalePrice !== null,
    wholesalePrice: koboToNairaInput(product.wholesalePrice),
    wholesaleMinQty: product.wholesaleMinQty?.toString() ?? '',
    minPrice: koboToNairaInput(product.minPrice),
    lowStockThreshold: String(product.lowStockThreshold),
    isActive: product.isActive,
    isFeatured: product.isFeatured,
    hasOptions: !simple,
    stock: defaultVariant ? String(defaultVariant.stock) : '',
    sku: defaultVariant?.sku ?? '',
    variants: simple
      ? []
      : variants.map((v) => ({
          id: v.id,
          size: v.size ?? '',
          colour: v.colour ?? '',
          stock: String(v.stock),
          price: koboToNairaInput(v.priceOverride),
          sku: v.sku ?? '',
        })),
  };
}
