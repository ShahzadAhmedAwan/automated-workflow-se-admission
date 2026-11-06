import { useState, useEffect } from 'react';
import { marketingApi } from './marketingApi.js';
import {
  IconPlus,
  IconRefresh,
  IconSend,
  IconChat,
  IconCheck,
  IconClose,
  IconMegaphone,
} from '../../core/icons/Icons.jsx';
import { MetricStrip, SectionTabs, StatusBadge, WorkspacePanel } from '../../core/ui/primitives.jsx';

const simulatorStatusLabels = {
  AWAITING_INTEREST: 'Waiting for reply',
  AWAITING_MARKS: 'Waiting for marks',
  AWAITING_MATHS: 'Waiting for subject reply',
  QUALIFIED: 'Qualified',
  INELIGIBLE: 'Not qualified',
};

const campaignStatusLabels = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
};

export function MarketingModuleView() {
  const [activeTab, setActiveTab] = useState('campaigns'); // 'campaigns' | 'csv' | 'simulator'
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [campaignDesc, setCampaignDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);

  // CSV Dry-run Ingestion
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [selectedTargetCampaign, setSelectedTargetCampaign] = useState('');
  const [committing, setCommitting] = useState(false);

  // Live Simulator
  const [simPhone, setSimPhone] = useState('923001234567');
  const [simMessage, setSimMessage] = useState('Yes');
  const [simHistory, setSimHistory] = useState([
    {
      direction: 'OUTBOUND',
      text: 'Assalam-o-Alaikum! Are you interested in Software Engineering admissions for Fall 2026? (Reply Yes/No)',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [simTurnState, setSimTurnState] = useState('AWAITING_INTEREST');
  const [simSending, setSimSending] = useState(false);

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    setLoading(true);
    setError('');
    try {
      const data = await marketingApi.listCampaigns();
      setCampaigns(data || []);
      if (data?.length && !selectedTargetCampaign) {
        setSelectedTargetCampaign(data[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCampaign(e) {
    e.preventDefault();
    if (!campaignName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await marketingApi.createCampaign(campaignName.trim(), campaignDesc.trim());
      setSuccess('Campaign created.');
      setCampaignName('');
      setCampaignDesc('');
      setShowCreateCampaign(false);
      await loadCampaigns();
    } catch (err) {
      setError(err.message || 'Could not create campaign.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDryRunPreview(e) {
    e.preventDefault();
    if (!file) return;
    setParsing(true);
    setError('');
    setPreview(null);
    try {
      const result = await marketingApi.previewCsv(file);
      setPreview(result);
    } catch (err) {
      setError(err.message || 'Error processing CSV file.');
    } finally {
      setParsing(false);
    }
  }

  async function handleCommitLeads() {
    if (!selectedTargetCampaign || !preview?.validLeads?.length) return;
    setCommitting(true);
    setError('');
    try {
      const res = await marketingApi.importLeads(selectedTargetCampaign, preview.validLeads);
      setSuccess(`Added ${res.insertedCount} applicants to the campaign.`);
      setPreview(null);
      setFile(null);
      await loadCampaigns();
    } catch (err) {
      setError(err.message || 'Failed to commit leads.');
    } finally {
      setCommitting(false);
    }
  }

  async function handleTriggerOutreach(campaign) {
    if (!window.confirm(`Start WhatsApp outreach for "${campaign.name}"?`)) return;
    try {
      const res = await marketingApi.triggerOutreach(campaign.id);
      setSuccess(`Outreach started. ${res.scheduledCount} messages are scheduled.`);
      loadCampaigns();
    } catch (err) {
      setError(err.message || 'Failed to trigger outreach.');
    }
  }

  async function handleSendSimulatedTurn(e) {
    e.preventDefault();
    if (!simMessage.trim()) return;
    setSimSending(true);

    const userText = simMessage.trim();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setSimHistory((prev) => [
      ...prev,
      { direction: 'INBOUND', text: userText, timestamp: timeStr },
    ]);
    setSimMessage('');

    try {
      const res = await marketingApi.simulateInboundMessage(simPhone, userText);
      setSimTurnState(res.state);
      setSimHistory((prev) => [
        ...prev,
        { direction: 'OUTBOUND', text: res.reply, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    } catch (err) {
      setSimHistory((prev) => [
        ...prev,
        { direction: 'OUTBOUND', text: `Error: ${err.message}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    } finally {
      setSimSending(false);
    }
  }

  // Summary Metrics
  const totalLeadsCount = campaigns.reduce((acc, c) => acc + (c.totalLeads || 0), 0);
  const totalSentCount = campaigns.reduce((acc, c) => acc + (c.sentCount || 0), 0);
  const totalEligibleCount = campaigns.reduce((acc, c) => acc + (c.eligibleCount || 0), 0);

  return (
    <div className="space-y-5">
      {/* Top Banner Alert Messages */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-emerald-600" />
            {success}
          </span>
          <button onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      <SectionTabs
        label="Admissions workspace"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'campaigns', label: 'Campaigns' },
          { id: 'csv', label: 'Import applicants' },
          { id: 'simulator', label: 'Message simulator' },
        ]}
      />

      {activeTab === 'campaigns' && (
        <MetricStrip
          label="Fall 2026 intake totals"
          items={[
            { label: 'Applicants', value: totalLeadsCount },
            { label: 'Messages sent', value: totalSentCount },
            { label: 'Qualified', value: totalEligibleCount, tone: 'blue' },
          ]}
        />
      )}

      {/* ======================= TAB 1: CAMPAIGNS ======================= */}
      {activeTab === 'campaigns' && (
        <WorkspacePanel
          title="Campaigns"
          description={`${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'}`}
          actions={(
            <>
              <button type="button" onClick={loadCampaigns} disabled={loading} aria-label="Refresh campaigns" title="Refresh campaigns" className="grid size-9 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-blue-700 disabled:opacity-50">
                <IconRefresh className="size-4" />
              </button>
              <button type="button" onClick={() => setShowCreateCampaign((shown) => !shown)} aria-expanded={showCreateCampaign} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-blue-700 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800">
                {showCreateCampaign ? <IconClose className="size-4" /> : <IconPlus className="size-4" />}
                {showCreateCampaign ? 'Close form' : 'New campaign'}
              </button>
            </>
          )}
        >

              {showCreateCampaign && (
                <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 gap-4 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2 sm:px-6">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">Campaign name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fall 2026 applicants"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  type="text"
                  placeholder="Add a short note"
                  value={campaignDesc}
                  onChange={(e) => setCampaignDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={() => setShowCreateCampaign(false)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/70">Cancel</button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <IconPlus className="w-4 h-4" />
                  <span>{creating ? 'Creating…' : 'Create campaign'}</span>
                </button>
              </div>
            </form>
              )}

            {loading ? (
              <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-sm text-slate-500" aria-live="polite">
                <span className="size-6 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
                <span>Loading campaigns…</span>
              </div>
            ) : campaigns.length === 0 ? (
              <div className="grid min-h-52 place-content-center justify-items-center px-6 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-blue-50 text-blue-700"><IconMegaphone className="size-5" /></span>
                <p className="mb-0 mt-3 text-sm font-semibold text-slate-800">No campaigns yet</p>
                <p className="mb-0 mt-1 max-w-xs text-xs leading-5 text-slate-500">Start an intake campaign to organize applicant outreach.</p>
                <button type="button" onClick={() => setShowCreateCampaign(true)} className="mt-3 rounded-md px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50">Create your first campaign <span aria-hidden="true">→</span></button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm text-slate-700">
                  <thead className="border-b border-slate-100 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-[.055em] text-slate-600">
                    <tr>
                      <th className="px-5 py-3.5 sm:px-6">Campaign</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5 text-right">Applicants</th>
                      <th className="px-4 py-3.5 text-right">Sent</th>
                      <th className="px-4 py-3.5 text-right">Qualified</th>
                      <th className="px-5 py-3.5 text-right sm:px-6">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="transition hover:bg-slate-50/70">
                        <td className="max-w-[220px] px-5 py-4 sm:px-6">
                          <div className="truncate font-medium text-slate-900">{c.name}</div>
                          {c.description && <div className="mt-1 truncate text-[11px] text-slate-500">{c.description}</div>}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{campaignStatusLabels[c.status] || c.status}</StatusBadge>
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-slate-700">{c.totalLeads}</td>
                        <td className="px-4 py-4 text-right tabular-nums text-slate-600">{c.sentCount}</td>
                        <td className="px-4 py-4 text-right tabular-nums font-medium text-emerald-700">{c.eligibleCount}</td>
                        <td className="px-5 py-4 text-right sm:px-6">
                          <button
                            onClick={() => handleTriggerOutreach(c)}
                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                          >
                            <IconSend className="size-3.5" /> Start
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </WorkspacePanel>
      )}

      {/* ======================= TAB 2: TWO-STAGE CSV INGESTION ======================= */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1.5">
              Preview applicant file
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              Upload a CSV to check applicant details before adding them to a campaign.
            </p>

            <form onSubmit={handleDryRunPreview} className="flex flex-col sm:flex-row gap-4 items-center">
              <input
                type="file"
                accept=".csv"
                required
                onChange={(e) => setFile(e.target.files[0])}
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 cursor-pointer"
              />

              <button
                type="submit"
                disabled={parsing || !file}
                className="w-full sm:w-auto px-6 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {parsing ? 'Checking file…' : 'Preview file'}
              </button>
            </form>
          </div>

          {/* Dry-Run Results & Stage 2 Commit Box */}
          {preview && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Rows in file</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{preview.totalRows}</div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                  <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">Ready to add</div>
                  <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{preview.validCount}</div>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200">
                  <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Already listed</div>
                  <div className="text-2xl font-bold font-mono text-amber-700 mt-1">{preview.duplicateCount}</div>
                </div>

                <div className="p-4 rounded-xl bg-red-50/60 border border-red-200">
                  <div className="text-[11px] font-semibold text-red-800 uppercase tracking-wider">Invalid phone numbers</div>
                  <div className="text-2xl font-bold font-mono text-red-700 mt-1">{preview.invalidPhoneCount}</div>
                </div>
              </div>

              {/* Sample Preview Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Applicant preview
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Name</th>
                        <th className="px-4 py-2.5">Phone in file</th>
                        <th className="px-4 py-2.5">Phone to use</th>
                        <th className="px-4 py-2.5">City</th>
                        <th className="px-4 py-2.5">Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.previewRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/75">
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{r.fullName}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">{r.phoneRaw}</td>
                          <td className="px-4 py-2.5 font-mono text-blue-700 font-medium">{r.phoneNormalized || '—'}</td>
                          <td className="px-4 py-2.5">{r.city || '—'}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge tone={r.status === 'VALID' ? 'success' : 'danger'}>{r.status === 'VALID' ? 'Ready' : 'Check number'}</StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Stage 2 Action Bar */}
              {preview.validCount > 0 && campaigns.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Add applicants to a campaign</div>
                    <div className="text-xs text-slate-500">{preview.validCount} applicants are ready to add.</div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <select
                      value={selectedTargetCampaign}
                      onChange={(e) => setSelectedTargetCampaign(e.target.value)}
                      className="px-3.5 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:outline-none"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                              {c.name}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleCommitLeads}
                      disabled={committing}
                      className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {committing ? 'Adding...' : `Add ${preview.validCount} applicants`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================= TAB 3: LIVE BOT CHAT SIMULATOR ======================= */}
      {activeTab === 'simulator' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Chat Panel */}
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col h-[580px]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/75 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <div>
                  <div className="text-sm font-bold text-slate-900">Message simulator</div>
                  <div className="text-xs text-slate-500">Applicant: +{simPhone}</div>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {simulatorStatusLabels[simTurnState] || 'In progress'}
              </span>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/25">
              {simHistory.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.direction === 'INBOUND' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[78%] rounded-xl px-4 py-3 text-sm shadow-xs ${
                      m.direction === 'INBOUND'
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <div className={`text-[10px] mt-1.5 text-right ${m.direction === 'INBOUND' ? 'text-blue-100' : 'text-slate-400'}`}>
                      {m.timestamp}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Turn Input */}
            <form onSubmit={handleSendSimulatedTurn} className="p-4 border-t border-slate-200 bg-white flex gap-3">
              <input
                type="text"
                placeholder="Type a reply…"
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={simSending || !simMessage.trim()}
                className="px-5 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <IconSend className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>

          {/* Reference Sidebar */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-900">How qualification works</h3>
            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">Interest</div>
                <div>Interested applicants are asked for their marks.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">Marks</div>
                <div>Applicants need at least 50% of their total marks.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">Mathematics</div>
                <div>Applicants must have studied Mathematics.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                <div className="font-bold mb-1">Next step</div>
                <div>Qualified applicants can continue to document verification.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
