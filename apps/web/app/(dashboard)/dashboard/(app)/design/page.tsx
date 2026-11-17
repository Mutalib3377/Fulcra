import { formatNaira } from '@fulcra/config';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FieldMessage,
  Input,
  Label,
  LoadingState,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@fulcra/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { InteractiveSamples } from './interactive';

export const metadata: Metadata = { title: 'Design system' };

const colours = [
  ['background', 'bg-background'],
  ['card', 'bg-card'],
  ['muted', 'bg-muted'],
  ['border', 'bg-border'],
  ['foreground', 'bg-foreground'],
  ['muted-foreground', 'bg-muted-foreground'],
  ['primary', 'bg-primary'],
  ['primary-soft', 'bg-primary-soft'],
  ['accent', 'bg-accent'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['danger', 'bg-danger'],
  ['info', 'bg-info'],
] as const;

const typeScale = [
  ['7xl', 'text-7xl font-semibold', 'Sell while you sleep'],
  ['5xl', 'text-5xl font-semibold', 'Sell while you sleep'],
  ['3xl', 'text-3xl font-semibold', 'Page title'],
  ['2xl', 'text-2xl font-semibold', 'Section title'],
  ['xl', 'text-xl font-semibold', 'Sheet title'],
  ['lg', 'text-lg font-semibold', 'Card title'],
  ['base', 'text-base', 'Body text. Plain, friendly words for busy sellers.'],
  ['sm', 'text-sm text-muted-foreground', 'Secondary text and help under fields.'],
  ['xs', 'text-xs text-muted-foreground', 'Captions and tiny labels'],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Every design token and component on one page, in light and dark (follows the phone).
 * Hidden in production unless SHOW_DESIGN_PAGE=true.
 */
export default function DesignPage() {
  if (process.env.NODE_ENV === 'production' && process.env.SHOW_DESIGN_PAGE !== 'true') {
    notFound();
  }
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">Fulcra design system</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Quiet, clear, fast.</h1>
        <p className="max-w-xl text-muted-foreground">
          One typeface, generous space, and colour only where it means something. Green is for
          actions and money. Switch your phone to dark mode to see the dark theme.
        </p>
      </div>

      <Section title="Colour">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
          {colours.map(([name, className]) => (
            <div key={name} className="flex flex-col gap-2">
              <div className={`h-16 rounded-lg border ${className}`} />
              <p className="text-xs text-muted-foreground">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <Card>
          <CardContent className="flex flex-col gap-5 pt-5 sm:pt-6">
            {typeScale.map(([name, className, sample]) => (
              <div key={name} className="flex flex-col gap-1 border-b pb-5 last:border-0 last:pb-0">
                <span className="text-xs text-subtle-foreground">{name}</span>
                <p className={`${className} break-words`}>{sample}</p>
              </div>
            ))}
            <p className="text-2xl font-semibold tabular-nums">
              {formatNaira(1_500_000)} · {formatNaira(25_000_000)}
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus aria-hidden /> New order
          </Button>
          <Button variant="tinted">Tinted</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="link">Link</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Growth</Badge>
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Awaiting payment</Badge>
          <Badge tone="danger">Sold out</Badge>
          <Badge tone="info">Dispatched</Badge>
        </div>
      </Section>

      <Section title="Fields">
        <Card>
          <CardContent className="grid gap-5 pt-5 sm:grid-cols-2 sm:pt-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-name">Product name</Label>
              <Input id="ds-name" placeholder="Ankara midi dress" />
              <FieldMessage>Customers see this name.</FieldMessage>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-price">Price</Label>
              <Input id="ds-price" aria-invalid defaultValue="abc" />
              <FieldMessage error>Enter a price in naira, like 15000.</FieldMessage>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-category">Category</Label>
              <NativeSelect id="ds-category" defaultValue="fashion">
                <option value="fashion">Fashion</option>
                <option value="beauty">Beauty</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-notes">Notes</Label>
              <Textarea id="ds-notes" rows={2} placeholder="Anything the assistant should know" />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Controls">
        <InteractiveSamples />
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s sales</CardTitle>
              <CardDescription>Paid orders since midnight.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-semibold tabular-nums">{formatNaira(8_750_000)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Loading</CardTitle>
              <CardDescription>Skeletons keep the layout still while data arrives.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-3/4" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <EmptyState
              title="No orders yet"
              description="New orders show here."
              className="py-10"
            />
          </Card>
          <Card>
            <ErrorState className="py-10" />
          </Card>
          <Card>
            <LoadingState className="py-10" />
          </Card>
        </div>
      </Section>
    </div>
  );
}
