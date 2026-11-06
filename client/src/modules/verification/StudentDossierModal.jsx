import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button, StatusBadge } from '../../core/ui/primitives.jsx';
import { IconDocumentCheck, IconShield } from '../../core/icons/Icons.jsx';

export function StudentDossierModal({ studentId, isOpen, onClose, onActionComplete }) {
  const [loading, setLoading] = useState(true);
  const [dossier, setDossier] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showOverrideInputs, setShowOverrideInputs] = useState(false);
  const [overrideMarks, setOverrideMarks] = useState({ fsc: '', matric: '' });
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [reviewMethod, setReviewMethod] = useState('STAFF_DOCUMENT');
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    async function load() {
      if (!studentId || !isOpen) return;
      try {
        setLoading(true);
        const data = await verificationApi.fetchStudentDossier(studentId);
        setDossier(data);
        setOverrideMarks({
          fsc: data.student.fsc_obtained_marks || '',
          matric: data.student.matric_obtained_marks || '',
        });
        const target = data.documents.find((document) => document.verification_status !== 'MATCHED') || data.documents[0];
        setSelectedDocumentId(target ? String(target.document_id) : '');
        setReviewMethod('STAFF_DOCUMENT');
        setReviewNotes('');
      } catch (err) {
        alert(err.message || 'Could not load student verification dossier.');
        onClose();
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [studentId, isOpen, onClose]);

  if (!isOpen) return null;

  async function handleApprove() {
    if (!selectedDocumentId) return alert('Select a document to review.');
    if (!reviewNotes.trim()) return alert('Add a short note describing the evidence you checked.');
    if (!confirm('Record this document as verified? The candidate is marked complete only after all required documents are verified.')) return;
    try {
      setActionLoading(true);
      const result = await verificationApi.executeReviewAction(studentId, {
        action: 'APPROVE',
        studentId,
        documentId: Number(selectedDocumentId),
        reviewMethod,
        notes: reviewNotes.trim(),
      });
      alert(result.overall_status === 'VERIFIED'
        ? 'Document reviewed. Candidate verification is complete.'
        : 'Document reviewed. The candidate remains in review until all required documents are complete.');
      onActionComplete?.();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to approve candidate.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleOverride() {
    if (!selectedDocumentId || !reviewNotes.trim()) return alert('Select a document and add a verification note.');
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
      alert(result.overall_status === 'VERIFIED'
        ? 'Marks saved. Candidate verification is complete.'
        : 'Marks saved. The candidate remains in review until all documents are complete.');
      onActionComplete?.();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to override marks.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectReissue() {
    if (!selectedDocumentId) return alert('Select the document that needs a replacement.');
    const reason = prompt('Enter the reason to send to the student:', 'The uploaded document could not be verified. Please upload a clearer copy.');
    if (!reason) return;

    try {
      setActionLoading(true);
      await verificationApi.executeReviewAction(studentId, {
        action: 'REJECT_AND_REISSUE',
        studentId,
        documentId: Number(selectedDocumentId),
        reviewMethod,
        notes: reason,
      });
      alert('Token reissued and notification queued.');
      onActionComplete?.();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to reissue token.');
    } finally {
      setActionLoading(false);
    }

  }

  async function handleMarkDiscrepancy() {
    if (!selectedDocumentId) return alert('Select a document to review.');
    const discrepancyReason = prompt('Describe the discrepancy for the review record:');
    if (!discrepancyReason?.trim()) return;
    try {
      setActionLoading(true);
      await verificationApi.executeReviewAction(studentId, { action: 'MARK_DISCREPANCY', studentId, documentId: Number(selectedDocumentId), reviewMethod, discrepancyReason: discrepancyReason.trim() });
      alert('Discrepancy recorded for staff review.');
      onActionComplete?.();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to record discrepancy.');
    } finally {
      setActionLoading(false);
    }
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
      alert(error.message || 'Could not open the board gazette.');
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
      alert(error.message || 'Could not open the candidate document.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-blue-100 text-blue-700">
              <IconDocumentCheck className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {student ? `${student.full_name} — Verification Dossier` : 'Loading Dossier…'}
              </h2>
              <p className="text-[11px] text-slate-500">
                {student?.application_no ? `App #${student.application_no}` : ''} | CNIC: {student?.cnic || 'N/A'} | Phone: {student?.phone_normalized}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid place-content-center py-16 text-slate-400">
              <span className="mx-auto size-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
              <p className="mt-3 text-xs">Retrieving candidate records and OCR transcripts…</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Declared FSc</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{student?.fsc_obtained_marks || '—'} / 1100</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Declared Matric</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{student?.matric_obtained_marks || '—'} / 1100</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</span>
                  <p className="mt-1 text-xs font-bold text-blue-700">{student?.overall_status}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Documents</span>
                  <p className="mt-1 text-base font-bold text-slate-900">{documents.length} Uploaded</p>
                </div>
              </div>
              {student?.verified_by_name && (
                <p className="m-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Verified by <strong>{student.verified_by_name}</strong>
                  {student.verified_at ? ` · ${new Date(student.verified_at).toLocaleString()}` : ''}
                </p>
              )}

              {/* Discrepancy Note banner if any */}
              {student?.discrepancy_notes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
                  <strong className="font-semibold">Audit Discrepancy History:</strong>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-amber-800">{student.discrepancy_notes}</pre>
                </div>
              )}

              {/* Uploaded Documents List & Side-by-Side OCR comparison */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Document Transcripts & OCR Analysis</h3>

                {documents.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No documents uploaded yet by this candidate.
                  </p>
                ) : (
                  documents.map((doc) => {
                    const ocr = doc.extractedData || {};
                    const portal = doc.portalVerificationData || {};

                    return (
                      <div key={doc.document_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-xs font-bold text-slate-800">{doc.doc_type.replace(/_/g, ' ')}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-slate-500">{doc.verification_status}</span>
                            <button type="button" onClick={() => openStudentDocument(doc.document_id)} className="rounded px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50">
                              View original
                            </button>
                            <button type="button" onClick={() => setSelectedDocumentId(String(doc.document_id))} className={`rounded px-2 py-1 text-[10px] font-semibold ${String(doc.document_id) === selectedDocumentId ? 'bg-blue-100 text-blue-800' : 'text-blue-700 hover:bg-blue-50'}`}>
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
                          <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs space-y-1.5">
                            <p className="font-bold text-slate-700">AI OCR Extracted Data</p>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Name:</span>
                              <strong className="text-slate-800">{ocr.candidateName || '—'}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Roll No:</span>
                              <strong className="font-mono text-slate-800">{ocr.rollNumber || '—'}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Board:</span>
                              <strong className="text-slate-800">{ocr.boardName || '—'}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Obtained Marks:</span>
                              <strong className="text-blue-700">{ocr.obtainedMarks || '—'} / {ocr.totalMarks || 1100}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Result Status:</span>
                              <strong className={ocr.isPass ? 'text-emerald-700' : 'text-rose-600'}>
                                {ocr.isPass === true ? 'PASS' : ocr.isPass === false ? 'FAIL' : 'NOT CONFIRMED'}
                              </strong>
                            </div>
                          </div>

                          {/* Right: Board Verification Outcome */}
                          <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs space-y-1.5">
                            <p className="font-bold text-slate-700">Board result check</p>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Status:</span>
                              <strong className="text-slate-800">{portal.status || 'NOT_QUERIED'}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Portal Verified:</span>
                              <strong className={portal.isVerified ? 'text-emerald-700' : 'text-amber-700'}>
                                {portal.isVerified ? 'VERIFIED MATCH' : 'NO DIRECT MATCH'}
                              </strong>
                            </div>
                            {portal.boardMarks && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Portal Marks:</span>
                                <strong className="text-slate-800">{portal.boardMarks}</strong>
                              </div>
                            )}
                            {doc.boardSource?.sourceType === 'PORTAL_URL' && (
                              <a href={doc.boardSource.resultUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex font-semibold text-blue-700 hover:underline">
                                Open {doc.boardSource.boardName} result page ↗
                              </a>
                            )}
                            {doc.boardSource?.sourceType === 'GAZETTE' && (
                              <button type="button" onClick={() => openGazette(doc.boardSource.id)} className="mt-2 inline-flex font-semibold text-blue-700 hover:underline">
                                Open gazette: {doc.boardSource.gazetteFilename} ↗
                              </button>
                            )}
                            {!doc.boardSource && <p className="mb-0 mt-2 text-[10px] text-slate-500">No board source is configured for this result. Check the original document and record your evidence in the review note.</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                <h4 className="m-0 text-xs font-bold text-slate-800">Record your review</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-700">
                    Document
                    <select value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)} className="mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                      <option value="">Select a document</option>
                      {documents.map((document) => <option key={document.document_id} value={document.document_id}>{document.doc_type.replace(/_/g, ' ')} · {document.verification_status}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Evidence checked
                    <select value={reviewMethod} onChange={(event) => setReviewMethod(event.target.value)} className="mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                      <option value="STAFF_DOCUMENT">Original document</option>
                      <option value="STAFF_PORTAL">Official board portal</option>
                      <option value="STAFF_GAZETTE">Board gazette</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                    Review note
                    <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} maxLength={1000} rows={2} placeholder="Record what you checked and the result." className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" />
                  </label>
                </div>
              </section>

              {/* Override Inputs (toggled) */}
              {showOverrideInputs && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 text-xs">
                  <h4 className="font-bold text-blue-900">Manual Marks Override</h4>
                <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600">Verified FSc Marks</label>
                      <input
                        type="number"
                        value={overrideMarks.fsc}
                        onChange={(e) => setOverrideMarks((prev) => ({ ...prev, fsc: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600">Verified Matric Marks</label>
                      <input
                        type="number"
                        value={overrideMarks.matric}
                        onChange={(e) => setOverrideMarks((prev) => ({ ...prev, matric: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-slate-600">Audit Justification Notes</label>
                    <input
                      type="text"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="e.g. Verified with original FBISE gazette copy"
                      className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs"
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
    </div>
  );
}
