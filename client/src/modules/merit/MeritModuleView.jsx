import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { meritApi } from './meritApi.js';
import {
  MetricStrip,
  SectionTabs,
  StatusBadge,
  WorkspacePanel,
  Button,
} from '../../core/ui/primitives.jsx';
import {
  IconAcademicCap,
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

export function MeritModuleView() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('calculations'); // 'calculations' | 'seet' | 'policies' | 'snapshots'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  // SEET Scraper & Gazette State
  const [seetMode, setSeetMode] = useState('lookup'); // 'lookup' | 'manual'
  const [seetCnic, setSeetCnic] = useState('');
  const [seetSearching, setSeetSearching] = useState(false);
  const [seetResult, setSeetResult] = useState(null);
  const [savingSeet, setSavingSeet] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [useSimulatedPortal, setUseSimulatedPortal] = useState(false);

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

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      const [policy, snaps] = await Promise.all([
        meritApi.getActivePolicy('SE').catch(() => null),
        meritApi.listSnapshots().catch(() => []),
      ]);

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

      // If there is an existing snapshot, load the latest
      if (snaps && snaps.length) {
        loadSnapshotDetails(snaps[0].id);
      } else {
        // Run initial dry run calculation
        runDryRunCalculation();
      }
    } catch (err) {
      setError(err.message || 'Failed to load initial merit data.');
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
      setError(err.message || 'Failed to load snapshot details.');
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
          snapshotTitle: `${res.policy.name} (Dry Run Preview)`,
          isLocked: false,
          totalCandidates: res.totalCandidates,
          selectedCount: res.selectedCount,
          waitlistedCount: res.waitlistedCount,
        },
        entries: res.entries,
      });
      setCurrentSnapshotId(null);
      setIsLocked(false);
      setSuccess('Calculated live preview based on verified candidates.');
    } catch (err) {
      setError(err.message || 'Dry-run calculation failed.');
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
      setError(err.message || 'Failed to generate official snapshot.');
    } finally {
      setCalculating(false);
    }
  }

  async function handleLockSnapshot() {
    if (!currentSnapshotId) return;
    if (!window.confirm('Are you sure you want to lock this merit list? Once locked, it is legally immutable and cannot be modified or overwritten.')) {
      return;
    }
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
      setError(err.message || 'Failed to lock snapshot.');
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!currentSnapshotId) return;
    window.location.href = `/api/v1/merit/snapshots/${currentSnapshotId}/export`;
  }

  async function handleDispatchWhatsAppNotifications(e) {
    e.preventDefault();
    if (!currentSnapshotId) return;
    setNotifying(true);
    setError('');
    try {
      const res = await meritApi.notifySelected(currentSnapshotId, {
        duePaymentDate: dueDateInput.trim(),
      });
      setSuccess(res.message || `Queued WhatsApp notices for ${res.notifiedCount} candidates.`);
      setShowNotifyModal(false);
      await loadSnapshotDetails(currentSnapshotId);
    } catch (err) {
      setError(err.message || 'Failed to dispatch WhatsApp notices.');
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
        setSuccess(`Successfully extracted SEET test score for ${res.data.candidateName || 'Candidate'}: ${res.data.marksObtained}/100.`);
      } else {
        setError(res.message || 'No record found on SEET portal for this CNIC.');
        setManualForm((prev) => ({
          ...prev,
          cnic: res.cnic || seetCnic.trim(),
        }));
      }
    } catch (err) {
      setError(err.message || 'Error querying SEET portal. You can scrape with simulated response or enter marks manually.');
      setManualForm((prev) => ({
        ...prev,
        cnic: seetCnic.trim(),
      }));
    } finally {
      setSeetSearching(false);
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
      setError(err.message || 'Failed to save manual test result.');
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
      setError(err.message || 'Failed to save SEET score.');
    } finally {
      setSavingSeet(false);
    }
  }

  async function handleSyncVerifiedSeet() {
    if (!window.confirm('Query seet.must.edu.pk for all verified students currently missing test scores?')) return;
    setSyncingAll(true);
    setError('');
    setSyncSummary(null);
    try {
      const res = await meritApi.syncVerifiedSeet();
      setSyncSummary(res);
      setSuccess(`SEET batch sync finished: ${res.matched} matched, ${res.unmatched} unmatched.`);
    } catch (err) {
      setError(err.message || 'Failed to batch sync SEET results.');
    } finally {
      setSyncingAll(false);
    }
  }

  // Gazette PDF Upload
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
      setSuccess(`Extracted ${res.totalExtracted} records from gazette; backfilled ${res.matchedStudents} student marksheets.`);
      setGazetteFile(null);
    } catch (err) {
      setError(err.message || 'Failed to process official gazette PDF.');
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
      setError(err.message || 'Failed to save admission policy.');
    } finally {
      setLoading(false);
    }
  }

  const weightSum =
    Number(policyForm.matricWeightage || 0) +
    Number(policyForm.fscWeightage || 0) +
    Number(policyForm.entryTestWeightage || 0);

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-emerald-600" />
            {success}
          </span>
          <button onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <SectionTabs
        label="Merit engine sections"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'calculations', label: 'Merit calculations' },
          { id: 'seet', label: 'SEET & Gazette sync' },
          { id: 'policies', label: 'Admission policies' },
          { id: 'snapshots', label: 'Snapshots history' },
        ]}
      />

      {/* Metrics Strip */}
      <MetricStrip
        label="Active merit policy"
        items={[
          {
            label: 'Matric weightage',
            value: `${activePolicy?.matricWeightage || 10}%`,
          },
          {
            label: 'FSc weightage',
            value: `${activePolicy?.fscWeightage || 40}%`,
          },
          {
            label: 'SEET test weightage',
            value: `${activePolicy?.entryTestWeightage || 50}%`,
            tone: 'blue',
          },
          {
            label: 'Seats in quota',
            value: activePolicy?.quotaDefinitions?.find((q) => q.code === 'OPEN_MERIT')?.seats || 70,
            tone: 'emerald',
          },
        ]}
      />

      {/* ==================================================================== */}
      {/* TAB 1: MERIT CALCULATIONS & RANKINGS                                 */}
      {/* ==================================================================== */}
      {activeTab === 'calculations' && (
        <div className="space-y-5">
          <WorkspacePanel
            title={meritData?.snapshot?.snapshotTitle || 'Merit Calculations'}
            description={`${meritData?.entries?.length || 0} verified applicants evaluated (${meritData?.snapshot?.selectedCount || 0} selected, ${meritData?.snapshot?.waitlistedCount || 0} waitlisted)`}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                {snapshots.length > 0 && (
                  <select
                    value={currentSnapshotId || ''}
                    onChange={(e) => {
                      if (e.target.value === 'dry_run') {
                        runDryRunCalculation();
                      } else {
                        loadSnapshotDetails(Number(e.target.value));
                      }
                    }}
                    className="h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                  >
                    <option value="dry_run">Live Preview (Dry Run)</option>
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.snapshotTitle} {s.isLocked ? '[Locked]' : '[Draft]'}
                      </option>
                    ))}
                  </select>
                )}

                <Button
                  variant="subtle"
                  onClick={runDryRunCalculation}
                  disabled={calculating}
                  title="Run live aggregate calculation"
                >
                  <IconCalculator className="size-4" />
                  <span>Preview calculation</span>
                </Button>

                <Button
                  variant="primary"
                  onClick={() => setShowGenerateModal(true)}
                  disabled={calculating}
                >
                  <IconAcademicCap className="size-4" />
                  <span>Generate official snapshot</span>
                </Button>

                {currentSnapshotId && (
                  <>
                    <Button
                      variant="subtle"
                      onClick={handleExportCsv}
                      title="Download as Excel/CSV"
                    >
                      <IconDownload className="size-4" />
                      <span>Export CSV</span>
                    </Button>

                    <Button
                      variant="subtle"
                      onClick={() => setShowNotifyModal(true)}
                      title="Send WhatsApp selection notices"
                    >
                      <IconSend className="size-4" />
                      <span>WhatsApp notices</span>
                    </Button>

                    {isSuperAdmin && !isLocked && (
                      <button
                        type="button"
                        onClick={handleLockSnapshot}
                        disabled={loading}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-700 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
                        title="Lock official merit list (Permanent & Immutable)"
                      >
                        <IconLockClosed className="size-4" />
                        <span>Lock snapshot</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          >
            {/* Lock status banner */}
            {isLocked && (
              <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50/80 px-5 py-2.5 text-xs text-amber-900">
                <IconLockClosed className="size-4 text-amber-700" />
                <span className="font-semibold">Official Snapshot Locked:</span>
                <span>This merit list has been officially approved and locked by administration. It is permanently immutable.</span>
              </div>
            )}

            {/* Table */}
            {loading || calculating ? (
              <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-sm text-slate-500">
                <span className="size-6 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
                <span>Computing weighted merit rankings…</span>
              </div>
            ) : !meritData?.entries?.length ? (
              <div className="grid min-h-48 place-content-center justify-items-center p-6 text-center">
                <IconAcademicCap className="size-10 text-slate-400 mb-2" />
                <p className="text-sm font-semibold text-slate-800">No verified candidates found</p>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Only applicants whose overall status is <strong className="font-semibold text-emerald-700">VERIFIED</strong> in Module 3 are processed by the merit engine.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs text-slate-700">
                  <thead className="border-b border-slate-200 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-center">Rank</th>
                      <th className="px-4 py-3">Applicant details</th>
                      <th className="px-3 py-3 text-center">Matric ({activePolicy?.matricWeightage || 10}%)</th>
                      <th className="px-3 py-3 text-center">FSc ({activePolicy?.fscWeightage || 40}%)</th>
                      <th className="px-3 py-3 text-center">SEET ({activePolicy?.entryTestWeightage || 50}%)</th>
                      <th className="px-4 py-3 text-center font-bold text-blue-900">Aggregate</th>
                      <th className="px-3 py-3 text-center">Quota</th>
                      <th className="px-3 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {meritData.entries.map((entry) => (
                      <tr key={entry.studentId || entry.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3 text-center font-mono font-bold text-sm">
                          {entry.meritPosition <= 3 ? (
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 font-extrabold text-xs">
                              {entry.meritPosition}
                            </span>
                          ) : (
                            `#${entry.meritPosition}`
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{entry.fullName}</div>
                          <div className="text-[11px] text-slate-500">
                            {entry.fatherName ? `S/D/O ${entry.fatherName} · ` : ''}
                            CNIC: {entry.cnic || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center font-mono">
                          {entry.matricScoreUsed} <span className="text-slate-400 text-[10px]">/{entry.matricTotalUsed}</span>
                        </td>
                        <td className="px-3 py-3 text-center font-mono">
                          {entry.fscScoreUsed} <span className="text-slate-400 text-[10px]">/{entry.fscTotalUsed}</span>
                        </td>
                        <td className="px-3 py-3 text-center font-mono font-medium text-slate-900">
                          {entry.entryTestScoreUsed} <span className="text-slate-400 text-[10px]">/{entry.entryTestTotalUsed}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm font-bold text-blue-700">
                          {entry.aggregateScore.toFixed(3)}%
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-block rounded px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            {entry.allocatedQuota || entry.quotaCategory || 'OPEN_MERIT'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <StatusBadge tone={entry.decisionStatus === 'SELECTED' ? 'success' : 'neutral'}>
                            {entry.decisionStatus}
                          </StatusBadge>
                          {entry.tieBreakLevel > 0 && (
                            <div className="text-[10px] text-amber-700 font-medium mt-0.5" title={`Tie resolved at Tier ${entry.tieBreakLevel}`}>
                              Tier {entry.tieBreakLevel} Tie-break
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </WorkspacePanel>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: SEET RESULT LOOKUP & GAZETTE PDF SYNC                         */}
      {/* ==================================================================== */}
      {activeTab === 'seet' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Card 1: Official SEET Portal Scraper & Manual Entry */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            {/* Mode Switcher */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setSeetMode('lookup')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${seetMode === 'lookup' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Portal Live Lookup
                </button>
                <button
                  type="button"
                  onClick={() => setSeetMode('manual')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${seetMode === 'manual' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Manual Score Entry
                </button>
              </div>
              <span className="text-[11px] font-medium text-slate-400">
                {seetMode === 'lookup' ? 'seet.must.edu.pk' : 'Offline / Paper slip'}
              </span>
            </div>

            {/* Sub-view 1: Live Portal Scraper */}
            {seetMode === 'lookup' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    SEET Portal Live Lookup
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Direct lookup by student CNIC from official test results portal: <code className="text-blue-700 font-mono">seet.must.edu.pk/seet_result.php</code>
                  </p>
                </div>

                <form onSubmit={handleSeetLookup} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={seetCnic}
                      onChange={(e) => setSeetCnic(e.target.value)}
                      placeholder="Enter 13-digit CNIC (e.g. 82101-1234567-1)"
                      className="flex-1 px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={seetSearching || !seetCnic.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <IconSearch className="size-4" />
                      <span>{seetSearching ? 'Searching…' : 'Search SEET'}</span>
                    </button>
                  </div>

                  {/* Real-time CNIC digit counter validation */}
                  {seetCnic.trim() && (
                    <div className="flex items-center justify-between text-[11px]">
                      {seetCnic.replace(/\D/g, '').length === 13 ? (
                        <span className="font-semibold text-emerald-600">✓ 13 digits (valid Pakistani CNIC format)</span>
                      ) : seetCnic.replace(/\D/g, '').length > 13 ? (
                        <span className="font-semibold text-rose-600">
                          ⚠ {seetCnic.replace(/\D/g, '').length} / 13 digits ({seetCnic.replace(/\D/g, '').length - 13} extra digit)
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
                        Enter manually instead →
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
                        <span>Open Manual Entry Form →</span>
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
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveSeet}
                      disabled={savingSeet}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      <IconCheck className="size-4" />
                      <span>{savingSeet ? 'Saving & Backfilling…' : 'Save & Link to Student Record'}</span>
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
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Entry Test Roll Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-1042"
                      value={manualForm.rollNo}
                      onChange={(e) => setManualForm({ ...manualForm, rollNo: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Candidate Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Muhammad Ali"
                      value={manualForm.candidateName}
                      onChange={(e) => setManualForm({ ...manualForm, candidateName: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-600 focus:outline-none"
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
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
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
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
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
                    <span>{savingManual ? 'Saving score…' : 'Save & Link to Candidate Record'}</span>
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

            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900">Batch Sync for Verified Students</div>
                  <div className="text-[11px] text-slate-500">Auto-queries SEET portal for all verified candidates lacking test marks.</div>
                </div>
                <Button
                  variant="subtle"
                  onClick={handleSyncVerifiedSeet}
                  disabled={syncingAll}
                >
                  <IconRefresh className="size-3.5" />
                  <span>{syncingAll ? 'Syncing…' : 'Sync verified'}</span>
                </Button>
              </div>

              {syncSummary && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div>Candidates scanned: <strong>{syncSummary.totalCandidates}</strong></div>
                  <div>Matched & saved: <strong className="text-emerald-700">{syncSummary.matched}</strong></div>
                  <div>Not found: <strong className="text-amber-700">{syncSummary.unmatched}</strong></div>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Official Gazette PDF Upload */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                Official Board / SEET Gazette Upload
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Upload official board or entry test PDF gazette. The streaming engine extracts results without memory overhead and auto-links them to candidates.
              </p>
            </div>

            <form onSubmit={handleGazetteUpload} className="space-y-4">
              <input
                type="file"
                accept=".pdf"
                required
                onChange={(e) => setGazetteFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
              />

              <button
                type="submit"
                disabled={uploadingGazette || !gazetteFile}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer"
              >
                <IconUploadCloud className="size-4" />
                <span>{uploadingGazette ? 'Processing gazette…' : 'Process Gazette PDF'}</span>
              </button>
            </form>

            {gazetteResult && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs space-y-1.5">
                <div className="font-bold text-emerald-900">Gazette Processing Complete</div>
                <div>Extracted results: <strong className="font-mono">{gazetteResult.totalExtracted}</strong></div>
                <div>Matched admissions candidates: <strong className="font-mono text-emerald-700">{gazetteResult.matchedStudents}</strong></div>
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
          <WorkspacePanel
            title={activePolicy?.name || 'Active Admission Policy'}
            description="Configurable weighting coefficients and quota distributions."
            actions={(
              <Button
                variant={editingPolicy ? 'subtle' : 'primary'}
                onClick={() => setEditingPolicy((p) => !p)}
              >
                {editingPolicy ? 'Cancel' : 'Edit policy weights'}
              </Button>
            )}
          >
            {editingPolicy ? (
              <form onSubmit={handleSavePolicy} className="p-6 space-y-4 max-w-xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Policy Title</label>
                  <input
                    type="text"
                    required
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
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
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
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
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
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
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className={`text-xs font-semibold ${Math.abs(weightSum - 100) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                  Sum of weights: {weightSum}% {Math.abs(weightSum - 100) < 0.01 ? '(Valid)' : '(Must equal 100%)'}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading || Math.abs(weightSum - 100) > 0.01}
                    className="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer"
                  >
                    Save policy
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Matriculation</div>
                    <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{activePolicy?.matricWeightage}%</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Academic background foundation</div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
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
                      <div key={q.code} className="p-3.5 rounded-lg border border-slate-200 bg-white">
                        <div className="text-xs font-semibold text-slate-800">{q.title}</div>
                        <div className="text-lg font-bold font-mono text-slate-900 mt-1">{q.seats} seats</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </WorkspacePanel>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: SNAPSHOTS AUDIT HISTORY                                       */}
      {/* ==================================================================== */}
      {activeTab === 'snapshots' && (
        <WorkspacePanel
          title="Merit Snapshots History"
          description="Permanent legal audit log of all official merit lists."
        >
          {!snapshots.length ? (
            <div className="grid min-h-40 place-content-center text-xs text-slate-500">
              No official snapshots generated yet. Generate your first snapshot from the Calculations tab.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="border-b border-slate-200 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-5 py-3">Snapshot Title</th>
                    <th className="px-4 py-3">Iteration</th>
                    <th className="px-4 py-3 text-center">Candidates</th>
                    <th className="px-4 py-3 text-center">Selected</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshots.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-3.5 font-semibold text-slate-900">
                        {s.snapshotTitle}
                        <div className="text-[11px] font-normal text-slate-500">Created by {s.creatorName || 'System'}</div>
                      </td>
                      <td className="px-4 py-3.5 font-mono">List #{s.iterationNumber}</td>
                      <td className="px-4 py-3.5 text-center font-mono">{s.totalCandidates}</td>
                      <td className="px-4 py-3.5 text-center font-mono font-semibold text-emerald-700">{s.selectedCount}</td>
                      <td className="px-4 py-3.5 text-center">
                        <StatusBadge tone={s.isLocked ? 'neutral' : 'warning'}>
                          {s.isLocked ? 'Locked (Immutable)' : 'Draft (Unlocked)'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('calculations');
                            loadSnapshotDetails(s.id);
                          }}
                          className="font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
                        >
                          View list
                        </button>
                        <a
                          href={`/api/v1/merit/snapshots/${s.id}/export`}
                          className="font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          Export CSV
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WorkspacePanel>
      )}

      {/* Modal: Generate Official Snapshot */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">Generate Official Merit Snapshot</h3>
              <button onClick={() => setShowGenerateModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <IconClose className="size-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateOfficialSnapshot} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Snapshot Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1st Official Merit List - Fall 2026"
                  value={snapshotTitleInput}
                  onChange={(e) => setSnapshotTitleInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Iteration Number</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  required
                  value={iterationInput}
                  onChange={(e) => setIterationInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-600 focus:outline-none"
                />
                <span className="text-[11px] text-slate-500 mt-0.5 block">1 = 1st Merit List, 2 = 2nd Merit List (after dropouts), etc.</span>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button variant="subtle" type="button" onClick={() => setShowGenerateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={calculating}>
                  {calculating ? 'Generating…' : 'Generate & Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: WhatsApp Selection Notices */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">WhatsApp Selection Notices</h3>
              <button onClick={() => setShowNotifyModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <IconClose className="size-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              This will enqueue personalized WhatsApp messages to all <strong className="text-emerald-700 font-semibold">SELECTED</strong> candidates with their rank, aggregate score, and fee submission instructions.
            </p>

            <form onSubmit={handleDispatchWhatsAppNotifications} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fee Submission Deadline</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Friday, 4:00 PM"
                  value={dueDateInput}
                  onChange={(e) => setDueDateInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button variant="subtle" type="button" onClick={() => setShowNotifyModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={notifying}>
                  <IconSend className="size-3.5" />
                  <span>{notifying ? 'Queueing messages…' : 'Dispatch WhatsApp Notices'}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
