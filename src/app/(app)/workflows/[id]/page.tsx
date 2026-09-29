import { notFound } from "next/navigation";

import { WorkflowWizard } from "@/features/workflows/wizard";
import { destinationCatalog, getWorkflowDraft, listPageChoices, loadFormSourceFields } from "@/server/actions/workflows";

export default async function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getWorkflowDraft(id);
  if (!draft) notFound();
  const [pages, destinations, fields] = await Promise.all([
    listPageChoices(),
    destinationCatalog(),
    draft.pageId && draft.formId ? loadFormSourceFields(draft.pageId, draft.formId) : Promise.resolve([]),
  ]);
  return <WorkflowWizard initial={draft} pages={pages} destinations={destinations} fields={fields} />;
}
