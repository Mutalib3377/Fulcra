'use client';

import { BRAND_FONTS, type BrandFont, type BrandVoice } from '@fulcra/core/rules';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldMessage,
  Input,
  Label,
  Textarea,
  cn,
} from '@fulcra/ui';
import { CheckCircle2, ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { uploadImage, type UploadedImage } from '@/components/upload-image';
import { saveBrandKitAction } from './actions';
import { brandFontOptions } from './fonts';

type Values = {
  logo: UploadedImage | null;
  primaryColour: string;
  accentColour: string;
  font: BrandFont;
  voice: BrandVoice;
  voiceNotes: string;
  description: string;
};

const voices: { value: BrandVoice; label: string; example: string }[] = [
  { value: 'friendly', label: 'Friendly', example: 'Hi dear! Yes, we have it in size M 😊' },
  { value: 'professional', label: 'Professional', example: 'Good afternoon. Size M is available.' },
  { value: 'playful', label: 'Playful', example: 'Ooh great choice! Size M is waiting for you 🔥' },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function BrandKitForm({
  initial,
  businessName,
  canEdit,
}: {
  initial: Values;
  businessName: string;
  canEdit: boolean;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      set('logo', await uploadImage(file));
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Upload failed.' });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      if (!HEX.test(values.primaryColour) || !HEX.test(values.accentColour)) {
        setMessage({ ok: false, text: 'Colours must look like #0f6b55.' });
        return;
      }
      const result = await saveBrandKitAction({ ...values, logo: values.logo?.image ?? null });
      setMessage(
        result.ok ? { ok: true, text: 'Brand kit saved.' } : { ok: false, text: result.message },
      );
    });

  const font = brandFontOptions[values.font].stack;

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Only the business owner can change the brand kit.
        </p>
      )}

      {/* Live preview */}
      <Card className="overflow-hidden" aria-label="Preview">
        <div
          className="flex items-center gap-3 px-4 py-3 text-white"
          style={{ backgroundColor: values.primaryColour, fontFamily: font }}
        >
          {values.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage image
            <img
              src={values.logo.urls.sm}
              alt=""
              className="size-10 rounded-md bg-white object-contain"
            />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-md bg-white/20 text-lg font-bold">
              {businessName.charAt(0)}
            </span>
          )}
          <span className="truncate text-lg font-semibold">{businessName}</span>
        </div>
        <div className="flex flex-col gap-3 p-4" style={{ fontFamily: font }}>
          <p className="text-sm text-muted-foreground">
            {values.description || 'Your short description appears here.'}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Ankara wrap dress · ₦15,000</span>
            <span
              className="rounded-md px-3 py-2 text-sm font-semibold"
              style={{ backgroundColor: values.accentColour }}
            >
              Order now
            </span>
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            {voices.find((v) => v.value === values.voice)?.example}
          </p>
        </div>
      </Card>

      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Section title="Logo">
          <div className="flex items-center gap-3">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {uploading ? (
                <Loader2
                  className="size-6 animate-spin text-muted-foreground"
                  aria-label="Uploading"
                />
              ) : values.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- storage image
                <img src={values.logo.urls.sm} alt="Logo" className="size-full object-contain" />
              ) : (
                <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {values.logo ? 'Change logo' : 'Upload logo'}
              </Button>
              {values.logo && (
                <Button type="button" variant="ghost" size="sm" onClick={() => set('logo', null)}>
                  <X aria-hidden /> Remove
                </Button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void pickLogo(e.target.files?.[0])}
            />
          </div>
        </Section>

        <Section title="Colours">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColourField
              label="Main colour"
              value={values.primaryColour}
              onChange={(v) => set('primaryColour', v)}
            />
            <ColourField
              label="Accent colour (buttons)"
              value={values.accentColour}
              onChange={(v) => set('accentColour', v)}
            />
          </div>
        </Section>

        <Section title="Font">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BRAND_FONTS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set('font', f)}
                aria-pressed={values.font === f}
                className={cn(
                  'rounded-md border px-3 py-3 text-left',
                  values.font === f ? 'border-primary bg-secondary' : 'border-input bg-card',
                )}
                style={{ fontFamily: brandFontOptions[f].stack }}
              >
                <span className="block text-lg">Aa</span>
                <span className="block text-sm">{brandFontOptions[f].label}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="How your assistant talks">
          <div className="flex flex-col gap-2">
            {voices.map((v) => (
              <label
                key={v.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2',
                  values.voice === v.value ? 'border-primary bg-secondary' : 'border-input bg-card',
                )}
              >
                <input
                  type="radio"
                  name="voice"
                  checked={values.voice === v.value}
                  onChange={() => set('voice', v.value)}
                  className="mt-1 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="block font-medium">{v.label}</span>
                  <span className="block text-sm text-muted-foreground">“{v.example}”</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="voiceNotes">Anything else about how to talk? (optional)</Label>
            <Textarea
              id="voiceNotes"
              rows={2}
              maxLength={500}
              placeholder='e.g. Use light Pidgin. Call customers "dear".'
              value={values.voiceNotes}
              onChange={(e) => set('voiceNotes', e.target.value)}
            />
          </div>
        </Section>

        <Section title="About your business">
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Short description</Label>
            <Textarea
              id="description"
              rows={3}
              maxLength={1000}
              placeholder="e.g. Handmade Ankara dresses, delivered anywhere in Lagos."
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <FieldMessage>Shown on your store and used by the assistant.</FieldMessage>
          </div>
        </Section>
      </fieldset>

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
            message.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {message.ok && <CheckCircle2 className="size-4" aria-hidden />} {message.text}
        </p>
      )}
      {canEdit && (
        <Button type="button" size="lg" loading={pending} disabled={uploading} onClick={save}>
          Save brand kit
        </Button>
      )}
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

function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          className="font-mono"
        />
      </div>
    </div>
  );
}
