/* global React */
// Lucide-style line icons. 24×24 viewbox, stroke=2, currentColor.

const ICON_PATHS = {
  play:        'M8 5v14l11-7z',
  pause:       'M6 5h4v14H6zM14 5h4v14h-4z',
  stop:        'M6 6h12v12H6z',
  plus:        'M12 5v14M5 12h14',
  minus:       'M5 12h14',
  check:       'M5 13l4 4L19 7',
  x:           'M6 6l12 12M18 6L6 18',
  search:     'M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  clock:       'M12 8v4l3 2M12 2a10 10 0 110 20 10 10 0 010-20z',
  list:        'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  kanban:      'M3 4h4v16H3zM10 4h4v10h-4zM17 4h4v6h-4z',
  gantt:       'M3 6h8M7 12h10M11 18h8',
  chart:       'M4 19V5M4 19h16M8 15l3-4 3 3 5-7',
  pie:         'M21 12A9 9 0 1112 3v9h9z',
  download:    'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  filter:      'M3 4h18l-7 9v7l-4-2v-5L3 4z',
  cog:         'M12 8a4 4 0 100 8 4 4 0 000-8zm9 4a8.96 8.96 0 00-.13-1.5l2-1.55-2-3.46-2.34.94a9 9 0 00-2.6-1.5L15.5 2h-4l-.43 2.93a9 9 0 00-2.6 1.5L6.13 5.5l-2 3.46 2 1.55A8.96 8.96 0 004 12c0 .51.04 1.01.13 1.5l-2 1.55 2 3.46 2.34-.94a9 9 0 002.6 1.5L9.5 22h4l.43-2.93a9 9 0 002.6-1.5l2.34.94 2-3.46-2-1.55c.09-.49.13-.99.13-1.5z',
  user:        'M16 14a4 4 0 10-8 0M12 11a3 3 0 100-6 3 3 0 000 6zM4 20a8 8 0 0116 0',
  users:       'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  mail:        'M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z',
  briefcase:   'M3 8h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm6-3a2 2 0 012-2h2a2 2 0 012 2v3H9V5z',
  folder:      'M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  target:      'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 12m-7 0a7 7 0 1014 0 7 7 0 10-14 0M22 12h-3M12 2v3M2 12h3M12 19v3',
  home:        'M3 12L12 3l9 9v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z',
  zap:         'M13 2L3 14h7v8l10-12h-7z',
  bell:        'M15 17h5l-1.4-1.4A2 2 0 0118 14V11a6 6 0 00-12 0v3a2 2 0 01-.6 1.6L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  arrowRight:  'M5 12h14M13 5l7 7-7 7',
  arrowLeft:   'M19 12H5M11 5l-7 7 7 7',
  arrowUp:     'M12 19V5M5 12l7-7 7 7',
  arrowDown:   'M12 5v14M19 12l-7 7-7-7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp:   'M18 15l-6-6-6 6',
  chevronRight:'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  more:        'M5 12h.01M12 12h.01M19 12h.01',
  dots:        'M12 5h.01M12 12h.01M12 19h.01',
  trash:       'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
  edit:        'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-2-11l4 4-9 9H8v-4l9-9z',
  link:        'M10 14a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5M14 10a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5',
  flag:        'M4 21V4m0 0h12l-2 4 2 4H4',
  building:    'M3 21h18M5 21V7l8-4 8 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01',
  shield:      'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  exportIcon:  'M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7m4-5l5-5 5 5M12 2v13',
  calendar:    'M3 8h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM8 2v4M16 2v4',
  bolt:        'M13 2L3 14h7v8l10-12h-7z',
  star:        'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z',
  send:        'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  refresh:     'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
};

function Icon({ name, className = 'w-5 h-5', strokeWidth = 2 }) {
  const d = ICON_PATHS[name] || ICON_PATHS.dots;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d}></path>
    </svg>
  );
}

window.Icon = Icon;
