import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button, StatusBadge, ToastBanner, ConfirmDialog, PromptDialog } from '../../core/ui/primitives.jsx';
import { IconDocumentCheck, IconShield, IconAlertTriangle, IconRefresh, IconCheck, IconClose } from '../../core/icons/Icons.jsx';

export function StudentDossierModal({ studentId, isOpen, onClose, onActionComplete }) {
  const [loading, setLoading] = useState(true);
  const [dossier, setDossier] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showOverrideInputs, setShowOverrideInputs] = useState(false);
  const [overrideMarks, setOverrideMarks] = useState({ fsc: '', matric: '' });
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [reviewMethod, setReviewMethod] = useState('STAFF_DOCUMENT');
  const [reviewNotes, setReviewNotes] = useState('');
  const [searchingGazetteDocId, setSearchingGazetteDocId] = useState(null);
  const [reprocessingDocId, setReprocessingDocId] = useState(null);
  const [timelineExpanded, setTimelineExpanded] = useState(true);

  // Production-grade inline feedback & modal states
  const [notice, setNotice] = useState(null); // { type: 'error' | 'success' | 'warning' | 'info', message: string, detail?: string }
  const [confirmModal, setConfirmModal] = useState(null); // { isOpen, title, message, confirmLabel, tone, onConfirm }
  const [promptModal, setPromptModal] = useState(null); // { isOpen, title, message, placeholder, initialValue, presets, confirmLabel, onConfirm }

  async function loadDossier(silent = false) {
    if (!studentId || !isOpen) return;
    try {
      if (!silent) setLoading(true);
      const data = await verificationApi.fetchStudentDossier(studentId);
      setDossier(data);
      setOverrideMarks({
        fsc: data.student.fsc_obtained_marks || '',
        matric: data.student.matric_obtained_marks || '',
      });
      if (!selectedDocumentId) {
        const target = data.documents.find((document) => document.verification_status !== 'MATCHED') || data.documents[0];
        setSelectedDocumentId(target ? String(target.document_id) : '');
      }
    } catch (err) {
      if (!silent) {
        setNotice({ type: 'error', message: 'Could not load student verification dossier.', detail: err.message });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function handleSearchGazette(documentId) {
    setSearchingGazetteDocId(documentId);
    setNotice(null);
    try {
      const result = await verificationApi.searchGazette(documentId);
      if (result.portalVerification?.isVerified) {
        setNotice({
          type: 'success',
          message: 'Official result match found.',
          detail: `${result.portalVerification.boardMarks} marks confirmed from ${result.portalVerification.sourceType === 'GAZETTE' ? result.portalVerification.gazetteFilename || 'a matching gazette' : 'the board portal'}.`,
        });
      } else {
        setNotice({
          type: 'warning',
          message: 'Official result needs review.',
          detail: result.portalVerification?.reason || result.portalVerification?.status?.replace(/_/g, ' ').toLowerCase() || 'No matching result was confirmed from the configured sources.',
        });
      }
      await loadDossier(true);
    } catch (err) {
      setNotice({ type: 'error', message: 'Gazette search failed.', detail: err.message });
    } finally {
      setSearchingGazetteDocId(null);
    }
  }

  async function handleReprocessOcr(documentId) {
    setReprocessingDocId(documentId);
    setNotice(null);
    try {
      const result = await verificationApi.reprocessOcr(documentId);
      setNotice({
        type: 'success',
        message: 'Live AI OCR Extraction Complete',
        detail: `Successfully parsed document using Gemini AI (${result.model || 'Gemini Flash'}).`,
      });
      await loadDossier(true);
    } catch (err) {
      setNotice({ type: 'error', message: 'Live OCR extraction failed.', detail: err.message });
    } finally {
      setReprocessingDocId(null);
    }
  }

  useEffect(() => {
    loadDossier();
  }, [studentId, isOpen]);

  // Auto-poll if any document is still in PENDING or OCR_PROCESSING state
  useEffect(() => {
    if (!dossier?.documents) return;
    const hasPending = dossier.documents.some((d) => d.verification_status === 'PENDING' || d.verification_status === 'OCR_PROCESSING');
    if (!hasPending) return;

    const interval = setInterval(() => {
      loadDossier(true);
    }, 2500);

    return () => clearInterval(interval);
  }, [dossier?.documents, studentId, isOpen]);

  if (!isOpen) return null;

  async function handleApprove() {
    if (!selectedDocumentId) {
      setNotice({ type: 'warning', message: 'Select Document', detail: 'Select a document to review before approving.' });
      return;
    }
    if (!reviewNotes.trim()) {
      setNotice({ type: 'warning', message: 'Add Review Note', detail: 'Add a short note describing the evidence you checked.' });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Approve Document Verification',
      message: 'Record this document as officially verified? The candidate status updates to VERIFIED once all required documents are complete.',
      confirmLabel: 'Approve Document',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setActionLoading(true);
          const result = await verificationApi.executeReviewAction(studentId, {
            action: 'APPROVE',
            studentId,
            documentId: Number(selectedDocumentId),
            reviewMethod,
            notes: reviewNotes.trim(),
          });
          onActionComplete?.();
          onClose();
        } catch (err) {
          setNotice({ type: 'error', message: 'Failed to approve candidate.', detail: err.message });
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  async function handleOverride() {
    if (!selectedDocumentId || !reviewNotes.trim()) {
      setNotice({ type: 'warning', message: 'Missing Information', detail: 'Select a document and add a verification note.' });
      return;
    }
    try {
      setActionLoading(true);
      const result = await verificationApi.executeReviewAction(studentId, {
        action: 'OVERRIDE_MARKS',
        studentId,
        documentId: Number(selectedDocumentId),
        reviewMethod,
        fscObtainedMarks: overrideMarks.fsc ? Number(overrideMarks.fsc) : undefined,
        matricObtainedMarks: overrideMarks.matric ? Number(overrideMarks.matric) : undefined,
        notes: reviewNotes.trim(),
      });
      onActionComplete?.();
      onClose();
    } catch (err) {
      setNotice({ type: 'error', message: 'Failed to override marks.', detail: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDirectMarksOverride({ documentId, docType, marks, sourceLabel = 'transcript' }) {
    if (!marks) return;
    const isFsc = docType === 'FSC_MARKSHEET';
    const label = isFsc ? 'FSc' : 'Matric';
    const currentDeclared = isFsc ? student?.fsc_obtained_marks : student?.matric_obtained_marks;

    setConfirmModal({
      isOpen: true,
      title: `Apply ${label} Marks Override`,
      message: `Override candidate declared ${label} marks from ${currentDeclared || 'unspecified'} to ${marks} as verified from ${sourceLabel}?`,
      confirmLabel: 'Apply Score Override',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setActionLoading(true);
          const notes = `Adjusted ${label} marks to ${marks} as confirmed by official ${sourceLabel}`;
          const result = await verificationApi.executeReviewAction(studentId, {
            action: 'OVERRIDE_MARKS',
            studentId,
            documentId: Number(documentId),
            reviewMethod: sourceLabel.toLowerCase().includes('gazette') ? 'STAFF_GAZETTE' : 'STAFF_DOCUMENT',
            fscObtainedMarks: isFsc ? Number(marks) : (student?.fsc_obtained_marks ? Number(student.fsc_obtained_marks) : undefined),
            matricObtainedMarks: !isFsc ? Number(marks) : (student?.matric_obtained_marks ? Number(student.matric_obtained_marks) : undefined),
            notes,
          });

          setNotice({
            type: 'success',
            message: `${label} Marks Updated to ${marks} / 1100`,
            detail: result.overall_status === 'VERIFIED' ? 'Candidate is now officially VERIFIED.' : 'Updated in student dossier.',
          });
          await loadDossier(true);
          onActionComplete?.();
        } catch (err) {
          setNotice({ type: 'error', message: 'Failed to override marks.', detail: err.message });
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  async function handleRejectReissue() {
    if (!selectedDocumentId) {
      setNotice({ type: 'warning', message: 'Select Document', detail: 'Select the document that needs a replacement upload.' });
      return;
    }

    setPromptModal({
      isOpen: true,
      title: 'Reject Document & Reissue Upload Link',
      message: 'Enter the exact reason to be sent to the applicant via automated WhatsApp/SMS notification:',
      placeholder: 'e.g. Uploaded document scan is blurry or unreadable. Please upload a clear photo or PDF scan.',
      initialValue: 'The uploaded document could not be verified. Please upload a clearer copy.',
      confirmLabel: 'Send Rejection & Reissue Link',
      presets: [
        'Blurry or unreadable photo/scan',
        'Wrong document type uploaded',
        'Missing board seal or controller signature',
        'FSc Part-I result card instead of Complete Certificate',
      ],
      onConfirm: async (reason) => {
        setPromptModal(null);
        try {
          setActionLoading(true);
          await verificationApi.executeReviewAction(studentId, {
            action: 'REJECT_AND_REISSUE',
            studentId,
            documentId: Number(selectedDocumentId),
            reviewMethod,
            notes: reason,
          });
          onActionComplete?.();
          onClose();
        } catch (err) {
          setNotice({ type: 'error', message: 'Failed to reissue token.', detail: err.message });
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  async function handleMarkDiscrepancy() {
    if (!selectedDocumentId) {
      setNotice({ type: 'warning', message: 'Select Document', detail: 'Select a document to review.' });
      return;
    }

    setPromptModal({
      isOpen: true,
      title: 'Record Audit Discrepancy',
      message: 'Describe the discrepancy for the staff review record:',
      placeholder: 'e.g. Declared FSc marks do not match marksheet score.',
      initialValue: '',
      confirmLabel: 'Record Discrepancy',
      presets: [
        'Candidate declared score does not match uploaded transcript',
        'Name spelling mismatch between CNIC and Board Marksheet',
        'Roll number could not be found in board records',
      ],
      onConfirm: async (discrepancyReason) => {
        setPromptModal(null);
        try {
          setActionLoading(true);
          await verificationApi.executeReviewAction(studentId, {
            action: 'MARK_DISCREPANCY',
            studentId,
            documentId: Number(selectedDocumentId),
            reviewMethod,
            discrepancyReason: discrepancyReason.trim(),
          });
          onActionComplete?.();
          onClose();
        } catch (err) {
          setNotice({ type: 'error', message: 'Failed to record discrepancy.', detail: err.message });
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  const student = dossier?.student;
  const documents = dossier?.documents || [];
  const selectedDocument = documents.find((document) => String(document.document_id) === selectedDocumentId);

  async function openGazette(sourceId) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const file = await verificationApi.downloadBoardGazette(sourceId);
      const url = URL.createObjectURL(file);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      setNotice({ type: 'error', message: 'Could not open board gazette.', detail: error.message });
    }
  }

  async function openStudentDocument(documentId) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const file = await verificationApi.downloadStudentDocument(studentId, documentId);
      const url = URL.createObjectURL(file);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (error) {
      tab?.close();
      setNotice({ type: 'error', message: 'Could not open candidate document.', detail: error.message });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-blue-100 text-blue-700">
              <IconDocumentCheck className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {student ? `${student.full_name} — Verification Dossier` : loading ? 'Loading Dossier...' : 'Verification Dossier'}
              </h2>
              {student ? (
                <p className="text-[11px] text-slate-500">
                  {student.application_no ? `App #${student.application_no}` : ''} | CNIC: {student.cnic || 'N/A'} | Phone: {student.phone_normalized || 'N/A'}
                  {student.email ? ` | Email: ${student.email}` : ''}
                  {student.city ? ` | City: ${student.city}` : ''}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  {loading ? 'Retrieving candidate records...' : 'Candidate dossier unavailable'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadDossier(false)}
              disabled={loading}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              aria-label="Close dossier"
            >
              <IconClose className="size-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {notice && (
            <div className="mb-4">
              <ToastBanner notice={notice} onDismiss={() => setNotice(null)} />
            </div>
          )}

          {loading ? (
            <div className="grid place-content-center py-16 text-slate-400">
              <span className="mx-auto size-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
              <p className="mt-3 text-xs">Retrieving candidate records and OCR transcripts...</p>
            </div>
          ) : !dossier ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
              <div className="grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600 mb-3">
                <IconAlertTriangle className="size-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Could not load candidate verification dossier</h3>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                The candidate record or documents could not be retrieved from the server. Ensure that the API server is running (<code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">npm run dev:server</code>) and try again.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => loadDossier(false)}>
                  Retry Loading
                </Button>
                <Button variant="subtle" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Declared FSc</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{student?.fsc_obtained_marks || '—'} / 1100</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Declared Matric</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{student?.matric_obtained_marks || '—'} / 1100</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</span>
                  <p className="mt-1 text-xs font-bold text-blue-700">{student?.overall_status}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Documents</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{documents.length} Uploaded</p>
                </div>
              </div>

              {/* Program Eligibility & Academic Background */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-xs text-blue-900">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-blue-800">Program Eligibility:</span>
                  <span className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                    {student?.eligible_for || 'SE, SET, CET'}
                  </span>
                </div>
                {student?.prior_degree && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span>Academic Stream:</span>
                    <strong className="text-slate-900">{student.prior_degree}</strong>
                  </div>
                )}
              </div>

              {/* Merit Engine Gatekeeping & Mandatory Documents Checklist */}
              {(() => {
                const mandatoryDocsConfig = [
                  { type: 'CNIC_FRONT', label: 'CNIC Front / B-Form' },
                  { type: 'FSC_MARKSHEET', label: 'FSc / HSSC Marksheet' },
                  { type: 'MATRIC_MARKSHEET', label: 'Matric / SSC Marksheet' },
                ];
                const matchedDocTypes = new Set(
                  documents
                    .filter((d) => d.verification_status === 'MATCHED' || d.verification_status === 'PORTAL_VERIFIED')
                    .map((d) => d.doc_type)
                );
                const isCandidateOverallVerified = student?.overall_status === 'VERIFIED';

                return (
                  <div className={`rounded-xl p-4 text-xs border ${
                    isCandidateOverallVerified
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                      : 'border-amber-200 bg-amber-50/70 text-amber-900'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold flex items-center gap-2">
                        {isCandidateOverallVerified ? (
                          <>
                            <IconCheck className="size-4 text-emerald-600 shrink-0" />
                            <span>Qualified for Merit Calculations</span>
                          </>
                        ) : (
                          <>
                            <IconAlertTriangle className="size-4 text-amber-600 shrink-0" />
                            <span>Action Required for Merit Calculations</span>
                          </>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isCandidateOverallVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        Overall Status: {student?.overall_status}
                      </span>
                    </div>
                    <p className="mt-1.5 mb-2.5 text-[11px] leading-relaxed">
                      {isCandidateOverallVerified
                        ? 'All 3 mandatory admission documents have been verified. This candidate is officially verified and actively included in Module 4 Merit Engine calculations.'
                        : 'Module 4 (Merit Engine) strictly calculates candidates whose overall status is VERIFIED. All 3 mandatory documents below must be verified before the candidate enters Module 4 rankings:'}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-200/60">
                      {mandatoryDocsConfig.map((m) => {
                        const isDone = matchedDocTypes.has(m.type);
                        return (
                          <span
                            key={m.type}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold border ${
                              isDone
                                ? 'border-emerald-200 bg-white text-emerald-800 shadow-2xs'
                                : 'border-amber-300 bg-white text-amber-900 shadow-2xs'
                            }`}
                          >
                            <span className={`size-1.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            <span>{m.label}</span>
                            <span className="text-[10px] opacity-75">({isDone ? 'Verified' : 'Pending'})</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {student?.verified_by_name && (
                <p className="m-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Verified by <strong>{student.verified_by_name}</strong>
                  {student.verified_at ? ` · ${new Date(student.verified_at).toLocaleString()}` : ''}
                </p>
              )}

              {/* Discrepancy Note banner if any */}
              {student?.discrepancy_notes && (
                <div
                  className={`rounded-lg p-3 text-xs ${
                    student?.overall_status === 'VERIFIED'
                      ? 'border border-slate-200 bg-slate-50 text-slate-700'
                      : 'border border-amber-200 bg-amber-50/60 text-amber-900'
                  }`}
                >
                  <strong className="font-semibold">
                    {student?.overall_status === 'VERIFIED' ? 'Historical Audit Log (Staff Resolved):' : 'Audit Discrepancy History:'}
                  </strong>
                  <pre
                    className={`mt-1 whitespace-pre-wrap font-sans text-[11px] ${
                      student?.overall_status === 'VERIFIED' ? 'text-slate-600' : 'text-amber-800'
                    }`}
                  >
                    {student.discrepancy_notes}
                  </pre>
                </div>
              )}

              {/* Cross-Document Identity & Fuzzy Name Matching Analysis */}
              {dossier?.identityCrossCheck && dossier.identityCrossCheck.totalComparisons > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-7 place-items-center rounded-md bg-blue-50 text-blue-700">
                        <IconShield className="size-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 m-0">Cross-Document Identity & Name Matching</h4>
                        <p className="text-[11px] text-slate-500 m-0">
                          Neural OCR & Levenshtein scoring across CNIC, academic transcripts, and lead records
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">Confidence Score:</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          dossier.identityCrossCheck.overallScore >= 90
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : dossier.identityCrossCheck.overallScore >= 75
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {dossier.identityCrossCheck.overallScore}% · {dossier.identityCrossCheck.statusLabel}
                      </span>
                    </div>
                  </div>

                  {/* Comparisons Grid */}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {dossier.identityCrossCheck.comparisons.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg border p-2.5 text-xs ${
                          item.score >= 90
                            ? 'border-emerald-100 bg-emerald-50/40'
                            : item.score >= 75
                              ? 'border-amber-100 bg-amber-50/40'
                              : 'border-rose-100 bg-rose-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800 text-[11px]">{item.pair}</span>
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              item.score >= 90
                                ? 'text-emerald-700'
                                : item.score >= 75
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {item.score}% Match
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800 truncate max-w-[45%]" title={item.nameA}>
                            "{item.nameA}"
                          </span>
                          <span className="text-slate-400 text-[10px] font-semibold">vs</span>
                          <span className="font-medium text-slate-800 truncate max-w-[45%]" title={item.nameB}>
                            "{item.nameB}"
                          </span>
                        </div>
                        <p className="mb-0 mt-1 text-[10px] text-slate-500 italic">
                          {item.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Uploaded Documents List & Side-by-Side OCR comparison */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Document Transcripts & OCR Analysis</h3>

                {documents.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No documents uploaded yet by this candidate.
                  </p>
                ) : (
                  documents.map((doc) => {
                    const ocr = doc.extractedData || (typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data) || {};
                    const portal = doc.portalVerificationData || {};
                    const isPending = doc.verification_status === 'PENDING' || doc.verification_status === 'OCR_PROCESSING';
                    const isFsc = doc.doc_type === 'FSC_MARKSHEET';
                    const isMatric = doc.doc_type === 'MATRIC_MARKSHEET';
                    const isMarksheet = isFsc || isMatric;
                    const declaredMarks = isFsc ? student?.fsc_obtained_marks : isMatric ? student?.matric_obtained_marks : null;
                    const hasMarksDiscrepancy = isMarksheet && ocr.obtainedMarks !== null && ocr.obtainedMarks !== undefined && declaredMarks !== null && Number(ocr.obtainedMarks) !== Number(declaredMarks);

                    return (
                      <div key={doc.document_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-xs font-bold text-slate-800">{doc.doc_type.replace(/_/g, ' ')}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              doc.verification_status === 'MATCHED' || doc.verification_status === 'PORTAL_VERIFIED'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : isPending
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse'
                                  : doc.verification_status === 'MANUAL_REVIEW'
                                    ? 'bg-purple-50 text-purple-800 border border-purple-200'
                                    : 'bg-slate-100 text-slate-700'
                            }`}>
                              {doc.verification_status}
                            </span>
                            <button type="button" onClick={() => openStudentDocument(doc.document_id)} className="rounded px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
                              View original
                            </button>
                            <button type="button" onClick={() => setSelectedDocumentId(String(doc.document_id))} className={`rounded px-2 py-1 text-[10px] font-semibold cursor-pointer ${String(doc.document_id) === selectedDocumentId ? 'bg-blue-100 text-blue-800' : 'text-blue-700 hover:bg-blue-50'}`}>
                              {String(doc.document_id) === selectedDocumentId ? 'Selected' : 'Review this'}
                            </button>
                          </div>
                        </div>

                        {(doc.reviewed_by_name || doc.review_method) && (
                          <p className="mb-0 mt-2 text-[11px] text-slate-500">
                            {doc.reviewed_by_name ? <>Reviewed by <strong className="text-slate-700">{doc.reviewed_by_name}</strong></> : 'Automated review'}
                            {doc.review_method ? ` · ${doc.review_method.replace(/_/g, ' ').toLowerCase()}` : ''}
                            {doc.reviewed_at ? ` · ${new Date(doc.reviewed_at).toLocaleString()}` : ''}
                          </p>
                        )}
                        {doc.review_notes && <p className="mb-0 mt-1 text-[11px] text-slate-600">{doc.review_notes}</p>}

                        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                          {/* Left: OCR Extracted Fields */}
                          <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs space-y-1.5">
                            <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-slate-200">
                              <div className="flex items-center gap-1.5">
                                <p className="font-bold text-slate-800 mb-0">AI OCR Extracted Data</p>
                                {ocr.source && (
                                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                                    ocr.source === 'MOCK' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {ocr.source === 'MOCK' ? 'MOCK DATA' : ocr.source}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={reprocessingDocId === (doc.document_id || doc.id) || doc.verification_status === 'OCR_PROCESSING'}
                                onClick={() => handleReprocessOcr(doc.document_id || doc.id)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 border border-blue-200 bg-blue-50/70 hover:bg-blue-100 px-2 py-0.5 rounded cursor-pointer transition disabled:opacity-50"
                                title="Run live Gemini AI OCR on this uploaded document"
                              >
                                <IconRefresh className={`size-3 ${reprocessingDocId === (doc.document_id || doc.id) ? 'animate-spin' : ''}`} />
                                <span>{reprocessingDocId === (doc.document_id || doc.id) ? 'Extracting...' : 'Re-run Live OCR'}</span>
                              </button>
                            </div>

                            {isPending ? (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-amber-900 space-y-2">
                                <div className="flex items-center gap-2.5">
                                  <span className="size-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-amber-900" />
                                  <strong className="text-xs">Extraction in Progress</strong>
                                </div>
                                <p className="mb-0 text-[11px] text-amber-800 leading-relaxed">
                                  Neural transcript analysis is reading this document. If this takes longer than expected, you can inspect the original file directly and perform a manual review below.
                                </p>
                              </div>
                            ) : ocr.processingError ? (
                              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
                                <strong className="font-semibold flex items-center gap-1.5 text-rose-700">
                                  <IconAlertTriangle className="size-3.5 text-rose-600 shrink-0" />
                                  <span>OCR Extraction Incomplete</span>
                                </strong>
                                <p className="mb-0 text-[11px] text-rose-700">
                                  {ocr.processingError}
                                </p>
                                <p className="mb-0 text-[11px] text-slate-600 font-medium pt-1">
                                  Use the <em>View original</em> button above to inspect the document and enter candidate marks manually below.
                                </p>
                              </div>
                            ) : doc.doc_type === 'CNIC_FRONT' || doc.doc_type === 'CNIC_BACK' ? (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Name:</span>
                                  <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Father Name:</span>
                                  <strong className="text-slate-800">{ocr.fatherName || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">CNIC Number:</span>
                                  <strong className="font-mono text-blue-700">{ocr.cnic || '—'}</strong>
                                </div>
                                {ocr.dob && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Date of Birth:</span>
                                    <strong className="text-slate-800">{ocr.dob}</strong>
                                  </div>
                                )}
                                {ocr.gender && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Gender:</span>
                                    <strong className="text-slate-800">{ocr.gender}</strong>
                                  </div>
                                )}
                                {ocr.expiryDate && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Expiry Date:</span>
                                    <strong className="text-slate-800">{ocr.expiryDate}</strong>
                                  </div>
                                )}
                              </>
                            ) : doc.doc_type === 'DOMICILE' ? (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Name:</span>
                                  <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Father Name:</span>
                                  <strong className="text-slate-800">{ocr.fatherName || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">District:</span>
                                  <strong className="text-slate-800">{ocr.district || ocr.boardName || '—'}</strong>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Candidate Name:</span>
                                  <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                                </div>
                                {ocr.fatherName && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Father Name:</span>
                                    <strong className="text-slate-800">{ocr.fatherName}</strong>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Roll No:</span>
                                  <strong className="font-mono text-slate-900 font-bold">{ocr.rollNumber || '—'}</strong>
                                </div>
                                {ocr.registrationNumber && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Registration No:</span>
                                    <strong className="font-mono text-slate-800">{ocr.registrationNumber}</strong>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Board Name:</span>
                                  <strong className="text-slate-800 text-right max-w-[240px] truncate" title={ocr.boardName}>
                                    {ocr.boardName || '—'}
                                  </strong>
                                </div>
                                {ocr.examYear && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Exam Year:</span>
                                    <strong className="text-slate-800">{ocr.examYear}</strong>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Obtained Marks:</span>
                                  <strong className="text-blue-700 font-bold">
                                    {ocr.obtainedMarks !== null && ocr.obtainedMarks !== undefined ? ocr.obtainedMarks : '—'} / {ocr.totalMarks || 1100}
                                    {ocr.percentage ? ` (${ocr.percentage}%)` : ''}
                                  </strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Result Status:</span>
                                  <strong className={ocr.isPass ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                                    {ocr.isPass === true ? 'PASS' : ocr.isPass === false ? 'FAIL' : 'NOT CONFIRMED'}
                                  </strong>
                                </div>

                                {ocr.subjects && ocr.subjects.length > 0 && (
                                  <div className="mt-2.5 border-t border-slate-200 pt-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      Subject Breakdown ({ocr.subjects.length}):
                                    </span>
                                    <div className="mt-1.5 max-h-32 overflow-y-auto space-y-1 rounded bg-white p-2 border border-slate-200">
                                      {ocr.subjects.map((s, idx) => (
                                        <div key={idx} className="flex justify-between text-[11px] text-slate-700">
                                          <span className="truncate pr-2">{s.subject}</span>
                                          <span className="font-mono font-semibold text-slate-900">{s.obtained} / {s.total}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Right: Board Verification Outcome & Declared Data Match */}
                          <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs space-y-1.5">
                            {doc.doc_type === 'CNIC_FRONT' || doc.doc_type === 'CNIC_BACK' ? (
                              <>
                                <p className="font-bold text-slate-700">Identity Match Check</p>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Declared CNIC:</span>
                                  <strong className="font-mono text-slate-800">{student?.cnic || 'N/A'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Declared Name:</span>
                                  <strong className="text-slate-800">{student?.full_name || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Declared Father Name:</span>
                                  <strong className="text-slate-800">{student?.father_name || '—'}</strong>
                                </div>
                                <div className="mt-2 pt-1 border-t border-slate-200">
                                  <span className="text-slate-500">Identity Status: </span>
                                  <strong className={doc.verification_status === 'MATCHED' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                                    {doc.verification_status === 'MATCHED' ? 'VERIFIED MATCH' : 'PENDING REVIEW'}
                                  </strong>
                                </div>
                                {doc.verification_status === 'MANUAL_REVIEW' && student?.discrepancy_notes && (
                                  <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                                    <strong>Reason:</strong> {student.discrepancy_notes}
                                  </div>
                                )}
                              </>
                            ) : doc.doc_type === 'DOMICILE' ? (
                              <>
                                <p className="font-bold text-slate-700">Domicile Residence Check</p>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Applicant Name:</span>
                                  <strong className="text-slate-800">{student?.full_name || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Extracted Domicile City/District:</span>
                                  <strong className="text-slate-800 font-bold">{ocr.district || ocr.city || '—'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Student City in Database:</span>
                                  <strong className="text-blue-800 font-bold">{student?.city || 'Not recorded'}</strong>
                                </div>
                                <div className="mt-2 pt-1 border-t border-slate-200">
                                  <span className="text-slate-500">Domicile Status: </span>
                                  <strong className={doc.verification_status === 'MATCHED' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                                    {doc.verification_status === 'MATCHED' ? 'VERIFIED MATCH' : 'PENDING REVIEW'}
                                  </strong>
                                </div>
                                {doc.verification_status === 'MANUAL_REVIEW' && student?.discrepancy_notes && (
                                  <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                                    <strong>Reason:</strong> {student.discrepancy_notes}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="font-bold text-slate-700">Academic Verification Comparison</p>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Declared Marks:</span>
                                  <strong className="text-slate-900 font-bold">{declaredMarks || '—'} / 1100</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Marksheet Marks:</span>
                                  <strong className="text-blue-700 font-bold">{ocr.obtainedMarks !== undefined && ocr.obtainedMarks !== null ? ocr.obtainedMarks : '—'} / {ocr.totalMarks || 1100}</strong>
                                </div>

                                {hasMarksDiscrepancy ? (
                                  <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2.5 text-amber-900">
                                    <span className="font-bold">Discrepancy:</span> Candidate declared <strong>{declaredMarks}</strong>, but transcript shows <strong>{ocr.obtainedMarks}</strong>.
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={actionLoading}
                                        onClick={() => handleDirectMarksOverride({
                                          documentId: doc.document_id,
                                          docType: doc.doc_type,
                                          marks: ocr.obtainedMarks,
                                          sourceLabel: 'marksheet transcript',
                                        })}
                                        className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer shadow-xs"
                                      >
                                        {actionLoading ? 'Updating...' : `Use Marksheet Score (${ocr.obtainedMarks}) to Override`}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOverrideMarks((prev) => ({
                                            ...prev,
                                            [isFsc ? 'fsc' : 'matric']: ocr.obtainedMarks,
                                          }));
                                          setSelectedDocumentId(String(doc.document_id));
                                          setShowOverrideInputs(true);
                                          setReviewNotes(`Adjusted marks to official transcript score (${ocr.obtainedMarks})`);
                                        }}
                                        className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                                      >
                                        Custom Edit...
                                      </button>
                                    </div>
                                  </div>
                                ) : ocr.obtainedMarks && Number(declaredMarks) === Number(ocr.obtainedMarks) ? (
                                  <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 p-2 text-emerald-900 text-[11px] font-semibold">
                                    Declared score matches transcript ({ocr.obtainedMarks} / 1100).
                                  </div>
                                ) : null}

                                <div className="mt-2 border-t border-slate-200 pt-2">
                                  <p className="font-bold text-slate-700 mb-1">Board Source Status</p>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Status:</span>
                                    <strong className="text-slate-800">{portal.status || 'NOT_QUERIED'}</strong>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Portal Verified:</span>
                                    <strong className={portal.isVerified ? 'text-emerald-700 font-bold' : 'text-amber-700 font-semibold'}>
                                      {portal.isVerified ? 'VERIFIED MATCH' : 'NO DIRECT MATCH'}
                                    </strong>
                                  </div>
                                  {ocr?.rollNumber && (
                                    <button
                                      type="button"
                                      disabled={searchingGazetteDocId === (doc.document_id || doc.id)}
                                      onClick={() => handleSearchGazette(doc.document_id || doc.id)}
                                      className="mt-2 inline-flex items-center rounded border border-blue-600 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 cursor-pointer"
                                    >
                                      {searchingGazetteDocId === (doc.document_id || doc.id) ? 'Checking official sources...' : 'Run official result checks'}
                                    </button>
                                  )}
                                  {Array.isArray(portal.searchedSources) && portal.searchedSources.length > 0 && (
                                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[10px]">
                                      {portal.searchedSources.map((source, index) => (
                                        <li key={`${source.sourceId || source.sourceLabel}-${index}`} className="flex flex-wrap items-center justify-between gap-1">
                                          <span className="min-w-0 truncate text-slate-600">{source.sourceLabel || source.sourceType}{source.sourceType === 'GAZETTE' ? ' · Gazette' : ' · Portal'}</span>
                                          <span className={source.found ? 'font-semibold text-emerald-700' : 'text-slate-500'}>{source.status}</span>
                                          {source.sourceType === 'GAZETTE' && source.sourceId && (
                                            <button type="button" onClick={() => openGazette(source.sourceId)} className="text-blue-700 hover:underline">Open gazette</button>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {portal.isVerified && Number.isFinite(Number(portal.boardMarks)) && (
                                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
                                      <strong>Official result:</strong> {portal.boardMarks}{portal.totalMarks ? ` / ${portal.totalMarks}` : ''} marks
                                      {portal.candidateName ? ` · ${portal.candidateName}` : ''}
                                      {portal.sourceType ? ` · ${portal.sourceType === 'GAZETTE' ? 'Gazette' : 'Board portal'}` : ''}
                                    </div>
                                  )}
                                </div>

                                {doc.boardSource?.sourceType === 'PORTAL_URL' && (
                                  <a href={doc.boardSource.resultUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">
                                    <span>Open {doc.boardSource.boardName} result page</span>
                                  </a>
                                )}
                                {doc.boardSource?.sourceType === 'GAZETTE' && (
                                  <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <button type="button" onClick={() => openGazette(doc.boardSource.id)} className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline text-xs cursor-pointer">
                                        <span>Open gazette: {doc.boardSource.gazetteFilename}</span>
                                      </button>
                                    </div>

                                    {portal.status === 'GAZETTE_VERIFIED' && (
                                      <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-[11px] text-emerald-950">
                                        <div className="font-bold text-emerald-800">
                                          Official Gazette Match: {portal.boardMarks} Marks ({portal.candidateName})
                                        </div>
                                        {portal.rawSnippet && (
                                          <div className="mt-1 font-mono text-[10px] text-emerald-900 bg-emerald-100/60 rounded px-1.5 py-0.5 break-all">
                                            {portal.rawSnippet}
                                          </div>
                                        )}
                                        {portal.boardMarks && Number(portal.boardMarks) !== Number(declaredMarks) && (
                                          <button
                                            type="button"
                                            disabled={actionLoading}
                                            onClick={() => handleDirectMarksOverride({
                                              documentId: doc.document_id,
                                              docType: doc.doc_type,
                                              marks: portal.boardMarks,
                                              sourceLabel: 'official board gazette',
                                            })}
                                            className="mt-1.5 block rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer shadow-xs"
                                          >
                                            {actionLoading ? 'Updating...' : `Use Official Gazette Score (${portal.boardMarks}) to Override`}
                                          </button>
                                        )}
                                      </div>
                                    )}

                                    {['GAZETTE_NOT_FOUND', 'NO_OFFICIAL_RESULT_MATCH', 'EXAM_DETAILS_INCOMPLETE', 'OFFICIAL_SOURCE_CONFLICT', 'GAZETTE_MATCH_REQUIRES_REVIEW'].includes(portal.status) && (
                                      <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                                        <span className="font-bold">Official source check:</span> {portal.reason || portal.status.replace(/_/g, ' ').toLowerCase()}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {!doc.boardSource && (
                                  <p className="mb-0 mt-2 text-[10px] text-slate-500">
                                    No matching official source is configured for these exam details. Review the transcript and record the evidence used.
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
                <h4 className="m-0 text-xs font-bold text-slate-800">Record your review</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-700">
                    Document
                    <select value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-slate-800 focus:border-blue-600 focus:outline-none">
                      <option value="">Select a document</option>
                      {documents.map((document) => <option key={document.document_id} value={document.document_id}>{document.doc_type.replace(/_/g, ' ')} · {document.verification_status}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Evidence checked
                    <select value={reviewMethod} onChange={(event) => setReviewMethod(event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-slate-800 focus:border-blue-600 focus:outline-none">
                      <option value="STAFF_DOCUMENT">Original document</option>
                      <option value="STAFF_PORTAL">Official board portal</option>
                      <option value="STAFF_GAZETTE">Board gazette</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                    Review note
                    <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} maxLength={1000} rows={2} placeholder="Record what you checked and the result." className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 font-normal focus:border-blue-600 focus:outline-none" />
                  </label>
                </div>
              </section>

              {/* Audit Trail & Lifecycle Timeline */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setTimelineExpanded(!timelineExpanded)}
                >
                  <div className="flex items-center gap-2">
                    <h4 className="m-0 text-xs font-bold text-slate-800">
                      Candidate Lifecycle & Audit Trail
                    </h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {(dossier?.timeline || []).length} events
                    </span>
                  </div>
                  <span className="text-xs text-blue-600 font-medium hover:underline">
                    {timelineExpanded ? 'Hide timeline' : 'View timeline'}
                  </span>
                </div>

                {timelineExpanded && (
                  <div className="mt-4 border-l-2 border-slate-200 ml-3 pl-4 space-y-4">
                    {(dossier?.timeline || []).length === 0 ? (
                      <p className="text-xs text-slate-500 italic py-2">No lifecycle events recorded yet.</p>
                    ) : (
                      (dossier?.timeline || []).map((event) => {
                        const dateStr = new Date(event.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        });

                        const badgeColors = {
                          blue: 'bg-blue-50 text-blue-700 border-blue-200',
                          purple: 'bg-purple-50 text-purple-700 border-purple-200',
                          indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                          emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          amber: 'bg-amber-50 text-amber-700 border-amber-200',
                          slate: 'bg-slate-100 text-slate-700 border-slate-200',
                        };
                        const colorClass = badgeColors[event.badgeColor] || badgeColors.slate;

                        return (
                          <div key={event.id} className="relative group">
                            {/* Timeline node circle */}
                            <div className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-slate-400 bg-white group-hover:border-blue-600 group-hover:bg-blue-600 transition-colors" />

                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${colorClass}`}>
                                {event.badge}
                              </span>
                              <span className="text-[11px] font-medium text-slate-400">{dateStr}</span>
                            </div>

                            <p className="mt-1 text-xs font-semibold text-slate-900 leading-snug">
                              {event.title}
                            </p>
                            {event.description && (
                              <p className="mt-0.5 text-[11px] text-slate-600 leading-relaxed">
                                {event.description}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </section>

              {/* Override Inputs (toggled) */}
              {showOverrideInputs && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs">
                  <h4 className="font-bold text-blue-900">Manual Marks Override</h4>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-medium">Verified FSc Marks</label>
                      <input
                        type="number"
                        value={overrideMarks.fsc}
                        onChange={(e) => setOverrideMarks((prev) => ({ ...prev, fsc: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-medium">Verified Matric Marks</label>
                      <input
                        type="number"
                        value={overrideMarks.matric}
                        onChange={(e) => setOverrideMarks((prev) => ({ ...prev, matric: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-slate-600 font-medium">Audit Justification Notes</label>
                    <input
                      type="text"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="e.g. Verified with original FBISE gazette copy"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={handleOverride} disabled={actionLoading}>
                      Save & Verify Candidate
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => setShowOverrideInputs(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <div className="flex gap-2">
            {!showOverrideInputs && (
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setShowOverrideInputs(true)}
                disabled={actionLoading}
              >
                Override Marks
              </Button>
            )}
              <Button
              variant="subtle"
              size="sm"
              onClick={handleRejectReissue}
                disabled={actionLoading || !selectedDocument}
              className="text-rose-700 hover:bg-rose-50 hover:border-rose-200"
            >
              Reject & Reissue Link
            </Button>
              <Button variant="subtle" size="sm" onClick={handleMarkDiscrepancy} disabled={actionLoading || !selectedDocument}>
                Mark discrepancy
              </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="subtle" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={actionLoading || !selectedDocument || !reviewNotes.trim()}
            >
              Approve & Mark Verified
            </Button>
          </div>
        </div>
      </div>

      {/* Production Confirm Dialog */}
      {confirmModal && (
        <ConfirmDialog
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          tone={confirmModal.tone}
          loading={actionLoading}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Production Prompt Dialog */}
      {promptModal && (
        <PromptDialog
          isOpen={promptModal.isOpen}
          title={promptModal.title}
          message={promptModal.message}
          placeholder={promptModal.placeholder}
          initialValue={promptModal.initialValue}
          confirmLabel={promptModal.confirmLabel}
          presets={promptModal.presets}
          loading={actionLoading}
          onConfirm={promptModal.onConfirm}
          onCancel={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}
