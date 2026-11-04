import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@fulcra/ui';

export default function DashboardHome() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Badge tone="info">Placeholder</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Sales, orders and chats will show here.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Nothing here yet"
            description="Sign-up and onboarding arrive in the next phase (C1)."
          />
        </CardContent>
      </Card>
    </div>
  );
}
