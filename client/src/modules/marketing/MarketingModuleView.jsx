import { useState, useEffect } from 'react';
import { marketingApi } from './marketingApi.js';
import {
  IconPlus,
  IconRefresh,
  IconSend,
  IconCheck,
  IconClose,
  IconMegaphone,
  IconSearch,
  IconDownload,
  IconPencil,
  IconUsers,
} from '../../core/icons/Icons.jsx';
import { MetricStrip, SectionTabs, StatusBadge, WorkspacePanel, ConfirmDialog } from '../../core/ui/primitives.jsx';

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

const conversationStateLabels = {
  IDLE: 'Idle (Pending Outreach)',
  GREETING_SENT: 'Greeting Dispatched',
  AWAITING_INTEREST: 'Awaiting Interest',
  AWAITING_NAME: 'Awaiting Full Name',
  AWAITING_FATHER_NAME: 'Awaiting Father Name',
  AWAITING_MARKS: 'Awaiting FSc Marks',
  AWAITING_MATHS: 'Awaiting Maths Confirmation',
  AWAITING_CNIC: 'Awaiting CNIC / B-Form',
  AWAITING_EMAIL: 'Awaiting Email',
  QUALIFIED: 'Qualified for Admission',
  NOT_INTERESTED: 'Not Interested',
  GENERAL_INQUIRY: 'General Inquiry / Q&A',
};

