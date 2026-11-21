import type { AdminActionView } from '@fulcra/core';
import { ListRow } from '@fulcra/ui';
import Link from 'next/link';
import { formatDateTime } from '@/lib/orders';

const ACTION_LABEL: Record<string, string> = {
  extend_trial: 'Extended the trial',
  give_plan: 'Gave a plan',
  set_limit: 'Changed a limit',
  set_feature: 'Switched a feature',
  suspend: 'Suspended',
  unsuspend: 'Lifted the suspension',
};

function summary(item: AdminActionView): string {
  const d = item.details as Record<string, unknown>;
  switch (item.action) {
    case 'extend_trial':
      return `+${String(d.days)} days`;
    case 'give_plan':
      return `${String(d.plan)} for ${String(d.months)} months`;
    case 'set_limit':
      return `${d.key === 'owner.messages' ? 'Ask Fulcra messages' : 'Assistant chats'}: ${d.limit === null ? 'back to plan' : String(d.limit)}`;
    case 'set_feature':
      return `${String(d.feature)}: ${d.enabled === null ? 'as plan' : d.enabled ? 'on' : 'off'}`;
    default:
      return '';
  }
}

/** Admin activity rows: what, for whom, by whom, when and why. */
export function ActivityList({
  items,
  showBusiness = true,
}: {
  items: AdminActionView[];
  showBusiness?: boolean;
}) {
  if (items.length === 0) return <ListRow title="No changes yet" />;
  return (
    <>
      {items.map((item) => {
        const what = [ACTION_LABEL[item.action] ?? item.action, summary(item)]
          .filter(Boolean)
          .join(' · ');
        return (
          <ListRow
            key={item.id}
            title={
              showBusiness ? (
                <span>
                  {what}{' '}
                  <Link href={`/admin/sellers/${item.businessId}`} className="text-primary">
                    {item.businessName ?? 'deleted business'}
                  </Link>
                </span>
              ) : (
                what
              )
            }
            description={`“${item.reason}” · ${item.adminEmail} · ${formatDateTime(item.createdAt)}`}
          />
        );
      })}
    </>
  );
}
