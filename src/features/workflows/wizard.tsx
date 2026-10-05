"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Combobox } from "@/components/combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { suggestMappings } from "@/services/mapping/automap";
import { sourceFieldsForQuestions } from "@/services/mapping/sources";
import { demoSampleValues } from "@/services/demo/fixtures";
import {
  destinationCatalog,
  listFormChoices,
  loadFormSourceFields,
  previewWorkflow,
  saveWorkflow,
  sendWorkflowTest,
  setWorkflowStatus,
} from "@/server/actions/workflows";
import type { DestinationField, FieldMapping, SourceField, Transform, ValueTranslation } from "@/types/domain";
import { FUB_EVENT_TYPES, TRANSFORM_OPTIONS } from "@/types/domain";
import type { WorkflowDraft } from "@/types/workflow";

const steps = ["Trigger", "Map Fields", "Tags & Rules", "Test", "Activate"];

const quickDestinations = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["emails", "Email"],
  ["phones", "Phone"],
  ["message", "Message"],
  ["source", "Source"],
  ["tags", "Tags"],
] as const;

type FormChoice = { id: string; name: string; status?: string; updatedAt?: string; fieldCount: number; isDemo: boolean };

export function WorkflowWizard({
  initial,
  pages,
  destinations,
  fields,
}: {
  initial: WorkflowDraft;
  pages: Array<{ id: string; name: string; isDemo: boolean }>;
  destinations: DestinationField[];
  fields: SourceField[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initial);
  const [formChoices, setFormChoices] = useState<FormChoice[]>([]);
  const [sources, setSources] = useState(fields);
  const [fieldCatalog, setFieldCatalog] = useState(destinations);
  const [message, setMessage] = useState<string | null>(null);
  const [technical, setTechnical] = useState<string | null>(null);
  const [preview, setPreview] = useState<Array<{ label: string; value: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [translateFor, setTranslateFor] = useState<string | null>(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const [formStatus, setFormStatus] = useState<string | null>(null);

  const mappedCount = draft.mappings.filter((mapping) => mapping.destinationApiName && !mapping.ignored).length;
  const unmappedCount = draft.mappings.filter((mapping) => !mapping.destinationApiName && !mapping.ignored && !mapping.saveToBackground).length;
  const contactWarning = !draft.mappings.some((mapping) => ["name", "firstName", "lastName", "emails", "phones"].includes(mapping.destinationApiName ?? ""));

  useEffect(() => {
    if (initial.pageId) void loadForms(initial.pageId);
    // The saved page should load its forms once, without clearing the form already chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.pageId]);

  async function loadForms(pageId: string, refresh = false) {
    setFormStatus("Loading forms…");
    try {
      const choices = await listFormChoices(pageId, refresh);
      setFormChoices(choices);
      setFormStatus(choices.length ? null : "No lead forms were found on this Page.");
    } catch {
      setFormChoices([]);
      setFormStatus("Those forms could not be loaded. Try Refresh Forms.");
    }
  }

  async function choosePage(pageId: string) {
    const page = pages.find((item) => item.id === pageId);
    setDraft((current) => ({ ...current, pageId, pageName: page?.name ?? null, isDemo: Boolean(page?.isDemo), formId: null, formName: null, formScope: "specific" }));
    await loadForms(pageId);
  }

  async function chooseForm(formId: string) {
    if (!draft.pageId) return;
    setFormStatus(formId === "any" ? null : "Loading form fields…");
    let nextFields: SourceField[];
    try {
      nextFields = formId === "any" ? sourceFieldsForQuestions([]) : await loadFormSourceFields(draft.pageId, formId);
    } catch {
      setFormStatus("The form fields could not be loaded. Try that form again.");
      return;
    }
    const form = formChoices.find((item) => item.id === formId);
    const suggested = suggestMappings(nextFields, fieldCatalog);
    setSources(nextFields);
    setDraft((current) => ({
      ...current,
      formScope: formId === "any" ? "any" : "specific",
      formId: formId === "any" ? null : formId,
      formName: formId === "any" ? "Any form" : form?.name ?? null,
      isDemo: Boolean(form?.isDemo || current.isDemo),
      mappings: suggested.mappings,
      tags: current.tags.length
        ? current.tags
        : [
            { kind: "static", value: "Facebook" },
            { kind: "dynamic", value: "form_name" },
          ],
    }));
    setFormStatus(null);
    const matched = suggested.mappings.filter((mapping) => mapping.destinationApiName).length;
    const addedTags = draft.tags.length === 0;
    setMessage(
      matched
        ? `Suggested: ${matched} fields matched.${addedTags ? " Facebook and the form name are added as tags." : ""}`
        : "Suggested: choose where each answer should go. The main fields are one click.",
    );
  }

  function updateMapping(sourceKey: string, patch: Partial<FieldMapping>) {
    setDraft((current) => {
      const exists = current.mappings.some((mapping) => mapping.sourceKey === sourceKey);
      return {
        ...current,
        mappings: exists
          ? current.mappings.map((mapping) => (mapping.sourceKey === sourceKey ? { ...mapping, ...patch } : mapping))
          : [...current.mappings, { ...blankMapping({ key: sourceKey, label: patch.sourceLabel ?? sourceKey, group: patch.sourceGroup ?? "question" }), ...patch }],
      };
    });
  }

  async function persist() {
    setBusy(true);
    const result = await saveWorkflow(draft);
    setBusy(false);
    setMessage(result.ok ? "Draft saved." : result.error);
    return result.ok;
  }

  async function runPreview() {
    setBusy(true);
    const result = await previewWorkflow(draft, demoSampleValues);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.friendly);
      setTechnical(result.error.technical);
      setPreview([]);
      return;
    }
    setPreview(result.preview);
    setTechnical(JSON.stringify({ payload: result.payload, tags: result.tags }, null, 2));
    setMessage(result.warnings[0] ?? "Ready to send");
  }

  async function sendTest() {
    setBusy(true);
    const result = await sendWorkflowTest(draft, demoSampleValues, confirmTest);
    setBusy(false);
    if ("needsConfirmation" in result && result.needsConfirmation) {
      setConfirmTest(true);
      setMessage(result.error);
      return;
    }
    if (!result.ok) {
      setMessage("error" in result ? result.error ?? "The test could not be sent." : "The test could not be sent.");
      setTechnical("technical" in result ? result.technical ?? null : null);
      return;
    }
    setPreview(result.preview);
    setTechnical(JSON.stringify({ payload: result.payload, response: "response" in result ? result.response : null }, null, 2));
    setMessage(result.demo ? result.message : result.personId ? `Test successful. Contact ID: ${result.personId}` : result.message ?? "Test finished.");
  }

  async function activate() {
    setBusy(true);
    const saved = await saveWorkflow({ ...draft, status: "active" });
    if (!saved.ok) {
      setBusy(false);
      setMessage(saved.error);
      return;
    }
    const result = await setWorkflowStatus(draft.id, "active");
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setDraft((current) => ({ ...current, status: "active" }));
    setMessage(result.warnings?.[0] ?? "Workflow is on. New Facebook leads will be delivered.");
    router.refresh();
  }

  const destinationOptions = fieldCatalog.map((field) => ({
    value: field.apiName,
    label: field.label,
    hint: field.custom ? "Custom field" : field.category,
  }));

  const selectedForm = formChoices.find((form) => form.id === draft.formId);
  const translateField = fieldCatalog.find((field) => field.apiName === translateFor);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {draft.isDemo ? <Badge tone="warn">Demo Data</Badge> : null}
      <div>
        <p className="text-sm text-muted">Workflow</p>
        <input
          className="mt-1 w-full bg-transparent font-serif text-4xl outline-none"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          aria-label="Workflow name"
        />
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <button type="button" className={index === step ? "font-semibold text-forest" : "text-muted"} onClick={() => setStep(index)}>
              {index + 1} {label}
            </button>
            {index < steps.length - 1 ? <span className="text-stone-300">→</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card className="space-y-5">
          <div>
            <h2 className="font-serif text-3xl">When should this workflow run?</h2>
            <p className="mt-1 text-sm text-muted">Integration: Facebook Lead Ads</p>
          </div>
          <Combobox label="Facebook Page" placeholder="Search pages" value={draft.pageId ?? ""} options={pages.map((page) => ({ value: page.id, label: page.name, hint: page.isDemo ? "Demo Data" : undefined }))} onChange={(value) => void choosePage(value)} />
          <Combobox
            label="Lead Form"
            placeholder="Search forms"
            value={draft.formScope === "any" ? "any" : draft.formId ?? ""}
            options={[{ value: "any", label: "Any form on this Page" }, ...formChoices.map((form) => ({ value: form.id, label: form.name, hint: form.isDemo ? "Demo Data" : form.status }))]}
            onChange={(value) => void chooseForm(value)}
          />
          {formStatus ? <p className="text-sm text-muted">{formStatus}</p> : null}
          {selectedForm ? (
            <div className="grid gap-3 rounded-2xl bg-paper p-4 text-sm sm:grid-cols-4">
              <Meta label="Form name" value={selectedForm.name} />
              <Meta label="Form ID" value={selectedForm.id} />
              <Meta label="Status" value={selectedForm.status ?? "Unknown"} />
              <Meta label="Number of fields" value={String(selectedForm.fieldCount)} />
            </div>
          ) : null}
          <Button type="button" variant="secondary" disabled={!draft.pageId || formStatus === "Loading forms…"} onClick={() => draft.pageId && void loadForms(draft.pageId, true)}>Refresh Forms</Button>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-3xl">Tell us where each Facebook field should go</h2>
              <p className="mt-1 text-sm text-muted">Mapped fields: {mappedCount} · Unmapped fields: {unmappedCount}</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void destinationCatalog().then(setFieldCatalog)}>Refresh Follow Up Boss fields</Button>
          </div>
          {contactWarning ? <p className="rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn">Name, email, or phone is not mapped yet. The lead can still be saved, but Follow Up Boss may not know who it is.</p> : null}
          {message?.startsWith("Suggested:") ? <p className="text-sm text-forest">{message}</p> : null}
          <div className="space-y-3">
            {groupSources(sources.length ? sources : draft.mappings.map((mapping) => ({ key: mapping.sourceKey, label: mapping.sourceLabel, group: mapping.sourceGroup }))).map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
                <div className="space-y-2">
                  {group.fields.map((field) => {
                    const mapping = draft.mappings.find((item) => item.sourceKey === field.key) ?? blankMapping(field);
                    return (
                      <div key={field.key} className="grid items-center gap-2 rounded-2xl border border-line p-3 md:grid-cols-[1fr_auto_1.2fr]">
                        <div>
                          <p className="text-sm font-medium">{field.label}</p>
                          <p className="text-xs text-muted">{field.key}</p>
                        </div>
                        <span className="hidden text-muted md:block">→</span>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {quickDestinations.map(([apiName, label]) => {
                              const selected = mapping.destinationApiName === apiName;
                              return (
                                <button
                                  key={apiName}
                                  type="button"
                                  className={selected ? "rounded-full bg-forest px-2.5 py-1 text-xs text-white" : "rounded-full border border-line bg-white px-2.5 py-1 text-xs"}
                                  onClick={() => {
                                    const destination = fieldCatalog.find((item) => item.apiName === apiName);
                                    updateMapping(field.key, {
                                      ...mapping,
                                      destinationApiName: selected ? null : apiName,
                                      destinationLabel: selected ? null : destination?.label ?? label,
                                      transform: selected ? { type: "none" } : apiName === "phones" ? { type: "phone" } : { type: "none" },
                                      ignored: false,
                                    });
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <Combobox
                            label="Other Follow Up Boss field"
                            placeholder="Search custom fields"
                            value={quickDestinations.some(([apiName]) => apiName === mapping.destinationApiName) ? "__quick__" : mapping.destinationApiName ?? ""}
                            options={[{ value: "", label: "Leave unmapped" }, ...destinationOptions]}
                            onChange={(value) => {
                              const destination = fieldCatalog.find((item) => item.apiName === value);
                              updateMapping(field.key, {
                                ...mapping,
                                destinationApiName: value || null,
                                destinationLabel: destination?.label ?? null,
                                ignored: false,
                              });
                            }}
                          />
                          <details className="text-xs text-muted">
                            <summary className="cursor-pointer">Adjust this field</summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <select
                                className="h-9 rounded-full border border-line bg-white px-3 text-xs"
                                value={mapping.transform.type}
                                aria-label={`Transform ${field.label}`}
                                onChange={(event) => updateMapping(field.key, { ...mapping, transform: transformFrom(event.target.value, mapping.transform) })}
                              >
                                {TRANSFORM_OPTIONS.map((option) => (
                                  <option key={option.type} value={option.type}>{option.label}</option>
                                ))}
                              </select>
                              <TransformExtra mapping={mapping} onChange={(transform) => updateMapping(field.key, { ...mapping, transform })} />
                              <Button type="button" size="sm" variant="ghost" onClick={() => updateMapping(field.key, { ...mapping, ignored: !mapping.ignored, destinationApiName: null })}>Ignore this field</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => updateMapping(field.key, { ...mapping, saveToBackground: !mapping.saveToBackground })}>
                                {mapping.saveToBackground ? "Saving to lead note" : "Save answer to lead note"}
                              </Button>
                              {fieldCatalog.find((item) => item.apiName === mapping.destinationApiName)?.choices.length ? (
                                <Button type="button" size="sm" variant="secondary" onClick={() => setTranslateFor(mapping.destinationApiName)}>Translate values</Button>
                              ) : null}
                            </div>
                          </details>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="font-serif text-3xl">Always add these tags</h2>
            <div className="flex flex-wrap gap-2">
              {draft.tags.filter((tag) => tag.kind === "static").map((tag) => (
                <button key={tag.value} type="button" className="rounded-full bg-forest-soft px-3 py-1 text-sm text-forest" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((item) => item !== tag) })}>
                  {tag.value} ×
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const value = String(data.get("tag") ?? "").trim();
                if (!value) return;
                setDraft({ ...draft, tags: [...draft.tags, { kind: "static", value }] });
                event.currentTarget.reset();
              }}
            >
              <Input name="tag" placeholder="Add tag" aria-label="Add tag" />
              <Button type="submit" variant="secondary">Add Tag</Button>
            </form>
            <div className="space-y-2">
              <p className="text-sm font-medium">Add a Facebook value as a tag</p>
              {sources.filter((field) => ["form_name", "campaign_name", "ad_name", "adset_name", "page_name"].includes(field.key)).map((field) => {
                const checked = draft.tags.some((tag) => tag.kind === "dynamic" && tag.value === field.key);
                return (
                  <label key={field.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          tags: checked ? draft.tags.filter((tag) => !(tag.kind === "dynamic" && tag.value === field.key)) : [...draft.tags, { kind: "dynamic", value: field.key }],
                        })
                      }
                    />
                    Add {field.label} as a tag
                  </label>
                );
              })}
            </div>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-serif text-2xl">Conditional tags</h2>
            {draft.rules.map((rule, index) => (
              <div key={rule.id} className="space-y-2 rounded-2xl border border-line p-3">
                {rule.conditions.map((condition, conditionIndex) => (
                  <div key={`${rule.id}-${conditionIndex}`} className="grid gap-2 md:grid-cols-4">
                    <span className="self-center text-xs font-semibold">{conditionIndex === 0 ? "IF" : rule.combinator.toUpperCase()}</span>
                    <select className="h-10 rounded-2xl border border-line px-2 text-sm" value={condition.sourceKey} onChange={(event) => editCondition(index, conditionIndex, { sourceKey: event.target.value })}>
                      {sources.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                    </select>
                    <select className="h-10 rounded-2xl border border-line px-2 text-sm" value={condition.operator} onChange={(event) => editCondition(index, conditionIndex, { operator: event.target.value as typeof condition.operator })}>
                      {["is", "is_not", "contains", "not_contains", "is_empty", "is_not_empty", "starts_with", "ends_with"].map((operator) => <option key={operator} value={operator}>{operator.replaceAll("_", " ")}</option>)}
                    </select>
                    <Input value={condition.value} aria-label="Comparison value" onChange={(event) => editCondition(index, conditionIndex, { value: event.target.value })} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold">THEN ADD TAG</span>
                  <Input value={rule.tag} aria-label="Tag to add" onChange={(event) => editRule(index, { tag: event.target.value })} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => editRule(index, { combinator: rule.combinator === "and" ? "or" : "and" })}>{rule.combinator.toUpperCase()}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, ruleIndex) => ruleIndex !== index) })}>Remove</Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  rules: [...draft.rules, { id: crypto.randomUUID(), combinator: "and", tag: "", conditions: [{ sourceKey: sources[0]?.key ?? "", operator: "is", value: "" }] }],
                })
              }
            >
              Add rule
            </Button>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-serif text-2xl">Set a value for every lead</h2>
            {draft.staticValues.map((value, index) => (
              <div key={`${value.destinationApiName}-${index}`} className="grid gap-2 md:grid-cols-2">
                <Combobox label="Follow Up Boss field" placeholder="Choose a field" value={value.destinationApiName} options={destinationOptions} onChange={(apiName) => {
                  const destination = fieldCatalog.find((field) => field.apiName === apiName);
                  const next = [...draft.staticValues];
                  next[index] = { destinationApiName: apiName, destinationLabel: destination?.label ?? apiName, value: value.value };
                  setDraft({ ...draft, staticValues: next });
                }} />
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Value</span>
                  <Input value={value.value} onChange={(event) => {
                    const next = [...draft.staticValues];
                    next[index] = { ...value, value: event.target.value };
                    setDraft({ ...draft, staticValues: next });
                  }} />
                </label>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, staticValues: [...draft.staticValues, { destinationApiName: "", destinationLabel: "", value: "" }] })}>Add a value</Button>
          </Card>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void runPreview()} disabled={busy}>Test With Sample Lead</Button>
            <Button type="button" variant="secondary" onClick={() => void sendTest()} disabled={busy}>{confirmTest ? "Send test again" : "Send Test to Follow Up Boss"}</Button>
          </div>
          {draft.isDemo ? <p className="text-sm text-warn">Demo Data stays in Leadpath and is not delivered to Follow Up Boss.</p> : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <PreviewCard title="Facebook received" rows={Object.entries(demoSampleValues).slice(0, 6).map(([key, value]) => ({ label: key, value }))} />
            <PreviewCard title="After mapping" rows={preview} />
            <Card>
              <h3 className="font-serif text-2xl">Follow Up Boss</h3>
              <p className="mt-3 text-sm">{message ?? "Ready to send"}</p>
            </Card>
          </div>
          <details className="rounded-3xl border border-line bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Technical Details</summary>
            <pre className="mt-3 overflow-auto text-xs text-muted">{technical}</pre>
          </details>
        </div>
      ) : null}

      {step === 4 ? (
        <Card className="space-y-4">
          <h2 className="font-serif text-3xl">Ready to turn this on?</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Meta label="Facebook Page" value={draft.pageName ?? "Not chosen"} />
            <Meta label="Form" value={draft.formName ?? "Not chosen"} />
            <Meta label="Fields mapped" value={String(mappedCount)} />
            <Meta label="Always-on tags" value={String(draft.tags.filter((tag) => tag.kind === "static").length)} />
            <Meta label="Conditional rules" value={String(draft.rules.length)} />
            <Meta label="Destination" value="Follow Up Boss" />
            <Meta label="Status" value={draft.status === "active" ? "Active" : "Ready"} />
          </dl>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Lead type in Follow Up Boss</span>
            <select className="h-11 rounded-2xl border border-line bg-white px-3" value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}>
              {FUB_EVENT_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">General Inquiry is the usual choice for a Facebook lead.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" onClick={() => void activate()} disabled={busy}>Turn On Workflow</Button>
            {draft.status === "active" ? <Button type="button" variant="secondary" onClick={() => void setWorkflowStatus(draft.id, "paused").then(() => setDraft({ ...draft, status: "paused" }))}>Pause</Button> : null}
          </div>
          {draft.status === "active" ? <p className="text-sm font-medium text-forest">● Active</p> : null}
        </Card>
      ) : null}

      {message && !message.startsWith("Suggested:") ? <p className="text-sm">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={step === 0} onClick={() => setStep((current) => current - 1)}>Back</Button>
        <Button type="button" variant="secondary" disabled={step === steps.length - 1} onClick={() => setStep((current) => current + 1)}>Continue</Button>
        <Button type="button" variant="ghost" onClick={() => void persist()} disabled={busy}>Save Draft</Button>
      </div>

      <Modal open={Boolean(translateField)} onOpenChange={(open) => !open && setTranslateFor(null)} title="Translate answers">
        {translateField ? (
          <TranslationEditor
            field={translateField}
            rows={draft.translations.filter((item) => item.destinationApiName === translateField.apiName)}
            onChange={(rows) =>
              setDraft({
                ...draft,
                translations: [...draft.translations.filter((item) => item.destinationApiName !== translateField.apiName), ...rows],
              })
            }
          />
        ) : null}
      </Modal>
    </div>
  );

  function editCondition(ruleIndex: number, conditionIndex: number, patch: Partial<WorkflowDraft["rules"][number]["conditions"][number]>) {
    const rules = draft.rules.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      const conditions = rule.conditions.map((condition, inner) => (inner === conditionIndex ? { ...condition, ...patch } : condition));
      return { ...rule, conditions };
    });
    setDraft({ ...draft, rules });
  }

  function editRule(ruleIndex: number, patch: Partial<WorkflowDraft["rules"][number]>) {
    setDraft({ ...draft, rules: draft.rules.map((rule, index) => (index === ruleIndex ? { ...rule, ...patch } : rule)) });
  }
}

function TranslationEditor({
  field,
  rows,
  onChange,
}: {
  field: DestinationField;
  rows: ValueTranslation[];
  onChange: (rows: ValueTranslation[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">If a Facebook answer does not match {field.label}, translate it to one of the allowed choices.</p>
      <p className="text-xs text-muted">Allowed: {field.choices.join(", ")}</p>
      {rows.map((row, index) => (
        <div key={`${row.fromValue}-${index}`} className="grid gap-2 md:grid-cols-2">
          <Input value={row.fromValue} aria-label="Facebook answer" onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, fromValue: event.target.value } : item))} />
          <select className="h-11 rounded-2xl border border-line px-3 text-sm" value={row.toValue} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, toValue: event.target.value } : item))}>
            <option value="">Choose a Follow Up Boss value</option>
            {field.choices.map((choice) => <option key={choice}>{choice}</option>)}
          </select>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange([...rows, { destinationApiName: field.apiName, fromValue: "", toValue: "" }])}>Add translation</Button>
    </div>
  );
}

