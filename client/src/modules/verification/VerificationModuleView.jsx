import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { StudentDossierModal } from './StudentDossierModal.jsx';
import { Button, StatusBadge, StatCard } from '../../core/ui/primitives.jsx';
import { IconDocumentCheck, IconShield, IconUsers } from '../../core/icons/Icons.jsx';

export function VerificationModuleView() {
  const [activeTab, setActiveTab] = useState('queue'); // 'queue', 'import', 'reissue'
  const [queue, setQueue] = useState([]);
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
  }, [activeTab, filterStatus]);

  async function loadQueue() {
    try {
      setLoading(true);
      const data = await verificationApi.fetchReviewQueue({ status: filterStatus || undefined });
      setQueue(data);
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

  const needsReviewCount = queue.filter((q) => q.overallStatus === 'NEEDS_MANUAL_REVIEW').length;
  const underReviewCount = queue.filter((q) => q.overallStatus === 'UNDER_REVIEW').length;
  const verifiedCount = queue.filter((q) => q.overallStatus === 'VERIFIED').length;

  return (
    <div className="space-y-6">
      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Needs Manual Review"
          value={needsReviewCount}
          detail="Discrepancies or board mismatches"
          icon={IconDocumentCheck}
          tone="teal"
        />
        <StatCard
          label="Under Review"
          value={underReviewCount}
          detail="Documents currently in OCR queue"
          icon={IconDocumentCheck}
          tone="blue"
        />
        <StatCard
          label="Recently Verified"
          value={verifiedCount}
          detail="Ready for merit aggregate calculation"
          icon={IconShield}
          tone="neutral"
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'queue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Verification Queue
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'import' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Bulk Discrepancy Ingest
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reissue')}
          className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'reissue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Manual Token Reissue
        </button>
      </div>

      {/* Tab 1: Review Queue */}
      {activeTab === 'queue' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setFilterStatus('')}
                className={`rounded-md px-3 py-1.5 font-medium transition ${!filterStatus ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                All Active ({queue.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('NEEDS_MANUAL_REVIEW')}
                className={`rounded-md px-3 py-1.5 font-medium transition ${filterStatus === 'NEEDS_MANUAL_REVIEW' ? 'bg-amber-50 text-amber-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Needs Review
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('UNDER_REVIEW')}
                className={`rounded-md px-3 py-1.5 font-medium transition ${filterStatus === 'UNDER_REVIEW' ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Under Review
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('VERIFIED')}
                className={`rounded-md px-3 py-1.5 font-medium transition ${filterStatus === 'VERIFIED' ? 'bg-emerald-50 text-emerald-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                Verified
              </button>
            </div>
            <Button size="sm" variant="subtle" onClick={loadQueue} disabled={loading}>
              Refresh
            </Button>
          </div>

          {/* Queue Table */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading verification queue…</div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No candidates in this queue.</div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
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
                    {item.activeToken && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>Portal URL:</span>
                        <a
                          href={`/upload/${item.activeToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-blue-600 hover:underline max-w-xs md:max-w-md truncate"
                          title="Click to open applicant upload form"
                        >
                          {`${window.location.origin}/upload/${item.activeToken}`}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {item.activeToken ? (
                      <>
                        <a
                          href={`https://wa.me/${item.phoneNormalized}?text=${encodeURIComponent(
                            `Admissions update for ${item.fullName}: Please upload your required documents to complete your verification here: ${window.location.origin}/upload/${item.activeToken}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition inline-flex items-center gap-1"
                          title="Open WhatsApp Web chat with student"
                        >
                          💬 WhatsApp
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/upload/${item.activeToken}`;
                            navigator.clipboard.writeText(url);
                            alert(`Copied link to clipboard:\n${url}`);
                          }}
                          className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                        >
                          Copy Link
                        </button>
                        <a
                          href={`/upload/${item.activeToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                        >
                          Open Portal ↗
                        </a>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleQuickGenerateToken(item.studentId)}
                        className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                      >
                        + Generate Link
                      </button>
                    )}
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
        </section>
      )}

      {/* Tab 2: Discrepancy Ingest */}
      {activeTab === 'import' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs max-w-2xl">
          <h2 className="text-sm font-bold text-slate-900">Bulk Document Discrepancy Ingestion</h2>
          <p className="mt-1 text-xs text-slate-500">
            Upload an Excel or CSV export of students with missing or discrepant documents. The system will auto-mint 48-hour capability tokens and enqueue customized WhatsApp intake messages.
          </p>

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
                <p className="mt-1 text-[10px] text-slate-400">
                  Columns: Application No, CNIC, Full Name, Phone, FSc Marks, Issues (e.g. "MATRIC_MARKSHEET; FSC_MARKSHEET")
                </p>
              </label>
            </div>

            <Button type="submit" disabled={!importFile || importing} className="w-full text-xs">
              {importing ? 'Processing & Dispatching Tokens…' : 'Process Discrepancies & Send WhatsApp Links'}
            </Button>
          </form>

          {importResult && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-xs">
              <strong className="text-emerald-900">Ingest Summary:</strong>
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
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs max-w-xl">
          <h2 className="text-sm font-bold text-slate-900">Manual Capability Token Reissue</h2>
          <p className="mt-1 text-xs text-slate-500">
            Generate a fresh 48-hour upload link for any student and immediately dispatch the link via WhatsApp.
          </p>

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
              <p className="mt-1 text-[11px] text-slate-400">
                Enter an Admissions candidate ID or a Lead ID from Marketing.
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

            <Button type="submit" disabled={reissuing || !reissueForm.studentId} className="w-full text-xs">
              {reissuing ? 'Minting & Dispatching…' : 'Mint Token & Dispatch Alert'}
            </Button>
          </form>

          {reissueResult && (
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-900">
              <p className="font-bold">
                Token Successfully Reissued for {reissueResult.studentName || 'Candidate'} (ID: #{reissueResult.studentId})!
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
