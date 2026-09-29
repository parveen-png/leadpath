import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateAdvanced, updateWorkspace } from "@/server/actions/account";
import { requireWorkspace } from "@/server/session";
import { FUB_EVENT_TYPES } from "@/types/domain";

export default async function SettingsPage() {
  const ctx = await requireWorkspace();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-4xl">Settings</h1>
        <p className="mt-2 text-sm text-muted">Everyday choices are here. Connection secrets stay on the Connections page.</p>
      </div>
      <Card>
        <h2 className="font-serif text-2xl">General</h2>
        <form
          action={async (formData) => {
            await updateWorkspace(formData);
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Workspace name</span>
            <Input name="name" defaultValue={ctx.workspaceName} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Default time zone</span>
            <Input name="timezone" defaultValue={ctx.timezone} />
            <span className="mt-1 block text-xs text-muted">Used when you read “today” on the dashboard. Example: America/Toronto.</span>
          </label>
          <Button type="submit">Save general settings</Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-serif text-2xl">Security</h2>
        <p className="mt-2 text-sm text-muted">Facebook and Follow Up Boss credentials are encrypted before they are stored. They are decrypted only on the server when a lead is delivered or a connection is tested. The browser never receives the full key.</p>
      </Card>
      <Card>
        <h2 className="font-serif text-2xl">Advanced</h2>
        <p className="mt-1 text-sm text-muted">These change how leads are sent. Leave them alone unless you know you need a different setup.</p>
        <form
          action={async (formData) => {
            await updateAdvanced(formData);
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Meta API version</span>
            <Input name="metaGraphVersion" placeholder="v25.0" defaultValue={ctx.metaGraphVersion ?? ""} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Default Follow Up Boss event type</span>
            <select name="defaultEventType" defaultValue={ctx.defaultEventType} className="h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm">
              {FUB_EVENT_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Delivery attempts</span>
            <Input name="maxDeliveryAttempts" type="number" min={1} max={5} defaultValue={ctx.maxDeliveryAttempts} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="demoMode" defaultChecked={ctx.demoMode} />
            Show demo Facebook data when no Pages are connected
          </label>
          <Button type="submit" variant="secondary">Save advanced settings</Button>
        </form>
      </Card>
    </div>
  );
}