export function MarketingModuleView() {
  const [activeTab, setActiveTab] = useState('leads'); // 'leads' | 'csv' | 'campaigns' | 'single' | 'simulator'
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  // Form State
  const [campaignName, setCampaignName] = useState('');
  const [campaignDesc, setCampaignDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);

  // Student Leads View State
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsSummary, setLeadsSummary] = useState({ total: 0, qualified: 0, pending: 0, ineligible: 0 });
  const [leadsPage, setLeadsPage] = useState(0);
  const leadsPageSize = 25;
  const [leadSearch, setLeadSearch] = useState('');
  const [leadCampaignFilter, setLeadCampaignFilter] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState('');
  const [leadStateFilter, setLeadStateFilter] = useState('');

  // Edit Lead Modal State
  const [editLeadModal, setEditLeadModal] = useState(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    fatherName: '',
    phone: '',
    cnic: '',
    email: '',
    city: '',
    priorDegree: '',
    fscMarks: '',
    hasMaths: true,
    eligibleFor: '',
    eligibilityStatus: 'PENDING',
    ineligibilityReason: '',
    conversationState: 'IDLE',
  });
  const [updatingLead, setUpdatingLead] = useState(false);

  // CSV Dry-run Ingestion
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [selectedTargetCampaign, setSelectedTargetCampaign] = useState('');
  const [committing, setCommitting] = useState(false);

  // Single Applicant Direct Outreach
  const [singleName, setSingleName] = useState('');
  const [singlePhone, setSinglePhone] = useState('');
  const [singleCampaignId, setSingleCampaignId] = useState('');
  const [singleCity, setSingleCity] = useState('');
  const [singleDegree, setSingleDegree] = useState('');
  const [singleCustomGreeting, setSingleCustomGreeting] = useState('');
  const [singleSending, setSingleSending] = useState(false);

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

  useEffect(() => {
    if (activeTab === 'leads') {
      loadLeads();
    }
  }, [activeTab, leadsPage, leadCampaignFilter, leadStatusFilter, leadStateFilter]);

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

  async function loadLeads() {
    setLeadsLoading(true);
    setError('');
    try {
      const data = await marketingApi.listLeads({
        campaignId: leadCampaignFilter || undefined,
        status: leadStatusFilter || undefined,
        conversationState: leadStateFilter || undefined,
        search: leadSearch || undefined,
        limit: leadsPageSize,
        offset: leadsPage * leadsPageSize,
      });
      setLeads(data.items || []);
      setLeadsTotal(data.total || 0);
      setLeadsSummary(data.summary || { total: 0, qualified: 0, pending: 0, ineligible: 0 });
    } catch (err) {
      setError(err.message || 'Failed to load student leads');
    } finally {
      setLeadsLoading(false);
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setLeadsPage(0);
    loadLeads();
  }

  function openEditModal(lead) {
    setEditLeadModal(lead);
    setEditForm({
      fullName: lead.fullName || '',
      fatherName: lead.fatherName || '',
      phone: lead.phoneNormalized || lead.phoneRaw || '',
      cnic: lead.cnic || '',
      email: lead.email || '',
      city: lead.city || '',
      priorDegree: lead.priorDegree || '',
      fscMarks: lead.fscMarks !== null && lead.fscMarks !== undefined ? String(lead.fscMarks) : '',
      hasMaths: lead.hasMaths !== false,
      eligibleFor: lead.eligibleFor || '',
      eligibilityStatus: lead.eligibilityStatus || 'PENDING',
      ineligibilityReason: lead.ineligibilityReason || '',
      conversationState: lead.conversationState || 'IDLE',
    });
  }

  async function handleSaveEditLead(e) {
    e.preventDefault();
    if (!editLeadModal) return;
    setUpdatingLead(true);
    setError('');
    try {
      const payload = {
        fullName: editForm.fullName.trim(),
        fatherName: editForm.fatherName.trim() || null,
        phone: editForm.phone.trim(),
        cnic: editForm.cnic.trim() || null,
        email: editForm.email.trim() || null,
        city: editForm.city.trim() || null,
        priorDegree: editForm.priorDegree.trim() || null,
        fscMarks: editForm.fscMarks.trim() !== '' ? Number(editForm.fscMarks) : null,
        hasMaths: Boolean(editForm.hasMaths),
        eligibleFor: editForm.eligibleFor.trim() || null,
        eligibilityStatus: editForm.eligibilityStatus,
        ineligibilityReason: editForm.ineligibilityReason.trim() || null,
        conversationState: editForm.conversationState,
      };

      await marketingApi.updateLead(editLeadModal.id, payload);
      setSuccess(`Student profile for "${payload.fullName}" saved and synchronized successfully.`);
      setEditLeadModal(null);
      await loadLeads();
      loadCampaigns();
    } catch (err) {
      setError(err.message || 'Failed to update student profile.');
    } finally {
      setUpdatingLead(false);
    }
  }

  async function handleDeleteLead(lead) {
    setConfirmModal({
      isOpen: true,
      title: 'Remove Student Lead',
      message: `Are you sure you want to remove student lead "${lead.fullName}" (${lead.phoneNormalized})? This will also remove any unverified intake draft record.`,
      confirmLabel: 'Remove Lead',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await marketingApi.deleteLead(lead.id);
          setSuccess(`Lead #${lead.id} removed.`);
          loadLeads();
          loadCampaigns();
        } catch (err) {
          setError(err.message || 'Failed to remove lead.');
        }
      },
    });
  }

  function downloadSampleCsv() {
    const headers = ['fullName', 'phone', 'fatherName', 'cnic', 'email', 'city', 'priorDegree', 'fscMarks', 'hasMaths', 'eligibleFor'];
    const sampleRows = [
      ['Muhammad Ali', '03001234567', 'Tariq Mahmood', '82101-1234567-1', 'ali.tariq@gmail.com', 'Mirpur', 'Pre-Engineering', '850', 'Yes', 'Software Engineering'],
      ['Ayesha Khan', '03129876543', 'Muhammad Khan', '82203-7654321-2', 'ayesha.k@yahoo.com', 'Islamabad', 'ICS', '790', 'Yes', 'Software Engineering'],
      ['Hamza Farooq', '03455554433', 'Farooq Ahmed', '82301-9988776-3', 'hamza.f@gmail.com', 'Rawalpindi', 'Pre-Medical', '680', 'No', 'Software Engineering Tech'],
    ];
    const csvContent = [headers.join(','), ...sampleRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'admissions_marketing_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      if (activeTab === 'leads') loadLeads();
    } catch (err) {
      setError(err.message || 'Failed to commit leads.');
    } finally {
      setCommitting(false);
    }
  }

  async function handleTriggerOutreach(campaign) {
    setConfirmModal({
      isOpen: true,
      title: 'Start WhatsApp Outreach',
      message: `Start WhatsApp outreach campaign for "${campaign.name}"? The system will enqueue personalized automated greeting messages to pending leads.`,
      confirmLabel: 'Start Outreach',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await marketingApi.triggerOutreach(campaign.id);
          setSuccess(`Outreach started. ${res.scheduledCount} messages are scheduled.`);
          loadCampaigns();
        } catch (err) {
          setError(err.message || 'Failed to trigger outreach.');
        }
      },
    });
  }

  async function handleSingleLeadSubmit(e) {
    e.preventDefault();
    if (!singleName.trim() || !singlePhone.trim()) return;
    setSingleSending(true);
    setError('');
    try {
      const res = await marketingApi.sendSingleLead({
        fullName: singleName.trim(),
        phone: singlePhone.trim(),
        campaignId: singleCampaignId ? Number(singleCampaignId) : undefined,
        city: singleCity.trim() || undefined,
        priorDegree: singleDegree.trim() || undefined,
        customGreeting: singleCustomGreeting.trim() || undefined,
      });
      setSuccess(`WhatsApp greeting dispatched to ${res.fullName} (${res.phoneNormalized}). The bot will guide them when they reply.`);
      setSingleName('');
      setSinglePhone('');
      setSingleCity('');
      setSingleDegree('');
      setSingleCustomGreeting('');
      await loadCampaigns();
    } catch (err) {
      setError(err.message || 'Failed to dispatch single message.');
    } finally {
      setSingleSending(false);
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

  // Summary Metrics for Campaigns
  const totalLeadsCount = campaigns.reduce((acc, c) => acc + (c.totalLeads || 0), 0);
  const totalSentCount = campaigns.reduce((acc, c) => acc + (c.sentCount || 0), 0);
  const totalEligibleCount = campaigns.reduce((acc, c) => acc + (c.eligibleCount || 0), 0);

  const totalLeadPages = Math.max(1, Math.ceil(leadsTotal / leadsPageSize));

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
          { id: 'leads', label: 'Student Leads Directory' },
          { id: 'csv', label: 'Import Applicants (CSV)' },
          { id: 'campaigns', label: 'Broadcast Campaigns' },
          { id: 'single', label: 'Single Lead Outreach' },
          { id: 'simulator', label: 'WhatsApp Bot Simulator' },
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

      {activeTab === 'leads' && (
        <MetricStrip
          label="Student Admissions Directory"
          items={[
            { label: 'Total Students', value: leadsSummary.total || leadsTotal },
            { label: 'Qualified', value: leadsSummary.qualified, tone: 'blue' },
            { label: 'Pending Review', value: leadsSummary.pending },
            { label: 'Ineligible', value: leadsSummary.ineligible },
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
                          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 cursor-pointer"
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

      {/* ======================= TAB 2: ALL APPLICANTS & LEADS (STUDENT DATA VIEW & EDIT) ======================= */}
      {activeTab === 'leads' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            {/* Clean Filter Pills and Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter(''); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    !leadStatusFilter
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  All ({leadsSummary.total || leadsTotal})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('ELIGIBLE'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'ELIGIBLE'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  Qualified ({leadsSummary.qualified || 0})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('PENDING'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'PENDING'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  Pending ({leadsSummary.pending || 0})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('INELIGIBLE'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'INELIGIBLE'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  Ineligible ({leadsSummary.ineligible || 0})
                </button>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px]">
                  <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                  <input
                    type="text"
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    placeholder="Search name, phone, CNIC…"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
                  />
                  {leadSearch && (
                    <button
                      type="button"
                      onClick={() => { setLeadSearch(''); setLeadsPage(0); }}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <IconClose className="size-3" />
                    </button>
                  )}
                </div>

                {campaigns.length > 1 && (
                  <select
                    value={leadCampaignFilter}
                    onChange={(e) => { setLeadCampaignFilter(e.target.value); setLeadsPage(0); }}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:bg-white focus:outline-none"
                  >
                    <option value="">All Campaigns</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}

                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 cursor-pointer"
                >
                  Search
                </button>
                <button
                  type="button"
                  onClick={loadLeads}
                  disabled={leadsLoading}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  title="Refresh leads list"
                >
                  <IconRefresh className="size-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Leads Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            {leadsLoading ? (
              <div className="grid min-h-56 place-content-center justify-items-center gap-3 text-sm text-slate-500">
                <span className="size-6 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
                <span>Loading student records…</span>
              </div>
            ) : leads.length === 0 ? (
              <div className="grid min-h-56 place-content-center justify-items-center px-6 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <IconUsers className="size-6" />
                </span>
                <p className="mb-0 mt-3 text-sm font-semibold text-slate-800">No applicants match this query</p>
                <p className="mb-0 mt-1 max-w-sm text-xs text-slate-500">
                  Try adjusting filters or upload applicant records using the CSV importer.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs text-slate-700">
                  <thead className="border-b border-slate-100 bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-[.05em] text-slate-600">
                    <tr>
                      <th className="px-5 py-3.5">Student Details</th>
                      <th className="px-4 py-3.5">Contact</th>
                      <th className="px-4 py-3.5">Academic Score</th>
                      <th className="px-4 py-3.5">Program</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="transition hover:bg-slate-50/70">
                        {/* Student Details */}
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900 text-sm">{lead.fullName}</div>
                          {lead.fatherName && (
                            <div className="text-[11px] text-slate-500">
                              S/O {lead.fatherName}
                            </div>
                          )}
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            CNIC: <span className="font-mono text-slate-700 font-medium">{lead.cnic || '—'}</span>
                            {lead.city ? ` · ${lead.city}` : ''}
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-4 py-3.5">
                          <div className="font-mono font-medium text-slate-800">{lead.phoneNormalized || lead.phoneRaw}</div>
                          {lead.email ? (
                            <div className="mt-0.5 truncate max-w-[180px] text-[11px] text-slate-500" title={lead.email}>
                              {lead.email}
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-slate-400 italic">No email on file</div>
                          )}
                        </td>

                        {/* Academic Background */}
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">
                            {lead.fscMarks !== null && lead.fscMarks !== undefined ? (
                              <span>{lead.fscMarks} <span className="text-slate-400 text-[11px]">/ 1100</span></span>
                            ) : (
                              '—'
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {lead.priorDegree || 'Group Unspecified'}
                            {lead.hasMaths ? ' · Maths' : ''}
                          </div>
                        </td>

                        {/* Program */}
                        <td className="px-4 py-3.5">
                          {lead.eligibleFor ? (
                            <span className="inline-block rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-100">
                              {lead.eligibleFor}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">General Candidate</span>
                          )}
                        </td>

                        {/* Clean Status Badge */}
                        <td className="px-4 py-3.5">
                          <StatusBadge
                            tone={
                              lead.eligibilityStatus === 'ELIGIBLE' || lead.conversationState === 'QUALIFIED'
                                ? 'success'
                                : lead.eligibilityStatus === 'INELIGIBLE'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {lead.eligibilityStatus === 'ELIGIBLE' || lead.conversationState === 'QUALIFIED'
                              ? 'Qualified'
                              : lead.eligibilityStatus === 'INELIGIBLE'
                                ? 'Ineligible'
                                : 'Pending'}
                          </StatusBadge>
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(lead)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition cursor-pointer"
                              title="Edit student profile"
                            >
                              <IconPencil className="size-3.5" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteLead(lead)}
                              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 transition cursor-pointer"
                              title="Delete record"
                            >
                              <IconClose className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {leadsTotal > leadsPageSize && (
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50/50">
                <span className="text-xs text-slate-500">
                  Showing {leadsPage * leadsPageSize + 1}–{Math.min((leadsPage + 1) * leadsPageSize, leadsTotal)} of {leadsTotal} students
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={leadsPage === 0 || leadsLoading}
                    onClick={() => setLeadsPage((p) => Math.max(0, p - 1))}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-slate-600 font-mono">
                    Page {leadsPage + 1} of {totalLeadPages}
                  </span>
                  <button
                    type="button"
                    disabled={leadsPage + 1 >= totalLeadPages || leadsLoading}
                    onClick={() => setLeadsPage((p) => Math.min(totalLeadPages - 1, p + 1))}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ======================= TAB 3: TWO-STAGE CSV INGESTION & FORMAT SPECIFICATION ======================= */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          {/* Prominent CSV Format Specification & Download Template Card */}
          <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/80 via-white to-blue-50/40 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-blue-100">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-800">
                  Standard Data Format
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-2">
                  Marketing CSV Upload Specification
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Prepare your spreadsheet using these standard columns. The parser fuzzy-matches headers automatically.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={downloadSampleCsv}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-blue-800 shadow-xs cursor-pointer"
                >
                  <IconDownload className="size-4" />
                  <span>Download Sample CSV Template</span>
                </button>
              </div>
            </div>

            {/* Format Specification Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-blue-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 pr-4">Column Header</th>
                    <th className="py-2.5 pr-4">Requirement</th>
                    <th className="py-2.5 pr-4">Accepted Aliases</th>
                    <th className="py-2.5 pr-4">Format / Example</th>
                    <th className="py-2.5">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-100/60 font-sans text-slate-700">
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">fullName</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">Required</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">name, student_name, candidate</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">Muhammad Ali</td>
                    <td className="py-2.5 text-slate-600">Applicant legal full name</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">phone</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">Required</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">contact, mobile, cell, whatsapp</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-900">03001234567 or 923001234567</td>
                    <td className="py-2.5 text-slate-600">Valid mobile number with WhatsApp capability</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">fatherName</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">father, guardian, parent_name</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">Tariq Mahmood</td>
                    <td className="py-2.5 text-slate-600">Father or legal guardian name</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">cnic</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">bform, national_id, id_card</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-900">82101-1234567-1 (13 digits)</td>
                    <td className="py-2.5 text-slate-600">CNIC or B-Form number</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">email</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">email_address, mail</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-900">ali.tariq@gmail.com</td>
                    <td className="py-2.5 text-slate-600">Applicant email address for admission notifications</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">city</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">district, location, town</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">Mirpur, Islamabad</td>
                    <td className="py-2.5 text-slate-600">Domicile or current residence city</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">priorDegree</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">education, group, degree</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">Pre-Engineering, ICS, Pre-Medical</td>
                    <td className="py-2.5 text-slate-600">Intermediate education background</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">fscMarks</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">marks, score, obtained_marks</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-900">850 (out of 1100)</td>
                    <td className="py-2.5 text-slate-600">FSc or intermediate obtained marks</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">hasMaths</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">maths, mathematics</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-900">Yes or No (1 / 0)</td>
                    <td className="py-2.5 text-slate-600">Whether student studied Mathematics</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-mono font-bold text-blue-900">eligibleFor</td>
                    <td className="py-2.5 pr-4"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">program, preferred_program</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">Software Engineering</td>
                    <td className="py-2.5 text-slate-600">Target or admitted academic program</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload & Dry-Run Preview Area */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1.5">
              Upload and preview CSV file
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              Upload a CSV matching the format above to test and preview all applicant profiles before adding them to a campaign.
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
                {parsing ? 'Checking file…' : 'Preview and Validate'}
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
                  Applicant preview (First {preview.previewRows.length} rows)
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Name & Father</th>
                        <th className="px-4 py-2.5">Phone Raw</th>
                        <th className="px-4 py-2.5">Normalized Phone</th>
                        <th className="px-4 py-2.5">CNIC</th>
                        <th className="px-4 py-2.5">City & Group</th>
                        <th className="px-4 py-2.5">Marks</th>
                        <th className="px-4 py-2.5">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.previewRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/75">
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-slate-900">{r.fullName}</span>
                            {r.fatherName && <span className="block text-[11px] text-slate-500">S/O {r.fatherName}</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">{r.phoneRaw}</td>
                          <td className="px-4 py-2.5 font-mono text-blue-700 font-medium">{r.phoneNormalized || '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-600">{r.cnic || '—'}</td>
                          <td className="px-4 py-2.5">
                            <div>{r.city || '—'}</div>
                            {r.priorDegree && <span className="text-[10px] text-slate-400">{r.priorDegree}</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            {r.fscMarks ? `${r.fscMarks}/1100` : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge tone={r.status === 'VALID' ? 'success' : 'danger'}>
                              {r.status === 'VALID' ? 'Ready' : r.status === 'DUPLICATE_IN_DB' ? 'Already in Database' : 'Check number'}
                            </StatusBadge>
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
                    <div className="text-sm font-semibold text-slate-900">Commit applicants to campaign</div>
                    <div className="text-xs text-slate-500">{preview.validCount} verified applicants are ready to ingest.</div>
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

      {/* ======================= TAB 4: SINGLE APPLICANT DIRECT OUTREACH ======================= */}
      {activeTab === 'single' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs max-w-2xl">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1.5">
            Direct WhatsApp Outreach (Single Applicant)
          </h3>
          <p className="text-xs text-slate-500 mb-6">
            Dispatch an automated admissions greeting to an individual student immediately. When they reply, the AI bot takes over and guides them through the qualification process.
          </p>

          <form onSubmit={handleSingleLeadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Student full name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="e.g. Sheikh Haseeb Ur Rehman"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  WhatsApp / Mobile number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={singlePhone}
                  onChange={(e) => setSinglePhone(e.target.value)}
                  placeholder="e.g. 03001234567 or +923001234567"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 font-mono focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Assign to campaign
                </label>
                <select
                  value={singleCampaignId}
                  onChange={(e) => setSingleCampaignId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none bg-white"
                >
                  <option value="">Default (Direct Outreach)</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  City / District (optional)
                </label>
                <input
                  type="text"
                  value={singleCity}
                  onChange={(e) => setSingleCity(e.target.value)}
                  placeholder="e.g. Muzaffarabad"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Prior degree (optional)
                </label>
                <input
                  type="text"
                  value={singleDegree}
                  onChange={(e) => setSingleDegree(e.target.value)}
                  placeholder="e.g. Pre-Engineering"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Custom greeting message (optional)
              </label>
              <textarea
                rows={3}
                value={singleCustomGreeting}
                onChange={(e) => setSingleCustomGreeting(e.target.value)}
                placeholder="Leave blank to use the official department greeting. You can use {name} for student's name."
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={singleSending || !singleName.trim() || !singlePhone.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <IconSend className="size-4" />
                <span>{singleSending ? 'Queueing WhatsApp message…' : 'Send WhatsApp greeting'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======================= TAB 5: LIVE BOT CHAT SIMULATOR ======================= */}
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

      {/* ======================= EDIT STUDENT MODAL ======================= */}
      {editLeadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Edit Student Record</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update candidate information. Changes sync across Marketing and Document Verification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditLeadModal(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <IconClose className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditLead} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Father's Name
                  </label>
                  <input
                    type="text"
                    value={editForm.fatherName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fatherName: e.target.value }))}
                    placeholder="Father / Guardian"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile / WhatsApp Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.phone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CNIC / B-Form Number
                  </label>
                  <input
                    type="text"
                    value={editForm.cnic}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, cnic: e.target.value }))}
                    placeholder="e.g. 82101-1234567-1"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="student@example.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City / Domicile
                  </label>
                  <input
                    type="text"
                    value={editForm.city}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="e.g. Mirpur, Kotli, Rawalpindi"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Intermediate Academic Group
                  </label>
                  <select
                    value={editForm.priorDegree}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, priorDegree: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none bg-white"
                  >
                    <option value="">Unspecified</option>
                    <option value="Pre-Engineering">Pre-Engineering</option>
                    <option value="ICS">ICS (Computer Science)</option>
                    <option value="Pre-Medical">Pre-Medical</option>
                    <option value="General Science">General Science</option>
                    <option value="DAE">DAE (Diploma of Associate Engineer)</option>
                    <option value="A-Levels">A-Levels / Cambridge</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    FSc Obtained Marks (out of 1100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1100"
                    value={editForm.fscMarks}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fscMarks: e.target.value }))}
                    placeholder="e.g. 840"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Studied Mathematics?
                  </label>
                  <div className="flex items-center gap-4 pt-1.5">
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="hasMaths"
                        checked={editForm.hasMaths === true}
                        onChange={() => setEditForm((prev) => ({ ...prev, hasMaths: true }))}
                      />
                      <span>Yes</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="hasMaths"
                        checked={editForm.hasMaths === false}
                        onChange={() => setEditForm((prev) => ({ ...prev, hasMaths: false }))}
                      />
                      <span>No</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Eligible / Target Program
                  </label>
                  <input
                    type="text"
                    value={editForm.eligibleFor}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, eligibleFor: e.target.value }))}
                    placeholder="e.g. Software Engineering"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Eligibility Status
                  </label>
                  <select
                    value={editForm.eligibilityStatus}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, eligibilityStatus: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none bg-white"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="ELIGIBLE">ELIGIBLE (Qualified)</option>
                    <option value="INELIGIBLE">INELIGIBLE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Conversation Workflow State
                  </label>
                  <select
                    value={editForm.conversationState}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, conversationState: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none bg-white"
                  >
                    {Object.entries(conversationStateLabels).map(([code, label]) => (
                      <option key={code} value={code}>{label} ({code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {editForm.eligibilityStatus === 'INELIGIBLE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ineligibility Reason
                  </label>
                  <input
                    type="text"
                    value={editForm.ineligibilityReason}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, ineligibilityReason: e.target.value }))}
                    placeholder="e.g. Marks below minimum 50% threshold"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditLeadModal(null)}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingLead || !editForm.fullName.trim() || !editForm.phone.trim()}
                  className="rounded-lg bg-blue-700 px-5 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {updatingLead ? 'Saving Changes…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Confirmation Dialog */}
      {confirmModal && (
        <ConfirmDialog
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          tone={confirmModal.tone}
          loading={loading}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}
