import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to configure yet</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Restaurant profile, tax rate, and menu management will live here.
        </CardContent>
      </Card>
    </div>
  );
}
