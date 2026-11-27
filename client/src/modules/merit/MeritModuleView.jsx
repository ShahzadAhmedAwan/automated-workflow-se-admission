import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { meritApi } from './meritApi.js';
import {
  MetricStrip,
  SectionTabs,
  StatusBadge,
  WorkspacePanel,
  Button,
  ConfirmDialog,
  ToastBanner,
} from '../../core/ui/primitives.jsx';
import { formatUserError } from '../../core/utils/friendlyErrors.js';
import {
  IconAcademicCap,
  IconAlertTriangle,
  IconCalculator,
  IconCheck,
  IconClose,
  IconDownload,
  IconLockClosed,
  IconRefresh,
  IconSearch,
  IconSend,
  IconUploadCloud,
} from '../../core/icons/Icons.jsx';
import { marketingApi } from '../marketing/marketingApi.js';

export function MeritModuleView() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('calculations'); // 'calculations' | 'seet' | 'policies' | 'snapshots'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  // Policies state
  const [activePolicy, setActivePolicy] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    name: '',
    matricWeightage: 10,
    fscWeightage: 40,
    entryTestWeightage: 50,
  });

  // Calculations / Active Snapshot State
  const [calculating, setCalculating] = useState(false);
  const [meritData, setMeritData] = useState(null); // { policy, entries, totalCandidates, selectedCount, waitlistedCount }
  const [currentSnapshotId, setCurrentSnapshotId] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [snapshotTitleInput, setSnapshotTitleInput] = useState('');
  const [iterationInput, setIterationInput] = useState(1);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Snapshots History
  const [snapshots, setSnapshots] = useState([]);

  // Merit Table Filters
  const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL' | 'SELECTED' | 'SEET_PENDING' | 'BELOW_MERIT' | 'WAITLISTED'
  const [searchQuery, setSearchQuery] = useState('');
  const [quotaFilter, setQuotaFilter] = useState('ALL');

  // SEET Scraper & Gazette State
  const [seetMode, setSeetMode] = useState('lookup'); // 'lookup' | 'manual'
  const [seetCnic, setSeetCnic] = useState('');
  const [seetSearching, setSeetSearching] = useState(false);
  const [seetResult, setSeetResult] = useState(null);
  const [savingSeet, setSavingSeet] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [useSimulatedPortal, setUseSimulatedPortal] = useState(false);
  const [seetPhases, setSeetPhases] = useState([]);
  const [refreshingPhases, setRefreshingPhases] = useState(false);

  // Manual Entry Form State
  const [manualForm, setManualForm] = useState({
    cnic: '',
    rollNo: '',
    candidateName: '',
    fatherName: '',
    marksObtained: '',
    totalMarks: '100',
  });
  const [savingManual, setSavingManual] = useState(false);

  // Gazette PDF upload
  const [gazetteFile, setGazetteFile] = useState(null);
  const [uploadingGazette, setUploadingGazette] = useState(false);
  const [gazetteResult, setGazetteResult] = useState(null);

  // WhatsApp Notification Dialog
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [dueDateInput, setDueDateInput] = useState('Friday, 4:00 PM');
  const [forceResend, setForceResend] = useState(false);
  const [selectedStudentForNotice, setSelectedStudentForNotice] = useState(null);
  const [waStatus, setWaStatus] = useState(null);

  // CSV Export
  const [exporting, setExporting] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (showNotifyModal) {
      marketingApi.getWhatsAppStatus().then(setWaStatus).catch(() => null);
    }
  }, [showNotifyModal]);

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      const [policy, snaps, phaseData] = await Promise.all([
        meritApi.getActivePolicy('SE').catch(() => null),
        meritApi.listSnapshots().catch(() => []),
        meritApi.getSeetPhases().catch(() => null),
      ]);

      if (phaseData?.phases) {
        setSeetPhases(phaseData.phases);
      }

      if (policy) {
        setActivePolicy(policy);
        setPolicyForm({
          name: policy.name,
          matricWeightage: policy.matricWeightage,
          fscWeightage: policy.fscWeightage,
          entryTestWeightage: policy.entryTestWeightage,
        });
      }
      setSnapshots(snaps || []);

      // If there is an existing snapshot with evaluated candidates, load the latest
      if (snaps && snaps.length && snaps[0].totalCandidates > 0) {
        loadSnapshotDetails(snaps[0].id);
      } else {
        // Run initial live calculation against all currently verified candidates
        runDryRunCalculation();
      }
    } catch (err) {
      setError(formatUserError(err, 'Failed to load initial merit data.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSnapshotDetails(snapshotId) {
    setLoading(true);
    setError('');
    try {
      const data = await meritApi.getSnapshot(snapshotId);
      setMeritData(data);
      setCurrentSnapshotId(data.snapshot.id);
      setIsLocked(data.snapshot.isLocked);
    } catch (err) {
      setError(formatUserError(err, 'Failed to load snapshot details.'));
    } finally {
      setLoading(false);
    }
  }

  async function runDryRunCalculation() {
    setCalculating(true);
    setError('');
    try {
      const res = await meritApi.calculateMerit({ isDryRun: true });
      setMeritData({
        snapshot: {
          snapshotTitle: `${res.policy?.name || 'Admission Policy'} (Dry Run Preview)`,
          isLocked: false,
          totalCandidates: res.totalCandidates || 0,
          selectedCount: res.selectedCount || 0,
          waitlistedCount: res.waitlistedCount || 0,
        },
        entries: res.entries || [],
      });
      setCurrentSnapshotId(null);
      setIsLocked(false);
      setSuccess('Calculated live preview based on verified candidates.');
    } catch (err) {
      setError(formatUserError(err, 'Dry-run calculation failed.'));
    } finally {
      setCalculating(false);
    }
  }

  async function handleGenerateOfficialSnapshot(e) {
    e.preventDefault();
    setCalculating(true);
    setError('');
    try {
      const res = await meritApi.calculateMerit({
        snapshotTitle: snapshotTitleInput.trim() || undefined,
        iterationNumber: Number(iterationInput) || 1,
        isDryRun: false,
      });
      setSuccess(`Generated official ${res.snapshotTitle}.`);
      setShowGenerateModal(false);
      await loadInitialData();
      if (res.id) {
        await loadSnapshotDetails(res.id);
      }
    } catch (err) {
      setError(formatUserError(err, 'Failed to generate official snapshot.'));
    } finally {
      setCalculating(false);
    }
  }

  async function handleLockSnapshot() {
    if (!currentSnapshotId) return;
    setConfirmModal({
      isOpen: true,
      title: 'Lock Official Merit List',
      message: 'Are you sure you want to lock this merit list? Once locked, it is legally immutable and cannot be modified or overwritten.',
      confirmLabel: 'Lock Snapshot (Permanent)',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        setLoading(true);
        setError('');
        try {
          await meritApi.lockSnapshot(currentSnapshotId);
          setIsLocked(true);
          setSuccess('Merit snapshot locked successfully.');
          await loadSnapshotDetails(currentSnapshotId);
          const snaps = await meritApi.listSnapshots();
          setSnapshots(snaps || []);
        } catch (err) {
          setError(formatUserError(err, 'Failed to lock snapshot.'));
        } finally {
          setLoading(false);
        }
      },
    });
  }

  async function handleExportCsv(targetSnapshotId, title) {
    const sId = targetSnapshotId || currentSnapshotId;
    if (!sId) {
      setError('Please select or generate an official snapshot to export.');
      return;
    }
    setExporting(true);
    setError('');
    try {
      const blob = await meritApi.exportSnapshotCsv(sId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const cleanTitle = (title || snapshotTitleInput || `merit_snapshot_${sId}`)
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      link.download = `${cleanTitle}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSuccess('Merit list exported to CSV successfully.');
    } catch (err) {
      setError(formatUserError(err, 'Failed to export CSV.'));
    } finally {
      setExporting(false);
    }
  }

  async function handleDispatchWhatsAppNotifications(e) {
    e.preventDefault();
    if (!currentSnapshotId) return;
    setNotifying(true);
    setError('');
    try {
      const payload = {
        duePaymentDate: dueDateInput.trim(),
        forceResend,
      };
      if (selectedStudentForNotice?.studentId) {
        payload.studentId = selectedStudentForNotice.studentId;
      }
      const res = await meritApi.notifySelected(currentSnapshotId, payload);
      setSuccess(res.message || `Queued WhatsApp notices for ${res.notifiedCount} candidates.`);
      setShowNotifyModal(false);
      setSelectedStudentForNotice(null);
      await loadSnapshotDetails(currentSnapshotId);
    } catch (err) {
      setError(formatUserError(err, 'Failed to dispatch WhatsApp notices.'));
    } finally {
      setNotifying(false);
    }
  }

  // SEET Lookup
  async function handleSeetLookup(e, forceSimulate = false) {
    if (e?.preventDefault) e.preventDefault();
    if (!seetCnic.trim()) return;

    const digitsOnly = seetCnic.replace(/\D/g, '');
    if (digitsOnly.length !== 13) {
      setError(`Pakistani CNIC must be exactly 13 digits (you entered ${digitsOnly.length} digits). Check for typos or enter marks manually below.`);
      setManualForm((prev) => ({ ...prev, cnic: seetCnic.trim() }));
      return;
    }

    const shouldSimulate = forceSimulate || useSimulatedPortal;
    setSeetSearching(true);
    setError('');
    setSeetResult(null);
    try {
      const res = await meritApi.lookupSeet(seetCnic.trim(), shouldSimulate);
      setSeetResult(res);
      if (res.found && res.data) {
        setSuccess(`Successfully extracted SEET test score for ${res.data.candidateName || 'Candidate'} (${res.phase || res.data?.phase || 'SEET'}): ${res.data.marksObtained}/100.`);
      } else {
        setError(res.message || 'No SEET record found on official portal across active test phases. Candidate remains SEET Pending.');
        setManualForm((prev) => ({
          ...prev,
          cnic: res.cnic || seetCnic.trim(),
        }));
      }
    } catch (err) {
      setError(formatUserError(err, 'Error querying SEET portal. Candidate remains SEET Pending.'));
      setManualForm((prev) => ({
        ...prev,
        cnic: seetCnic.trim(),
      }));
    } finally {
      setSeetSearching(false);
    }
  }

  async function handleRefreshPhases() {
    setRefreshingPhases(true);
    setError('');
    try {
      const data = await meritApi.getSeetPhases(true);
      if (data?.phases) {
        setSeetPhases(data.phases);
        setSuccess(`Discovered ${data.phases.length} active exam phases from official portal: ${data.summary}`);
      }
    } catch (err) {
      setError(formatUserError(err, 'Could not refresh test phases from portal.'));
    } finally {
      setRefreshingPhases(false);
    }
  }

  async function handleSaveManualSeet(e) {
    e.preventDefault();
    const digitsOnly = (manualForm.cnic || '').replace(/\D/g, '');
    if (digitsOnly.length !== 13) {
      setError(`CNIC must be exactly 13 digits (currently ${digitsOnly.length} digits).`);
      return;
    }
    const marks = parseFloat(manualForm.marksObtained);
    const total = parseFloat(manualForm.totalMarks) || 100;
    if (isNaN(marks) || marks < 0 || marks > total) {
      setError(`Obtained marks must be between 0 and total marks (${total}).`);
      return;
    }

    setSavingManual(true);
    setError('');
    try {
      const saved = await meritApi.saveSeetResult({
        cnic: manualForm.cnic.trim(),
        rollNo: manualForm.rollNo?.trim() || null,
        candidateName: manualForm.candidateName?.trim() || null,
        fatherName: manualForm.fatherName?.trim() || null,
        marksObtained: marks,
        totalMarks: total,
        sourceType: 'MANUAL_ENTRY',
      });
      setSuccess(`Official test score (${saved.marksObtained}/${saved.totalMarks}) saved for ${saved.cnic} and linked to candidate record.`);
      setManualForm({
        cnic: '',
        rollNo: '',
        candidateName: '',
        fatherName: '',
        marksObtained: '',
        totalMarks: '100',
      });
      setSeetResult(null);
      setSeetCnic('');
      setSeetMode('lookup');
      await runDryRunCalculation();
    } catch (err) {
      setError(formatUserError(err, 'Failed to save manual test result.'));
    } finally {
      setSavingManual(false);
    }
  }

  async function handleSaveSeet() {
    if (!seetResult?.data) return;
    setSavingSeet(true);
    setError('');
    try {
      const saved = await meritApi.saveSeetResult(seetResult.data);
      setSuccess(`Saved SEET test score (${saved.marksObtained}/100) and linked to student record.`);
      setSeetResult(null);
      setSeetCnic('');
    } catch (err) {
      setError(formatUserError(err, 'Failed to save SEET score.'));
    } finally {
      setSavingSeet(false);
    }
  }

  async function handleSyncVerifiedSeet() {
    setConfirmModal({
      isOpen: true,
      title: 'Batch Sync SEET Portal Scores',
      message: 'Query seet.must.edu.pk for all verified candidates currently missing admission test scores? Matching test scores will be saved and linked directly to candidate records.',
      confirmLabel: 'Start Batch Sync',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmModal(null);
        setSyncingAll(true);
        setError('');
        setSyncSummary(null);
        try {
          const res = await meritApi.syncVerifiedSeet();
          setSyncSummary(res);
          setSuccess(`SEET batch sync finished: ${res.matched} matched, ${res.unmatched} unmatched.`);
        } catch (err) {
          setError(formatUserError(err, 'Failed to batch sync SEET results.'));
        } finally {
          setSyncingAll(false);
        }
      },
    });
  }

  // SEET Gazette PDF Upload
  async function handleGazetteUpload(e) {
    e.preventDefault();
    if (!gazetteFile) return;
    setUploadingGazette(true);
    setError('');
    setGazetteResult(null);
    try {
      const formData = new FormData();
      formData.append('file', gazetteFile);
      const res = await meritApi.uploadGazette(formData);
      setGazetteResult(res);
      setSuccess(`Parsed ${res.totalExtracted} SEET results. Successfully linked scores for ${res.matchedStudents} pending candidates (${res.remainingPending ?? 0} candidates still pending).`);
      setGazetteFile(null);
    } catch (err) {
      setError(formatUserError(err, 'Failed to process official SEET gazette PDF.'));
    } finally {
      setUploadingGazette(false);
    }
  }

  // Update Policy
  async function handleSavePolicy(e) {
    e.preventDefault();
    const sum = Number(policyForm.matricWeightage) + Number(policyForm.fscWeightage) + Number(policyForm.entryTestWeightage);
    if (Math.abs(sum - 100) > 0.01) {
      setError(`Weights must sum to 100% (currently ${sum}%).`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (activePolicy?.id) {
        const updated = await meritApi.updatePolicy(activePolicy.id, policyForm);
        setActivePolicy(updated);
        setSuccess('Admission policy updated.');
      }
      setEditingPolicy(false);
    } catch (err) {
      setError(formatUserError(err, 'Failed to save admission policy.'));
    } finally {
      setLoading(false);
    }
  }

  const weightSum =
    Number(policyForm.matricWeightage || 0) +
    Number(policyForm.fscWeightage || 0) +
    Number(policyForm.entryTestWeightage || 0);

  const allEntries = meritData?.entries || [];

  const totalCount = allEntries.length;
  const selectedCount = allEntries.filter((e) => e.decisionStatus === 'SELECTED').length;
  const seetPendingCount = allEntries.filter((e) => Number(e.entryTestScoreUsed || 0) <= 0).length;
  const belowCutoffCount = allEntries.filter(
    (e) =>
      e.decisionStatus !== 'SELECTED' &&
      (Number(e.aggregateScore || 0) < 40.0 || (e.ineligibilityReason && e.ineligibilityReason.includes('cutoff')))
  ).length;
  const waitlistedCount = allEntries.filter((e) => e.decisionStatus === 'WAITLISTED').length;

  const availableQuotas = Array.from(
    new Set(allEntries.map((e) => e.allocatedQuota || e.quotaCategory || 'OPEN_MERIT'))
  );

  const filteredEntries = allEntries.filter((entry) => {
    // 1. Status Filter
    if (filterStatus === 'SELECTED' && entry.decisionStatus !== 'SELECTED') return false;
    if (filterStatus === 'SEET_PENDING' && Number(entry.entryTestScoreUsed || 0) > 0) return false;
    if (
      filterStatus === 'BELOW_MERIT' &&
      (entry.decisionStatus === 'SELECTED' ||
        (Number(entry.aggregateScore || 0) >= 40.0 && !entry.ineligibilityReason?.includes('cutoff')))
    ) {
      return false;
    }
    if (filterStatus === 'WAITLISTED' && entry.decisionStatus !== 'WAITLISTED') return false;

    // 2. Quota Filter
    if (quotaFilter !== 'ALL') {
      const q = entry.allocatedQuota || entry.quotaCategory || 'OPEN_MERIT';
      if (q !== quotaFilter) return false;
    }

    // 3. Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = entry.fullName?.toLowerCase().includes(q);
      const matchFather = entry.fatherName?.toLowerCase().includes(q);
      const matchCnic = entry.cnic?.toLowerCase().includes(q);
      const matchApp = entry.applicationNo?.toLowerCase().includes(q);
      const matchId = String(entry.studentId || entry.id).includes(q);
      if (!matchName && !matchFather && !matchCnic && !matchApp && !matchId) return false;
    }

    return true;
  });

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {error && (
        <ToastBanner notice={{ type: 'error', message: error }} onDismiss={() => setError('')} />
      )}
      {success && (
        <ToastBanner notice={{ type: 'success', message: success }} onDismiss={() => setSuccess('')} />
      )}

      {/* Navigation Tabs */}
      <SectionTabs
        label="Merit engine sections"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'calculations', label: 'Merit Calculations & Rankings', count: totalCount || undefined },
          { id: 'seet', label: 'SEET Test & Gazette Sync', count: seetPendingCount > 0 ? seetPendingCount : undefined },
          { id: 'policies', label: 'Admission Weightage Policies' },
          { id: 'snapshots', label: 'Merit Snapshots', count: snapshots.length || undefined },
        ]}
      />

      {/* Context-Sensitive Metric Strips */}
      {activeTab === 'calculations' && (
        <MetricStrip
          label="Merit calculation overview"
          items={[
            {
              label: 'Evaluated Candidates',
              value: totalCount,
              detail: 'Verified applicant records',
            },
            {
              label: 'Selected for Admission',
              value: selectedCount,
              tone: 'emerald',
              detail: `${activePolicy?.quotaDefinitions?.find((q) => q.code === 'OPEN_MERIT')?.seats || 70} open merit capacity`,
            },
            {
              label: 'SEET Test Pending',
              value: seetPendingCount,
              tone: 'amber',
              detail: 'Awaiting entry test marks',
            },
            {
              label: 'Below Merit Cutoff',
              value: belowCutoffCount,
              tone: 'rose',
              detail: 'Aggregate score < 40%',
            },
          ]}
        />
      )}

      {activeTab === 'seet' && (
        <MetricStrip
          label="SEET test synchronization overview"
          items={[
            {
              label: 'Verified Candidates',
              value: totalCount,
              detail: 'Module 3 verified records',
            },
            {
              label: 'SEET Scores Synced',
              value: Math.max(0, totalCount - seetPendingCount),
              tone: 'emerald',
              detail: 'Portal & gazette matched',
            },
            {
              label: 'Awaiting Test Score',
              value: seetPendingCount,
              tone: 'amber',
              detail: 'Requires portal or slip sync',
            },
            {
              label: 'Entrance Test Weight',
              value: `${activePolicy?.entryTestWeightage || 50}%`,
              tone: 'blue',
              detail: 'Weight in aggregate merit',
            },
          ]}
        />
      )}

      {activeTab === 'policies' && (
        <MetricStrip
          label="Active merit policy"
          items={[
            {
              label: 'Matric Weightage',
              value: `${activePolicy?.matricWeightage || 10}%`,
              detail: 'Academic record (10%)',
            },
            {
              label: 'FSc Weightage',
              value: `${activePolicy?.fscWeightage || 40}%`,
              detail: 'Intermediate record (40%)',
            },
            {
              label: 'SEET Test Weightage',
              value: `${activePolicy?.entryTestWeightage || 50}%`,
              tone: 'blue',
              detail: 'Entrance test (50%)',
            },
            {
              label: 'Open Merit Quota',
              value: `${activePolicy?.quotaDefinitions?.find((q) => q.code === 'OPEN_MERIT')?.seats || 70} Seats`,
              tone: 'emerald',
              detail: 'Available capacity',
            },
          ]}
        />
      )}

      {activeTab === 'snapshots' && (
        <MetricStrip
          label="Official merit snapshot archive"
          items={[
            {
              label: 'Total Official Lists',
              value: snapshots.length,
              tone: 'blue',
              detail: 'Saved merit snapshots',
            },
            {
              label: 'Locked Snapshots',
              value: snapshots.filter((s) => s.isLocked).length,
              tone: 'emerald',
              detail: 'Immutable official records',
            },
            {
              label: 'Draft Snapshots',
              value: snapshots.filter((s) => !s.isLocked).length,
              tone: 'amber',
              detail: 'Editable working drafts',
            },
            {
              label: 'Latest Iteration',
              value: snapshots.length > 0 ? `List #${Math.max(...snapshots.map((s) => s.iterationNumber || 1))}` : 'None',
              detail: 'Active intake cycle',
            },
          ]}
        />
      )}

      {/* ==================================================================== */}
      {/* TAB 1: MERIT CALCULATIONS & RANKINGS                                 */}
      {/* ==================================================================== */}
      {activeTab === 'calculations' && (
        <div className="space-y-5">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
            {/* Academic Panel Header */}
            <div className="border-b border-slate-200 bg-slate-50/75 px-6 py-4">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0 space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="m-0 text-base font-bold text-slate-900 tracking-tight">
                      {meritData?.snapshot?.snapshotTitle || 'Merit Calculations & Rankings'}
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
                        isLocked
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : currentSnapshotId
                            ? 'bg-slate-100 text-slate-700 border border-slate-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          isLocked ? 'bg-amber-500' : currentSnapshotId ? 'bg-slate-500' : 'bg-blue-600'
                        }`}
                      />
                      {isLocked
                        ? 'Official Snapshot (Locked)'
                        : currentSnapshotId
                          ? `Saved Snapshot (Iteration ${meritData?.snapshot?.iterationNumber || 1})`
                          : 'Live Preview (Dry Run)'}
                    </span>
                  </div>
                  <p className="m-0 text-xs text-slate-500 font-normal leading-relaxed">
                    {allEntries.length === 0
                      ? 'No verified applicants evaluated in this view · Switch to Live Preview or select a snapshot'
                      : `${totalCount} verified applicant${totalCount === 1 ? '' : 's'} evaluated · ${selectedCount} selected for admission · ${seetPendingCount} pending SEET test scores`}
                  </p>
                </div>

                {/* Snapshot Switcher Dropdown */}
                {snapshots.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0 self-start lg:self-center">
                    <label htmlFor="snapshot-select" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Select List:
                    </label>
                    <select
                      id="snapshot-select"
                      value={currentSnapshotId || 'dry_run'}
                      onChange={(e) => {
                        if (e.target.value === 'dry_run') {
                          runDryRunCalculation();
                        } else {
                          loadSnapshotDetails(Number(e.target.value));
                        }
                      }}
                      className="h-9 min-w-[220px] max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-2xs focus:border-blue-600 focus:outline-none cursor-pointer"
                    >
                      <option value="dry_run">Live Preview (Dry Run)</option>
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.snapshotTitle} {s.isLocked ? '[Locked]' : '[Draft]'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Dedicated Actions & Operations Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
              {/* Primary Calculations Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={runDryRunCalculation}
                  disabled={calculating}
                  title="Run live aggregate calculation from latest verified candidate records"
                  className="border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                >
                  <IconCalculator className="size-3.5 text-blue-700" />
                  <span>Preview Calculation</span>
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowGenerateModal(true)}
                  disabled={calculating}
                  className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold shadow-xs px-3.5"
                >
                  <IconAcademicCap className="size-3.5" />
                  <span>Generate Official Snapshot</span>
                </Button>
              </div>

              {/* Secondary Operations (Export, Notices, Lock) */}
              <div className="flex flex-wrap items-center gap-2">
                {currentSnapshotId && (
                  <>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => handleExportCsv(currentSnapshotId, snapshotTitleInput)}
                      disabled={exporting}
                      title="Download merit list as CSV spreadsheet"
                      className="border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      <IconDownload className="size-3.5 text-slate-500" />
                      <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
                    </Button>

                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => {
                        setSelectedStudentForNotice(null);
                        const selected = (allEntries || []).filter((e) => e.decisionStatus === 'SELECTED');
                        const unnotified = selected.filter((e) => !e.notificationSent);
                        setForceResend(unnotified.length === 0 && selected.length > 0);
                        setShowNotifyModal(true);
                      }}
                      title="Dispatch WhatsApp selection notifications to eligible applicants"
                      className="border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      <IconSend className="size-3.5 text-emerald-600" />
                      <span>WhatsApp Notices</span>
                    </Button>

                    {isSuperAdmin && !isLocked && (
                      <button
                        type="button"
                        onClick={handleLockSnapshot}
                        disabled={loading}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
                        title="Lock official merit list (Permanent & Immutable legal record)"
                      >
                        <IconLockClosed className="size-3.5" />
                        <span>Lock Snapshot</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Lock status banner */}
            {isLocked && (
              <div className="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50/80 px-6 py-2.5 text-xs text-amber-900 font-medium">
                <IconLockClosed className="size-4 text-amber-700 shrink-0" />
                <span className="font-bold">Official Snapshot Locked:</span>
                <span>This merit list has been officially approved and locked by administration. It is permanently immutable.</span>
              </div>
            )}

            {/* Interactive Candidate Filtering Toolbar */}
            {allEntries.length > 0 && (
              <div className="border-b border-slate-200/80 bg-slate-50/50 p-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Segmented Filter Pills */}
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setFilterStatus('ALL')}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        filterStatus === 'ALL'
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span>All</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filterStatus === 'ALL' ? 'bg-slate-100 text-slate-800' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {totalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterStatus('SELECTED')}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        filterStatus === 'SELECTED'
                          ? 'bg-white text-emerald-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span className="size-2 rounded-full bg-emerald-500" />
                      <span>Selected</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filterStatus === 'SELECTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {selectedCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterStatus('SEET_PENDING')}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        filterStatus === 'SEET_PENDING'
                          ? 'bg-white text-amber-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span className="size-2 rounded-full bg-amber-500" />
                      <span>SEET Pending</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filterStatus === 'SEET_PENDING' ? 'bg-amber-50 text-amber-700' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {seetPendingCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterStatus('BELOW_MERIT')}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        filterStatus === 'BELOW_MERIT'
                          ? 'bg-white text-rose-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span className="size-2 rounded-full bg-rose-500" />
                      <span>Below Merit (&lt; 40%)</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filterStatus === 'BELOW_MERIT' ? 'bg-rose-50 text-rose-700' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {belowCutoffCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterStatus('WAITLISTED')}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        filterStatus === 'WAITLISTED'
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span className="size-2 rounded-full bg-slate-400" />
                      <span>Waitlisted</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filterStatus === 'WAITLISTED' ? 'bg-slate-100 text-slate-800' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {waitlistedCount}
                      </span>
                    </button>
                  </div>

                  {/* Quota filter, Search Input, and Reset */}
                  <div className="flex flex-wrap items-center gap-2">
                    {availableQuotas.length > 1 && (
                      <select
                        value={quotaFilter}
                        onChange={(e) => setQuotaFilter(e.target.value)}
                        className="h-8.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 shadow-2xs focus:outline-none focus:border-blue-600 cursor-pointer"
                      >
                        <option value="ALL">All Quotas</option>
                        {availableQuotas.map((q) => (
                          <option key={q} value={q}>{q.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    )}

                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search candidate, CNIC, app #..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8.5 w-48 sm:w-60 rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 shadow-2xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-500"
                      />
                      <IconSearch className="size-3.5 absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <IconClose className="size-3" />
                        </button>
                      )}
                    </div>

                    {(filterStatus !== 'ALL' || searchQuery || quotaFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterStatus('ALL');
                          setSearchQuery('');
                          setQuotaFilter('ALL');
                        }}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            {loading || calculating ? (
              <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-sm text-slate-500">
                <span className="size-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
                <span className="text-xs font-semibold text-slate-700">Computing weighted merit rankings...</span>
              </div>
            ) : !allEntries.length ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="mb-4 grid size-16 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 shadow-2xs">
                  <IconAcademicCap className="size-8 text-slate-500" />
                </div>
                <h3 className="m-0 text-base font-bold tracking-tight text-slate-900">
                  {currentSnapshotId ? 'No Candidates in this Saved Snapshot' : 'No Verified Candidates Evaluated'}
                </h3>
                <p className="mt-2 mb-0 max-w-lg text-xs leading-relaxed text-slate-500">
                  {currentSnapshotId
                    ? 'This snapshot was created earlier when no candidates were verified. Switch to Live Preview to calculate current rankings with newly verified students.'
                    : 'The merit engine strictly ranks candidates whose overall status is VERIFIED. In Module 3 (Document Verification), a candidate becomes verified once all mandatory admission documents (CNIC Front, FSc, Matric) are validated.'}
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={runDryRunCalculation}
                    disabled={calculating}
                    className="bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-xs"
                  >
                    <IconCalculator className="size-3.5" />
                    <span>Run Live Preview Calculation</span>
                  </Button>
                </div>
              </div>
            ) : !filteredEntries.length ? (
              <div className="grid min-h-48 place-content-center justify-items-center p-8 text-center space-y-2">
                <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500 mx-auto">
                  <IconSearch className="size-5" />
                </span>
                <p className="text-sm font-bold text-slate-800">No Candidates Match Selected Filter</p>
                <p className="text-xs text-slate-500 max-w-sm">
                  {filterStatus === 'SEET_PENDING'
                    ? 'All candidates currently evaluated have had their SEET scores recorded.'
                    : filterStatus === 'SELECTED'
                      ? 'No candidate has met both the SEET passing threshold and seat quota cutoff.'
                      : filterStatus === 'BELOW_MERIT'
                        ? 'No evaluated candidates are below the 40% merit cutoff.'
                        : 'No candidate matches the search query or active filter.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('ALL');
                    setSearchQuery('');
                    setQuotaFilter('ALL');
                  }}
                  className="mt-2 text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  View all {totalCount} evaluated candidates
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs text-slate-700 border-collapse">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3.5 text-center w-16">Rank</th>
                      <th className="px-4 py-3.5">Applicant Details</th>
                      <th className="px-3 py-3.5 text-center">Matric ({activePolicy?.matricWeightage || 10}%)</th>
                      <th className="px-3 py-3.5 text-center">FSc ({activePolicy?.fscWeightage || 40}%)</th>
                      <th className="px-3 py-3.5 text-center">SEET ({activePolicy?.entryTestWeightage || 50}%)</th>
                      <th className="px-4 py-3.5 text-center font-bold text-slate-900">Aggregate</th>
                      <th className="px-3 py-3.5 text-center">Quota</th>
                      <th className="px-3 py-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEntries.map((entry) => (
                      <tr key={entry.studentId || entry.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex size-6 items-center justify-center rounded-md font-mono font-semibold text-xs ${
                            entry.meritPosition === 1
                              ? 'bg-amber-50 text-amber-800 border border-amber-200/90 shadow-2xs'
                              : entry.meritPosition <= 3
                                ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                : 'text-slate-600'
                          }`}>
                            {entry.meritPosition}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-900 text-xs tracking-tight">
                              {entry.fullName}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              {entry.fatherName && <span>S/D/O {entry.fatherName}</span>}
                              {entry.fatherName && entry.cnic && <span className="text-slate-300">·</span>}
                              {entry.cnic && (
                                <span className="font-mono text-slate-500">
                                  {entry.cnic}
                                </span>
                              )}
                              {entry.applicationNo && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="font-mono text-[10px] text-slate-400">
                                    {entry.applicationNo}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center font-mono">
                          <span className="font-semibold text-slate-800">{entry.matricScoreUsed}</span>
                          <span className="text-slate-400 text-[10px]"> /{entry.matricTotalUsed}</span>
                        </td>
                        <td className="px-3 py-3.5 text-center font-mono">
                          <span className="font-semibold text-slate-800">{entry.fscScoreUsed}</span>
                          <span className="text-slate-400 text-[10px]"> /{entry.fscTotalUsed}</span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          {entry.entryTestScoreUsed > 0 ? (
                            <div className="font-mono text-xs">
                              <span className={`font-bold ${entry.entryTestScoreUsed >= 40 ? 'text-slate-900' : 'text-rose-700'}`}>
                                {entry.entryTestScoreUsed}
                              </span>
                              <span className="text-slate-400 text-[10px]"> /{entry.entryTestTotalUsed}</span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-[10px] font-medium" title="SEET entry test score pending">
                              <span className="size-1.5 rounded-full bg-amber-500" />
                              <span>Score Pending</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="space-y-1">
                            <div className="font-mono text-xs font-bold text-slate-900">
                              {entry.aggregateScore.toFixed(3)}%
                            </div>
                            <div className="w-14 mx-auto h-1 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  entry.aggregateScore >= 60
                                    ? 'bg-emerald-500'
                                    : entry.aggregateScore >= 40
                                      ? 'bg-blue-500'
                                      : 'bg-rose-400'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, entry.aggregateScore))}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                            {(entry.allocatedQuota || entry.quotaCategory || 'OPEN_MERIT').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            {entry.decisionStatus === 'SELECTED' ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  <span className="size-1.5 rounded-full bg-emerald-500" />
                                  <span>Selected</span>
                                </span>
                                {currentSnapshotId && (
                                  entry.notificationSent ? (
                                    <div className="flex items-center gap-1">
                                      <span
                                        className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50/90 px-1.5 py-0.5 rounded border border-emerald-200/60"
                                        title={entry.notificationSentAt ? `Notice queued ${new Date(entry.notificationSentAt).toLocaleString()}` : 'Notice sent'}
                                      >
                                        <IconCheck className="size-2.5 text-emerald-600" />
                                        <span>Notice Sent</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedStudentForNotice(entry);
                                          setForceResend(true);
                                          setShowNotifyModal(true);
                                        }}
                                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                                        title="Resend WhatsApp notice to this candidate"
                                      >
                                        Resend
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                        <span className="size-1.5 rounded-full bg-amber-500" />
                                        <span>Notice Pending</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedStudentForNotice(entry);
                                          setForceResend(false);
                                          setShowNotifyModal(true);
                                        }}
                                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                                        title="Send WhatsApp notice to this candidate"
                                      >
                                        Send Notice
                                      </button>
                                    </div>
                                  )
                                )}
                              </div>
                            ) : entry.decisionStatus === 'REJECTED' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                                <span className="size-1.5 rounded-full bg-rose-500" />
                                <span>Ineligible</span>
                              </span>
                            ) : entry.entryTestScoreUsed <= 0 ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                <span className="size-1.5 rounded-full bg-amber-500" />
                                <span>SEET Pending</span>
                              </span>
                            ) : entry.aggregateScore < 40 ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                                <span className="size-1.5 rounded-full bg-rose-500" />
                                <span>Below Cutoff</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                <span className="size-1.5 rounded-full bg-slate-400" />
                                <span>Waitlisted</span>
                              </span>
                            )}

                            {entry.tieBreakLevel > 0 && (
                              <span className="inline-flex items-center text-[10px] text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/50">
                                Tier {entry.tieBreakLevel} Tie-break
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: SEET RESULT LOOKUP & GAZETTE PDF SYNC                         */}
      {/* ==================================================================== */}
      {activeTab === 'seet' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Card 1: Official SEET Portal Scraper & Manual Entry */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
            {/* Header with Icon */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
                  <IconSearch className="size-5" />
                </span>
                <div>
                  <h3 className="m-0 text-sm font-bold text-slate-900">
                    SEET Entry Test Portal & Score Link
                  </h3>
                  <p className="m-0 text-xs text-slate-500 font-normal">
                    Query live test results from seet.must.edu.pk or record marks manually
                  </p>
                </div>
              </div>
            </div>

            {/* Segmented Mode Switcher */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => setSeetMode('lookup')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                    seetMode === 'lookup'
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  Portal Live Lookup
                </button>
                <button
                  type="button"
                  onClick={() => setSeetMode('manual')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                    seetMode === 'manual'
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  Manual Score Entry
                </button>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {seetMode === 'lookup' ? 'seet.must.edu.pk' : 'Offline / Result Slip'}
              </span>
            </div>

            {/* Sub-view 1: Live Portal Scraper */}
            {seetMode === 'lookup' && (
              <div className="space-y-4">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 leading-relaxed m-0">
                      Direct lookup by student CNIC from official test results portal:{' '}
                      <code className="text-blue-700 font-mono">seet.must.edu.pk/seet_result.php</code>
                    </p>
                    <button
                      type="button"
                      onClick={handleRefreshPhases}
                      disabled={refreshingPhases}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer disabled:opacity-50"
                      title="Discover active admission phases published on official SEET portal"
                    >
                      <IconRefresh className={`size-3 ${refreshingPhases ? 'animate-spin' : ''}`} />
                      <span>{refreshingPhases ? 'Scanning Portal...' : 'Discover Live Phases'}</span>
                    </button>
                  </div>

                  {/* Active Exam Phases Badges */}
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-blue-100 bg-blue-50/50">
                    <span className="text-[11px] font-semibold text-blue-950 flex items-center gap-1">
                      <span>Active Test Phases:</span>
                    </span>
                    {(seetPhases.length > 0 ? seetPhases : [
                      { id: '11', label: 'SEET26-P2' },
                      { id: '10', label: 'SEET26-P1' },
                    ]).map((p) => (
                      <span
                        key={p.id || p.label}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold font-mono bg-white text-blue-800 border border-blue-200/80 shadow-2xs"
                      >
                        <span className="size-1.5 rounded-full bg-blue-600" />
                        <span>{p.label}</span>
                      </span>
                    ))}
                    <span className="text-[10px] text-blue-700 font-medium ml-auto">
                      Auto-adapts to upcoming cycles (e.g. SEET27)
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSeetLookup} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={seetCnic}
                      onChange={(e) => setSeetCnic(e.target.value)}
                      placeholder="Enter 13-digit CNIC (e.g. 82101-1234567-1)"
                      className="flex-1 px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={seetSearching || !seetCnic.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <IconSearch className="size-4" />
                      <span>{seetSearching ? 'Searching...' : 'Search SEET'}</span>
                    </button>
                  </div>

                  {/* Real-time CNIC digit counter validation */}
                  {seetCnic.trim() && (
                    <div className="flex items-center justify-between text-[11px]">
                      {seetCnic.replace(/\D/g, '').length === 13 ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                          <IconCheck className="size-3" />
                          <span>13 digits (valid Pakistani CNIC format)</span>
                        </span>
                      ) : seetCnic.replace(/\D/g, '').length > 13 ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                          <IconAlertTriangle className="size-3" />
                          <span>{seetCnic.replace(/\D/g, '').length} / 13 digits ({seetCnic.replace(/\D/g, '').length - 13} extra)</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          {seetCnic.replace(/\D/g, '').length} / 13 digits
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setManualForm((f) => ({ ...f, cnic: seetCnic.trim() }));
                          setSeetMode('manual');
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                      >
                        Enter manually instead
                      </button>
                    </div>
                  )}

                  <div className="pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={useSimulatedPortal}
                        onChange={(e) => setUseSimulatedPortal(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>Simulate SEET portal response (test mode when seet.must.edu.pk is offline)</span>
                    </label>
                  </div>
                </form>

                {/* If live query timed out / offline, show actionable helper */}
                {error && error.toLowerCase().includes('seet portal') && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900">University SEET Server Unreachable</span>
                      <span className="text-[10px] font-mono text-amber-700">seet.must.edu.pk</span>
                    </div>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      The university website server <code className="font-mono text-blue-800">seet.must.edu.pk</code> is currently offline or timing out on the campus end. You can test the scraper with a simulated portal markup response or enter marks manually:
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => handleSeetLookup(e, true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                      >
                        <IconSearch className="size-3.5" />
                        <span>Scrape with Simulated SEET HTML</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setManualForm((f) => ({ ...f, cnic: seetCnic.trim() }));
                          setSeetMode('manual');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-xs font-medium cursor-pointer"
                      >
                        <span>Open Manual Entry Form</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Lookup result display */}
                {seetResult?.found && seetResult.data && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-emerald-900">Official Test Score Found</span>
                      <div className="flex items-center gap-2">
                        {seetResult.simulated && (
                          <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded">
                            Simulated Portal HTML
                          </span>
                        )}
                        <StatusBadge tone="success">{seetResult.data.status || 'PASS'}</StatusBadge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                      <div>Candidate: <strong className="font-semibold text-slate-900">{seetResult.data.candidateName || '—'}</strong></div>
                      <div>Roll Number: <strong className="font-mono text-slate-900">{seetResult.data.rollNo || '—'}</strong></div>
                      <div>CNIC: <strong className="font-mono text-slate-900">{seetResult.data.cnic}</strong></div>
                      <div>Score: <strong className="font-mono text-sm text-emerald-700">{seetResult.data.marksObtained} / 100</strong></div>
                      {(seetResult.data?.phase || seetResult.phase) && (
                        <div className="col-span-2">Test Phase: <strong className="font-semibold text-blue-700">{seetResult.data?.phase || seetResult.phase}</strong></div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveSeet}
                      disabled={savingSeet}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      <IconCheck className="size-4" />
                      <span>{savingSeet ? 'Saving & Backfilling...' : 'Save & Link to Student Record'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Sub-view 2: Manual Score Entry Form */}
            {seetMode === 'manual' && (
              <form onSubmit={handleSaveManualSeet} className="space-y-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    Manual SEET Score Entry
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Record admission test marks directly from verified result slip or gazette when the portal is slow or offline.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-semibold text-slate-700">Student CNIC / B-Form *</label>
                      <span className={`text-[10px] font-mono ${manualForm.cnic.replace(/\D/g, '').length === 13 ? 'text-emerald-600 font-bold' : 'text-slate-400'}`}>
                        {manualForm.cnic.replace(/\D/g, '').length} / 13 digits
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 82201-1234567-1"
                      value={manualForm.cnic}
                      onChange={(e) => setManualForm({ ...manualForm, cnic: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Entry Test Roll Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-1042"
                      value={manualForm.rollNo}
                      onChange={(e) => setManualForm({ ...manualForm, rollNo: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Candidate Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Muhammad Ali"
                      value={manualForm.candidateName}
                      onChange={(e) => setManualForm({ ...manualForm, candidateName: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">SEET Obtained Marks *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={manualForm.totalMarks || 100}
                      required
                      placeholder="e.g. 78"
                      value={manualForm.marksObtained}
                      onChange={(e) => setManualForm({ ...manualForm, marksObtained: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Total Marks *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={manualForm.totalMarks}
                      onChange={(e) => setManualForm({ ...manualForm, totalMarks: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={savingManual || !manualForm.cnic.trim() || manualForm.marksObtained === ''}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50"
                  >
                    <IconCheck className="size-4" />
                    <span>{savingManual ? 'Saving score...' : 'Save & Link to Candidate Record'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeetMode('lookup')}
                    className="px-3 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-900">Batch Sync for Verified Candidates</div>
                  <div className="text-[11px] text-slate-500">Auto-queries SEET portal for all verified candidates lacking test marks.</div>
                </div>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={handleSyncVerifiedSeet}
                  disabled={syncingAll}
                >
                  <IconRefresh className={`size-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
                  <span>{syncingAll ? 'Syncing...' : 'Sync verified'}</span>
                </Button>
              </div>

              {syncSummary && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Scanned</span>
                    <p className="font-bold font-mono text-slate-900 text-sm m-0">{syncSummary.totalCandidates}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] text-emerald-700 uppercase font-semibold">Matched & Saved</span>
                    <p className="font-bold font-mono text-emerald-800 text-sm m-0">{syncSummary.matched}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                    <span className="text-[10px] text-amber-700 uppercase font-semibold">Not Found</span>
                    <p className="font-bold font-mono text-amber-800 text-sm m-0">{syncSummary.unmatched}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Official SEET Gazette PDF Upload */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                  <IconUploadCloud className="size-5" />
                </span>
                <div>
                  <h3 className="m-0 text-sm font-bold text-slate-900">
                    Official SEET Test Gazette Upload
                  </h3>
                  <p className="m-0 text-xs text-slate-500 font-normal">
                    Stream & extract entry test scores directly from university PDF gazettes
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed m-0">
              Upload the official SEET entry test PDF gazette published by MUST. The streaming parser reads roll numbers, student names, and test scores, automatically matching and linking them to candidates with pending SEET scores.
            </p>

            <form onSubmit={handleGazetteUpload} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <input
                  type="file"
                  accept=".pdf"
                  required
                  onChange={(e) => setGazetteFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
              </div>

              <button
                type="submit"
                disabled={uploadingGazette || !gazetteFile}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <IconUploadCloud className="size-4" />
                <span>{uploadingGazette ? 'Processing SEET gazette...' : 'Process SEET Gazette PDF'}</span>
              </button>
            </form>

            {gazetteResult && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs space-y-2">
                <div className="font-bold text-emerald-900">SEET Gazette Sync Complete</div>
                <div>Extracted test scores: <strong className="font-mono">{gazetteResult.totalExtracted}</strong></div>
                <div>Pending candidates matched & updated: <strong className="font-mono text-emerald-700">{gazetteResult.matchedStudents ?? gazetteResult.matchedPendingStudents}</strong></div>
                {gazetteResult.remainingPending !== undefined && (
                  <div>Remaining candidates with pending SEET score: <strong className={`font-mono ${gazetteResult.remainingPending > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{gazetteResult.remainingPending}</strong></div>
                )}
                {gazetteResult.matchedDetails?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-emerald-200/60 space-y-1">
                    <div className="font-semibold text-emerald-950">Recently Updated Candidates:</div>
                    <div className="max-h-36 overflow-y-auto space-y-1">
                      {gazetteResult.matchedDetails.slice(0, 10).map((d, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px] text-emerald-900 bg-white/80 px-2 py-1 rounded">
                          <span>{d.studentName} ({d.cnic || d.rollNo})</span>
                          <span className="font-mono font-bold">{d.entryTestMarks} / 100 ({d.status})</span>
                        </div>
                      ))}
                      {gazetteResult.matchedDetails.length > 10 && (
                        <div className="text-[10px] text-emerald-700 italic">
                          + {gazetteResult.matchedDetails.length - 10} more candidates
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: ADMISSION POLICIES & QUOTA MANAGEMENT                        */}
      {/* ==================================================================== */}
      {activeTab === 'policies' && (
        <div className="space-y-5">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/75 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
                  <IconCalculator className="size-5" />
                </span>
                <div>
                  <h3 className="m-0 text-sm font-bold text-slate-900">
                    {activePolicy?.name || 'Active Admission Policy'}
                  </h3>
                  <p className="m-0 text-xs text-slate-500 font-normal">
                    Configurable weighting coefficients and quota distributions for aggregate merit calculations
                  </p>
                </div>
              </div>
              <Button
                variant={editingPolicy ? 'subtle' : 'primary'}
                size="sm"
                onClick={() => setEditingPolicy((p) => !p)}
              >
                {editingPolicy ? 'Cancel' : 'Edit Policy Weights'}
              </Button>
            </header>

            {editingPolicy ? (
              <form onSubmit={handleSavePolicy} className="p-6 space-y-4 max-w-xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Policy Title</label>
                  <input
                    type="text"
                    required
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Matric %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={policyForm.matricWeightage}
                      onChange={(e) => setPolicyForm({ ...policyForm, matricWeightage: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">FSc %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={policyForm.fscWeightage}
                      onChange={(e) => setPolicyForm({ ...policyForm, fscWeightage: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">SEET Test %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={policyForm.entryTestWeightage}
                      onChange={(e) => setPolicyForm({ ...policyForm, entryTestWeightage: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className={`text-xs font-semibold ${Math.abs(weightSum - 100) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                  Sum of weights: {weightSum}% {Math.abs(weightSum - 100) < 0.01 ? '(Valid)' : '(Must equal 100%)'}
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={loading || Math.abs(weightSum - 100) > 0.01}
                  >
                    Save Policy Weights
                  </Button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/75">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Matriculation</div>
                    <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{activePolicy?.matricWeightage}%</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Academic background foundation</div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/75">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">FSc / Intermediate</div>
                    <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{activePolicy?.fscWeightage}%</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Core science & mathematics score</div>
                  </div>
                  <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/60">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-900">SEET Entry Test</div>
                    <div className="text-2xl font-bold font-mono text-blue-800 mt-1">{activePolicy?.entryTestWeightage}%</div>
                    <div className="text-[11px] text-blue-700 mt-0.5">University admission entrance test</div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">Quota seat allocations</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {activePolicy?.quotaDefinitions?.map((q) => (
                      <div key={q.code} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
                        <div className="text-xs font-semibold text-slate-800">{q.title}</div>
                        <div className="text-lg font-bold font-mono text-slate-900 mt-1">{q.seats} seats</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: SNAPSHOTS AUDIT HISTORY                                       */}
      {/* ==================================================================== */}
      {activeTab === 'snapshots' && (
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/75 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <IconAcademicCap className="size-5" />
              </span>
              <div>
                <h3 className="m-0 text-sm font-bold text-slate-900">
                  Official Merit Snapshots History
                </h3>
                <p className="m-0 text-xs text-slate-500 font-normal">
                  Permanent administrative and legal audit trail of generated merit lists
                </p>
              </div>
            </div>
          </header>

          {!snapshots.length ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-3 grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-500">
                <IconAcademicCap className="size-6 text-slate-500" />
              </div>
              <h4 className="text-sm font-bold text-slate-800 m-0">No Official Snapshots Generated Yet</h4>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Generate and lock official merit lists from the Merit Calculations & Rankings tab to create an immutable archive.
              </p>
              <div className="mt-4">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActiveTab('calculations')}
                >
                  Go to Merit Calculations
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-6 py-3.5">Snapshot Title</th>
                    <th className="px-4 py-3.5">Iteration</th>
                    <th className="px-4 py-3.5 text-center">Candidates</th>
                    <th className="px-4 py-3.5 text-center">Selected</th>
                    <th className="px-4 py-3.5 text-center">Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshots.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-3.5 font-semibold text-slate-900">
                        {s.snapshotTitle}
                        <div className="text-[11px] font-normal text-slate-500">
                          Created by {s.creatorName || 'System'}
                          {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString()}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono">List #{s.iterationNumber}</td>
                      <td className="px-4 py-3.5 text-center font-mono">{s.totalCandidates}</td>
                      <td className="px-4 py-3.5 text-center font-mono font-semibold text-emerald-700">{s.selectedCount}</td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          s.isLocked
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          <span className={`size-1.5 rounded-full ${s.isLocked ? 'bg-amber-500' : 'bg-blue-600'}`} />
                          <span>{s.isLocked ? 'Locked (Immutable)' : 'Draft (Unlocked)'}</span>
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right space-x-2">
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => {
                            setActiveTab('calculations');
                            loadSnapshotDetails(s.id);
                          }}
                        >
                          View List
                        </Button>
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => handleExportCsv(s.id, s.snapshot_title || s.snapshotTitle)}
                          disabled={exporting}
                        >
                          <IconDownload className="size-3 text-slate-500" />
                          <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal: Generate Official Snapshot */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-700">
                  <IconAcademicCap className="size-4" />
                </span>
                <h3 className="text-sm font-bold text-slate-900 m-0">Generate Official Merit Snapshot</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <IconClose className="size-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateOfficialSnapshot} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Snapshot Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1st Official Merit List - Fall 2026"
                  value={snapshotTitleInput}
                  onChange={(e) => setSnapshotTitleInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Iteration Number *</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  required
                  value={iterationInput}
                  onChange={(e) => setIterationInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:border-blue-600 focus:outline-none"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">1 = 1st Merit List, 2 = 2nd Merit List (after fee dropouts), etc.</span>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <Button variant="subtle" type="button" onClick={() => setShowGenerateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={calculating}>
                  {calculating ? 'Generating...' : 'Generate & Save Snapshot'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: WhatsApp Selection Notices */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <IconSend className="size-4" />
                </span>
                <h3 className="text-sm font-bold text-slate-900 m-0">
                  {selectedStudentForNotice ? 'Send Candidate Selection Notice' : 'WhatsApp Selection Notices'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNotifyModal(false);
                  setSelectedStudentForNotice(null);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <IconClose className="size-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* WhatsApp Connection Indicator */}
              {waStatus && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs ${
                  waStatus.connected
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${waStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    <span className="font-semibold">
                      {waStatus.connected
                        ? `WhatsApp Bot Online (+${waStatus.phone})`
                        : 'WhatsApp Bot Disconnected / Offline'}
                    </span>
                  </div>
                  {!waStatus.connected && (
                    <span className="text-[10px] text-amber-700 font-medium">Will queue in outbox</span>
                  )}
                </div>
              )}

              {selectedStudentForNotice ? (
                <div className="p-3.5 bg-slate-50/80 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{selectedStudentForNotice.fullName}</span>
                    <span className="font-mono text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px]">
                      Rank #{selectedStudentForNotice.meritPosition}
                    </span>
                  </div>
                  <div className="text-slate-500 text-[11px] flex items-center gap-2">
                    <span>Phone: <strong className="font-mono text-slate-700">+{selectedStudentForNotice.phoneNormalized}</strong></span>
                    <span>·</span>
                    <span>Aggregate: <strong className="font-mono text-slate-700">{selectedStudentForNotice.aggregateScore.toFixed(3)}%</strong></span>
                  </div>
                  {selectedStudentForNotice.notificationSent && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium pt-1">
                      <IconAlertTriangle className="size-3.5 shrink-0 text-amber-600" />
                      <span>Notice was previously queued on {selectedStudentForNotice.notificationSentAt ? new Date(selectedStudentForNotice.notificationSentAt).toLocaleString() : 'earlier date'}.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600 leading-relaxed m-0">
                    Enqueue personalized WhatsApp messages to <strong className="text-emerald-700 font-semibold">SELECTED</strong> candidates with their rank, aggregate score, and fee submission instructions.
                  </p>
                  {(() => {
                    const selected = (allEntries || []).filter((e) => e.decisionStatus === 'SELECTED');
                    const sent = selected.filter((e) => e.notificationSent).length;
                    const pending = selected.length - sent;
                    return (
                      <div className="grid grid-cols-3 gap-2 text-center text-xs py-1">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                          <div className="text-slate-500 text-[10px] uppercase font-semibold">Total Selected</div>
                          <div className="font-bold text-slate-900 text-sm font-mono mt-0.5">{selected.length}</div>
                        </div>
                        <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                          <div className="text-emerald-700 text-[10px] uppercase font-semibold">Notice Sent</div>
                          <div className="font-bold text-emerald-800 text-sm font-mono mt-0.5">{sent}</div>
                        </div>
                        <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                          <div className="text-amber-700 text-[10px] uppercase font-semibold">Pending Notice</div>
                          <div className="font-bold text-amber-800 text-sm font-mono mt-0.5">{pending}</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <form onSubmit={handleDispatchWhatsAppNotifications} className="space-y-4 text-xs pt-1">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fee Submission Deadline *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Friday, 4:00 PM"
                    value={dueDateInput}
                    onChange={(e) => setDueDateInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {!selectedStudentForNotice && (
                  <label className="flex items-center gap-2 cursor-pointer pt-1 text-xs text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={forceResend}
                      onChange={(e) => setForceResend(e.target.checked)}
                      className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span>Re-send notices to candidates who were already notified</span>
                  </label>
                )}

                <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                  <Button
                    variant="subtle"
                    type="button"
                    onClick={() => {
                      setShowNotifyModal(false);
                      setSelectedStudentForNotice(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" disabled={notifying}>
                    <IconSend className="size-3.5" />
                    <span>
                      {notifying
                        ? 'Queueing messages...'
                        : selectedStudentForNotice
                          ? (selectedStudentForNotice.notificationSent ? 'Re-send WhatsApp Notice' : 'Dispatch WhatsApp Notice')
                          : forceResend
                            ? 'Re-dispatch WhatsApp Notices'
                            : 'Dispatch WhatsApp Notices'}
                    </span>
                  </Button>
                </div>
              </form>
            </div>
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
          loading={loading || syncingAll}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}
