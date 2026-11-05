import { useState, useEffect } from 'react';
import { marketingApi } from './marketingApi.js';
import {
  IconPlus,
  IconRefresh,
  IconSend,
  IconUploadCloud,
  IconChat,
  IconCheck,
  IconClose,
} from '../../core/icons/Icons.jsx';

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
      setSuccess(`Campaign "${campaignName}" created successfully.`);
      setCampaignName('');
      setCampaignDesc('');
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
      setSuccess(`Committed ${res.insertedCount} leads into campaign #${selectedTargetCampaign}.`);
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
    if (!window.confirm(`Trigger WhatsApp outreach for "${campaign.name}"? Outreach enqueues messages with 12–28s randomized anti-ban jitter.`)) return;
    try {
      const res = await marketingApi.triggerOutreach(campaign.id);
      setSuccess(`Enqueued ${res.scheduledCount} messages into outbox with anti-ban jitter.`);
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
    <div className="space-y-6">
      {/* Top Banner Alert Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between shadow-xs">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between shadow-xs">
          <span className="flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-emerald-600" />
            {success}
          </span>
          <button onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Ingested Leads</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{totalLeadsCount}</div>
            <div className="text-xs text-slate-400 mt-1">Across all active campaigns</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <IconUploadCloud className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Outreach Messages</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{totalSentCount}</div>
            <div className="text-xs text-slate-400 mt-1">Scheduled via anti-ban outbox</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <IconSend className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Qualified Candidates</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{totalEligibleCount}</div>
            <div className="text-xs text-slate-400 mt-1">Score ≥ 50% & Mathematics verified</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <IconCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Campaigns</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{campaigns.length}</div>
            <div className="text-xs text-slate-400 mt-1">Fall 2026 Admissions</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <IconRefresh className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Primary Sub-Navigation Strip */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`pb-3 px-1 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'campaigns'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Campaigns & Outreach
        </button>

        <button
          onClick={() => setActiveTab('csv')}
          className={`pb-3 px-1 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'csv'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Two-Stage CSV Ingestion
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`pb-3 px-1 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'simulator'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Conversational Qualification Simulator
        </button>
      </div>

      {/* ======================= TAB 1: CAMPAIGNS ======================= */}
      {activeTab === 'campaigns' && (
        <div className="space-y-6">
          {/* Create Campaign Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">Create Outreach Campaign</h3>
            <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fall 2026 Pre-Engineering Drive"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Audience Scope & Note</label>
                <input
                  type="text"
                  placeholder="e.g. Board colleges across AJK and Rawalpindi"
                  value={campaignDesc}
                  onChange={(e) => setCampaignDesc(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  <IconPlus className="w-4 h-4" />
                  <span>{creating ? 'Creating...' : 'Create Campaign'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Campaigns Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Active Campaigns ({campaigns.length})
              </h3>
              <button
                onClick={loadCampaigns}
                className="text-xs text-slate-600 hover:text-blue-600 font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                <IconRefresh className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading campaigns...</div>
            ) : campaigns.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No campaigns created yet. Use the form above to initialize your first campaign.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Campaign Reference</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3 font-mono">Total Leads</th>
                      <th className="px-6 py-3 font-mono">Dispatched</th>
                      <th className="px-6 py-3 font-mono">Qualified</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/75 transition">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${
                            c.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono font-medium">{c.totalLeads}</td>
                        <td className="px-6 py-4 font-mono font-medium text-slate-600">{c.sentCount}</td>
                        <td className="px-6 py-4">
                          <span className="font-mono font-bold text-emerald-700">{c.eligibleCount}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleTriggerOutreach(c)}
                            className="px-3.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <IconSend className="w-3.5 h-3.5" />
                            <span>Trigger Outreach</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= TAB 2: TWO-STAGE CSV INGESTION ======================= */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1.5">
              Stage 1: Memory-Safe Streaming Dry-Run
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              Upload an applicant CSV file. The memory-buffered stream normalizes phone numbers to standard E.164 and checks for duplicates prior to committing records.
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
                className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {parsing ? 'Analyzing...' : 'Run Dry-Run Preview'}
              </button>
            </form>
          </div>

          {/* Dry-Run Results & Stage 2 Commit Box */}
          {preview && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Rows In File</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{preview.totalRows}</div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                  <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">Valid New Leads</div>
                  <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{preview.validCount}</div>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200">
                  <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Duplicates Caught</div>
                  <div className="text-2xl font-bold font-mono text-amber-700 mt-1">{preview.duplicateCount}</div>
                </div>

                <div className="p-4 rounded-xl bg-red-50/60 border border-red-200">
                  <div className="text-[11px] font-semibold text-red-800 uppercase tracking-wider">Invalid Phone Numbers</div>
                  <div className="text-2xl font-bold font-mono text-red-700 mt-1">{preview.invalidPhoneCount}</div>
                </div>
              </div>

              {/* Sample Preview Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Parsed Data Sample (First 10 records)
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Candidate Name</th>
                        <th className="px-4 py-2.5 font-mono">Raw Phone</th>
                        <th className="px-4 py-2.5 font-mono">Normalized (E.164)</th>
                        <th className="px-4 py-2.5">City</th>
                        <th className="px-4 py-2.5">Verification Status</th>
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
                            <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                              r.status === 'VALID'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {r.status}
                            </span>
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
                    <div className="text-sm font-semibold text-slate-900">Stage 2: Batch Commit to Campaign</div>
                    <div className="text-xs text-slate-500">Commits {preview.validCount} valid records in batches of 250 rows.</div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <select
                      value={selectedTargetCampaign}
                      onChange={(e) => setSelectedTargetCampaign(e.target.value)}
                      className="px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:outline-none"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.id} - {c.name}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleCommitLeads}
                      disabled={committing}
                      className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {committing ? 'Committing...' : `Commit ${preview.validCount} Leads`}
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
                  <div className="text-sm font-bold text-slate-900">Conversational WhatsApp Qualification</div>
                  <div className="text-xs text-slate-500">Target Candidate: +{simPhone}</div>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                STATE: {simTurnState}
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
                placeholder="Type applicant response (e.g. Yes, 480/550, No)..."
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={simSending || !simMessage.trim()}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <IconSend className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>

          {/* Reference Sidebar */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Qualification Rules</h3>
            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">1. Interest Confirmation</div>
                <div>Replies like &quot;Yes&quot;, &quot;Han&quot;, &quot;Jee&quot;, &quot;Interested&quot; progress the applicant to academic marks collection.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">2. Academic Score Threshold (≥ 50%)</div>
                <div>Evaluates obtained and total marks (e.g. &quot;480/550&quot;, &quot;850/1100&quot;, or percentages). Scores &lt; 50% are automatically marked ineligible.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 mb-1">3. Mathematics Prerequisite</div>
                <div>Checks whether the candidate studied Mathematics in FSc/ICS. A negative response marks the lead ineligible.</div>
              </div>

              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                <div className="font-bold mb-1">Module 3 Handoff:</div>
                <div>Upon qualification, a <span className="font-mono font-bold">LEAD_QUALIFIED</span> event is dispatched to MySQL outbox for single-use token issuance.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
