import { useState, useEffect, useRef } from 'react';
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
  IconTrash,
  IconUploadCloud,
  IconAcademicCap,
  IconChat,
  IconDocumentCheck,
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
  // Step sequence:
  // 1. campaigns: Broadcast Campaigns
  // 2. csv: Import Applicants (CSV)
  // 3. single: Single Lead Outreach
  // 4. leads: Student Leads Directory
  // 5. simulator: WhatsApp Bot Simulator
  // 6. knowledge: Bot Knowledge & Rules
  const [activeTab, setActiveTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  // Form State - Campaigns
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
  const [simPhoneInput, setSimPhoneInput] = useState('923001234567');
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

  // Dynamic Bot Knowledge & Policy Document State
  const [knowledgeText, setKnowledgeText] = useState('');
  const [knowledgeMeta, setKnowledgeMeta] = useState(null);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [customWhatsAppInput, setCustomWhatsAppInput] = useState('');
  const [savingWhatsAppNumber, setSavingWhatsAppNumber] = useState(false);
  const knowledgeFileInputRef = useRef(null);

  useEffect(() => {
    loadCampaigns();
    loadKnowledge();
    loadLeads();
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
      setSuccess(`Student record for "${payload.fullName}" saved and synchronized.`);
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

  async function handleDeleteCampaign(campaign) {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Campaign',
      message: `Are you sure you want to delete campaign "${campaign.name}"? This will remove the campaign and all associated student leads.`,
      confirmLabel: 'Delete Campaign',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await marketingApi.deleteCampaign(campaign.id);
          setSuccess(`Campaign "${campaign.name}" deleted successfully.`);
          loadCampaigns();
          loadLeads();
        } catch (err) {
          setError(err.message || 'Failed to delete campaign.');
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

  async function loadKnowledge() {
    setLoadingKnowledge(true);
    try {
      const data = await marketingApi.getKnowledge();
      setKnowledgeText(data.content || '');
      setKnowledgeMeta(data);
    } catch (err) {
      console.error('Failed to load knowledge:', err);
    } finally {
      setLoadingKnowledge(false);
    }
  }

  async function handleSaveKnowledge(e) {
    if (e) e.preventDefault();
    setSavingKnowledge(true);
    setError('');
    try {
      const res = await marketingApi.updateKnowledge(knowledgeText);
      setKnowledgeMeta(res);
      setSuccess('Admissions knowledge document updated successfully. Automated bot guidelines are now synchronized.');
    } catch (err) {
      setError(err.message || 'Failed to update knowledge base.');
    } finally {
      setSavingKnowledge(false);
    }
  }

  function handleKnowledgeFileUpload(e) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target?.result;
      if (typeof content === 'string') {
        setKnowledgeText(content);
        setSavingKnowledge(true);
        try {
          const res = await marketingApi.uploadKnowledgeFile(selectedFile);
          setKnowledgeMeta(res);
          setSuccess(`Document "${selectedFile.name}" loaded and deployed to live admissions bot.`);
        } catch (err) {
          setError(err.message || 'Failed to upload document file.');
        } finally {
          setSavingKnowledge(false);
        }
      }
    };
    reader.readAsText(selectedFile);
  }

  async function handleSaveWhatsAppNumber(e) {
    if (e) e.preventDefault();
    if (!customWhatsAppInput.trim()) return;
    setSavingWhatsAppNumber(true);
    setError('');
    try {
      const res = await marketingApi.updateWhatsAppNumber(customWhatsAppInput.trim());
      setSuccess(`Active department WhatsApp line updated to ${res.number || customWhatsAppInput}.`);
      setCustomWhatsAppInput('');
    } catch (err) {
      setError(err.message || 'Failed to update WhatsApp number.');
    } finally {
      setSavingWhatsAppNumber(false);
    }
  }

  function handleSwitchSimPhone(newPhone) {
    const cleaned = String(newPhone || '').replace(/\D/g, '');
    if (!cleaned) return;
    setSimPhone(cleaned);
    setSimPhoneInput(cleaned);
    setSimHistory([
      {
        direction: 'OUTBOUND',
        text: 'Assalam-o-Alaikum! Are you interested in Software Engineering admissions for Fall 2026? (Reply Yes/No)',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setSimTurnState('AWAITING_INTEREST');
    setSuccess(`Simulator applicant switched to +${cleaned}`);
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
        <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="flex items-center gap-2 font-medium">
            <IconCheck className="w-4 h-4 text-emerald-700" />
            {success}
          </span>
          <button onClick={() => setSuccess('')} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step Sequence Tabs: Ordered per workflow: Campaigns -> CSV -> Single -> Leads -> Simulator -> Knowledge */}
      <SectionTabs
        label="Admissions workspace workflow"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'campaigns', label: '1. Broadcast Campaigns', count: campaigns.length },
          { id: 'csv', label: '2. Import Applicants (CSV)' },
          { id: 'single', label: '3. Single Lead Outreach' },
          { id: 'leads', label: '4. Student Leads Directory', count: leadsSummary.total || leadsTotal },
          { id: 'simulator', label: '5. WhatsApp Bot Simulator' },
          { id: 'knowledge', label: '6. Bot Knowledge & Rules' },
        ]}
      />

      {/* Metric Strips */}
      {activeTab === 'campaigns' && (
        <MetricStrip
          label="Fall 2026 intake totals"
          items={[
            { label: 'Total Applicants', value: totalLeadsCount },
            { label: 'Messages Dispatched', value: totalSentCount },
            { label: 'Qualified Candidates', value: totalEligibleCount, tone: 'blue' },
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
            { label: 'Ineligible', value: leadsSummary.ineligible, tone: 'rose' },
          ]}
        />
      )}

      {/* =========================================================================
          STEP 1: BROADCAST CAMPAIGNS
          ========================================================================= */}
      {activeTab === 'campaigns' && (
        <WorkspacePanel
          title="Broadcast Outreach Campaigns"
          description={`${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'} registered in intake cycle`}
          actions={(
            <>
              <button
                type="button"
                onClick={loadCampaigns}
                disabled={loading}
                aria-label="Refresh campaigns"
                title="Refresh campaigns"
                className="grid size-9 place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 cursor-pointer"
              >
                <IconRefresh className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowCreateCampaign((shown) => !shown)}
                aria-expanded={showCreateCampaign}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-blue-700 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 cursor-pointer"
              >
                {showCreateCampaign ? <IconClose className="size-4" /> : <IconPlus className="size-4" />}
                {showCreateCampaign ? 'Close Form' : 'New Campaign'}
              </button>
            </>
          )}
        >
          {showCreateCampaign && (
            <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 gap-4 border-b border-slate-200 bg-slate-50/70 p-5 sm:grid-cols-2 sm:px-6">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-800">Campaign Name <span className="text-rose-600">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fall 2026 - Phase 1 Outreach"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-800">Campaign Notes <span className="font-normal text-slate-500">(Optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. Target Pre-Engineering & ICS matriculates from Mirpur division"
                  value={campaignDesc}
                  onChange={(e) => setCampaignDesc(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 sm:col-span-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateCampaign(false)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-blue-700 px-4 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  <IconPlus className="w-3.5 h-3.5" />
                  <span>{creating ? 'Creating…' : 'Save Campaign'}</span>
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-sm text-slate-500" aria-live="polite">
              <span className="size-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700" />
              <span>Loading campaigns…</span>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="grid min-h-52 place-content-center justify-items-center px-6 py-10 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                <IconMegaphone className="size-5" />
              </span>
              <p className="mb-0 mt-3 text-sm font-bold text-slate-800">No campaigns created yet</p>
              <p className="mb-0 mt-1 max-w-sm text-xs text-slate-500">Create your first intake outreach campaign, then import student lists via CSV.</p>
              <button
                type="button"
                onClick={() => setShowCreateCampaign(true)}
                className="mt-4 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 cursor-pointer"
              >
                + Create First Campaign
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs text-slate-700">
                <thead className="border-b border-slate-200 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-[.055em] text-slate-700">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Campaign Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Candidates</th>
                    <th className="px-4 py-3 text-right">Dispatched</th>
                    <th className="px-4 py-3 text-right">Qualified</th>
                    <th className="px-5 py-3 text-right sm:px-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="transition hover:bg-slate-50/80">
                      <td className="max-w-[240px] px-5 py-3.5 sm:px-6">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        {c.description && <div className="mt-0.5 truncate text-[11px] text-slate-500">{c.description}</div>}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {campaignStatusLabels[c.status] || c.status}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-mono text-slate-800 font-medium">{c.totalLeads}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-mono text-slate-600">{c.sentCount}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-mono font-bold text-blue-700">{c.eligibleCount}</td>
                      <td className="px-5 py-3.5 text-right sm:px-6">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleTriggerOutreach(c)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 hover:border-blue-300 cursor-pointer"
                          >
                            <IconSend className="size-3" />
                            <span>Start Outreach</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCampaign(c)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50/60 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 cursor-pointer"
                            title="Delete Campaign"
                          >
                            <IconTrash className="size-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WorkspacePanel>
      )}

      {/* =========================================================================
          STEP 2: IMPORT APPLICANTS (CSV)
          ========================================================================= */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          {/* Institutional Specification Card */}
          <div className="rounded-xl border border-slate-300 bg-white p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                  Admissions Office Schema Specification
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-2">
                  Standard Applicant Batch Import Specification
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Prepare applicant spreadsheets using these standard columns. The ingestion engine automatically matches column aliases.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadSampleCsv}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-100 shadow-2xs cursor-pointer"
                >
                  <IconDownload className="size-4 text-slate-700" />
                  <span>Download Sample CSV Template</span>
                </button>
              </div>
            </div>

            {/* Format Specification Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200">
                <thead className="bg-[#f4f7fb] border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  <tr>
                    <th className="px-4 py-2.5">Column Header</th>
                    <th className="px-3 py-2.5">Requirement</th>
                    <th className="px-3 py-2.5">Accepted Aliases</th>
                    <th className="px-4 py-2.5">Format / Example</th>
                    <th className="px-4 py-2.5">Field Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">fullName</td>
                    <td className="px-3 py-2"><span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">Required</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">name, student_name, candidate</td>
                    <td className="px-4 py-2 font-medium text-slate-900">Muhammad Ali</td>
                    <td className="px-4 py-2 text-slate-600">Applicant legal full name</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">phone</td>
                    <td className="px-3 py-2"><span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">Required</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">contact, mobile, cell, whatsapp</td>
                    <td className="px-4 py-2 font-mono text-slate-900">03001234567 / 923001234567</td>
                    <td className="px-4 py-2 text-slate-600">Valid mobile number with WhatsApp capability</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">fatherName</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">father, guardian, parent_name</td>
                    <td className="px-4 py-2 font-medium text-slate-900">Tariq Mahmood</td>
                    <td className="px-4 py-2 text-slate-600">Father or legal guardian name</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">cnic</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">bform, national_id, id_card</td>
                    <td className="px-4 py-2 font-mono text-slate-900">82101-1234567-1 (13 digits)</td>
                    <td className="px-4 py-2 text-slate-600">National identity CNIC or B-Form</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">email</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">email_address, mail</td>
                    <td className="px-4 py-2 font-mono text-slate-900">ali.tariq@gmail.com</td>
                    <td className="px-4 py-2 text-slate-600">Applicant email address</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">city</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">district, location, town</td>
                    <td className="px-4 py-2 font-medium text-slate-900">Mirpur, Rawalpindi</td>
                    <td className="px-4 py-2 text-slate-600">Domicile or current residence city</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">priorDegree</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">education, group, degree</td>
                    <td className="px-4 py-2 font-medium text-slate-900">Pre-Engineering, ICS</td>
                    <td className="px-4 py-2 text-slate-600">Intermediate education background</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">fscMarks</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">marks, score, obtained_marks</td>
                    <td className="px-4 py-2 font-mono text-slate-900">850 (out of 1100)</td>
                    <td className="px-4 py-2 text-slate-600">Intermediate obtained marks</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">hasMaths</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">maths, mathematics</td>
                    <td className="px-4 py-2 font-mono text-slate-900">Yes or No (1 / 0)</td>
                    <td className="px-4 py-2 text-slate-600">Whether student studied Mathematics</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono font-bold text-blue-900">eligibleFor</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Optional</span></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">program, preferred_program</td>
                    <td className="px-4 py-2 font-medium text-slate-900">Software Engineering</td>
                    <td className="px-4 py-2 text-slate-600">Target or admitted academic program</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload & Dry-Run Preview Card */}
          <div className="bg-white border border-slate-300 rounded-xl p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
              Step 2A: Upload & Validate CSV File
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Select an applicant CSV file matching the schema above to test and preview normalized records before assigning them to a campaign.
            </p>

            <form onSubmit={handleDryRunPreview} className="flex flex-col sm:flex-row gap-4 items-center">
              <input
                type="file"
                accept=".csv"
                required
                onChange={(e) => setFile(e.target.files[0])}
                className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-3.5 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-800 hover:file:bg-slate-100 cursor-pointer"
              />

              <button
                type="submit"
                disabled={parsing || !file}
                className="w-full sm:w-auto px-5 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {parsing ? 'Validating…' : 'Preview & Validate'}
              </button>
            </form>
          </div>

          {/* Dry-Run Results & Stage 2 Commit Box */}
          {preview && (
            <div className="bg-white border border-slate-300 rounded-xl p-6 shadow-xs space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">File Rows Total</div>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{preview.totalRows}</div>
                </div>

                <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
                  <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">Ready for Ingestion</div>
                  <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{preview.validCount}</div>
                </div>

                <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200">
                  <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Already in Database</div>
                  <div className="text-2xl font-bold font-mono text-amber-700 mt-1">{preview.duplicateCount}</div>
                </div>

                <div className="p-3.5 rounded-lg bg-rose-50/70 border border-rose-200">
                  <div className="text-[11px] font-semibold text-rose-800 uppercase tracking-wider">Invalid Phone Numbers</div>
                  <div className="text-2xl font-bold font-mono text-rose-700 mt-1">{preview.invalidPhoneCount}</div>
                </div>
              </div>

              {/* Sample Preview Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5">
                  Applicant Sample Preview (First {preview.previewRows.length} rows)
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-[#f4f7fb] text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Name & Father</th>
                        <th className="px-3 py-2.5">Raw Phone</th>
                        <th className="px-3 py-2.5">Normalized</th>
                        <th className="px-3 py-2.5">CNIC</th>
                        <th className="px-3 py-2.5">City & Group</th>
                        <th className="px-3 py-2.5">Marks</th>
                        <th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.previewRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/75">
                          <td className="px-4 py-2.5">
                            <span className="font-bold text-slate-900">{r.fullName}</span>
                            {r.fatherName && <span className="block text-[11px] text-slate-500">S/O {r.fatherName}</span>}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500">{r.phoneRaw}</td>
                          <td className="px-3 py-2.5 font-mono text-blue-700 font-medium">{r.phoneNormalized || '—'}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-600">{r.cnic || '—'}</td>
                          <td className="px-3 py-2.5">
                            <div>{r.city || '—'}</div>
                            {r.priorDegree && <span className="text-[10px] text-slate-400">{r.priorDegree}</span>}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
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
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-300 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-800">Step 2B: Ingest Validated Applicants</div>
                    <div className="text-xs text-slate-600 mt-0.5">{preview.validCount} verified applicant records ready to attach to campaign.</div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <select
                      value={selectedTargetCampaign}
                      onChange={(e) => setSelectedTargetCampaign(e.target.value)}
                      className="px-3 py-1.5 rounded-md bg-white border border-slate-300 text-slate-900 text-xs focus:border-blue-700 focus:outline-none"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleCommitLeads}
                      disabled={committing}
                      className="px-4 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition shadow-2xs disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {committing ? 'Adding...' : `Add ${preview.validCount} Applicants`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          STEP 3: SINGLE LEAD OUTREACH
          ========================================================================= */}
      {activeTab === 'single' && (
        <div className="bg-white border border-slate-300 rounded-xl p-6 shadow-xs max-w-2xl">
          <div className="border-b border-slate-200 pb-4 mb-5">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Single Applicant Direct Outreach
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Dispatch an official admissions invitation directly to an individual candidate. The AI counselor will guide them through eligibility criteria once they reply.
            </p>
          </div>

          <form onSubmit={handleSingleLeadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Candidate Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="e.g. Sheikh Haseeb Ur Rehman"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  WhatsApp / Mobile Number <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={singlePhone}
                  onChange={(e) => setSinglePhone(e.target.value)}
                  placeholder="e.g. 03001234567 or 923001234567"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 font-mono focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Assign to Campaign
                </label>
                <select
                  value={singleCampaignId}
                  onChange={(e) => setSingleCampaignId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none bg-white"
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
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  City / Domicile <span className="font-normal text-slate-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={singleCity}
                  onChange={(e) => setSingleCity(e.target.value)}
                  placeholder="e.g. Muzaffarabad"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Prior Degree / Group <span className="font-normal text-slate-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={singleDegree}
                  onChange={(e) => setSingleDegree(e.target.value)}
                  placeholder="e.g. Pre-Engineering"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Custom Invitation Note <span className="font-normal text-slate-500">(Optional)</span>
              </label>
              <textarea
                rows={3}
                value={singleCustomGreeting}
                onChange={(e) => setSingleCustomGreeting(e.target.value)}
                placeholder="Leave blank to use the official department greeting. You can use {name} for student's name."
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={singleSending || !singleName.trim() || !singlePhone.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                <IconSend className="size-3.5" />
                <span>{singleSending ? 'Queueing Message…' : 'Dispatch WhatsApp Greeting'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          STEP 4: STUDENT LEADS DIRECTORY
          ========================================================================= */}
      {activeTab === 'leads' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-xs">
            {/* Filter Pills and Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter(''); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    !leadStatusFilter
                      ? 'bg-blue-700 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  All ({leadsSummary.total || leadsTotal})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('ELIGIBLE'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'ELIGIBLE'
                      ? 'bg-emerald-700 text-white shadow-2xs'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  Qualified ({leadsSummary.qualified || 0})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('PENDING'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'PENDING'
                      ? 'bg-amber-700 text-white shadow-2xs'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  Pending ({leadsSummary.pending || 0})
                </button>
                <button
                  type="button"
                  onClick={() => { setLeadStatusFilter('INELIGIBLE'); setLeadStateFilter(''); setLeadsPage(0); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    leadStatusFilter === 'INELIGIBLE'
                      ? 'bg-rose-700 text-white shadow-2xs'
                      : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  Ineligible ({leadsSummary.ineligible || 0})
                </button>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px]">
                  <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    placeholder="Search name, phone, CNIC…"
                    className="w-full rounded-md border border-slate-300 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none"
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
                    className="rounded-md border border-slate-300 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-700 focus:bg-white focus:outline-none"
                  >
                    <option value="">All Campaigns</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}

                <button
                  type="submit"
                  className="rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-800 cursor-pointer"
                >
                  Search
                </button>
                <button
                  type="button"
                  onClick={loadLeads}
                  disabled={leadsLoading}
                  className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  title="Refresh leads list"
                >
                  <IconRefresh className="size-3.5" />
                </button>
              </form>
            </div>
          </div>

          {/* Leads Table */}
          <div className="rounded-xl border border-slate-300 bg-white overflow-hidden shadow-xs">
            {leadsLoading ? (
              <div className="grid min-h-56 place-content-center justify-items-center gap-3 text-sm text-slate-500">
                <span className="size-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700" />
                <span>Loading student records…</span>
              </div>
            ) : leads.length === 0 ? (
              <div className="grid min-h-56 place-content-center justify-items-center px-6 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400 border border-slate-200">
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
                  <thead className="border-b border-slate-200 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-[.05em] text-slate-700">
                    <tr>
                      <th className="px-5 py-3">Student Details</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Academic Score</th>
                      <th className="px-4 py-3">Program</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="transition hover:bg-slate-50/70">
                        {/* Student Details */}
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900 text-xs">{lead.fullName}</div>
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
                            <span className="inline-block rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
                              {lead.eligibleFor}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">General Candidate</span>
                          )}
                        </td>

                        {/* Status Badge */}
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
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              title="Edit student profile"
                            >
                              <IconPencil className="size-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteLead(lead)}
                              className="inline-flex items-center rounded border border-slate-200 bg-white p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                              title="Delete record"
                            >
                              <IconClose className="size-3" />
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
              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 bg-slate-50/50">
                <span className="text-xs text-slate-500">
                  Showing {leadsPage * leadsPageSize + 1}–{Math.min((leadsPage + 1) * leadsPageSize, leadsTotal)} of {leadsTotal} students
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={leadsPage === 0 || leadsLoading}
                    onClick={() => setLeadsPage((p) => Math.max(0, p - 1))}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
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
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* =========================================================================
          STEP 5: WHATSAPP BOT SIMULATOR (CLEAN & OLD-SCHOOL INSTITUTIONAL)
          ========================================================================= */}
      {activeTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main Simulator Pane */}
          <div className="lg:col-span-2 bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs flex flex-col h-[640px]">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 bg-[#f4f7fb] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <IconChat className="size-4 text-blue-700" />
                  <span className="text-sm font-bold text-slate-900">Admissions WhatsApp Simulator</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Interactive testing sandbox for conversational intake & qualification rules
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge tone={simTurnState === 'QUALIFIED' ? 'success' : 'neutral'}>
                  {simulatorStatusLabels[simTurnState] || simTurnState}
                </StatusBadge>
                <button
                  type="button"
                  onClick={() => handleSwitchSimPhone(simPhone)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  title="Reset conversation for this number"
                >
                  <IconRefresh className="size-3" />
                  <span>Reset Chat</span>
                </button>
              </div>
            </div>

            {/* Applicant Selector Toolbar */}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Test Candidate Line:</span>
                <input
                  type="text"
                  value={simPhoneInput}
                  onChange={(e) => setSimPhoneInput(e.target.value)}
                  placeholder="e.g. 923001234567"
                  className="px-2.5 py-1 rounded border border-slate-300 text-xs font-mono w-36 bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                />
                <button
                  type="button"
                  onClick={() => handleSwitchSimPhone(simPhoneInput)}
                  className="px-2.5 py-1 rounded bg-blue-700 text-white font-semibold hover:bg-blue-800 cursor-pointer"
                >
                  Switch
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500 font-medium">Quick Presets:</span>
                <button
                  type="button"
                  onClick={() => handleSwitchSimPhone('923001234567')}
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 font-mono hover:bg-slate-100 cursor-pointer"
                >
                  Candidate (+923001234567)
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchSimPhone('923408195018')}
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 font-mono hover:bg-slate-100 cursor-pointer"
                >
                  Staff (+923408195018)
                </button>
              </div>
            </div>

            {/* Chat Transcript Area */}
            <div className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-slate-50/40">
              {simTurnState === 'QUALIFIED' && (
                <div className="p-3.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs shadow-2xs">
                  <div className="font-bold flex items-center gap-1.5 mb-0.5">
                    <IconCheck className="size-4 text-emerald-700" />
                    <span>Candidate Qualified — 60-Second Grace Window Active</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    The bot has qualified the candidate and displayed their dossier for verification. The candidate may review details or request corrections (e.g., <em>"can I write my name again"</em> or <em>"correction krni hai"</em>) before the document verification link is dispatched.
                  </p>
                </div>
              )}

              {simHistory.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.direction === 'INBOUND' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] rounded-lg p-3 text-xs shadow-2xs ${
                    m.direction === 'INBOUND'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-900 border border-slate-300'
                  }`}>
                    <div className="flex items-center justify-between gap-3 pb-1 mb-1 border-b border-white/20 text-[10px] font-mono">
                      <span className="font-bold uppercase tracking-wider">
                        {m.direction === 'INBOUND' ? `Candidate (+${simPhone})` : 'Admissions Counselor Bot'}
                      </span>
                      <span className={m.direction === 'INBOUND' ? 'text-slate-300' : 'text-slate-500'}>
                        {m.timestamp}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendSimulatedTurn} className="p-3.5 border-t border-slate-200 bg-white flex gap-2">
              <input
                type="text"
                placeholder="Type candidate reply (e.g. 'Yes', 'Pre-Engineering', '840', 'can I write my name again')…"
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="submit"
                disabled={simSending || !simMessage.trim()}
                className="px-4 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <IconSend className="size-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>

          {/* Reference & Directives Sidebar */}
          <div className="space-y-4">
            {/* Department Active WhatsApp Line Card */}
            <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">
                Department WhatsApp Line
              </h3>
              <p className="text-[11px] text-slate-600 mb-3 leading-relaxed">
                Primary outbound WhatsApp Business number used by automated campaigns and intake bots.
              </p>
              <form onSubmit={handleSaveWhatsAppNumber} className="space-y-2">
                <input
                  type="text"
                  value={customWhatsAppInput}
                  onChange={(e) => setCustomWhatsAppInput(e.target.value)}
                  placeholder="e.g. 923408195018"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                />
                <button
                  type="submit"
                  disabled={savingWhatsAppNumber || !customWhatsAppInput.trim()}
                  className="w-full py-1.5 px-3 text-xs font-semibold rounded bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 cursor-pointer transition"
                >
                  {savingWhatsAppNumber ? 'Saving…' : 'Update Line Number'}
                </button>
              </form>
            </div>

            {/* Counselor Intake Directives Card */}
            <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Intake Directives & Rules
              </h3>
              <div className="text-xs text-slate-700 space-y-2.5">
                <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                  <div className="font-bold text-slate-900 mb-0.5">Short Academic Abbreviations</div>
                  <div className="text-[11px] text-slate-600">Accepts "pre eng", "ics", "med", "pre med", "dae" without requiring case-sensitive names.</div>
                </div>

                <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                  <div className="font-bold text-slate-900 mb-0.5">Minimum 50% Threshold</div>
                  <div className="text-[11px] text-slate-600">Requires 550 / 1100 marks and Mathematics for BS Software Engineering qualification.</div>
                </div>

                <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                  <div className="font-bold text-slate-900 mb-0.5">General Inquiries Interception</div>
                  <div className="text-[11px] text-slate-600">Answers inquiries regarding hostel, fees, or entrance tests before prompting for the next intake step.</div>
                </div>

                <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                  <div className="font-bold text-slate-900 mb-0.5">60s Correction Grace</div>
                  <div className="text-[11px] text-slate-600">Allows candidates to adjust marks, name, or CNIC before generating document upload access.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 6: BOT KNOWLEDGE & RULES (CLEAN & OLD-SCHOOL INSTITUTIONAL)
          ========================================================================= */}
      {activeTab === 'knowledge' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-300 rounded-xl p-6 shadow-xs">
            {/* Institutional Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Department Admissions Policy & Knowledge Base
                  </h2>
                  <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                    Official Directives
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  Institutional regulations, admission criteria, and counselor guidelines synchronized with the AI intake engine. The bot strictly adheres to this policy text when evaluating applicants.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadKnowledge}
                  disabled={loadingKnowledge}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 transition"
                >
                  <IconRefresh className="size-3.5" />
                  <span>Reload</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveKnowledge}
                  disabled={savingKnowledge}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded bg-blue-700 text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50 shadow-2xs transition"
                >
                  <IconCheck className="size-3.5" />
                  <span>{savingKnowledge ? 'Deploying…' : 'Save & Deploy Directives'}</span>
                </button>
              </div>
            </div>

            {/* Institutional Metadata Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4 border-b border-slate-200 text-xs">
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <div className="text-slate-500 text-[11px] uppercase tracking-wider font-semibold">Last Synchronized</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {knowledgeMeta?.updatedAt ? new Date(knowledgeMeta.updatedAt).toLocaleString() : 'System Default'}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <div className="text-slate-500 text-[11px] uppercase tracking-wider font-semibold">Directive Length</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {knowledgeMeta?.charCount || knowledgeText.length} characters
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <div className="text-slate-500 text-[11px] uppercase tracking-wider font-semibold">Word Count</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {knowledgeMeta?.wordCount || (knowledgeText.trim() ? knowledgeText.trim().split(/\s+/).length : 0)} words
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <div className="text-slate-500 text-[11px] uppercase tracking-wider font-semibold">Storage File</div>
                <div className="font-semibold text-slate-900 mt-0.5 font-mono text-[11px] truncate">
                  server/data/knowledge.txt
                </div>
              </div>
            </div>

            {/* Clean Document File Upload Bar */}
            <div className="my-5 p-4 rounded-lg border border-slate-200 bg-slate-50/70">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Load Regulations Document from Disk (.txt, .md, .csv)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Selecting a file will read its content into the editor below and immediately deploy it to the live admissions bot.
                  </div>
                </div>

                <div>
                  <input
                    type="file"
                    id="knowledgeDocUpload"
                    ref={knowledgeFileInputRef}
                    accept=".txt,.md,.markdown,.doc,.json,.csv"
                    onChange={handleKnowledgeFileUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="knowledgeDocUpload"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 cursor-pointer shadow-2xs"
                  >
                    <IconUploadCloud className="size-3.5 text-blue-700" />
                    <span>Select Document</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Clean Document Editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Admissions Directives Text Editor
                </label>
                <span className="text-[11px] text-slate-500">
                  The automated counselor strictly adheres to the text below
                </span>
              </div>
              <textarea
                rows={16}
                value={knowledgeText}
                onChange={(e) => setKnowledgeText(e.target.value)}
                placeholder="Paste admissions requirements, program eligibility, deadlines, fee details, and FAQ answers..."
                className="w-full p-3.5 rounded-lg border border-slate-300 font-mono text-xs text-slate-900 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-blue-700 leading-relaxed resize-y"
              />
              <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-xs text-slate-500">
                  Saved updates take effect immediately on next inbound candidate message.
                </span>
                <button
                  type="button"
                  onClick={handleSaveKnowledge}
                  disabled={savingKnowledge}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded bg-blue-700 text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <IconCheck className="size-3.5" />
                  <span>{savingKnowledge ? 'Saving…' : 'Save & Deploy Directives'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Institutional Rule Governance Table */}
          <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
              Directives Enforcement Matrix
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200">
                <thead className="bg-[#f4f7fb] border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  <tr>
                    <th className="px-4 py-2.5">Directive</th>
                    <th className="px-3 py-2.5">Level</th>
                    <th className="px-4 py-2.5">Enforcement Protocol & Behavior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-900">Strict Knowledge Grounding</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200">Mandatory</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      AI counselor only provides answers present in the knowledge text above. Queries outside scope are referred to admissions office.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-900">Minimum Academic Threshold</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200">Mandatory</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      Candidates require minimum 50% intermediate marks (550 / 1100) and Mathematics for BS Software Engineering qualification.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-900">60-Second Correction Grace</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">Active</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      Upon qualification, the candidate is shown a unified summary and given 60s to edit details before document verification link dispatch.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-slate-900">Ad-Hoc Inquiry Interception</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">Active</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      General inquiries regarding tuition, hostel, entry tests, or accreditation are answered gracefully before resuming candidate intake.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          EDIT STUDENT RECORD MODAL
          ========================================================================= */}
      {editLeadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl border border-slate-300">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Edit Candidate Record</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update candidate information. Changes sync across Marketing and Document Verification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditLeadModal(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <IconClose className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditLead} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Student Full Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Father's Name
                  </label>
                  <input
                    type="text"
                    value={editForm.fatherName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fatherName: e.target.value }))}
                    placeholder="Father / Guardian"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Mobile / WhatsApp Number <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.phone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    CNIC / B-Form Number
                  </label>
                  <input
                    type="text"
                    value={editForm.cnic}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, cnic: e.target.value }))}
                    placeholder="e.g. 82101-1234567-1"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="student@example.com"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    City / Domicile
                  </label>
                  <input
                    type="text"
                    value={editForm.city}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="e.g. Mirpur, Kotli, Rawalpindi"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Intermediate Academic Group
                  </label>
                  <select
                    value={editForm.priorDegree}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, priorDegree: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none bg-white"
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
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    FSc Obtained Marks (out of 1100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1100"
                    value={editForm.fscMarks}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fscMarks: e.target.value }))}
                    placeholder="e.g. 840"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
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
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Eligible / Target Program
                  </label>
                  <input
                    type="text"
                    value={editForm.eligibleFor}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, eligibleFor: e.target.value }))}
                    placeholder="e.g. Software Engineering"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Eligibility Status
                  </label>
                  <select
                    value={editForm.eligibilityStatus}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, eligibilityStatus: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none bg-white"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="ELIGIBLE">ELIGIBLE (Qualified)</option>
                    <option value="INELIGIBLE">INELIGIBLE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Conversation Workflow State
                  </label>
                  <select
                    value={editForm.conversationState}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, conversationState: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none bg-white"
                  >
                    {Object.entries(conversationStateLabels).map(([code, label]) => (
                      <option key={code} value={code}>{label} ({code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {editForm.eligibilityStatus === 'INELIGIBLE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Ineligibility Reason
                  </label>
                  <input
                    type="text"
                    value={editForm.ineligibilityReason}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, ineligibilityReason: e.target.value }))}
                    placeholder="e.g. Marks below minimum 50% threshold"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditLeadModal(null)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingLead || !editForm.fullName.trim() || !editForm.phone.trim()}
                  className="rounded bg-blue-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer shadow-2xs"
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
