/* global React, Icon, useApp, byId, fmtMins, fmtMoney, Card, Tile, Pill, Avatar, AvatarStack, Eyebrow, Button, Section, Dot, STATUS_LABEL */

function PageDashboard() {
  const { me, users, clients, projects, goals, todos, entries, activity, startTimer, setRoute } = useApp();

  // ---- this-week metrics ----
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Sunday
  weekStart.setHours(0,0,0,0);
  const inWeek = entries.filter((e) => new Date(e.startIso) >= weekStart);
  const totalMinThisWeek = inWeek.reduce((s, e) => s + e.durationMin, 0);
  const myMinThisWeek = inWeek.filter((e) => e.userId === me.id).reduce((s, e) => s + e.durationMin, 0);
  const billableMin = inWeek.filter((e) => {
    const p = byId(projects, e.projectId);
    return p && p.billable;
  }).reduce((s, e) => s + e.durationMin, 0);
  const billableRev = inWeek.reduce((s, e) => {
    const p = byId(projects, e.projectId);
    const u = byId(users, e.userId);
    if (!p || !p.billable || !u) return s;
    return s + (e.durationMin / 60) * u.billable;
  }, 0);

  const myTodos = todos.filter((t) => t.assignee === me.id && t.status !== 'done').slice(0, 5);
  const liveGoals = goals.filter((g) => g.status === 'in-progress' || g.status === 'review').slice(0, 4);

  // hours by project this week (for the bar list)
  const byProject = {};
  inWeek.forEach((e) => { byProject[e.projectId] = (byProject[e.projectId] || 0) + e.durationMin; });
  const projRows = Object.entries(byProject)
    .map(([pid, m]) => ({ project: byId(projects, pid), min: m }))
    .filter((r) => r.project)
    .sort((a, b) => b.min - a.min)
    .slice(0, 5);
  const maxProjMin = projRows[0] ? projRows[0].min : 1;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Hey {me.name.split(' ')[0]}, let's ship some wicked fresh work.</h1>
          <p className="text-gray-500 mt-1">Here's what's happening across the studio this week.</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setRoute('time')}>
          <Icon name="play" className="w-4 h-4" />Track time
        </Button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile className="p-5">
          <div className="flex items-center justify-between">
            <Eyebrow>Studio · This week</Eyebrow>
            <div className="p-2 rounded-lg bg-purple-100 text-purple-700"><Icon name="clock" className="w-4 h-4" /></div>
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-2 tabular-nums">{fmtMins(totalMinThisWeek)}</div>
          <div className="text-xs text-gray-500 mt-1">across {users.length} team members</div>
        </Tile>
        <Tile className="p-5">
          <div className="flex items-center justify-between">
            <Eyebrow>You · This week</Eyebrow>
            <div className="p-2 rounded-lg bg-blue-100 text-blue-700"><Icon name="user" className="w-4 h-4" /></div>
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-2 tabular-nums">{fmtMins(myMinThisWeek)}</div>
          <div className="text-xs text-gray-500 mt-1">{Math.round((myMinThisWeek/2400)*100)}% of a 40-hour week</div>
        </Tile>
        <Tile className="p-5">
          <div className="flex items-center justify-between">
            <Eyebrow>Billable hours</Eyebrow>
            <div className="p-2 rounded-lg bg-green-100 text-green-700"><Icon name="check" className="w-4 h-4" /></div>
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-2 tabular-nums">{fmtMins(billableMin)}</div>
          <div className="text-xs text-gray-500 mt-1">{Math.round((billableMin / Math.max(totalMinThisWeek, 1)) * 100)}% billable rate</div>
        </Tile>
        <Tile className="p-5">
          <div className="flex items-center justify-between">
            <Eyebrow>Billable revenue</Eyebrow>
            <div className="p-2 rounded-lg bg-purple-100 text-purple-700"><Icon name="zap" className="w-4 h-4" /></div>
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-2 tabular-nums">{fmtMoney(billableRev)}</div>
          <div className="text-xs text-gray-500 mt-1">at current bill rates</div>
        </Tile>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: my todos + live goals */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <Section
              title="Your plate today"
              eyebrow="To-dos · Assigned to you"
              action={<Button variant="ghost" size="sm" onClick={() => setRoute('todos')}>View all<Icon name="arrowRight" className="w-4 h-4" /></Button>}
            >
              <div className="divide-y divide-gray-100">
                {myTodos.length === 0 && <div className="py-8 text-center text-sm text-gray-500">Inbox zero. Wicked.</div>}
                {myTodos.map((t) => {
                  const project = byId(projects, t.projectId);
                  const client = project ? byId(clients, project.clientId) : null;
                  return (
                    <div key={t.id} className="py-3 flex items-center gap-3">
                      <button className="w-5 h-5 rounded-md border-2 border-gray-300 hover:border-purple-500 transition-colors"></button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{t.title}</div>
                        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                          {client && (<><Dot color={client.color} /> {client.name}</>)}
                          <span>·</span>
                          <span>{project ? project.name : ''}</span>
                        </div>
                      </div>
                      <Pill color={t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'yellow' : 'gray'}>{t.priority}</Pill>
                      <Button variant="secondary" size="sm" onClick={() => startTimer({ projectId: t.projectId, note: t.title, todoId: t.id })}>
                        <Icon name="play" className="w-3.5 h-3.5" />Start
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Section>
          </Card>

          <Card className="p-5">
            <Section
              title="Goals in flight"
              eyebrow="Roadmap · Active"
              action={<Button variant="ghost" size="sm" onClick={() => setRoute('roadmap')}>Open roadmap<Icon name="arrowRight" className="w-4 h-4" /></Button>}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {liveGoals.map((g) => {
                  const client = byId(clients, g.clientId);
                  const owner = byId(users, g.owner);
                  return (
                    <Tile key={g.id} className="p-4" hover>
                      <div className="flex items-start gap-3">
                        <div className="w-1 self-stretch rounded-full" style={{ background: client ? client.color : '#9333ea' }}></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] uppercase tracking-widest font-semibold text-gray-400 flex items-center gap-2">
                            {client && <span>{client.name}</span>}
                            <span>·</span>
                            <span>{g.tag}</span>
                          </div>
                          <div className="font-semibold text-gray-900 mt-0.5 leading-snug">{g.title}</div>
                          <div className="flex items-center justify-between mt-3">
                            <Pill color={g.status === 'review' ? 'yellow' : 'purple'}>{STATUS_LABEL[g.status]}</Pill>
                            {owner && <Avatar user={owner} size={26} />}
                          </div>
                        </div>
                      </div>
                    </Tile>
                  );
                })}
              </div>
            </Section>
          </Card>
        </div>

        {/* Right: project hours + activity */}
        <div className="space-y-6">
          <Card className="p-5">
            <Section title="Where the hours went" eyebrow="This week · Top projects">
              <div className="space-y-3 mt-2">
                {projRows.map(({ project, min }) => {
                  const client = byId(clients, project.clientId);
                  return (
                    <div key={project.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Dot color={client ? client.color : '#9333ea'} />
                          <span className="font-semibold text-gray-900 truncate">{project.name}</span>
                        </div>
                        <span className="text-gray-500 tabular-nums">{fmtMins(min)}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(min/maxProjMin)*100}%`, background: client ? client.color : '#9333ea' }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          </Card>

          <Card className="p-5">
            <Section title="Activity" eyebrow="Studio · Last 48 hours">
              <ul className="space-y-3 mt-2">
                {activity.slice(0, 6).map((a) => {
                  const u = byId(users, a.who);
                  return (
                    <li key={a.id} className="flex items-start gap-3 text-sm">
                      {u && <Avatar user={u} size={28} />}
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-900"><span className="font-semibold">{u ? u.name.split(' ')[0] : 'Someone'}</span> <span className="text-gray-500">{a.kind.replace('.', ' ')}</span></div>
                        <div className="text-xs text-gray-500 truncate">{a.target}</div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-400 mt-0.5">{a.when}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </Card>
        </div>
      </div>
    </div>
  );
}

window.PageDashboard = PageDashboard;
