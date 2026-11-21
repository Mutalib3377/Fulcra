import { adminActivity } from '@fulcra/core';
import { ListGroup } from '@fulcra/ui';
import { PageHeader } from '@/components/page-header';
import { requireAdminPage } from '@/lib/admin';
import { ActivityList } from '../activity-list';

export const dynamic = 'force-dynamic';

/** Every change made from the admin area, newest first. */
export default async function AdminActivityPage() {
  const admin = await requireAdminPage();
  const items = await adminActivity(admin, { limit: 200 });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Activity"
        description="Every change made from the admin area: what, for whom, by whom and why."
      />
      <ListGroup>
        <ActivityList items={items} />
      </ListGroup>
    </div>
  );
}
