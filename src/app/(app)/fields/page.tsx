import { FieldBrowser } from "@/features/field-mapping/browser";
import { isDemoModeEnabled } from "@/lib/env";
import { requireWorkspace } from "@/server/session";
import { storedFields } from "@/server/queries";

export default async function FieldsPage() {
  const [ctx, fields] = await Promise.all([requireWorkspace(), storedFields()]);
  return (
    <FieldBrowser
      custom={fields.custom
        .filter((field) => field.is_custom === true)
        .map((field) => ({
          label: String(field.label ?? ""),
          api_name: String(field.api_name ?? ""),
          field_type: String(field.field_type ?? "text"),
          choices: Array.isArray(field.choices) ? field.choices.map(String) : [],
          is_recurring: typeof field.is_recurring === "boolean" ? field.is_recurring : null,
        }))}
      syncedAt={fields.syncedAt}
      demo={ctx.demoMode || isDemoModeEnabled()}
    />
  );
}
