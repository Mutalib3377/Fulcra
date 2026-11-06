'use client';

import { formatNaira } from '@fulcra/config';
import { koboToNairaInput, nairaToKobo } from '@fulcra/core/rules';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  FieldMessage,
  Input,
  Label,
  Switch,
} from '@fulcra/ui';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { removeZoneAction, saveZoneAction } from './actions';

type Zone = { id: string; name: string; fee: number; estimatedTime: string; isActive: boolean };
type Draft = {
  id: string | null;
  name: string;
  fee: string;
  estimatedTime: string;
  isActive: boolean;
};

const blank: Draft = { id: null, name: '', fee: '', estimatedTime: '', isActive: true };

export function ZoneEditor({ zones, canEdit }: { zones: Zone[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edit = (z: Zone) => {
    setError(null);
    setDraft({
      id: z.id,
      name: z.name,
      fee: koboToNairaInput(z.fee),
      estimatedTime: z.estimatedTime,
      isActive: z.isActive,
    });
  };

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      const fee = nairaToKobo(draft.fee || '0');
      if (fee === null) return setError('Enter the fee, e.g. 2000.');
      const result = await saveZoneAction(draft.id, {
        name: draft.name,
        fee,
        estimatedTime: draft.estimatedTime,
        isActive: draft.isActive,
      });
      if (result.ok) {
        setDraft(null);
        setError(null);
      } else setError(result.message);
    });

  const remove = (z: Zone) => {
    if (!window.confirm(`Remove "${z.name}"? Past orders keep their delivery details.`)) return;
    startTransition(async () => {
      const result = await removeZoneAction(z.id);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {zones.length === 0 && !draft && (
        <EmptyState
          icon={<MapPin aria-hidden />}
          title="No delivery areas yet"
          description="Add the areas you deliver to, e.g. Lekki ₦2,000, Ikeja ₦1,500."
        />
      )}
      <ul className="flex flex-col gap-2">
        {zones.map((z) => (
          <li key={z.id}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{z.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatNaira(z.fee)}
                  {z.estimatedTime ? ` · ${z.estimatedTime}` : ''}
                </p>
                {!z.isActive && <Badge tone="neutral">Paused</Badge>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${z.name}`}
                    onClick={() => edit(z)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${z.name}`}
                    onClick={() => remove(z)}
                    disabled={pending}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {canEdit && draft && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4 sm:pt-6">
            <p className="font-semibold">{draft.id ? 'Edit area' : 'New area'}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone-name">Area name</Label>
              <Input
                id="zone-name"
                placeholder="e.g. Lekki"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="zone-fee">Delivery fee (₦)</Label>
                <Input
                  id="zone-fee"
                  inputMode="decimal"
                  placeholder="e.g. 2000"
                  value={draft.fee}
                  onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="zone-time">How long it takes (optional)</Label>
                <Input
                  id="zone-time"
                  placeholder="e.g. Same day"
                  value={draft.estimatedTime}
                  onChange={(e) => setDraft({ ...draft, estimatedTime: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span>Available for new orders</span>
              <Switch
                checked={draft.isActive}
                onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
                aria-label="Available for new orders"
              />
            </label>
            {error && <FieldMessage error>{error}</FieldMessage>}
            <div className="flex gap-2">
              <Button type="button" loading={pending} onClick={save}>
                Save area
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canEdit && !draft && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            setDraft(blank);
          }}
        >
          <Plus aria-hidden /> Add delivery area
        </Button>
      )}
      {error && !draft && <FieldMessage error>{error}</FieldMessage>}
    </div>
  );
}
