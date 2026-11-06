import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { StudentDossierModal } from './StudentDossierModal.jsx';
import { Button, StatusBadge } from '../../core/ui/primitives.jsx';
import { IconDocumentCheck } from '../../core/icons/Icons.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { BoardSourcesPanel } from './BoardSourcesPanel.jsx';

export function VerificationModuleView() {
  const { user } = useAuth();
  const canManageSources = user?.permissions?.includes('verification.sources.manage');
  const [activeTab, setActiveTab] = useState('queue'); // 'queue', 'import', 'reissue'
  const [queue, setQueue] = useState([]);
  const [queueSummary, setQueueSummary] = useState({ NEEDS_MANUAL_REVIEW: 0, UNDER_REVIEW: 0, DOCS_REQUESTED: 0, VERIFIED: 0 });
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState(null);

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

  useEffect(() => {
    if (activeTab === 'queue') {
      loadQueue();
    }
  }, [activeTab, filterStatus, queuePage]);

  async function loadQueue() {
    try {
      setLoading(true);
      const data = await verificationApi.fetchReviewQueue({ status: filterStatus || undefined, limit: pageSize, offset: queuePage * pageSize });
      const lastPage = Math.max(0, Math.ceil((data.total || 0) / pageSize) - 1);
      if (queuePage > lastPage) {
        setQueuePage(lastPage);
        return;
      }
      setQueue(data.items || []);
      setQueueSummary(data.summary || { NEEDS_MANUAL_REVIEW: 0, UNDER_REVIEW: 0, DOCS_REQUESTED: 0, VERIFIED: 0 });
      setQueueTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load verification queue:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEditPhone(studentId, currentPhone) {
    const newPhone = prompt('Enter candidate mobile phone number (e.g. 923001234567 or 03001234567):', currentPhone);
    if (!newPhone || newPhone.trim() === currentPhone) return;
    try {
      await verificationApi.updatePhone(studentId, newPhone.trim());
      alert('Phone number updated successfully.');
      loadQueue();
    } catch (err) {
      alert(err.message || 'Failed to update phone number.');
    }
  }

  async function handleQuickGenerateToken(studentId) {
    try {
      const res = await verificationApi.reissueToken({
        studentId,
        allowedDocTypes: ['FSC_MARKSHEET'],
        expiresInHours: 48,
      });
      navigator.clipboard.writeText(res.uploadUrl);
      alert(`Token generated! Upload link copied to clipboard:\n${res.uploadUrl}`);
      loadQueue();
    } catch (err) {
      alert(err.message || 'Failed to generate token.');
    }
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
    } catch (err) {
      alert(err.message || 'Discrepancy import failed.');
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
    } catch (err) {
      alert(err.message || 'Token reissue failed.');
    } finally {
      setReissuing(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(queueTotal / pageSize));

  return (
    <div className="space-y-5">
      {/* Compact queue summary */}
      <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-3" aria-label="Verification summary">
        {[
          { label: 'Needs review', value: queueSummary.NEEDS_MANUAL_REVIEW, tone: 'text-amber-700' },
          { label: 'Under review', value: queueSummary.UNDER_REVIEW + queueSummary.DOCS_REQUESTED, tone: 'text-blue-700' },
          { label: 'Verified', value: queueSummary.VERIFIED, tone: 'text-slate-900' },
        ].map((metric, index) => (
          <div key={metric.label} className={`flex items-center justify-between gap-4 px-5 py-3.5 ${index > 0 ? 'border-t border-slate-100 sm:border-l sm:border-t-0' : ''}`}>
            <span className="text-xs font-medium text-slate-600">{metric.label}</span>
            <strong className={`text-xl font-semibold tabular-nums ${metric.tone}`}>{metric.value}</strong>
          </div>
        ))}
      </section>

      {/* Navigation Tabs */}
      <div className="flex gap-5 overflow-x-auto border-b border-slate-200 sm:gap-7" role="tablist" aria-label="Document verification">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'queue'}
          onClick={() => setActiveTab('queue')}
          className={`min-h-11 shrink-0 border-b-2 px-1 text-xs font-semibold transition-colors ${activeTab === 'queue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Verification Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'import'}
          onClick={() => setActiveTab('import')}
          className={`min-h-11 shrink-0 border-b-2 px-1 text-xs font-semibold transition-colors ${activeTab === 'import' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Import discrepancies
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'reissue'}
          onClick={() => setActiveTab('reissue')}
          className={`min-h-11 shrink-0 border-b-2 px-1 text-xs font-semibold transition-colors ${activeTab === 'reissue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Reissue upload link
        </button>
        {canManageSources && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sources'}
            onClick={() => setActiveTab('sources')}
            className={`min-h-11 shrink-0 border-b-2 px-1 text-xs font-semibold transition-colors ${activeTab === 'sources' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            Board sources
          </button>
        )}
      </div>

      {/* Tab 1: Review Queue */}
      {activeTab === 'queue' && (
        <section role="tabpanel" aria-label="Verification queue" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_2px_8px_rgba(20,30,50,0.035)]">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => { setFilterStatus(''); setQueuePage(0); }}
                className={`rounded-md px-3 py-2 font-medium transition ${!filterStatus ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                All Active ({queueTotal})
              </button>
              <button
                type="button"
                onClick={() => { setFilterStatus('NEEDS_MANUAL_REVIEW'); setQueuePage(0); }}
                className={`rounded-md px-3 py-2 font-medium transition ${filterStatus === 'NEEDS_MANUAL_REVIEW' ? 'bg-amber-50 text-amber-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Needs Review
              </button>
              <button
                type="button"
                onClick={() => { setFilterStatus('UNDER_REVIEW'); setQueuePage(0); }}
                className={`rounded-md px-3 py-2 font-medium transition ${filterStatus === 'UNDER_REVIEW' ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Under Review
              </button>
              <button
                type="button"
                onClick={() => { setFilterStatus('VERIFIED'); setQueuePage(0); }}
                className={`rounded-md px-3 py-2 font-medium transition ${filterStatus === 'VERIFIED' ? 'bg-emerald-50 text-emerald-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Verified
              </button>
            </div>
            <Button size="sm" variant="subtle" onClick={loadQueue} disabled={loading} className="border border-slate-200 bg-white">
              Refresh
            </Button>
          </div>

          {/* Queue Table */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading candidates…</div>
          ) : queue.length === 0 ? (
            <div className="grid min-h-44 place-content-center justify-items-center px-5 py-8 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-blue-50 text-blue-700"><IconDocumentCheck className="size-5" /></span>
              <p className="mb-0 mt-3 text-sm font-semibold text-slate-800">Queue is clear</p>
              <p className="mb-0 mt-1 text-xs text-slate-500">No candidates match this view.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 px-4 sm:px-5">
              {queue.map((item) => (
                <div key={item.studentId} className="flex flex-wrap items-center justify-between gap-4 py-3.5 hover:bg-slate-50/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-slate-900">{item.fullName}</strong>
                      {item.applicationNo && (
                        <span className="font-mono text-[10px] text-slate-400">({item.applicationNo})</span>
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
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[11px] text-slate-500">
                      <span>
                        Phone: <strong>{item.phoneNormalized}</strong>
                        <button
                          type="button"
                          onClick={() => handleEditPhone(item.studentId, item.phoneNormalized)}
                          className="ml-1.5 text-blue-600 hover:underline text-[10px] cursor-pointer"
                        >
                          [Edit]
                        </button>
                      </span>
                      <span>FSc Marks: <strong>{item.fscObtainedMarks || '—'} / 1100</strong></span>
                      <span>Documents: <strong>{item.documentCount}</strong></span>
                    </div>
                    {item.discrepancyNotes && (
                      <p className="mt-1 max-w-xl truncate text-[10px] text-amber-700">
                        {item.discrepancyNotes.split('\n').filter(Boolean).pop()}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickGenerateToken(item.studentId)}
                      className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 transition hover:bg-blue-100 cursor-pointer"
                    >
                      Generate link
                    </button>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => setSelectedStudentId(item.studentId)}
                    >
                      Review Dossier
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {queueTotal > pageSize && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 sm:px-5">
              <p className="m-0 text-xs text-slate-500">Showing {queuePage * pageSize + 1}–{Math.min((queuePage + 1) * pageSize, queueTotal)} of {queueTotal}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="subtle" disabled={queuePage === 0 || loading} onClick={() => setQueuePage((current) => Math.max(0, current - 1))}>Previous</Button>
                <span className="text-xs tabular-nums text-slate-600">Page {queuePage + 1} of {totalPages}</span>
                <Button size="sm" variant="subtle" disabled={queuePage + 1 >= totalPages || loading} onClick={() => setQueuePage((current) => Math.min(totalPages - 1, current + 1))}>Next</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tab 2: Discrepancy Ingest */}
      {activeTab === 'import' && (
        <section role="tabpanel" aria-label="Import discrepancies" className="max-w-3xl rounded-lg border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(20,30,50,0.035)] sm:p-6">
          <h2 className="m-0 text-base font-semibold text-slate-900">Import discrepancies</h2>
          <p className="mb-0 mt-1 text-xs text-slate-500">Upload a CSV of applicants with missing or mismatched documents.</p>

          <form onSubmit={handleImportSubmit} className="mt-5 space-y-4">
            <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
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
                  Include application number, name, phone, and document issues.
                </p>
              </label>
            </div>

            <Button type="submit" disabled={!importFile || importing} className="min-h-10 w-full text-xs sm:w-auto sm:px-5">
              {importing ? 'Importing…' : 'Import and send links'}
            </Button>
          </form>

          {importResult && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-xs">
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
        <section role="tabpanel" aria-label="Reissue upload link" className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(20,30,50,0.035)] sm:p-6">
          <h2 className="m-0 text-base font-semibold text-slate-900">Reissue upload link</h2>
          <p className="mb-0 mt-1 text-xs text-slate-500">Create a fresh upload link and send it to an applicant.</p>

          <form onSubmit={handleReissueSubmit} className="mt-5 space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700">Candidate ID or Lead ID</label>
              <input
                type="number"
                required
                value={reissueForm.studentId}
                onChange={(e) => setReissueForm((prev) => ({ ...prev, studentId: e.target.value }))}
                placeholder="e.g. 14"
                className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
              />
              <p className="mb-0 mt-1 text-[11px] text-slate-500">
                Enter a candidate ID or a marketing lead ID.
              </p>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1.5">Required Document Types</label>
              <div className="space-y-1.5">
                {[
                  { id: 'FSC_MARKSHEET', label: 'FSc / HSSC Marksheet' },
                  { id: 'MATRIC_MARKSHEET', label: 'Matric / SSC Marksheet' },
                  { id: 'CNIC_FRONT', label: 'CNIC Front' },
                  { id: 'CNIC_BACK', label: 'CNIC Back' },
                  { id: 'DOMICILE', label: 'Domicile Certificate' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer">
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
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700">Expiration Window (Hours)</label>
              <input
                type="number"
                min="1"
                max="168"
                value={reissueForm.expiresInHours}
                onChange={(e) => setReissueForm((prev) => ({ ...prev, expiresInHours: e.target.value }))}
                className="mt-1 w-32 rounded border border-slate-300 p-2 text-xs"
              />
            </div>

            <Button type="submit" disabled={reissuing || !reissueForm.studentId} className="min-h-10 w-full text-xs sm:w-auto sm:px-5">
              {reissuing ? 'Creating link…' : 'Create link and send'}
            </Button>
          </form>

          {reissueResult && (
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-900">
              <p className="mb-0 font-semibold">
                Upload link created for {reissueResult.studentName || 'Candidate'} (ID: #{reissueResult.studentId}).
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded bg-white p-2 border border-blue-100">
                <span className="font-mono text-[11px] truncate">{reissueResult.uploadUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(reissueResult.uploadUrl);
                    alert('Copied link to clipboard!');
                  }}
                  className="shrink-0 text-blue-700 font-bold hover:underline"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'sources' && canManageSources && <BoardSourcesPanel />}

      {/* Candidate Verification Dossier Modal */}
      {selectedStudentId && (
        <StudentDossierModal
          studentId={selectedStudentId}
          isOpen={Boolean(selectedStudentId)}
          onClose={() => setSelectedStudentId(null)}
          onActionComplete={loadQueue}
        />
      )}
    </div>
  );
}
