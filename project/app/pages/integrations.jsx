/* global React, Icon, useApp, byId, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Select, Empty, RESOURCE_TYPES, SEED_DRIVE_ITEMS */
const { useState: useIntState } = React;

// =============================================================================
// Admin > Integrations
// Google Drive (and others) — connection state, linked folders, browse, sync
// =============================================================================

const INTEGRATIONS_META = {
  drive: {
    name: 'Google Drive', color: '#2563eb', icon: 'folder',
    blurb: 'Index folders, link files to clients, attach docs to roadmap goals.',
  },
  github: {
    name: 'GitHub', color: '#111827', icon: 'code',
    blurb: 'Link repos to projects, surface PRs alongside time tracking.',
  },
  slack: {
    name: 'Slack', color: '#db2777', icon: 'send',
    blurb: 'Notify channels when periods close, todos are assigned, goals ship.',
  },
  quickbooks: {
    name: 'QuickBooks', color: '#22c55e', icon: 'chart',
    blurb: 'Sync approved time → invoices automatically.',
  },
};

function IntegrationsTab() {
  const { integrations } = useApp();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DriveCard data={integrations?.drive} />
        {['github', 'slack', 'quickbooks'].map((key) => (
          <SimpleIntegrationCard key={key} integrationKey={key} data={integrations?.[key]} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google Drive — featured card
// ---------------------------------------------------------------------------
function DriveCard({ data }) {
  const { clients, connectIntegration, disconnectIntegration, updateIntegration, linkDriveFolder, unlinkDriveFolder, syncDrive } = useApp();
  const meta = INTEGRATIONS_META.drive;
  const [connectModal, setConnectModal] = useIntState(false);
  const [linkModal, setLinkModal]       = useIntState(false);
  const [browseModal, setBrowseModal]   = useIntState(null); // folder id

  const connected = !!data?.connected;
  const folders = data?.linkedFolders || [];
  const lastSync = data?.lastSyncAt ? new Date(data.lastSyncAt) : null;
  const totalItems = folders.reduce((s, f) => s + (f.itemCount || 0), 0);

  return (
    <Card className="md:col-span-2 overflow-hidden">
      {/* header */}
      <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
            <Icon name={meta.icon} className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900 text-lg">{meta.name}</h2>
              {connected ? <Pill color="green"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>Connected</Pill> : <Pill color="gray">Not connected</Pill>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{meta.blurb}</p>
            {connected && (
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1"><Icon name="user" className="w-3 h-3" /><span className="font-semibold">{data.account}</span></span>
                {lastSync && <><span className="text-gray-300">·</span><span>Last sync {lastSync.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></>}
                <span className="text-gray-300">·</span>
                <span><span className="font-semibold">{totalItems}</span> indexed items</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {connected ? (
            <>
              <Button variant="outline" size="sm" onClick={() => syncDrive()}><Icon name="refresh" className="w-3.5 h-3.5" />Sync now</Button>
              <Button variant="ghost" size="sm" onClick={() => { if (confirm('Disconnect Google Drive? Linked folders will be unlinked.')) disconnectIntegration('drive'); }}>Disconnect</Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setConnectModal(true)}><Icon name="link" className="w-4 h-4" />Connect</Button>
          )}
        </div>
      </div>

      {connected && (
        <>
          {/* settings strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-x divide-gray-100 bg-gray-50/60">
            <div className="px-5 py-4">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">Auto-sync</div>
              <label className="inline-flex items-center gap-2 mt-1 cursor-pointer">
                <button onClick={() => updateIntegration('drive', { autoSync: !data.autoSync })}
                  className={`w-9 h-5 rounded-full relative transition-colors ${data.autoSync ? 'bg-purple-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${data.autoSync ? 'left-4' : 'left-0.5'}`}></span>
                </button>
                <span className="text-sm font-semibold text-gray-900">{data.autoSync ? 'On' : 'Off'}</span>
              </label>
            </div>
            <div className="px-5 py-4">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">Sync interval</div>
              <Select value={data.syncIntervalHours || 4} onChange={(e) => updateIntegration('drive', { syncIntervalHours: Number(e.target.value) })} className="!w-auto !py-1 mt-1">
                <option value="1">Every hour</option>
                <option value="4">Every 4 hours</option>
                <option value="12">Every 12 hours</option>
                <option value="24">Daily</option>
              </Select>
            </div>
            <div className="px-5 py-4">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">Connected since</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{data.connectedAt}</div>
            </div>
          </div>

          {/* linked folders */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-900">Indexed folders</h3>
                <p className="text-xs text-gray-500 mt-0.5">Drive folders mapped to clients. Files inside become attachable to goals.</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => setLinkModal(true)}><Icon name="plus" className="w-3.5 h-3.5" />Link a folder</Button>
            </div>
            {folders.length === 0 ? (
              <Empty icon="folder" title="No folders indexed yet" hint="Link a Drive folder to a client to start surfacing docs in the portal." />
            ) : (
              <div className="space-y-2">
                {folders.map((f) => {
                  const c = byId(clients, f.clientId);
                  const sync = f.lastSync ? new Date(f.lastSync) : null;
                  return (
                    <div key={f.id} className="group flex items-center gap-3 px-3 py-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                        <Icon name="folder" className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-gray-900 text-sm font-mono truncate">{f.drivePath}</div>
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                          {c && <span className="inline-flex items-center gap-1"><Dot color={c.color} /><span className="font-semibold text-gray-700">{c.name}</span></span>}
                          <span className="text-gray-300">·</span>
                          <span>{f.itemCount} items</span>
                          {sync && <><span className="text-gray-300">·</span><span>Synced {sync.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span></>}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setBrowseModal(f)}>
                        <Icon name="search" className="w-3.5 h-3.5" />Browse
                      </Button>
                      <button onClick={() => unlinkDriveFolder(f.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:bg-red-100 hover:text-red-600 transition-all" title="Unlink">
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!connected && (
        <div className="p-8 text-center">
          <Icon name="folder" className="w-12 h-12 text-blue-300 mx-auto mb-3" />
          <p className="font-bold text-gray-900">Bring your docs into the studio.</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">Connect Google Drive once. Then map folders to clients so the team can drop docs onto goals without leaving Allebrum.</p>
          <Button variant="primary" className="mt-4" onClick={() => setConnectModal(true)}><Icon name="link" className="w-4 h-4" />Connect Google Drive</Button>
        </div>
      )}

      {connectModal && <ConnectDriveModal onClose={() => setConnectModal(false)} onConnect={(payload) => { connectIntegration('drive', payload); setConnectModal(false); }} />}
      {linkModal && <LinkFolderModal onClose={() => setLinkModal(false)} onSubmit={(payload) => { linkDriveFolder(payload); setLinkModal(false); }} />}
      {browseModal && <BrowseFolderModal folder={browseModal} onClose={() => setBrowseModal(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function SimpleIntegrationCard({ integrationKey, data }) {
  const { connectIntegration, disconnectIntegration } = useApp();
  const meta = INTEGRATIONS_META[integrationKey];
  const connected = !!data?.connected;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.color}1a`, color: meta.color }}>
          <Icon name={meta.icon} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-900">{meta.name}</h3>
            {connected ? <Pill color="green">Connected</Pill> : <Pill color="gray">Not connected</Pill>}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{meta.blurb}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        {connected
          ? <Button variant="ghost" size="sm" onClick={() => disconnectIntegration(integrationKey)}>Disconnect</Button>
          : <Button variant="outline" size="sm" onClick={() => connectIntegration(integrationKey, {})}>Connect</Button>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function ConnectDriveModal({ onClose, onConnect }) {
  const { me } = useApp();
  const [step, setStep] = useIntState('intro'); // intro | authorizing | scope
  const [account, setAccount] = useIntState(me.email);

  React.useEffect(() => {
    if (step === 'authorizing') {
      const id = setTimeout(() => setStep('scope'), 1200);
      return () => clearTimeout(id);
    }
  }, [step]);

  return (
    <Modal open onClose={onClose} title="Connect Google Drive" size="md"
      footer={step === 'scope' ? <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onConnect({ account, autoSync: true, syncIntervalHours: 4, linkedFolders: [] })}>
          <Icon name="check" className="w-4 h-4" />Authorize & connect
        </Button>
      </> : null}
    >
      {step === 'intro' && (
        <div className="space-y-4 text-center py-2">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
            <Icon name="folder" className="w-8 h-8" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-lg">Sign in with Google</p>
            <p className="text-sm text-gray-500 mt-1">Allebrum will only read files in folders you explicitly link. We never modify your Drive.</p>
          </div>
          <Field label="Connect with Google account">
            <Input type="email" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="you@allebrum.com" />
          </Field>
          <Button variant="primary" className="w-full" onClick={() => setStep('authorizing')}>
            <Icon name="arrowRight" className="w-4 h-4" />Continue with Google
          </Button>
        </div>
      )}
      {step === 'authorizing' && (
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin mx-auto"></div>
          <p className="text-sm font-semibold text-gray-700 mt-4">Authorizing as {account}…</p>
          <p className="text-xs text-gray-500 mt-1">Redirecting to accounts.google.com (simulated)</p>
        </div>
      )}
      {step === 'scope' && (
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0">
              <Icon name="check" className="w-5 h-5" strokeWidth={3} />
            </div>
            <div>
              <div className="font-bold text-green-900 text-sm">Signed in as {account}</div>
              <div className="text-xs text-green-700">Ready to authorize Allebrum's Drive access.</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-2">Allebrum will be able to</div>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li className="flex items-start gap-2"><Icon name="check" className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /><span>See & open files in folders you explicitly link to clients</span></li>
              <li className="flex items-start gap-2"><Icon name="check" className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /><span>Index file metadata (titles, modified dates, paths)</span></li>
              <li className="flex items-start gap-2"><Icon name="x"     className="w-4 h-4 text-red-500   mt-0.5 shrink-0" /><span>Cannot edit, delete, or share your files</span></li>
              <li className="flex items-start gap-2"><Icon name="x"     className="w-4 h-4 text-red-500   mt-0.5 shrink-0" /><span>Cannot see files outside linked folders</span></li>
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LinkFolderModal({ onClose, onSubmit }) {
  const { clients } = useApp();
  const [drivePath, setDrivePath]   = useIntState('Allebrum LLC / Clients / ');
  const [clientId, setClientId]     = useIntState(clients[0]?.id);

  // Mock browse — a handful of fake folders to "browse"
  const suggestedFolders = [
    'Allebrum LLC / Clients / Capital Health',
    'Allebrum LLC / Clients / Bay Area Transit',
    'Allebrum LLC / Templates',
    'Allebrum LLC / Sales / Proposals',
  ];

  return (
    <Modal open onClose={onClose} title="Link a Drive folder to a client" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!drivePath.trim() || !clientId} onClick={() => onSubmit({ drivePath: drivePath.trim(), clientId, itemCount: 0 })}>
          <Icon name="link" className="w-4 h-4" />Link folder
        </Button>
      </>}>
      <div className="space-y-4">
        <Field label="Drive folder path">
          <Input value={drivePath} onChange={(e) => setDrivePath(e.target.value)} placeholder="Allebrum LLC / Clients / …" className="font-mono text-sm" />
        </Field>
        <div>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-2">Suggested folders</div>
          <div className="space-y-1.5">
            {suggestedFolders.map((p) => (
              <button key={p} onClick={() => setDrivePath(p)} className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border ${drivePath === p ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <Icon name="folder" className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-mono text-xs text-gray-700 truncate">{p}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Map to client" hint="Files inside this folder become attachable to goals on this client's roadmap.">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function BrowseFolderModal({ folder, onClose }) {
  const items = (SEED_DRIVE_ITEMS || []).filter((d) => d.folderId === folder.id);
  return (
    <Modal open onClose={onClose} title={folder.drivePath} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button></>}>
      <div className="text-xs text-gray-500 mb-3">{items.length} indexed items · synced {folder.lastSync ? new Date(folder.lastSync).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'never'}</div>
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
        {items.length === 0 && <div className="text-sm text-gray-500 text-center py-6">No items indexed yet — try a sync.</div>}
        {items.map((d) => {
          const t = RESOURCE_TYPES[d.kind] || RESOURCE_TYPES['drive-doc'];
          return (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${t.color}1a`, color: t.color }}>
                <Icon name={t.icon} className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-sm truncate">{d.title}</div>
                <div className="text-xs text-gray-500 truncate">{d.meta} · modified {d.modified}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

window.IntegrationsTab = IntegrationsTab;
