import type { UploadedImage } from '@/components/upload-image';

/** Product form values. Money and numbers are text while typing; converted on save. */
export type ProductFormValues = {
  name: string;
  description: string;
  category: string;
  photos: UploadedImage[];
  retailPrice: string;
  wholesaleEnabled: boolean;
  wholesalePrice: string;
  wholesaleMinQty: string;
  minPrice: string;
  lowStockThreshold: string;
  isActive: boolean;
  isFeatured: boolean;
  hasOptions: boolean;
  /** Used when the product has no sizes or colours. */
  stock: string;
  sku: string;
  variants: VariantFormValues[];
};

export type VariantFormValues = {
  id?: string;
  size: string;
  colour: string;
  stock: string;
  price: string;
  sku: string;
};

export function emptyProductForm(category = ''): ProductFormValues {
  return {
    name: '',
    description: '',
    category,
    photos: [],
    retailPrice: '',
    wholesaleEnabled: false,
    wholesalePrice: '',
    wholesaleMinQty: '',
    minPrice: '',
    lowStockThreshold: '3',
    isActive: true,
    isFeatured: false,
    hasOptions: false,
    stock: '',
    sku: '',
    variants: [],
  };
}
