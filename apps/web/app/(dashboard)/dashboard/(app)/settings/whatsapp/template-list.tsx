import type { TemplateView } from '@fulcra/core';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';

const STATUS: Record<TemplateView['status'], { label: string; tone: string }> = {
  not_submitted: { label: 'Sending to WhatsApp', tone: 'bg-muted text-muted-foreground' },
  pending: { label: 'Waiting for approval', tone: 'bg-warning-soft text-warning' },
  approved: { label: 'Approved', tone: 'bg-success-soft text-success' },
  rejected: { label: 'Rejected', tone: 'bg-danger-soft text-danger' },
  paused: { label: 'Paused by WhatsApp', tone: 'bg-warning-soft text-warning' },
  disabled: { label: 'Turned off by WhatsApp', tone: 'bg-danger-soft text-danger' },
};

/** The WhatsApp messages Fulcra may send after the 24-hour window, and where each is with Meta. */
export function TemplateList({ templates }: { templates: TemplateView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic messages</CardTitle>
        <CardDescription>
          WhatsApp must approve these before they can be sent outside the 24-hour window (usually
          within minutes to a few hours). Fulcra sends order confirmations, receipts and delivery
          updates to customers who chat with you on WhatsApp. Each one costs about ₦15. Examples
          below show sample names and amounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t.label}</span>
                  <Badge className={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{t.example}</p>
                {t.statusReason && t.status !== 'approved' && (
                  <p className="text-xs text-danger">WhatsApp says: {t.statusReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
