import { VendorList } from "@/components/vendors/vendor-list";
import { VendorHealthDashboard } from "@/components/vendors/vendor-health";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage vendor connections, authentication, and preferences.
        </p>
      </div>

      <VendorList />
      <VendorHealthDashboard />
    </div>
  );
}
