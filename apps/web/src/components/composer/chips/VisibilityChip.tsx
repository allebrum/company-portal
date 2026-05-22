'use client';

import { Shield } from 'lucide-react';
import { ChipButton } from './ChipButton';

export function VisibilityChip({
  value,
  onChange,
}: {
  /** true = private to assignee, false = team-visible */
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <ChipButton active={value} onClick={() => onChange(!value)}>
      <Shield className="w-3.5 h-3.5" />
      {value ? 'Private to you' : 'Team-visible'}
    </ChipButton>
  );
}
