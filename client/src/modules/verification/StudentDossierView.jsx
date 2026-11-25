import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button, ToastBanner, ConfirmDialog, PromptDialog } from '../../core/ui/primitives.jsx';
import {
  IconDocumentCheck,
  IconShield,
  IconAlertTriangle,
  IconRefresh,
  IconCheck,
  IconClose,
  IconEye,
  IconArrowLeft,
} from '../../core/icons/Icons.jsx';

export function StudentDossierView({ studentId, onBack, onActionComplete }) {
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

  // Collapsible toggle states (irrelevant / verbose data hidden by default)
  const [showIdentityDetails, setShowIdentityDetails] = useState(false);
  const [showDiscrepancyNotes, setShowDiscrepancyNotes] = useState(false);
  const [showSubjects, setShowSubjects] = useState(false);
  const [showMoreOcr, setShowMoreOcr] = useState(false);
  const [showRawSnippet, setShowRawSnippet] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // Inline feedback & dialog modals
  const [notice, setNotice] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [promptModal, setPromptModal] = useState(null);

  const REVIEW_PRESETS = [
    'Verified with official board gazette score.',
    'Verified with original marksheet scan.',
    'Identity and declared marks match official records.',
    'Discrepancy resolved through verified document evidence.',
  ];

  function broadcastVerificationSuccess(targetStudentId) {
    try {
      const payload = {
        type: 'DOCUMENTS_VERIFIED',
        studentId: targetStudentId || studentId,
        overallStatus: 'VERIFIED',
        timestamp: Date.now(),
      };
      localStorage.setItem('adm_verification_event', JSON.stringify(payload));
      new BroadcastChannel('adm_verification').postMessage(payload);
    } catch (_) {}
  }

  function handleBack(preferredFilter) {
    const target = preferredFilter !== undefined ? preferredFilter : (isCandidateOverallVerified ? 'VERIFIED' : undefined);
    onBack?.(target);
  }

  async function loadDossier(silent = false) {
    if (!studentId) return;
    try {
      if (!silent) setLoading(true);
      const data = await verificationApi.fetchStudentDossier(studentId);
      setDossier(data);
      if (data?.student?.overall_status === 'VERIFIED') {
        broadcastVerificationSuccess(studentId);
        onActionComplete?.(data.student);
      }
      setOverrideMarks({
        fsc: data.student?.fsc_obtained_marks || '',
        matric: data.student?.matric_obtained_marks || '',
      });
      if (!selectedDocumentId && data.documents?.length) {
        const target =
          data.documents.find(
            (doc) => doc.verification_status !== 'MATCHED' && doc.verification_status !== 'PORTAL_VERIFIED'
          ) || data.documents[0];
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
          detail: `${result.portalVerification.boardMarks} marks confirmed from ${
            result.portalVerification.sourceType === 'GAZETTE'
              ? result.portalVerification.gazetteFilename || 'a matching gazette'
              : 'the board portal'
          }.`,
        });
      } else {
        setNotice({
          type: 'warning',
          message: 'Official result needs review.',
          detail:
            result.portalVerification?.reason ||
            result.portalVerification?.status?.replace(/_/g, ' ').toLowerCase() ||
            'No matching result was confirmed from the configured sources.',
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
      if (result.isFallback) {
        setNotice({
          type: 'warning',
          message: 'Document Extracted (Contextual Fallback)',
          detail:
            'Google AI was temporarily experiencing peak demand (HTTP 503/429). The marksheet was processed using contextual fallback so review could proceed uninterrupted.',
        });
      } else {
        setNotice({
          type: 'success',
          message: 'Live AI OCR Extraction Complete',
          detail: `Successfully parsed document using Gemini AI (${result.model || 'Gemini Flash'}).`,
        });
      }
      await loadDossier(true);
    } catch (err) {
      let friendlyMessage = err.message || 'Live OCR extraction failed.';
      if (friendlyMessage.includes('503') || friendlyMessage.includes('high demand') || friendlyMessage.includes('UNAVAILABLE')) {
        friendlyMessage = 'Google AI service is currently experiencing peak traffic (HTTP 503). Retrying in a few moments, or you can verify manually.';
      } else if (friendlyMessage.includes('429') || friendlyMessage.includes('quota') || friendlyMessage.includes('RESOURCE_EXHAUSTED')) {
        friendlyMessage = 'Google AI rate limit or quota reached (HTTP 429). Contextual review is ready for manual inspection.';
      }
      setNotice({ type: 'error', message: 'Live OCR extraction failed.', detail: friendlyMessage });
    } finally {
      setReprocessingDocId(null);
    }
  }

  useEffect(() => {
    loadDossier();
  }, [studentId]);

  // Auto-poll if any document is still in PENDING or OCR_PROCESSING state
  useEffect(() => {
    if (!dossier?.documents) return;
    const hasPending = dossier.documents.some(
      (d) => d.verification_status === 'PENDING' || d.verification_status === 'OCR_PROCESSING'
    );
    if (!hasPending) return;

    const interval = setInterval(() => {
      loadDossier(true);
    }, 2500);

    return () => clearInterval(interval);
  }, [dossier?.documents, studentId]);

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
          const isVerified = result?.overall_status === 'VERIFIED';
          if (isVerified) {
            broadcastVerificationSuccess(studentId);
          }
          onActionComplete?.(result);
          handleBack(isVerified ? 'VERIFIED' : undefined);
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
      const isVerified = result?.overall_status === 'VERIFIED';
      if (isVerified) {
        broadcastVerificationSuccess(studentId);
      }
      onActionComplete?.(result);
      handleBack(isVerified ? 'VERIFIED' : undefined);
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

          const isVerified = result?.overall_status === 'VERIFIED';
          if (isVerified) {
            broadcastVerificationSuccess(studentId);
          }
          setNotice({
            type: 'success',
            message: `${label} Marks Updated to ${marks} / 1100`,
            detail: isVerified ? 'Candidate is now officially VERIFIED in the Verified filter.' : 'Updated in student dossier.',
          });
          await loadDossier(true);
          onActionComplete?.(result);
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
          onBack?.();
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
          onBack?.();
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
  const selectedDocument =
    documents.find((doc) => String(doc.document_id) === String(selectedDocumentId)) || documents[0];

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

  // Active document extracted data & comparisons
  const activeDoc = selectedDocument;
  const ocr =
    activeDoc?.extractedData ||
    (typeof activeDoc?.extracted_data === 'string'
      ? (function () {
          try { return JSON.parse(activeDoc.extracted_data); } catch { return {}; }
        })()
      : activeDoc?.extracted_data) ||
    {};
  const portal = activeDoc?.portalVerificationData || {};
  const isPending =
    activeDoc?.verification_status === 'PENDING' || activeDoc?.verification_status === 'OCR_PROCESSING';
  const isFsc = activeDoc?.doc_type === 'FSC_MARKSHEET';
  const isMatric = activeDoc?.doc_type === 'MATRIC_MARKSHEET';
  const isMarksheet = isFsc || isMatric;
  const declaredMarks = isFsc
    ? student?.fsc_obtained_marks
    : isMatric
      ? student?.matric_obtained_marks
      : null;
  const hasMarksDiscrepancy =
    isMarksheet &&
    ocr.obtainedMarks !== null &&
    ocr.obtainedMarks !== undefined &&
    declaredMarks !== null &&
    Number(ocr.obtainedMarks) !== Number(declaredMarks);

  // Mandatory checklist logic
  const mandatoryDocsConfig = [
    { type: 'CNIC_FRONT', label: 'CNIC / B-Form' },
    { type: 'FSC_MARKSHEET', label: 'FSc Marksheet' },
    { type: 'MATRIC_MARKSHEET', label: 'Matric Marksheet' },
    { type: 'DOMICILE', label: 'Domicile' },
  ];
  const matchedDocTypes = new Set(
    documents
      .filter((d) => d.verification_status === 'MATCHED' || d.verification_status === 'PORTAL_VERIFIED')
      .map((d) => d.doc_type)
  );
  const isCandidateOverallVerified = student?.overall_status === 'VERIFIED';

  return (
    <div className="space-y-6">
      {notice && (
        <ToastBanner notice={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* Top Header Card: Back Breadcrumb, Candidate Identity & Status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            {/* Clean Back Navigation Link */}
            <button
              type="button"
              onClick={() => handleBack()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition cursor-pointer group"
            >
              <IconArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to Verification Queue</span>
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700 shrink-0">
                <IconDocumentCheck className="size-5.5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-lg font-bold text-slate-900 m-0">
                    {student?.full_name || (loading ? 'Loading Candidate Dossier...' : 'Candidate Verification Dossier')}
                  </h1>
                  {student?.application_no && (
                    <span className="text-xs font-mono text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                      #{student.application_no}
                    </span>
                  )}
                  {student?.overall_status && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                        isCandidateOverallVerified
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <span className={`size-1.5 rounded-full ${isCandidateOverallVerified ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {student.overall_status}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 mb-0">
                  CNIC: <strong className="font-mono text-slate-700">{student?.cnic || 'N/A'}</strong> · Phone: <strong className="font-mono text-slate-700">{student?.phone_normalized || 'N/A'}</strong>
                  {student?.city ? ` · City: ${student.city}` : ''}
                  {student?.email ? ` · Email: ${student.email}` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Refresh Button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadDossier(false)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition cursor-pointer"
            >
              <IconRefresh className="size-3.5 text-slate-500" />
              <span>Refresh Records</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid place-content-center py-20 text-slate-400 rounded-2xl border border-slate-200 bg-white">
          <span className="mx-auto size-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
          <p className="mt-3 text-xs font-medium">Retrieving candidate academic records and OCR transcripts...</p>
        </div>
      ) : !dossier ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500 rounded-2xl border border-slate-200 bg-white p-6">
          <IconAlertTriangle className="size-10 text-rose-500 mb-2.5" />
          <h3 className="text-sm font-bold text-slate-800">Candidate verification dossier unavailable</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            The candidate record could not be found or loaded from the database.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => loadDossier(false)}>
              Retry
            </Button>
            <Button variant="subtle" size="sm" onClick={() => handleBack()}>
              Return to Queue
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Real-time Verified Notice & Direct Filter Link */}
          {isCandidateOverallVerified && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50/90 p-4 text-xs text-emerald-950 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-white font-bold text-xs shrink-0">
                  ✓
                </span>
                <div>
                  <strong className="font-bold text-emerald-950 text-sm block">
                    Candidate Officially Verified!
                  </strong>
                  <span className="text-emerald-800">
                    All mandatory admission documents and marks are verified. This candidate automatically appears in the Verified filter.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleBack('VERIFIED')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 text-xs font-bold shadow-2xs cursor-pointer transition"
              >
                <span>View in Verified Filter →</span>
              </button>
            </div>
          )}

          {/* Section 1: Compact Academic & Verification Summary Strip */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="text-slate-400 font-medium">FSc Declared:</span>{' '}
                  <strong className="text-slate-900 font-bold">{student?.fsc_obtained_marks || '—'} / 1100</strong>
                </div>
                <span className="text-slate-200">|</span>
                <div>
                  <span className="text-slate-400 font-medium">Matric Declared:</span>{' '}
                  <strong className="text-slate-900 font-bold">{student?.matric_obtained_marks || '—'} / 1100</strong>
                </div>
                {student?.prior_degree && (
                  <>
                    <span className="text-slate-200">|</span>
                    <div>
                      <span className="text-slate-400 font-medium">Stream:</span>{' '}
                      <strong className="text-slate-800 font-semibold">{student.prior_degree}</strong>
                    </div>
                  </>
                )}
                <span className="text-slate-200">|</span>
                <div>
                  <span className="text-slate-400 font-medium">Eligible Programs:</span>{' '}
                  <span className="rounded bg-blue-50 text-blue-800 font-bold px-2 py-0.5 text-xs border border-blue-200/60">
                    {student?.eligible_for || 'SE, SET, CET'}
                  </span>
                </div>
              </div>

              {student?.verified_by_name && (
                <span className="text-xs text-emerald-800 font-medium bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                  Verified by <strong>{student.verified_by_name}</strong>
                  {student.verified_at ? ` (${new Date(student.verified_at).toLocaleDateString()})` : ''}
                </span>
              )}
            </div>

            {/* Mandatory Checklist & Audit Link */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Mandatory Checklist:
                </span>
                {mandatoryDocsConfig.map((m) => {
                  const isDone = matchedDocTypes.has(m.type);
                  return (
                    <span
                      key={m.type}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${
                        isDone
                          ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800'
                          : 'border-amber-200 bg-amber-50/60 text-amber-800'
                      }`}
                    >
                      <span className={`size-1.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <span>{m.label}</span>
                      <span className="text-[10px] opacity-75">({isDone ? 'Verified' : 'Pending'})</span>
                    </span>
                  );
                })}
              </div>

              {student?.discrepancy_notes && (
                <button
                  type="button"
                  onClick={() => setShowDiscrepancyNotes((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-950 hover:underline cursor-pointer"
                >
                  <span>Audit History ({showDiscrepancyNotes ? 'Hide ▲' : 'View ▼'})</span>
                </button>
              )}
            </div>

            {/* Collapsible Discrepancy Record */}
            {showDiscrepancyNotes && student?.discrepancy_notes && (
              <div className="rounded-xl bg-amber-50/90 border border-amber-200 p-3 text-xs text-amber-900 mt-2 space-y-1">
                <span className="font-bold block mb-1">Historical Audit / Discrepancy Record:</span>
                <pre className="font-mono text-[11px] text-amber-950 bg-white/80 p-2.5 rounded-lg border border-amber-200/80 whitespace-pre-wrap mb-0">
                  {student.discrepancy_notes}
                </pre>
              </div>
            )}
          </div>

          {/* Section 2: Identity & Fuzzy Name Matching (Compact, Click to expand) */}
          {dossier?.identityCrossCheck && dossier.identityCrossCheck.totalComparisons > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconShield className="size-4 text-blue-600 shrink-0" />
                  <span className="font-semibold text-slate-800">Identity & Name Matching Analysis:</span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-xs ${
                      dossier.identityCrossCheck.overallScore >= 90
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : dossier.identityCrossCheck.overallScore >= 75
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {dossier.identityCrossCheck.overallScore}% · {dossier.identityCrossCheck.statusLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIdentityDetails((v) => !v)}
                  className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  {showIdentityDetails ? 'Hide Comparison Details ▲' : 'View Comparisons ▼'}
                </button>
              </div>

              {showIdentityDetails && (
                <div className="mt-3.5 grid gap-3 sm:grid-cols-2 pt-3 border-t border-slate-100">
                  {dossier.identityCrossCheck.comparisons.map((item, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs">
                      <div className="flex justify-between font-semibold text-xs">
                        <span className="text-slate-800">{item.pair}</span>
                        <span className={item.score >= 90 ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                          {item.score}% Match
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                        <span className="font-semibold text-slate-800 truncate max-w-[45%]">"{item.nameA}"</span>
                        <span className="text-slate-400 text-[11px]">vs</span>
                        <span className="font-semibold text-slate-800 truncate max-w-[45%]">"{item.nameB}"</span>
                      </div>
                      <p className="mt-1 mb-0 text-[11px] text-slate-500 italic">{item.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Section 3: Document Switcher Tabs & Active Document View */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            {/* Horizontal Document Switcher Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto p-2 bg-slate-50/80 border-b border-slate-200 scrollbar-none">
              {documents.length === 0 ? (
                <p className="text-xs text-slate-400 p-2">No documents uploaded yet by this candidate.</p>
              ) : (
                documents.map((doc) => {
                  const isSelected = String(doc.document_id) === String(selectedDocumentId);
                  const isMatched =
                    doc.verification_status === 'MATCHED' || doc.verification_status === 'PORTAL_VERIFIED';
                  const isPendingDoc =
                    doc.verification_status === 'PENDING' || doc.verification_status === 'OCR_PROCESSING';
                  return (
                    <button
                      key={doc.document_id}
                      type="button"
                      onClick={() => {
                        setSelectedDocumentId(String(doc.document_id));
                        setShowSubjects(false);
                        setShowMoreOcr(false);
                        setShowRawSnippet(false);
                      }}
                      className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition cursor-pointer shrink-0 ${
                        isSelected
                          ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span
                        className={`size-2 rounded-full shrink-0 ${
                          isMatched ? 'bg-emerald-500' : isPendingDoc ? 'bg-amber-500 animate-pulse' : 'bg-purple-500'
                        }`}
                      />
                      <span>{doc.doc_type.replace(/_/g, ' ')}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          isMatched
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isPendingDoc
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}
                      >
                        {doc.verification_status}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Active Document Card Content */}
            {activeDoc && (
              <div className="p-5 space-y-4">
                {/* Active Document Action Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <h3 className="m-0 text-sm font-bold text-slate-900">
                      {activeDoc.doc_type.replace(/_/g, ' ')}
                    </h3>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        activeDoc.verification_status === 'MATCHED' || activeDoc.verification_status === 'PORTAL_VERIFIED'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : isPending
                            ? 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse'
                            : 'bg-purple-50 text-purple-800 border border-purple-200'
                      }`}
                    >
                      {activeDoc.verification_status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openStudentDocument(activeDoc.document_id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition cursor-pointer"
                    >
                      <IconEye className="size-3.5 text-slate-500" />
                      <span>View Uploaded File</span>
                    </button>
                    <button
                      type="button"
                      disabled={reprocessingDocId === activeDoc.document_id || activeDoc.verification_status === 'OCR_PROCESSING'}
                      onClick={() => handleReprocessOcr(activeDoc.document_id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer shadow-2xs transition disabled:opacity-50"
                    >
                      <IconRefresh className={`size-3.5 ${reprocessingDocId === activeDoc.document_id ? 'animate-spin' : ''}`} />
                      <span>{reprocessingDocId === activeDoc.document_id ? 'Extracting...' : 'Re-run Live OCR'}</span>
                    </button>
                  </div>
                </div>

                {/* Score Discrepancy Alert */}
                {hasMarksDiscrepancy && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3.5 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong className="font-bold text-amber-950">Discrepancy Detected:</strong> Declared{' '}
                      <strong>{declaredMarks}</strong> vs Marksheet OCR score <strong>{ocr.obtainedMarks}</strong> / 1100.
                    </div>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() =>
                        handleDirectMarksOverride({
                          documentId: activeDoc.document_id,
                          docType: activeDoc.doc_type,
                          marks: ocr.obtainedMarks,
                          sourceLabel: 'marksheet transcript',
                        })
                      }
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer shadow-2xs transition"
                    >
                      {actionLoading ? 'Updating...' : `Use Marksheet Score (${ocr.obtainedMarks}) to Override`}
                    </button>
                  </div>
                )}

                {/* Side-by-Side Comparison Columns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Left Column: OCR Extracted Transcript */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                      <span className="font-bold text-slate-800 text-xs">AI OCR Extracted Data</span>
                      {ocr.source && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200/70 text-slate-700 font-semibold">
                          {ocr.source}
                        </span>
                      )}
                    </div>

                    {isMarksheet ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Marksheet Score:</span>
                          <strong className="text-blue-700 font-bold text-xs">
                            {ocr.obtainedMarks !== undefined && ocr.obtainedMarks !== null ? ocr.obtainedMarks : '—'} /{' '}
                            {ocr.totalMarks || 1100}
                            {ocr.percentage ? ` (${ocr.percentage}%)` : ''}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Candidate Name:</span>
                          <strong className="text-slate-900 truncate max-w-[200px]">{ocr.candidateName || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Roll Number:</span>
                          <strong className="font-mono text-slate-900 font-bold text-xs">{ocr.rollNumber || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Exam Board:</span>
                          <strong className="text-slate-800 truncate max-w-[200px]">{ocr.boardName || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Result Status:</span>
                          <strong className={ocr.isPass ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                            {ocr.isPass === true ? 'PASS' : ocr.isPass === false ? 'FAIL' : 'NOT CONFIRMED'}
                          </strong>
                        </div>

                        {/* Collapsible Details (Subjects, Registration) */}
                        <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-2">
                          {ocr.subjects && ocr.subjects.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowSubjects((v) => !v)}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-200/70 hover:bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition cursor-pointer"
                            >
                              <span>{ocr.subjects.length} Subjects Breakdown</span>
                              <span className="text-[9px]">{showSubjects ? '▲' : '▼'}</span>
                            </button>
                          )}
                          {(ocr.registrationNumber || ocr.examYear || ocr.fatherName) && (
                            <button
                              type="button"
                              onClick={() => setShowMoreOcr((v) => !v)}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-200/70 hover:bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition cursor-pointer"
                            >
                              <span>Extra Details</span>
                              <span className="text-[9px]">{showMoreOcr ? '▲' : '▼'}</span>
                            </button>
                          )}
                        </div>

                        {/* Subjects Grid */}
                        {showSubjects && ocr.subjects && (
                          <div className="max-h-36 overflow-y-auto rounded-lg bg-white p-2.5 border border-slate-200 space-y-1">
                            {ocr.subjects.map((s, idx) => (
                              <div key={idx} className="flex justify-between text-[11px] text-slate-700">
                                <span className="truncate pr-2">{s.subject}</span>
                                <span className="font-mono font-semibold text-slate-900">{s.obtained} / {s.total}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Extra OCR Fields */}
                        {showMoreOcr && (
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200 text-xs space-y-1.5">
                            {ocr.fatherName && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Father Name:</span>
                                <span className="text-slate-800 font-medium">{ocr.fatherName}</span>
                              </div>
                            )}
                            {ocr.registrationNumber && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Registration Number:</span>
                                <span className="font-mono text-slate-800">{ocr.registrationNumber}</span>
                              </div>
                            )}
                            {ocr.examYear && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Academic Year:</span>
                                <span className="text-slate-800 font-medium">{ocr.examYear}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : activeDoc.doc_type === 'CNIC_FRONT' || activeDoc.doc_type === 'CNIC_BACK' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">CNIC Number:</span>
                          <strong className="font-mono text-blue-700 font-bold text-xs">{ocr.cnic || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Name on Card:</span>
                          <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Father Name:</span>
                          <strong className="text-slate-800">{ocr.fatherName || '—'}</strong>
                        </div>
                        {ocr.dob && (
                          <div className="flex justify-between">
                            <span className="text-slate-500">Date of Birth:</span>
                            <strong className="text-slate-800">{ocr.dob}</strong>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Candidate Name:</span>
                          <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Domicile District:</span>
                          <strong className="text-slate-800 font-bold">{ocr.district || ocr.city || '—'}</strong>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right Column: Official Board Gazette / Source Verification */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                      <span className="font-bold text-slate-800 text-xs">
                        {isMarksheet ? 'Official Board Source Cross-Check' : 'Declared Application Record'}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          portal.isVerified || activeDoc.verification_status === 'MATCHED'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-200/70 text-slate-700'
                        }`}
                      >
                        {portal.isVerified ? 'VERIFIED MATCH' : portal.status || 'READY'}
                      </span>
                    </div>

                    {isMarksheet ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Score:</span>
                          <strong className="text-slate-900 font-bold text-xs">{declaredMarks || '—'} / 1100</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Official Gazette:</span>
                          <strong className="text-emerald-800 font-bold text-xs">
                            {portal.boardMarks ? `${portal.boardMarks} / ${portal.totalMarks || 1100}` : 'No direct match'}
                          </strong>
                        </div>

                        {/* Run Result Check Button */}
                        {ocr?.rollNumber && (
                          <div className="pt-1">
                            <button
                              type="button"
                              disabled={searchingGazetteDocId === activeDoc.document_id}
                              onClick={() => handleSearchGazette(activeDoc.document_id)}
                              className="w-full rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 cursor-pointer shadow-2xs transition"
                            >
                              {searchingGazetteDocId === activeDoc.document_id
                                ? 'Scanning official archives...'
                                : 'Check Official Gazettes & Portals'}
                            </button>
                          </div>
                        )}

                        {/* Official Gazette Match Details */}
                        {portal.status === 'GAZETTE_VERIFIED' && (
                          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-2 text-emerald-950">
                            <div className="font-bold text-emerald-900 flex justify-between text-xs">
                              <span>Official Gazette Match: {portal.boardMarks} Marks</span>
                              {portal.candidateName && <span>({portal.candidateName})</span>}
                            </div>
                            {portal.boardMarks && Number(portal.boardMarks) !== Number(declaredMarks) && (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                  handleDirectMarksOverride({
                                    documentId: activeDoc.document_id,
                                    docType: activeDoc.doc_type,
                                    marks: portal.boardMarks,
                                    sourceLabel: 'official board gazette',
                                  })
                                }
                                className="w-full rounded-lg bg-emerald-700 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer shadow-2xs transition"
                              >
                                Use Official Gazette Score ({portal.boardMarks}) to Override
                              </button>
                            )}
                            {portal.rawSnippet && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setShowRawSnippet((v) => !v)}
                                  className="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer"
                                >
                                  {showRawSnippet ? 'Hide Gazette Line ▲' : 'View Gazette Match Line ▼'}
                                </button>
                                {showRawSnippet && (
                                  <pre className="font-mono text-[10px] bg-white p-2 rounded-lg border border-emerald-200 text-emerald-900 overflow-x-auto mt-1 mb-0 select-all">
                                    {portal.rawSnippet}
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {activeDoc.boardSource?.sourceType === 'GAZETTE' && (
                          <button
                            type="button"
                            onClick={() => openGazette(activeDoc.boardSource.id)}
                            className="text-blue-700 hover:underline font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Gazette PDF: {activeDoc.boardSource.gazetteFilename}</span>
                          </button>
                        )}
                      </>
                    ) : activeDoc.doc_type === 'CNIC_FRONT' || activeDoc.doc_type === 'CNIC_BACK' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared CNIC:</span>
                          <strong className="font-mono text-slate-800 text-xs">{student?.cnic || 'N/A'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Name:</span>
                          <strong className="text-slate-800">{student?.full_name || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Father:</span>
                          <strong className="text-slate-800">{student?.father_name || '—'}</strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Name:</span>
                          <strong className="text-slate-800">{student?.full_name || '—'}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">City in Database:</span>
                          <strong className="text-slate-800 font-bold">{student?.city || 'Not recorded'}</strong>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Staff Review Audit Note with Presets */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5 text-xs shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">Staff Review Audit Note:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Evidence Checked:</span>
                <select
                  value={reviewMethod}
                  onChange={(e) => setReviewMethod(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                >
                  <option value="STAFF_DOCUMENT">Original document</option>
                  <option value="STAFF_PORTAL">Official board portal</option>
                  <option value="STAFF_GAZETTE">Board gazette</option>
                </select>
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Presets:</span>
              {REVIEW_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setReviewNotes(preset)}
                  className="rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-transparent px-2.5 py-1 text-xs text-slate-600 transition cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Record your audit observations or verified document evidence..."
              maxLength={1000}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Section 5: Manual Marks Override Drawer (if activated) */}
          {showOverrideInputs && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-xs space-y-3 shadow-xs">
              <span className="font-bold text-blue-900 text-sm block">Manual Marks Override Form</span>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Verified FSc Marks</label>
                  <input
                    type="number"
                    value={overrideMarks.fsc}
                    onChange={(e) => setOverrideMarks((prev) => ({ ...prev, fsc: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Verified Matric Marks</label>
                  <input
                    type="number"
                    value={overrideMarks.matric}
                    onChange={(e) => setOverrideMarks((prev) => ({ ...prev, matric: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleOverride} disabled={actionLoading}>
                  Save & Verify Candidate
                </Button>
                <Button size="sm" variant="subtle" onClick={() => setShowOverrideInputs(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Section 6: Candidate Lifecycle & Audit Trail (Collapsible Drawer) */}
          {timelineExpanded && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 text-xs shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <span className="font-bold text-slate-800 text-sm">Candidate Lifecycle & Audit Trail</span>
                <button
                  type="button"
                  onClick={() => setTimelineExpanded(false)}
                  className="text-xs text-blue-600 hover:underline cursor-pointer"
                >
                  Hide Timeline ▲
                </button>
              </div>
              <div className="border-l-2 border-slate-200 ml-3 pl-4 space-y-3 max-h-56 overflow-y-auto">
                {(dossier?.timeline || []).length === 0 ? (
                  <p className="text-slate-400 italic py-2">No lifecycle events recorded yet.</p>
                ) : (
                  (dossier?.timeline || []).map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute -left-[21px] top-1 size-2.5 rounded-full border border-slate-400 bg-white" />
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{event.title}</span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
                      </div>
                      {event.description && (
                        <p className="mb-0 mt-0.5 text-xs text-slate-600">{event.description}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Bottom Action Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!showOverrideInputs && (
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setShowOverrideInputs(true)}
                  disabled={actionLoading}
                  className="border border-slate-200 bg-white text-xs font-semibold"
                >
                  Override Marks
                </Button>
              )}
              <Button
                variant="subtle"
                size="sm"
                onClick={handleRejectReissue}
                disabled={actionLoading || !activeDoc}
                className="border border-slate-200 bg-white text-rose-700 hover:bg-rose-50 hover:border-rose-200 text-xs font-semibold"
              >
                Reject & Reissue
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={handleMarkDiscrepancy}
                disabled={actionLoading || !activeDoc}
                className="border border-slate-200 bg-white text-amber-800 hover:bg-amber-50 text-xs font-semibold"
              >
                Mark Discrepancy
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setTimelineExpanded((v) => !v)}
                className="border border-slate-200 bg-white text-slate-600 text-xs font-semibold"
              >
                Timeline ({(dossier?.timeline || []).length}) {timelineExpanded ? '▲' : '▼'}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="subtle" size="sm" onClick={() => handleBack()} className="text-xs">
                Back to Queue
              </Button>
              {isCandidateOverallVerified ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleBack('VERIFIED')}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-5 py-2 rounded-xl shadow-2xs"
                >
                  View in Verified Filter →
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                  disabled={actionLoading || !activeDoc}
                  className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold px-5 py-2 rounded-xl"
                >
                  {actionLoading ? 'Approving...' : 'Approve Document'}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Confirmation & Prompt Dialogs */}
      {confirmModal && (
        <ConfirmDialog
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          tone={confirmModal.tone}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {promptModal && (
        <PromptDialog
          isOpen={promptModal.isOpen}
          title={promptModal.title}
          message={promptModal.message}
          placeholder={promptModal.placeholder}
          initialValue={promptModal.initialValue}
          presets={promptModal.presets}
          confirmLabel={promptModal.confirmLabel}
          onConfirm={promptModal.onConfirm}
          onCancel={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}

// Backward-compatibility export
export { StudentDossierView as StudentDossierModal };
