import { APP_NAME } from '@fulcra/config';
import { Button } from '@fulcra/ui';

// Placeholder. The real landing page with pricing and sign-up is built in L1.
export default function MarketingHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold tracking-wide text-primary uppercase">{APP_NAME}</p>
      <h1 className="text-3xl font-bold sm:text-4xl">
        Run your business like you have three staff, without paying three salaries.
      </h1>
      <p className="text-lg text-muted-foreground">
        An AI sales assistant that answers customers, takes orders and confirms payments on
        WhatsApp, Instagram and your website.
      </p>
      <div>
        <Button size="lg" disabled>
          Coming soon
        </Button>
      </div>
    </main>
  );
}
