import { EmptyState } from '@fulcra/ui';
import type { Metadata } from 'next';

type StorePageProps = { params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
  const { subdomain } = await params;
  return { title: subdomain };
}

// Placeholder. In S1 this looks up the business by subdomain and shows a friendly 404 if none.
export default async function StoreHome({ params }: StorePageProps) {
  const { subdomain } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4">
      <EmptyState
        title={`Store: ${subdomain}`}
        description="This is a store placeholder. Products will show here once the storefront is built."
      />
    </main>
  );
}
