'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  FileSpreadsheet,
  FormInput,
  GripVertical,
  Link2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  FormDefinition,
  FormField,
  FormFieldCondition,
  FormFieldType,
  FormRow,
  FormStatus,
  FormVisibility,
} from '@allebrum/shared';
import { useClients, useProjects } from '@/hooks/useResources';
import {
  formSubmissionsCsvUrl,
  useCreateForm,
  useDeleteForm,
  useFormEmbedSnippet,
  useForms,
  useFormSubmissions,
  useUpdateForm,
} from '@/hooks/useForms';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { relativeFromIso } from '@/lib/formatters';

const FIELD_TYPES: FormFieldType[] = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'radio'];
const OPERATORS = ['equals', 'not_equals', 'includes', 'is_truthy', 'is_falsy'] as const;

type Props = {
  clientId?: string | null;
  projectId?: string | null;
  defaultVisibility?: FormVisibility;
  allowProjectLinkPicker?: boolean;
  createHeading?: string;
  emptyTitle?: string;
  emptyHint?: string;
  onOpenClient?: (id: string) => void;
  onOpenProject?: (id: string) => void;
};

function normalizeOptionValue(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'option';
}

function newField(type: FormFieldType): FormField {
  const id = `fld_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  return {
    id,
    label: 'New field',
    type,
    required: false,
    placeholder: '',
    helpText: '',
    options:
      type === 'select' || type === 'radio'
        ? [
            { label: 'Option 1', value: 'option_1' },
            { label: 'Option 2', value: 'option_2' },
          ]
        : [],
    validation: {},
    showWhen: [],
    requiredWhen: [],
  };
}

function blankDefinition(): FormDefinition {
  return {
    title: 'Contact us',
    description: 'Drop us a message and we will reply shortly.',
    submitLabel: 'Submit',
    successMessage: 'Thanks, we got your submission.',
    fields: [
      {
        id: 'full_name',
        label: 'Full name',
        type: 'text',
        required: true,
        placeholder: 'Jane Doe',
        helpText: '',
        options: [],
        validation: { minLength: 2 },
        showWhen: [],
        requiredWhen: [],
      },
      {
        id: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        placeholder: 'you@company.com',
        helpText: '',
        options: [],
        validation: {},
        showWhen: [],
        requiredWhen: [],
      },
    ],
    security: {
      allowedOrigins: [],
      allowedPathPrefixes: [],
      requireCaptcha: false,
      captchaProvider: null,
      honeypotFieldName: 'company_website',
    },
  };
}

function validateBuilder(def: FormDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (def.fields.length === 0) errors.push('At least one field is required.');

  for (const field of def.fields) {
    if (!field.id.trim()) errors.push('Every field needs an id.');
    if (ids.has(field.id)) errors.push(`Duplicate field id: ${field.id}`);
    ids.add(field.id);
    if (!field.label.trim()) errors.push(`Field ${field.id || '(no id)'} needs a label.`);
    if ((field.type === 'select' || field.type === 'radio') && field.options.length === 0) {
      errors.push(`Field ${field.label || field.id} needs options.`);
    }
    if (
      field.validation.minLength != null &&
      field.validation.maxLength != null &&
      field.validation.minLength > field.validation.maxLength
    ) {
      errors.push(`Field ${field.label || field.id} has invalid length validation.`);
    }
    for (const cond of [...(field.showWhen ?? []), ...(field.requiredWhen ?? [])]) {
      if (!cond.fieldId) errors.push(`Condition in ${field.label || field.id} is missing a field.`);
    }
  }

  for (const origin of def.security?.allowedOrigins ?? []) {
    try {
      new URL(origin);
    } catch {
      errors.push(`Invalid allowed origin: ${origin}`);
    }
  }

  return errors;
}

function asComparableValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('|');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  return String(value).trim();
}

function conditionPasses(condition: FormFieldCondition, answers: Record<string, unknown>): boolean {
  const left = answers[condition.fieldId];
  const right = condition.value;

  switch (condition.operator) {
    case 'is_truthy':
      if (Array.isArray(left)) return left.length > 0;
      if (typeof left === 'string') return left.trim().length > 0;
      return !!left;
    case 'is_falsy':
      if (Array.isArray(left)) return left.length === 0;
      if (typeof left === 'string') return left.trim().length === 0;
      return !left;
    case 'includes':
      if (Array.isArray(left)) return left.map((v) => String(v)).includes(String(right ?? ''));
      return asComparableValue(left).includes(String(right ?? ''));
    case 'not_equals':
      return asComparableValue(left) !== asComparableValue(right);
    case 'equals':
    default:
      return asComparableValue(left) === asComparableValue(right);
  }
}

function conditionsPass(conditions: FormFieldCondition[] | undefined, answers: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return false;
  return conditions.every((c) => conditionPasses(c, answers));
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function FormBuilderManager({
  clientId = null,
  projectId = null,
  defaultVisibility = 'workspace',
  allowProjectLinkPicker = false,
  createHeading = 'New form',
  emptyTitle = 'No forms yet',
  emptyHint = 'Build one above and copy the embed snippet into your website.',
  onOpenClient,
  onOpenProject,
}: Props) {
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const forms = useForms({ clientId, projectId });
  const create = useCreateForm();
  const update = useUpdateForm();
  const remove = useDeleteForm();
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<FormStatus>('active');
  const [visibility, setVisibility] = useState<FormVisibility>(defaultVisibility);
  const [draft, setDraft] = useState<FormDefinition>(blankDefinition());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(draft.fields[0]?.id ?? null);
  const [selectedClientId, setSelectedClientId] = useState(clientId ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});

  const [submissionsFormId, setSubmissionsFormId] = useState<string | null>(null);
  const [embedFormId, setEmbedFormId] = useState<string | null>(null);

  const submissions = useFormSubmissions(submissionsFormId);
  const embedSnippet = useFormEmbedSnippet(embedFormId);

  const clientProjects = useMemo(
    () => projects.filter((p) => (selectedClientId ? p.clientId === selectedClientId : true)),
    [projects, selectedClientId],
  );
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const builderErrors = useMemo(() => validateBuilder(draft), [draft]);

  const selectedField = useMemo(
    () => draft.fields.find((f) => f.id === selectedFieldId) ?? null,
    [draft.fields, selectedFieldId],
  );

  useEffect(() => {
    if (!selectedFieldId || !draft.fields.some((f) => f.id === selectedFieldId)) {
      setSelectedFieldId(draft.fields[0]?.id ?? null);
    }
  }, [draft.fields, selectedFieldId]);

  const reset = () => {
    setName('');
    setDescription('');
    setStatus('active');
    setVisibility(defaultVisibility);
    const def = blankDefinition();
    setDraft(def);
    setSelectedFieldId(def.fields[0]?.id ?? null);
    setPreviewAnswers({});
    setEditingId(null);
    setSelectedClientId(clientId ?? '');
    setSelectedProjectId(projectId ?? '');
  };

  const updateField = (fieldId: string, updater: (field: FormField) => FormField) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? updater(f) : f)),
    }));
  };

  const removeField = (fieldId: string) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.filter((f) => f.id !== fieldId),
    }));
    setPreviewAnswers((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const onDragDrop = (toIdx: number) => {
    if (dragIndex == null || dragIndex === toIdx) return;
    setDraft((prev) => {
      const next = [...prev.fields];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(toIdx, 0, moved!);
      return { ...prev, fields: next };
    });
    setDragIndex(null);
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Form name is required');
      return;
    }
    if (builderErrors.length > 0) {
      toast.error(builderErrors[0] ?? 'Fix builder issues before saving');
      return;
    }

    const targetProjectId = projectId ?? (allowProjectLinkPicker ? (selectedProjectId || null) : (selectedProjectId || null));
    const targetClientId = targetProjectId ? null : (selectedClientId || clientId || null);

    const payload = {
      name: name.trim(),
      description: description.trim(),
      status,
      visibility,
      clientId: targetClientId,
      projectId: targetProjectId,
      definition: draft,
    };

    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, patch: payload });
        toast.success('Form updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Form created');
      }
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const startEdit = (row: FormRow) => {
    setEditingId(row.id);
    setName(row.name);
    setDescription(row.description);
    setStatus(row.status);
    setVisibility(row.visibility);
    setSelectedClientId(row.clientId ?? '');
    setSelectedProjectId(row.projectId ?? '');
    setDraft(row.definition);
    setSelectedFieldId(row.definition.fields[0]?.id ?? null);
    setPreviewAnswers({});
  };

  const archive = async (row: FormRow) => {
    const ok = await confirmDialog({
      title: `Archive ${row.name}?`,
      body: 'Submissions and analytics remain available.',
      confirmLabel: 'Archive form',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success('Form archived');
      if (editingId === row.id) reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Archive failed');
    }
  };

  const copySnippet = async () => {
    if (!embedSnippet.data?.snippet) return;
    try {
      await navigator.clipboard.writeText(embedSnippet.data.snippet);
      toast.success('Embed snippet copied');
    } catch {
      toast.error('Could not copy snippet');
    }
  };

  const visiblePreviewFields = useMemo(() => {
    return draft.fields.filter((field) => {
      if (!field.showWhen || field.showWhen.length === 0) return true;
      return conditionsPass(field.showWhen, previewAnswers);
    });
  }, [draft.fields, previewAnswers]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">{createHeading}</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Form name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead capture" />
          </Field>
          <Field label="Internal description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context" />
          </Field>
          <Field label="Visibility">
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as FormVisibility)}>
              <option value="workspace">Workspace</option>
              <option value="private">Private</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as FormStatus)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
          </Field>
        </div>

        {!projectId && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Link to client (optional)">
              <Select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}>
                <option value="">No client link</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            {(allowProjectLinkPicker || selectedClientId) && (
              <Field label="Link to project (optional)">
                <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                  <option value="">No project link</option>
                  {clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50 space-y-3">
              <div className="flex flex-wrap gap-2">
                {FIELD_TYPES.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const field = newField(type);
                      setDraft((d) => ({ ...d, fields: [...d.fields, field] }));
                      setSelectedFieldId(field.id);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {type}
                  </Button>
                ))}
              </div>

              <ul className="rounded-xl border border-gray-200 divide-y divide-gray-100 bg-white">
                {draft.fields.map((field, idx) => (
                  <li
                    key={field.id}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDragDrop(idx)}
                    className={`p-3 flex items-center gap-2 cursor-pointer ${selectedFieldId === field.id ? 'bg-indigo-50' : ''}`}
                    onClick={() => setSelectedFieldId(field.id)}
                  >
                    <GripVertical className="w-4 h-4 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900 truncate">{field.label || field.id}</div>
                      <div className="text-xs text-gray-500">{field.type} · {field.id}</div>
                    </div>
                    {(field.showWhen?.length ?? 0) > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">show-if</span>
                    )}
                    {(field.requiredWhen?.length ?? 0) > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">required-if</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-white">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-3">Live Form Preview</div>
              <div className="rounded-lg border border-gray-100 p-4 space-y-3 bg-gray-50">
                {draft.title.trim() ? <h3 className="text-lg font-semibold text-gray-900">{draft.title}</h3> : null}
                {draft.description && <p className="text-sm text-gray-600">{draft.description}</p>}
                {visiblePreviewFields.map((field) => {
                  const required = !!field.required || conditionsPass(field.requiredWhen, previewAnswers);
                  return (
                    <div key={field.id} className="space-y-1">
                      <div className="text-sm font-medium text-gray-800">{field.label}{required ? ' *' : ''}</div>
                      {(field.type === 'text' || field.type === 'email' || field.type === 'number') && (
                        <Input
                          type={field.type === 'text' ? 'text' : field.type}
                          placeholder={field.placeholder || ''}
                          value={typeof previewAnswers[field.id] === 'string' ? String(previewAnswers[field.id]) : ''}
                          onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [field.id]: e.target.value }))}
                        />
                      )}
                      {field.type === 'textarea' && (
                        <Textarea
                          rows={3}
                          placeholder={field.placeholder || ''}
                          value={typeof previewAnswers[field.id] === 'string' ? String(previewAnswers[field.id]) : ''}
                          onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [field.id]: e.target.value }))}
                        />
                      )}
                      {field.type === 'select' && (
                        <Select
                          value={typeof previewAnswers[field.id] === 'string' ? String(previewAnswers[field.id]) : ''}
                          onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [field.id]: e.target.value }))}
                        >
                          <option value="">Select...</option>
                          {field.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                      )}
                      {field.type === 'radio' && (
                        <div className="flex flex-wrap gap-3">
                          {field.options.map((o) => (
                            <label key={o.value} className="inline-flex items-center gap-1 text-sm">
                              <input
                                type="radio"
                                name={`preview_${field.id}`}
                                checked={previewAnswers[field.id] === o.value}
                                onChange={() => setPreviewAnswers((prev) => ({ ...prev, [field.id]: o.value }))}
                              />
                              {o.label}
                            </label>
                          ))}
                        </div>
                      )}
                      {field.type === 'checkbox' && (
                        <div className="space-y-1">
                          {field.options.length > 0 ? (
                            field.options.map((o) => {
                              const list = Array.isArray(previewAnswers[field.id]) ? (previewAnswers[field.id] as string[]) : [];
                              const checked = list.includes(o.value);
                              return (
                                <label key={o.value} className="inline-flex items-center gap-1 text-sm mr-3">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = new Set(list);
                                      if (e.target.checked) next.add(o.value);
                                      else next.delete(o.value);
                                      setPreviewAnswers((prev) => ({ ...prev, [field.id]: [...next] }));
                                    }}
                                  />
                                  {o.label}
                                </label>
                              );
                            })
                          ) : (
                            <label className="inline-flex items-center gap-1 text-sm">
                              <input
                                type="checkbox"
                                checked={!!previewAnswers[field.id]}
                                onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [field.id]: e.target.checked }))}
                              />
                              {field.helpText || 'Checked'}
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button size="sm" disabled>{draft.submitLabel || 'Submit'}</Button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-3">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Form Settings</div>
              <Field label="Public form title">
                <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              </Field>
              <Field label="Form description">
                <Textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
              </Field>
              <Field label="Submit label">
                <Input value={draft.submitLabel} onChange={(e) => setDraft((d) => ({ ...d, submitLabel: e.target.value }))} />
              </Field>
              <Field label="Success message">
                <Input value={draft.successMessage} onChange={(e) => setDraft((d) => ({ ...d, successMessage: e.target.value }))} />
              </Field>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-3">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Security</div>
              <Field label="Allowed origins (one per line)">
                <Textarea
                  rows={3}
                  value={(draft.security?.allowedOrigins ?? []).join('\n')}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      security: { ...d.security, allowedOrigins: parseLines(e.target.value) },
                    }))
                  }
                  placeholder="https://www.example.com"
                />
              </Field>
              <Field label="Allowed page path prefixes (one per line)">
                <Textarea
                  rows={3}
                  value={(draft.security?.allowedPathPrefixes ?? []).join('\n')}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      security: { ...d.security, allowedPathPrefixes: parseLines(e.target.value) },
                    }))
                  }
                  placeholder="/contact"
                />
              </Field>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!draft.security?.requireCaptcha}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      security: { ...d.security, requireCaptcha: e.target.checked },
                    }))
                  }
                />
                Require captcha on submit
              </label>
              {draft.security?.requireCaptcha && (
                <Field label="Captcha provider">
                  <Select
                    value={draft.security?.captchaProvider ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        security: {
                          ...d.security,
                          captchaProvider: (e.target.value || null) as 'hcaptcha' | 'recaptcha' | null,
                        },
                      }))
                    }
                  >
                    <option value="">Select provider</option>
                    <option value="hcaptcha">hCaptcha</option>
                    <option value="recaptcha">reCAPTCHA</option>
                  </Select>
                </Field>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-3">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Field Settings</div>
              {!selectedField ? (
                <div className="text-sm text-gray-500">Select a field on the left to edit settings.</div>
              ) : (
                <>
                  <Field label="Label">
                    <Input value={selectedField.label} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, label: e.target.value }))} />
                  </Field>
                  <Field label="Field id">
                    <Input value={selectedField.id} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, id: e.target.value.trim() }))} />
                  </Field>
                  <Field label="Type">
                    <Select value={selectedField.type} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, type: e.target.value as FormFieldType }))}>
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                  {(selectedField.type === 'text' || selectedField.type === 'email' || selectedField.type === 'number' || selectedField.type === 'textarea') && (
                    <>
                      <Field label="Placeholder">
                        <Input value={selectedField.placeholder ?? ''} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, placeholder: e.target.value }))} />
                      </Field>
                      <Field label="Help text">
                        <Input value={selectedField.helpText ?? ''} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, helpText: e.target.value }))} />
                      </Field>
                    </>
                  )}

                  {(selectedField.type === 'select' || selectedField.type === 'radio' || selectedField.type === 'checkbox') && (
                    <Field label="Options (one label per line)">
                      <Textarea
                        rows={4}
                        value={selectedField.options.map((o) => o.label).join('\n')}
                        onChange={(e) =>
                          updateField(selectedField.id, (f) => {
                            const labels = parseLines(e.target.value);
                            return {
                              ...f,
                              options: labels.map((label) => ({ label, value: normalizeOptionValue(label) })),
                            };
                          })
                        }
                      />
                    </Field>
                  )}

                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={!!selectedField.required} onChange={(e) => updateField(selectedField.id, (f) => ({ ...f, required: e.target.checked }))} />
                    Always required
                  </label>

                  <ConditionEditor
                    title="Show if"
                    conditions={selectedField.showWhen ?? []}
                    fields={draft.fields.filter((f) => f.id !== selectedField.id)}
                    onChange={(next) => updateField(selectedField.id, (f) => ({ ...f, showWhen: next }))}
                  />

                  <ConditionEditor
                    title="Required if"
                    conditions={selectedField.requiredWhen ?? []}
                    fields={draft.fields.filter((f) => f.id !== selectedField.id)}
                    onChange={(next) => updateField(selectedField.id, (f) => ({ ...f, requiredWhen: next }))}
                  />

                  <Button variant="ghost" size="sm" onClick={() => removeField(selectedField.id)}>
                    <Trash2 className="w-4 h-4" />
                    Remove field
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {builderErrors.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {builderErrors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {editingId && <Button variant="ghost" onClick={reset}>Cancel edit</Button>}
          <Button onClick={save} disabled={create.isPending || update.isPending}>
            <Save className="w-4 h-4" />
            {editingId ? 'Save changes' : 'Create form'}
          </Button>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mb-2">My forms · {forms.data?.length ?? 0}</div>
        {!forms.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-24" />
        ) : forms.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">{emptyTitle}</div>
            <p className="mt-1 text-sm text-gray-500">{emptyHint}</p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {forms.data.map((form) => {
              const linkedProject = form.projectId ? projectsById.get(form.projectId) : null;
              const resolvedClientId = form.clientId ?? linkedProject?.clientId ?? null;
              const clientName = resolvedClientId ? clientsById.get(resolvedClientId) ?? null : null;
              const projectName = linkedProject?.name ?? null;

              return (
                <li key={form.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                      <FormInput className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-gray-900 truncate">{form.name}</div>
                        <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-gray-100 text-gray-600">{form.status}</span>
                        <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700">{form.visibility}</span>
                      </div>
                      {form.description && <div className="text-xs text-gray-500 mt-1">{form.description}</div>}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                        {clientName && (
                          <button
                            type="button"
                            onClick={() => resolvedClientId && onOpenClient?.(resolvedClientId)}
                            disabled={!resolvedClientId || !onOpenClient}
                            className="inline-flex items-center rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold uppercase tracking-wider hover:bg-indigo-100"
                          >
                            Client · {clientName}
                          </button>
                        )}
                        {projectName && (
                          <button
                            type="button"
                            onClick={() => form.projectId && onOpenProject?.(form.projectId)}
                            disabled={!form.projectId || !onOpenProject}
                            className="inline-flex items-center rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 font-semibold uppercase tracking-wider hover:bg-sky-100"
                          >
                            Project · {projectName}
                          </button>
                        )}
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold uppercase tracking-wider">{form.views} views</span>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 font-semibold uppercase tracking-wider">{form.interactions} interactions</span>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 font-semibold uppercase tracking-wider">{form.submissions} submissions</span>
                      </div>

                      <div className="mt-2 text-xs text-gray-500">Updated {relativeFromIso(form.updatedAt)}</div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(form)} title="Edit form"><Save className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setEmbedFormId(form.id)} title="Embed snippet"><Link2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setSubmissionsFormId(form.id)} title="View submissions"><FileSpreadsheet className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => archive(form)} title="Archive"><Trash2 className="w-4 h-4 text-red-600" /></Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={!!embedFormId} onClose={() => setEmbedFormId(null)} title="Embed form" size="2xl">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Paste this snippet where the form should render. Runtime is namespaced and enforces allowed domains/paths.</p>
          <Textarea rows={6} value={embedSnippet.data?.snippet ?? ''} readOnly />
          {embedSnippet.isLoading && <div className="text-sm text-gray-500">Loading snippet...</div>}
          {embedSnippet.isError && <div className="text-sm text-red-600">Could not load embed snippet.</div>}
          <div className="flex justify-end">
            <Button onClick={copySnippet} disabled={!embedSnippet.data?.snippet}><Copy className="w-4 h-4" />Copy snippet</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!submissionsFormId} onClose={() => setSubmissionsFormId(null)} title="Submissions" size="4xl">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-500">Latest {submissions.data?.length ?? 0} submissions</div>
            {submissionsFormId && (
              <a href={formSubmissionsCsvUrl(submissionsFormId)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-brand-300 text-sm font-semibold text-gray-700">
                <FileSpreadsheet className="w-4 h-4" />
                Export CSV
              </a>
            )}
          </div>
          {submissions.isLoading ? (
            <div className="text-sm text-gray-500">Loading submissions...</div>
          ) : submissions.isError ? (
            <div className="text-sm text-red-600">Could not load submissions.</div>
          ) : !submissions.data || submissions.data.length === 0 ? (
            <div className="text-sm text-gray-500">No submissions yet.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">When</th>
                    <th className="text-left p-2 font-semibold text-gray-600">Session</th>
                    <th className="text-left p-2 font-semibold text-gray-600">Answers</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.data.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 align-top">
                      <td className="p-2 text-gray-600 whitespace-nowrap">{relativeFromIso(row.submittedAt)}</td>
                      <td className="p-2 text-gray-500 font-mono text-xs">{row.sessionId ?? '—'}</td>
                      <td className="p-2"><pre className="text-xs text-gray-700 whitespace-pre-wrap">{JSON.stringify(row.answers, null, 2)}</pre></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function ConditionEditor({
  title,
  conditions,
  fields,
  onChange,
}: {
  title: string;
  conditions: FormFieldCondition[];
  fields: FormField[];
  onChange: (next: FormFieldCondition[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">{title}</div>
      {conditions.map((cond, idx) => {
        const operatorNeedsValue = cond.operator === 'equals' || cond.operator === 'not_equals' || cond.operator === 'includes';
        return (
          <div key={`${cond.fieldId}_${idx}`} className="grid grid-cols-1 gap-2">
            <Select
              value={cond.fieldId}
              onChange={(e) =>
                onChange(conditions.map((c, i) => (i === idx ? { ...c, fieldId: e.target.value } : c)))
              }
            >
              <option value="">Select field</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.label || f.id}</option>
              ))}
            </Select>
            <Select
              value={cond.operator}
              onChange={(e) =>
                onChange(conditions.map((c, i) => (i === idx ? { ...c, operator: e.target.value as FormFieldCondition['operator'] } : c)))
              }
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </Select>
            {operatorNeedsValue && (
              <Input
                value={cond.value == null ? '' : String(cond.value)}
                onChange={(e) =>
                  onChange(conditions.map((c, i) => (i === idx ? { ...c, value: e.target.value } : c)))
                }
                placeholder="Comparison value"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(conditions.filter((_, i) => i !== idx))}
            >
              <Trash2 className="w-4 h-4" />
              Remove condition
            </Button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange([
            ...conditions,
            { fieldId: fields[0]?.id ?? '', operator: 'equals', value: '' },
          ])
        }
        disabled={fields.length === 0}
      >
        <Plus className="w-4 h-4" />
        Add condition
      </Button>
    </div>
  );
}
