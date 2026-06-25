'use client';

import Link from 'next/link';
import { ArrowRight, FormInput, Globe, QrCode } from 'lucide-react';

/**
 * F24 — Tools landing page. Cards-grid index of available utilities.
 * New tools land here as additional cards; the sidebar entry doesn't
 * need to grow until we have 5+.
 */

type Tool = {
  href: string;
  label: string;
  description: string;
  Icon: typeof QrCode;
  color: string;
};

const TOOLS: Tool[] = [
  {
    href: '/tools/qr',
    label: 'QR Code Generator',
    description: 'Mint trackable QR codes; see who scanned which and when.',
    Icon: QrCode,
    color: '#9333ea',
  },
  {
    href: '/tools/websites',
    label: 'Website Memory Bank',
    description: 'Track website vendors, costs, assignees, and encrypted credentials.',
    Icon: Globe,
    color: '#0284c7',
  },
  {
    href: '/tools/forms',
    label: 'Form Builder',
    description: 'Design embeddable forms, track views/interactions, and export submissions.',
    Icon: FormInput,
    color: '#b45309',
  },
];

export default function ToolsPage() {
  return (
    <div className="space-y-7">
      <div>
        <div className="eyebrow">Workspace</div>
        <h1 className="text-3xl font-bold text-gray-900">Tools</h1>
        <p className="mt-1 text-sm text-gray-500">
          Lightweight utilities for everyday workspace work.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group rounded-2xl border border-gray-200 bg-white p-5 hover:border-brand-300 hover:shadow-md transition-all"
          >
            <div className="flex items-start gap-3">
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                style={{ backgroundColor: t.color }}
              >
                <t.Icon className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-gray-900 group-hover:text-brand-700 transition-colors">
                  {t.label}
                </div>
                <p className="mt-1 text-[13px] text-gray-500">{t.description}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-700 transition-colors mt-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
