/* global React, ReactDOM, AppProvider, useApp, Sidebar, TimerBar, PageDashboard, PageTime, PageTodos, PageRoadmap, PageApprovals, PageReports, PageAdmin, useTweaks, TweaksPanel, TweakSection, TweakRadio */
const { useEffect: useAppEffect } = React;

const ROUTES = {
  dashboard: PageDashboard,
  time:      PageTime,
  todos:     PageTodos,
  roadmap:   PageRoadmap,
  approvals: PageApprovals,
  reports:   PageReports,
  admin:     PageAdmin,
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "airy"
}/*EDITMODE-END*/;

function Shell() {
  const { route } = useApp();
  const Page = ROUTES[route] || PageDashboard;

  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // density: apply class to root
  useAppEffect(() => {
    document.documentElement.dataset.density = t.density;
  }, [t.density]);

  // keyboard shortcuts (T to start timer, N for new todo, / for search)
  useAppEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 't' || e.key === 'T') {
        document.querySelector('[data-start-shortcut]')?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TimerBar />
        <main className="flex-1 overflow-y-auto">
          <Page />
        </main>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Density" hint="Switch between airy (marketing-site rhythm) and dense (productivity tool).">
          <TweakRadio
            value={t.density}
            onChange={(v) => setTweak('density', v)}
            options={[
              { value: 'airy',  label: 'Airy' },
              { value: 'dense', label: 'Dense' },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
