'use client';

import { FormBuilderManager } from '@/components/tools/FormBuilderManager';
import { useSpace } from '@/contexts/SpaceContext';
import { useAuth } from '@/hooks/useAuth';
import { Empty } from '@/components/ui/Card';

export default function FormsToolPage() {
  const { openSpace } = useSpace();
  const { can } = useAuth();
  const canView = can('forms.view');

  if (!canView) {
    return <Empty title="No access" description="You don't have permission to view forms." />;
  }

  return (
    <div className="space-y-7 max-w-6xl">
      <div>
        <div className="eyebrow">Tools</div>
        <h1 className="text-2xl font-bold text-gray-900">Form Builder</h1>
        <p className="mt-1 text-sm text-gray-500">
          Build embeddable forms with drag-and-drop fields, validation, analytics, and submission exports.
        </p>
      </div>

      <FormBuilderManager
        onOpenClient={(id) => openSpace({ kind: 'client', id })}
        onOpenProject={(id) => openSpace({ kind: 'project', id })}
        canCreate={can('forms.create')}
        canDelete={can('forms.delete')}
      />
    </div>
  );
}