function PreviewCard({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <Card>
      <h3 className="font-serif text-2xl">{title}</h3>
      <dl className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing to show yet.</p> : null}
        {rows.map((row) => (
          <div key={`${title}-${row.label}`}>
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="text-sm font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function TransformExtra({ mapping, onChange }: { mapping: FieldMapping; onChange: (transform: Transform) => void }) {
  if (mapping.transform.type === "prefix" || mapping.transform.type === "suffix" || mapping.transform.type === "default_if_empty" || mapping.transform.type === "static") {
    return <Input className="h-9" aria-label="Transform text" value={mapping.transform.value} onChange={(event) => onChange({ ...mapping.transform, value: event.target.value } as Transform)} />;
  }
  if (mapping.transform.type === "template") {
    return <Input className="h-9" aria-label="Template" placeholder="Facebook - {campaign_name}" value={mapping.transform.template} onChange={(event) => onChange({ type: "template", template: event.target.value })} />;
  }
  return null;
}

function transformFrom(type: string, current: Transform): Transform {
  if (type === "prefix" || type === "suffix" || type === "default_if_empty" || type === "static") {
    const value = "value" in current ? current.value : "";
    return { type, value };
  }
  if (type === "template") return { type: "template", template: "template" in current ? current.template : "" };
  if (type === "combine") return { type: "combine", fieldKeys: [], separator: " " };
  if (type === "date") return { type: "date", format: "date" };
  if (type === "none" || type === "trim" || type === "lowercase" || type === "uppercase" || type === "phone" || type === "split_full_name") return { type };
  return { type: "none" };
}

function blankMapping(field: SourceField): FieldMapping {
  return {
    sourceKey: field.key,
    sourceLabel: field.label,
    sourceGroup: field.group,
    destinationApiName: null,
    destinationLabel: null,
    transform: { type: "none" },
    ignored: false,
    saveToBackground: false,
  };
}

function groupSources(fields: SourceField[]) {
  const labels: Record<SourceField["group"], string> = {
    contact: "Contact Fields",
    question: "Form Questions",
    metadata: "Facebook Metadata",
    marketing: "Marketing Attribution",
  };
  return (["contact", "question", "metadata", "marketing"] as const)
    .map((group) => ({ label: labels[group], fields: fields.filter((field) => field.group === group) }))
    .filter((group) => group.fields.length > 0);
}
