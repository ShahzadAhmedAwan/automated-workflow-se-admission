import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button } from '../../core/ui/primitives.jsx';
import { IconDocumentCheck, IconShield } from '../../core/icons/Icons.jsx';

const DOC_LABELS = {
  MATRIC_MARKSHEET: 'Matric / SSC Marksheet (Result Card)',
  FSC_MARKSHEET: 'FSc / HSSC Intermediate Marksheet',
  CNIC_FRONT: 'CNIC / B-Form (Front Side)',
  CNIC_BACK: 'CNIC / B-Form (Back Side)',
  DOMICILE: 'State Domicile Certificate',
  EQUIVALENCE_CERTIFICATE: 'IBCC Equivalence Certificate (O/A Level)',
  OTHER: 'Supplementary Educational Document',
};

export function PublicUploadPortal({ token }) {
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState(null);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState({});
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setError(null);
        const data = await verificationApi.validateToken(token);
        setTokenData(data);
      } catch (err) {
        setError(err.message || 'Invalid or expired upload link.');
      } finally {
        setLoading(false);
      }
    }
    if (token) init();
  }, [token]);

  function handleFileChange(docType, file) {
    if (!file) {
      setFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert(`File size exceeds 5MB ceiling (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please upload a smaller file.`);
      return;
    }

    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.mimetype || file.type)) {
      alert('Only JPEG, PNG images and PDF documents are allowed.');
      return;
    }

    setFiles((prev) => ({
      ...prev,
      [docType]: file,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (Object.keys(files).length === 0) {
      alert('Please select at least one document to upload.');
      return;
    }

    try {
      setSubmitting(true);
      const formData = new FormData();
      for (const [docType, file] of Object.entries(files)) {
        formData.append(docType, file);
      }
      if (remarks) {
        formData.append('remarks', remarks);
      }

      await verificationApi.submitDocuments(token, formData);
      setSuccess(true);
    } catch (err) {
      alert(err.message || 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-content-center justify-items-center gap-3 bg-[#f8fafc] text-slate-500">
        <span className="size-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
        <p className="text-sm font-medium">Validating secure upload link…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center shadow-lg sm:p-8">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">Upload Link Unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-400">
            If you believe this is an error, please contact the SE Admissions Office via WhatsApp.
          </div>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-white p-6 text-center shadow-lg sm:p-8">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <IconDocumentCheck className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Documents Submitted!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thank you, <strong className="text-slate-900">{tokenData.maskedFullName}</strong>. Your documents have been safely received.
          </p>
          <p className="mt-2 rounded-lg bg-emerald-50/60 p-3 text-xs text-emerald-800">
            Our automated AI verification system and admissions team are now reviewing your submission. You will receive an update via WhatsApp once processed.
          </p>
          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-400">
            Single-use link has been safely consumed. Reference: #{tokenData.studentId}
          </div>
        </div>
      </main>
    );
  }

  const allowedDocs = tokenData.allowedDocTypes || ['FSC_MARKSHEET'];
  const expiresDate = new Date(tokenData.expiresAt).toLocaleString();

  return (
    <div className="min-h-screen bg-[#f4f7fb] py-8 text-slate-800 sm:py-12">
      <div className="mx-auto w-full max-w-2xl px-4">
        {/* Header banner */}
        <header className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <img src="/department-logo.png" alt="Department logo" className="size-12 object-contain" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Department of Software Engineering</p>
              <h1 className="text-base font-bold text-slate-900 sm:text-lg">Document Verification Portal</h1>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 sm:inline-flex">
            <IconShield className="size-3.5" />
            Secure Single-Use
          </span>
        </header>

        {/* Applicant Context Card */}
        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 pb-3">
            <div>
              <span className="text-slate-500">Applicant: </span>
              <strong className="text-slate-900">{tokenData.maskedFullName}</strong>
            </div>
            {tokenData.applicationNo && (
              <div>
                <span className="text-slate-500">Application #: </span>
                <strong className="font-mono text-slate-900">{tokenData.applicationNo}</strong>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-[11px] text-slate-600">
            <span>Submission Attempt: <strong>#{tokenData.attemptCount}</strong></span>
            <span>Link Expires: <strong className="text-amber-700">{expiresDate}</strong></span>
          </div>
        </div>

        {/* Form container */}
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-sm font-bold text-slate-900">Required Documents</h2>
          <p className="mt-1 text-xs text-slate-500">
            Upload clear, high-resolution photos or scanned PDF files (max 5MB each). Ensure student name, roll number, and obtained marks are clearly visible.
          </p>

          <div className="mt-6 space-y-4">
            {allowedDocs.map((docType) => {
              const label = DOC_LABELS[docType] || docType.replace(/_/g, ' ');
              const selectedFile = files[docType];

              return (
                <div key={docType} className="rounded-lg border border-slate-200 p-4 transition-colors hover:border-blue-300">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`file-${docType}`} className="cursor-pointer text-xs font-semibold text-slate-800">
                      {label}
                      <span className="ml-1 text-rose-500">*</span>
                    </label>
                    {selectedFile && (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Selected
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    {selectedFile ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs">
                        <span className="truncate font-medium text-slate-700">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                        <button
                          type="button"
                          onClick={() => handleFileChange(docType, null)}
                          className="shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-800"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor={`file-${docType}`}
                        className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-200 bg-slate-50/60 p-4 text-center transition-colors hover:bg-blue-50/40 hover:border-blue-300"
                      >
                        <span className="text-xs font-medium text-blue-700">Click to browse or drag file here</span>
                        <span className="mt-1 text-[10px] text-slate-400">JPEG, PNG or PDF up to 5MB</span>
                        <input
                          id={`file-${docType}`}
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          className="hidden"
                          onChange={(e) => handleFileChange(docType, e.target.files?.[0] || null)}
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6">
            <label htmlFor="remarks" className="block text-xs font-medium text-slate-700">
              Additional remarks or notes (optional)
            </label>
            <textarea
              id="remarks"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. My FSc Part 2 marks are improvement marks."
              className="mt-1.5 w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <Button
              type="submit"
              disabled={submitting || Object.keys(files).length === 0}
              className="w-full text-xs font-semibold"
            >
              {submitting ? 'Encrypting & Submitting…' : 'Submit Documents for Verification'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
