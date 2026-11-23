import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { StudentDossierModal } from './StudentDossierModal.jsx';
import { Button, StatusBadge, MetricStrip, SectionTabs, ToastBanner, ConfirmDialog, PromptDialog } from '../../core/ui/primitives.jsx';
import {
  IconDocumentCheck,
  IconSearch,
  IconRefresh,
  IconAlertTriangle,
  IconCheck,
  IconClose,
  IconPencil,
  IconSend,
  IconUsers,
} from '../../core/icons/Icons.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { BoardSourcesPanel } from './BoardSourcesPanel.jsx';

export function VerificationModuleView() {
  const { user } = useAuth();
  const canManageSources = true;
  const [activeTab, setActiveTab] = useState('sources'); // Default to Step 1: Gazettes Pre-Verification
  const [queue, setQueue] = useState([]);
  const [queueSummary, setQueueSummary] = useState({
    NEEDS_MANUAL_REVIEW: 0,
    UNDER_REVIEW: 0,
    DOCS_REQUESTED: 0,
    VERIFIED: 0,
    PROBLEMS_ONLY: 0,
  });
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const pageSize = 20;
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState(''); // Default to All candidates for clean overview
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [expandedDocs, setExpandedDocs] = useState({});
  const [density, setDensity] = useState('compact'); // Default to clean compact table

  // Production-grade feedback and dialog states
  const [notice, setNotice] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [promptModal, setPromptModal] = useState(null);

  // Import State
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Reissue State
  const [reissueForm, setReissueForm] = useState({
    studentId: '',
    docTypes: ['FSC_MARKSHEET'],
    expiresInHours: 48,
  });
  const [reissueResult, setReissueResult] = useState(null);
  const [reissuing, setReissuing] = useState(false);
  const [autoDispatching, setAutoDispatching] = useState(false);

  const selectedCandidate = queue.find(
    (c) => String(c.studentId) === String(reissueForm.studentId) || (c.leadId && String(c.leadId) === String(reissueForm.studentId))
  );

  useEffect(() => {
    loadQueue();
  }, [filterStatus, queuePage, activeTab]);

  async function loadQueue() {
    try {
      setLoading(true);
      const data = await verificationApi.fetchReviewQueue({
        status: filterStatus || undefined,
        search: searchQuery.trim() || undefined,
        limit: pageSize,
        offset: queuePage * pageSize,
      });
      const lastPage = Math.max(0, Math.ceil((data.total || 0) / pageSize) - 1);
      if (queuePage > lastPage) {
        setQueuePage(lastPage);
        return;
      }
      setQueue(data.items || []);
      setQueueSummary(
        data.summary || {
          NEEDS_MANUAL_REVIEW: 0,
          UNDER_REVIEW: 0,
          DOCS_REQUESTED: 0,
          VERIFIED: 0,
          PROBLEMS_ONLY: 0,
        }
      );
      setQueueTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load verification queue:', err);
      setNotice({
        type: 'error',
        message: 'Could not load candidate verification queue.',
        detail: err.message,
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setQueuePage(0);
    loadQueue();
  }

  function toggleDocExpand(studentId) {
    setExpandedDocs((prev) => ({
      ...prev,
      [studentId]: !prev[studentId],
    }));
  }

  async function handleEditPhone(studentId, currentPhone) {
    setPromptModal({
      isOpen: true,
      title: 'Update Candidate Contact Number',
      message: 'Enter verified WhatsApp mobile phone number for applicant communications:',
      placeholder: 'e.g. 03001234567 or 923001234567',
      initialValue: currentPhone || '',
      confirmLabel: 'Save Phone Number',
      onConfirm: async (newPhone) => {
        setPromptModal(null);
        if (!newPhone || newPhone.trim() === currentPhone) return;
        try {
          await verificationApi.updatePhone(studentId, newPhone.trim());
          setNotice({
            type: 'success',
            message: 'Phone Number Updated',
            detail: `Synchronized candidate phone to ${newPhone.trim()}`,
          });
          loadQueue();
        } catch (err) {
          setNotice({ type: 'error', message: 'Failed to update phone number.', detail: err.message });
        }
      },
    });
  }

  async function handleQuickGenerateToken(student) {
    const studentId = typeof student === 'object' ? student.studentId : student;
    const missingDocs = (typeof student === 'object' && student.missingDocuments?.length)
      ? student.missingDocuments
      : ['FSC_MARKSHEET', 'MATRIC_MARKSHEET', 'CNIC_FRONT'];

    try {
      const res = await verificationApi.reissueToken({
        studentId,
        allowedDocTypes: missingDocs,
        expiresInHours: 48,
      });
      navigator.clipboard.writeText(res.uploadUrl);
      setNotice({
        type: 'success',
        message: 'Upload Link Generated & Copied to Clipboard!',
        detail: `Generated token for (${missingDocs.join(', ')}). URL: ${res.uploadUrl}`,
      });
      loadQueue();
    } catch (err) {
      setNotice({ type: 'error', message: 'Failed to generate token.', detail: err.message });
    }
  }

  async function handleAutoDispatchMissing() {
    setConfirmModal({
      isOpen: true,
      title: 'Batch Dispatch Document Upload Requests',
      message: 'Dispatch document upload requests to all candidates with pending mandatory documents? Single-use secure upload tokens will be created and sent via automated WhatsApp outreach.',
      confirmLabel: 'Dispatch Batch Requests',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setAutoDispatching(true);
          const res = await verificationApi.autoDispatchMissing({ expiresInHours: 48 });
          setNotice({
            type: 'success',
            message: 'Batch Dispatch Complete',
            detail: `Requests sent to ${res.dispatched} candidate(s) with pending documents.`,
          });
          loadQueue();
        } catch (err) {
          setNotice({ type: 'error', message: 'Batch request dispatch failed.', detail: err.message });
        } finally {
          setAutoDispatching(false);
        }
      },
    });
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    if (!importFile) return;

    try {
      setImporting(true);
      setImportResult(null);
      const res = await verificationApi.importDiscrepancyCsv(importFile);
      setImportResult(res);
      setImportFile(null);
      setNotice({
        type: 'success',
        message: 'Discrepancy CSV Imported Successfully',
        detail: `Processed discrepancy records from file.`,
      });
      loadQueue();
    } catch (err) {
      setNotice({ type: 'error', message: 'Discrepancy import failed.', detail: err.message });
    } finally {
      setImporting(false);
    }
  }

  async function handleReissueSubmit(e) {
    e.preventDefault();
    if (!reissueForm.studentId) return;

    try {
      setReissuing(true);
      setReissueResult(null);
      const res = await verificationApi.reissueToken({
        studentId: Number(reissueForm.studentId),
        allowedDocTypes: reissueForm.docTypes,
        expiresInHours: Number(reissueForm.expiresInHours) || 48,
      });
      setReissueResult(res);
      setNotice({
        type: 'success',
        message: 'Upload Link Reissued',
        detail: `Link generated for candidate #${res.studentId || reissueForm.studentId}.`,
      });
      loadQueue();
    } catch (err) {
      setNotice({ type: 'error', message: 'Token reissue failed.', detail: err.message });
    } finally {
      setReissuing(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(queueTotal / pageSize));

  // Determine problem count for badge
  const problemCount = queueSummary.PROBLEMS_ONLY || queueSummary.NEEDS_MANUAL_REVIEW || 0;

  return (
    <div className="space-y-6">
      {notice && (
        <ToastBanner notice={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* High-level Queue KPI Strip */}
      <MetricStrip
        label="Candidate verification summary"
        items={[
          {
            label: 'Total Candidates',
            value: queueSummary.total || queueTotal,
          },
          {
            label: 'Fully Verified',
            value: queueSummary.VERIFIED || 0,
            tone: 'emerald',
          },
          {
            label: 'Needs Manual Review',
            value: queueSummary.NEEDS_MANUAL_REVIEW || 0,
            tone: 'rose',
          },
          {
            label: 'Documents with Issues',
            value: problemCount,
            tone: problemCount > 0 ? 'amber' : 'neutral',
          },
        ]}
      />

      {/* Navigation Tabs */}
      <SectionTabs
        label="Document verification sections"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'sources', label: '1. Official Board Gazettes (Pre-Verification)' },
          { id: 'queue', label: '2. Candidate Verification Queue' },
          { id: 'import', label: '3. Import Discrepancies (CSV)' },
          { id: 'reissue', label: '4. Reissue Upload Link' },
        ]}
      />

      {/* Tab 1: Official Board Gazettes (Upload & Manage) */}
      {activeTab === 'sources' && <BoardSourcesPanel />}

      {/* Tab 2: Review Queue */}
      {activeTab === 'queue' && (
        <section role="tabpanel" aria-label="Verification queue" className="space-y-4">
          {/* Clean Filter and Search Toolbar */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => { setFilterStatus(''); setQueuePage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    !filterStatus
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  All ({queueTotal})
                </button>

                <button
                  type="button"
                  onClick={() => { setFilterStatus('VERIFIED'); setQueuePage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    filterStatus === 'VERIFIED'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  Verified ({queueSummary.VERIFIED || 0})
                </button>

                <button
                  type="button"
                  onClick={() => { setFilterStatus('NEEDS_MANUAL_REVIEW'); setQueuePage(0); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    filterStatus === 'NEEDS_MANUAL_REVIEW'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  Needs Review ({queueSummary.NEEDS_MANUAL_REVIEW || 0})
                </button>

                <button
                  type="button"
                  onClick={() => { setFilterStatus('PROBLEMS_ONLY'); setQueuePage(0); }}
                  className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    filterStatus === 'PROBLEMS_ONLY'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <span>Problems Only</span>
                  <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterStatus === 'PROBLEMS_ONLY' ? 'bg-amber-800 text-white' : 'bg-amber-200 text-amber-900'
                  }`}>
                    {problemCount}
                  </span>
                </button>
              </div>

              {/* Search and Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <form onSubmit={handleSearchSubmit} className="relative min-w-[220px]">
                  <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search candidate, phone, CNIC…"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1.5 pl-9 pr-7 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => { setSearchQuery(''); setQueuePage(0); }}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <IconClose className="size-3" />
                    </button>
                  )}
                </form>

                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDensity('compact')}
                    className={`rounded px-2 py-0.5 font-semibold transition cursor-pointer ${density === 'compact' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensity('spacious')}
                    className={`rounded px-2 py-0.5 font-semibold transition cursor-pointer ${density === 'spacious' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Cards
                  </button>
                </div>

                <Button
                  size="sm"
                  variant="subtle"
                  onClick={handleAutoDispatchMissing}
                  disabled={autoDispatching || loading}
                  className="text-xs"
                >
                  <IconSend className="size-3 text-blue-600" />
                  <span>{autoDispatching ? 'Dispatching…' : 'Batch Request Missing'}</span>
                </Button>

                <button
                  type="button"
                  onClick={loadQueue}
                  disabled={loading}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  title="Refresh queue"
                >
                  <IconRefresh className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Queue Cards / Table */}
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-xs text-slate-500 shadow-xs">
              <span className="size-6 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600 inline-block mb-3" />
              <p className="m-0">Loading verification records…</p>
            </div>
          ) : queue.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-xs">
              <span className="grid size-12 place-items-center rounded-full bg-blue-50 text-blue-700 mx-auto">
                <IconDocumentCheck className="size-6" />
              </span>
              <h4 className="mt-3 text-base font-bold text-slate-900">
                {filterStatus === 'PROBLEMS_ONLY' ? 'No document problems found' : 'Queue is clear'}
              </h4>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                {filterStatus === 'PROBLEMS_ONLY'
                  ? 'All candidate documents in this queue are verified or waiting normal review with no reported discrepancies.'
                  : 'No candidates match the selected filter.'}
              </p>
              {filterStatus && (
                <button
                  type="button"
                  onClick={() => { setFilterStatus(''); setQueuePage(0); }}
                  className="mt-3 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  View all active candidates →
                </button>
              )}
            </div>
          ) : density === 'spacious' ? (
            /* ================= SPACIOUS CARD VIEW (Room to breathe, no clutter) ================= */
            <div className="space-y-4">
              {queue.map((item) => {
                const isExpanded = Boolean(expandedDocs[item.studentId]);
                const docKeys = [
                  { key: 'CNIC_FRONT', label: 'CNIC Front' },
                  { key: 'CNIC_BACK', label: 'CNIC Back' },
                  { key: 'FSC_MARKSHEET', label: 'FSc Marksheet' },
                  { key: 'MATRIC_MARKSHEET', label: 'Matric Marksheet' },
                  { key: 'DOMICILE', label: 'Domicile Certificate' },
                ];
                const verifiedDocsCount = docKeys.filter((d) => item.verifiedDocuments?.[d.key]?.isVerified).length;
                const hasItemProblem = item.overallStatus !== 'VERIFIED' && Boolean(
                  item.overallStatus === 'NEEDS_MANUAL_REVIEW' ||
                  item.hasProblem ||
                  (item.discrepancyNotes && item.discrepancyNotes.trim()) ||
                  (item.problemDocs && item.problemDocs.length > 0)
                );

                return (
                  <div
                    key={item.studentId}
                    className={`rounded-2xl border bg-white p-6 shadow-xs transition-all hover:shadow-sm ${
                      hasItemProblem
                        ? 'border-amber-300 ring-1 ring-amber-100'
                        : 'border-slate-200/90'
                    }`}
                  >
                    {/* Header Row: Candidate Identity, Badges, Status, and Primary Review Action */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                            {item.fullName}
                          </h3>
                          {item.fatherName && (
                            <span className="text-xs text-slate-500 font-medium">
                              (S/O {item.fatherName})
                            </span>
                          )}
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-mono font-medium text-slate-600">
                            Candidate #{item.studentId}
                          </span>
                          {item.leadId && (
                            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-mono font-semibold text-blue-700">
                              Lead #{item.leadId}
                            </span>
                          )}
                          {item.applicationNo && (
                            <span className="rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-[11px] font-mono text-slate-600">
                              App: {item.applicationNo}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {item.eligibleFor && (
                            <span className="rounded-md bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-100">
                              {item.eligibleFor}
                            </span>
                          )}
                          <StatusBadge
                            tone={
                              item.overallStatus === 'VERIFIED'
                                ? 'success'
                                : item.overallStatus === 'NEEDS_MANUAL_REVIEW'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {item.overallStatus}
                          </StatusBadge>
                        </div>
                      </div>

                      {/* Primary Action Button */}
                      <div className="flex items-center gap-2.5 shrink-0">
                        <Button
                          size="md"
                          variant="primary"
                          onClick={() => setSelectedStudentId(item.studentId)}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs"
                        >
                          Review Dossier & Decide
                        </Button>
                      </div>
                    </div>

                    {/* Dedicated Problem Callout Banner if Issue Exists */}
                    {hasItemProblem && (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs">
                        <div className="flex items-start gap-3">
                          <IconAlertTriangle className="size-4 shrink-0 text-amber-700 mt-0.5" />
                          <div className="space-y-1">
                            <strong className="text-amber-900 font-bold block">
                              Attention Required: Document Discrepancy or Review Flag
                            </strong>
                            <div className="text-amber-800 leading-relaxed font-sans">
                              {item.discrepancyNotes ||
                                (item.problemDocs?.length
                                  ? `Problem detected in: ${item.problemDocs.map((d) => `${d.type} (${d.status})`).join(', ')}`
                                  : 'Candidate has been escalated for manual review inspection.')}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Spacious Candidate Attributes Grid */}
                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div className="rounded-xl bg-slate-50/70 p-3.5 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                          Phone / WhatsApp
                        </span>
                        <div className="mt-1 font-mono font-bold text-slate-900">
                          {item.phoneNormalized}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleEditPhone(item.studentId, item.phoneNormalized)}
                          className="mt-1 text-[11px] font-medium text-blue-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                        >
                          <IconPencil className="size-3" />
                          <span>Edit phone</span>
                        </button>
                      </div>

                      <div className="rounded-xl bg-slate-50/70 p-3.5 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                          Email Address
                        </span>
                        <div className="mt-1 truncate font-medium text-slate-900" title={item.email || 'None'}>
                          {item.email || <span className="text-slate-400 italic">No email</span>}
                        </div>
                        <span className="mt-1 text-[11px] text-slate-400 block">
                          {item.city || 'Location unrecorded'}
                        </span>
                      </div>

                      <div className="rounded-xl bg-slate-50/70 p-3.5 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                          FSc / Intermediate Score
                        </span>
                        <div className="mt-1 font-mono font-bold text-slate-900">
                          {item.fscObtainedMarks ? `${item.fscObtainedMarks} / 1100` : '—'}
                        </div>
                        <span className="mt-1 text-[11px] text-slate-500 block">
                          {item.priorDegree || 'Group Unspecified'}
                        </span>
                      </div>

                      <div className="rounded-xl bg-slate-50/70 p-3.5 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                          Document Verification Progress
                        </span>
                        <div className="mt-1 flex items-center gap-2">
                          <strong className="text-slate-900 font-bold">
                            {verifiedDocsCount} of {docKeys.length} verified
                          </strong>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleDocExpand(item.studentId)}
                          className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                        >
                          {isExpanded ? 'Hide documents ▲' : 'Show checklist ▼'}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Document Checklist */}
                    {isExpanded && (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                          Document Checklist & Status
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {docKeys.map((docDef) => {
                            const verifiedInfo = item.verifiedDocuments?.[docDef.key];
                            const isVerified = verifiedInfo?.isVerified;
                            const hasUploaded = Boolean(verifiedInfo);
                            const hasIssue = ['DISCREPANCY', 'REJECTED', 'MANUAL_REVIEW'].includes(verifiedInfo?.status);

                            return (
                              <div
                                key={docDef.key}
                                className={`flex items-center justify-between rounded-lg border p-2.5 text-xs transition ${
                                  isVerified
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                    : hasIssue
                                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                                      : hasUploaded
                                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                                        : 'bg-white border-slate-200 text-slate-500'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-bold">
                                    {isVerified ? '✓' : hasIssue ? '✕' : hasUploaded ? '●' : '○'}
                                  </span>
                                  <span className="font-semibold">{docDef.label}</span>
                                </div>
                                <span className="font-mono text-[10px] font-bold">
                                  {isVerified ? 'Verified' : verifiedInfo?.status || 'Missing'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Card Action Footer */}
                    <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[11px] text-slate-500">
                        {item.missingDocuments?.length ? (
                          <span>
                            Pending required documents:{' '}
                            <strong className="text-amber-700">
                              {item.missingDocuments.join(', ')}
                            </strong>
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">
                            All mandatory documents verified
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {item.missingDocuments?.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleQuickGenerateToken(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 cursor-pointer"
                          >
                            <IconSend className="size-3.5" />
                            <span>Request Missing ({item.missingDocuments.length})</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReissueForm({
                              studentId: item.studentId,
                              docTypes: item.missingDocuments?.length ? item.missingDocuments : ['FSC_MARKSHEET'],
                              expiresInHours: 48,
                            });
                            setActiveTab('reissue');
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          Customize Link
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ================= COMPACT TABLE VIEW ================= */
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="border-b border-slate-100 bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-[.05em] text-slate-600">
                  <tr>
                    <th className="px-5 py-3.5">Candidate Details</th>
                    <th className="px-4 py-3.5">Contact</th>
                    <th className="px-4 py-3.5">Academic Score</th>
                    <th className="px-4 py-3.5">Program</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5 text-center">Verified Docs</th>
                    <th className="px-5 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queue.map((item) => {
                    const verifiedCount = Object.values(item.verifiedDocuments || {}).filter((d) => d.isVerified).length;
                    return (
                      <tr key={item.studentId} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900 text-sm">{item.fullName}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {item.fatherName ? `S/O ${item.fatherName} · ` : ''}
                            CNIC: <span className="font-mono text-slate-700 font-medium">{item.cnic || '—'}</span>
                            {item.city ? ` · ${item.city}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-mono font-medium text-slate-800">
                            {item.phoneNormalized || item.phoneRaw}
                          </div>
                          {item.email ? (
                            <div className="mt-0.5 truncate max-w-[170px] text-[11px] text-slate-500" title={item.email}>
                              {item.email}
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-slate-400 italic">No email on file</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">
                            {item.fscObtainedMarks ? (
                              <span>{item.fscObtainedMarks} <span className="text-slate-400 text-[11px]">/ 1100</span></span>
                            ) : (
                              '—'
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {item.priorDegree || 'Group Unspecified'}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {item.eligibleFor ? (
                            <span className="inline-block rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-100">
                              {item.eligibleFor}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">General Candidate</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col gap-1">
                            <StatusBadge
                              tone={
                                item.overallStatus === 'VERIFIED'
                                  ? 'success'
                                  : item.overallStatus === 'NEEDS_MANUAL_REVIEW'
                                    ? 'danger'
                                    : 'neutral'
                              }
                            >
                              {item.overallStatus}
                            </StatusBadge>
                            {item.overallStatus !== 'VERIFIED' && item.discrepancyNotes && (
                              <span className="text-[10px] text-amber-700 truncate max-w-[180px] font-medium" title={item.discrepancyNotes}>
                                {item.discrepancyNotes.split('\n').filter(Boolean).pop()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                              verifiedCount >= 3
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {verifiedCount >= 3 && <IconCheck className="size-3 text-emerald-600" />}
                            <span>{verifiedCount} / 5</span>
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={() => setSelectedStudentId(item.studentId)}
                            className="border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition text-xs font-semibold"
                          >
                            Review Dossier
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {queueTotal > pageSize && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xs">
              <p className="m-0 text-xs text-slate-500">
                Showing {queuePage * pageSize + 1}–{Math.min((queuePage + 1) * pageSize, queueTotal)} of {queueTotal} candidates
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={queuePage === 0 || loading}
                  onClick={() => setQueuePage((current) => Math.max(0, current - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-slate-600 font-mono">
                  Page {queuePage + 1} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={queuePage + 1 >= totalPages || loading}
                  onClick={() => setQueuePage((current) => Math.min(totalPages - 1, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tab 2: Discrepancy Ingest */}
      {activeTab === 'import' && (
        <section role="tabpanel" aria-label="Import discrepancies" className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="m-0 text-base font-bold text-slate-900">Import Discrepancies CSV</h2>
          <p className="mb-0 mt-1 text-xs text-slate-500">
            Upload an administrative discrepancy spreadsheet of applicants with missing or mismatched documents.
          </p>

          <form onSubmit={handleImportSubmit} className="mt-5 space-y-4">
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
              <input
                type="file"
                id="discrepancy-file"
                accept=".csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <label htmlFor="discrepancy-file" className="cursor-pointer">
                <span className="text-xs font-semibold text-blue-700">
                  {importFile ? importFile.name : 'Select or drop discrepancy CSV file'}
                </span>
                <p className="mb-0 mt-2 text-[11px] text-slate-500">
                  Include application number, student name, phone number, and document issues.
                </p>
              </label>
            </div>

            <Button type="submit" disabled={!importFile || importing} className="min-h-10 w-full text-xs sm:w-auto sm:px-5">
              {importing ? 'Importing…' : 'Import and send links'}
            </Button>
          </form>

          {importResult && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs">
              <strong className="text-emerald-900">Import complete</strong>
              <div className="mt-2 grid grid-cols-3 gap-2 text-emerald-800">
                <div>Total Records: <strong>{importResult.total}</strong></div>
                <div>Created: <strong>{importResult.created}</strong></div>
                <div>Tokens Minted: <strong>{importResult.tokensMinted}</strong></div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tab 3: Reissue Token */}
      {activeTab === 'reissue' && (
        <section role="tabpanel" aria-label="Reissue upload link" className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="m-0 text-base font-bold text-slate-900">Reissue Upload Link & Request Missing Documents</h2>
              <p className="mb-0 mt-1 text-xs text-slate-500">
                Generate a single-use tokenized link for missing documents and send it directly to the applicant's WhatsApp.
              </p>
            </div>
            <Button
              size="sm"
              variant="subtle"
              onClick={loadQueue}
              disabled={loading}
              className="border border-slate-200 bg-white text-xs"
            >
              Refresh Candidates
            </Button>
          </div>

          {/* Candidate Selection Dropdown */}
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs">
            <label className="block font-semibold text-blue-950 mb-1.5">
              Select Candidate to inspect missing documents:
            </label>
            <select
              value={reissueForm.studentId}
              onChange={(e) => {
                const val = e.target.value;
                const c = queue.find((cand) => String(cand.studentId) === String(val) || (cand.leadId && String(cand.leadId) === String(val)));
                setReissueForm((prev) => ({
                  ...prev,
                  studentId: val,
                  docTypes: c?.missingDocuments?.length ? c.missingDocuments : ['FSC_MARKSHEET', 'MATRIC_MARKSHEET'],
                }));
              }}
              className="w-full rounded-lg border border-blue-300 bg-white p-2.5 text-xs font-medium text-slate-800 shadow-2xs focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">-- Choose Candidate ({queue.length} in current view) --</option>
              {queue.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  #{c.studentId} {c.fullName} {c.leadId ? `(Lead #${c.leadId})` : ''} — {c.missingDocuments?.length || 0} Missing Doc(s): {c.missingDocuments?.map((d) => d.replace(/_/g, ' ')).join(', ') || 'All Verified'}
                </option>
              ))}
            </select>
          </div>

          {/* Selected Candidate Info Card */}
          {selectedCandidate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                    Candidate #{selectedCandidate.studentId}
                  </span>
                  <strong className="text-sm font-bold text-slate-900">{selectedCandidate.fullName}</strong>
                  {selectedCandidate.leadId && (
                    <span className="text-[11px] font-semibold text-slate-500">(Marketing Lead #{selectedCandidate.leadId})</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600">
                  WhatsApp: <strong className="font-mono text-slate-900">{selectedCandidate.phoneNormalized}</strong>
                </div>
              </div>

              <div className="mt-3">
                <span className="text-[11px] font-semibold text-slate-700">Verification Status by Document:</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[
                    { key: 'CNIC_FRONT', label: 'CNIC Front', mandatory: true },
                    { key: 'CNIC_BACK', label: 'CNIC Back', mandatory: false },
                    { key: 'FSC_MARKSHEET', label: 'FSc / HSSC Marksheet', mandatory: true },
                    { key: 'MATRIC_MARKSHEET', label: 'Matric / SSC Marksheet', mandatory: true },
                    { key: 'DOMICILE', label: 'Domicile Certificate', mandatory: false },
                  ].map((docDef) => {
                    const verifiedInfo = selectedCandidate.verifiedDocuments?.[docDef.key];
                    const isVerified = verifiedInfo?.isVerified;
                    const hasUploaded = Boolean(verifiedInfo);

                    return (
                      <div
                        key={docDef.key}
                        className={`flex items-center justify-between rounded-lg border p-2.5 text-[11px] ${
                          isVerified
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : docDef.mandatory
                              ? 'border-amber-200 bg-amber-50 text-amber-900'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        <span className="font-medium">{docDef.label}</span>
                        <span className="font-bold">
                          {isVerified ? (
                            <span className="text-emerald-700">Verified ({verifiedInfo.status})</span>
                          ) : hasUploaded ? (
                            <span className="text-amber-700">Uploaded ({verifiedInfo.status})</span>
                          ) : docDef.mandatory ? (
                            <span className="text-amber-800">Pending (Required)</span>
                          ) : (
                            <span className="text-slate-400">Not Uploaded</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] text-slate-600">
                  Pending required documents:{' '}
                  <strong className="text-amber-700">
                    {selectedCandidate.missingDocuments?.length
                      ? selectedCandidate.missingDocuments.map((d) => d.replace(/_/g, ' ')).join(', ')
                      : 'None (All Mandatory Docs Verified)'}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReissueForm((prev) => ({
                      ...prev,
                      docTypes: selectedCandidate.missingDocuments?.length
                        ? selectedCandidate.missingDocuments
                        : ['FSC_MARKSHEET', 'MATRIC_MARKSHEET'],
                    }));
                  }}
                  className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 border border-blue-200 hover:bg-blue-100 cursor-pointer"
                >
                  Select Missing Documents
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleReissueSubmit} className="mt-5 space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700">Candidate ID or Lead ID</label>
              <input
                type="number"
                required
                value={reissueForm.studentId}
                onChange={(e) => {
                  const val = e.target.value;
                  const matched = queue.find((c) => String(c.studentId) === String(val) || (c.leadId && String(c.leadId) === String(val)));
                  setReissueForm((prev) => ({
                    ...prev,
                    studentId: val,
                    docTypes: matched?.missingDocuments?.length ? matched.missingDocuments : prev.docTypes,
                  }));
                }}
                placeholder="e.g. 1 or 14"
                className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Required Document Types to Include in Link:
              </label>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                {[
                  { id: 'FSC_MARKSHEET', label: 'FSc / HSSC Marksheet', mandatory: true },
                  { id: 'MATRIC_MARKSHEET', label: 'Matric / SSC Marksheet', mandatory: true },
                  { id: 'CNIC_FRONT', label: 'CNIC Front', mandatory: true },
                  { id: 'CNIC_BACK', label: 'CNIC Back', mandatory: false },
                  { id: 'DOMICILE', label: 'Domicile Certificate', mandatory: false },
                ].map((item) => {
                  const isVerified = selectedCandidate?.verifiedDocuments?.[item.id]?.isVerified;
                  const isMissing = selectedCandidate?.missingDocuments?.includes(item.id);

                  return (
                    <label key={item.id} className="flex items-center justify-between rounded-lg p-1.5 hover:bg-white cursor-pointer">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reissueForm.docTypes.includes(item.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setReissueForm((prev) => ({
                              ...prev,
                              docTypes: checked
                                ? [...prev.docTypes, item.id]
                                : prev.docTypes.filter((x) => x !== item.id),
                            }));
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-semibold text-slate-800">{item.label}</span>
                      </div>
                      <div>
                        {isVerified ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            Verified
                          </span>
                        ) : isMissing ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Pending Verification
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Optional</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700">Expiration Window (Hours)</label>
              <input
                type="number"
                min="1"
                max="168"
                value={reissueForm.expiresInHours}
                onChange={(e) => setReissueForm((prev) => ({ ...prev, expiresInHours: e.target.value }))}
                className="mt-1 w-32 rounded-lg border border-slate-300 p-2 text-xs"
              />
            </div>

            <Button
              type="submit"
              disabled={reissuing || !reissueForm.studentId || reissueForm.docTypes.length === 0}
              className="min-h-10 w-full text-xs font-bold sm:w-auto sm:px-6 bg-blue-600 text-white hover:bg-blue-700 rounded-xl"
            >
              {reissuing
                ? 'Creating and dispatching link…'
                : `Create & Send Link for ${reissueForm.docTypes.length} Document(s)`}
            </Button>
          </form>

          {reissueResult && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
              <p className="mb-0 font-bold text-emerald-900">
                Upload link generated and dispatched to {reissueResult.studentName || 'Candidate'}.
              </p>
              <p className="mb-0 mt-1 text-[11px] text-emerald-800">
                Target: Candidate #{reissueResult.studentId} | Required: {reissueResult.allowedDocTypes?.map((d) => d.replace(/_/g, ' ')).join(', ')}
              </p>
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-white p-2.5 border border-emerald-200">
                <span className="font-mono text-[11px] truncate text-slate-700">{reissueResult.uploadUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(reissueResult.uploadUrl);
                    setNotice({ type: 'info', message: 'Upload link copied to clipboard!' });
                  }}
                  className="shrink-0 text-emerald-700 font-bold hover:underline cursor-pointer"
                >
                  Copy Link
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Candidate Verification Dossier Modal */}
      {selectedStudentId && (
        <StudentDossierModal
          studentId={selectedStudentId}
          isOpen={Boolean(selectedStudentId)}
          onClose={() => setSelectedStudentId(null)}
          onActionComplete={loadQueue}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmModal && (
        <ConfirmDialog
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          tone={confirmModal.tone}
          loading={autoDispatching}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Prompt Dialog */}
      {promptModal && (
        <PromptDialog
          isOpen={promptModal.isOpen}
          title={promptModal.title}
          message={promptModal.message}
          placeholder={promptModal.placeholder}
          initialValue={promptModal.initialValue}
          confirmLabel={promptModal.confirmLabel}
          presets={promptModal.presets}
          loading={loading}
          onConfirm={promptModal.onConfirm}
          onCancel={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}
