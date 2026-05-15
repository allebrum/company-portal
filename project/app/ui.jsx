/* global React, Icon */
// Reusable UI primitives for the portal — buttons, cards, pills, modals, etc.

const Button = ({ variant = 'primary', size = 'md', children, onClick, className = '', type = 'button', disabled, title, ...rest }) => {
  const sizes = {
    sm: 'px-3 py-1.5 text-sm rounded-md',
    md: 'px-4 py-2 text-sm rounded-lg',
    lg: 'px-6 py-3 text-base rounded-lg',
  };
  const variants = {
    primary:   'bg-purple-600 hover:bg-purple-700 text-white shadow-sm font-semibold',
    secondary: 'bg-white text-purple-700 hover:bg-purple-50 border border-purple-200 font-semibold',
    ghost:     'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium',
    ghostDark: 'text-white/80 hover:bg-white/10 hover:text-white font-medium',
    danger:    'bg-red-600 hover:bg-red-700 text-white font-semibold',
    success:   'bg-green-600 hover:bg-green-700 text-white font-semibold',
    outline:   'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 font-medium',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      className={`inline-flex items-center gap-1.5 transition-colors ${sizes[size]} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = '', as: As = 'div', ...rest }) => (
  <As className={`bg-white rounded-2xl border border-gray-100 shadow-lg ${className}`} {...rest}>{children}</As>
);

const Tile = ({ children, className = '', hover = false, ...rest }) => (
  <div
    className={`bg-white rounded-xl border border-gray-100 ${hover ? 'transition-shadow hover:shadow-lg' : 'shadow-sm'} ${className}`}
    {...rest}
  >
    {children}
  </div>
);

const Pill = ({ children, color = 'gray', className = '' }) => {
  const palettes = {
    gray:    'bg-gray-100 text-gray-700',
    purple:  'bg-purple-100 text-purple-800',
    green:   'bg-green-100 text-green-800',
    yellow:  'bg-yellow-100 text-yellow-800',
    red:     'bg-red-100 text-red-700',
    blue:    'bg-blue-100 text-blue-700',
    teal:    'bg-teal-100 text-teal-800',
    pink:    'bg-pink-100 text-pink-700',
    orange:  'bg-orange-100 text-orange-800',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${palettes[color] || palettes.gray} ${className}`}>{children}</span>;
};

const Eyebrow = ({ children, className = '' }) => (
  <p className={`text-[11px] uppercase tracking-widest font-semibold text-purple-600 ${className}`}>{children}</p>
);

const Avatar = ({ user, size = 32, className = '' }) => {
  if (!user) return null;
  return (
    <div
      className={`rounded-full text-white font-bold flex items-center justify-center shrink-0 ${className}`}
      style={{ background: user.color || '#9333ea', width: size, height: size, fontSize: size * 0.42 }}
      title={user.name}
    >
      {user.initials}
    </div>
  );
};

const AvatarStack = ({ users, max = 4, size = 28 }) => {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex -space-x-2 items-center">
      {shown.map((u) => (
        <div key={u.id} className="ring-2 ring-white rounded-full">
          <Avatar user={u} size={size} />
        </div>
      ))}
      {rest > 0 && (
        <div className="rounded-full bg-gray-200 text-gray-700 flex items-center justify-center ring-2 ring-white font-semibold"
             style={{ width: size, height: size, fontSize: size * 0.4 }}>
          +{rest}
        </div>
      )}
    </div>
  );
};

// Inline color dot for status / category
const Dot = ({ color = '#9333ea', size = 8, className = '' }) => (
  <span className={`inline-block rounded-full ${className}`} style={{ background: color, width: size, height: size }} />
);

const Section = ({ title, eyebrow, action, children, className = '' }) => (
  <section className={`${className}`}>
    {(title || eyebrow || action) && (
      <header className="flex items-end justify-between gap-4 mb-4">
        <div>
          {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
          {title && <h2 className="text-xl font-bold text-gray-900 leading-tight">{title}</h2>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
    )}
    {children}
  </section>
);

// Modal
const Modal = ({ open, onClose, title, children, footer, size = 'md' }) => {
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${widths[size]} max-h-[90vh] flex flex-col`}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors" aria-label="Close">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </header>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
};

// Form bits
const Field = ({ label, hint, children, className = '' }) => (
  <label className={`block ${className}`}>
    {label && <span className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">{label}</span>}
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </label>
);

const Input = ({ className = '', ...rest }) => (
  <input
    {...rest}
    className={`block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
  />
);
const Textarea = ({ className = '', ...rest }) => (
  <textarea
    {...rest}
    className={`block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
  />
);
const Select = ({ className = '', children, ...rest }) => (
  <select
    {...rest}
    className={`block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
  >
    {children}
  </select>
);

// Tab strip
const TabStrip = ({ tabs, value, onChange, className = '' }) => (
  <div className={`inline-flex bg-gray-100 rounded-lg p-1 ${className}`}>
    {tabs.map((t) => (
      <button
        key={t.value}
        onClick={() => onChange(t.value)}
        className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors flex items-center gap-1.5 ${value === t.value ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
      >
        {t.icon && <Icon name={t.icon} className="w-4 h-4" />}
        {t.label}
      </button>
    ))}
  </div>
);

const Empty = ({ icon = 'zap', title, hint, action }) => (
  <div className="text-center py-14 px-4">
    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-100 text-purple-600 mb-4">
      <Icon name={icon} className="w-7 h-7" />
    </div>
    <h3 className="font-bold text-gray-900">{title}</h3>
    {hint && <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

Object.assign(window, { Button, Card, Tile, Pill, Eyebrow, Avatar, AvatarStack, Dot, Section, Modal, Field, Input, Textarea, Select, TabStrip, Empty });
