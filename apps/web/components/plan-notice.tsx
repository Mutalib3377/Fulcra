import Link from 'next/link';

/** "This is part of Growth…" with a link to the plans. */
export function PlanNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
    >
      <span>{message}</span>
      <Link href="/settings/billing" className="font-semibold underline-offset-4 hover:underline">
        See plans
      </Link>
    </div>
  );
}
