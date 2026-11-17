import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button } from '../../core/ui/primitives.jsx';
import {
  IconDocumentCheck,
  IconShield,
  IconUploadCloud,
  IconEye,
  IconClose,
} from '../../core/icons/Icons.jsx';

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
  const [previews, setPreviews] = useState({});
  const [lightboxImage, setLightboxImage] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [draggingDocType, setDraggingDocType] = useState(null);
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

    return () => {
      // Clean up any object URLs on component unmount
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [token]);

  function handleFileChange(docType, file) {
    setFormError('');
    if (!file) {
      if (previews[docType]) {
        URL.revokeObjectURL(previews[docType]);
        setPreviews((prev) => {
          const next = { ...prev };
          delete next[docType];
          return next;
        });
      }
      setFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFormError(`"${file.name}" is larger than 5 MB. Please choose a smaller file.`);
      return;
    }

    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.mimetype || file.type)) {
      setFormError('Choose a JPEG, PNG or PDF file.');
      return;
    }

    // Clean up previous preview URL if any
    if (previews[docType]) {
      URL.revokeObjectURL(previews[docType]);
    }

    // Generate instant local thumbnail preview for image documents
    if (file.type?.startsWith('image/')) {
      const previewUrl = URL.createObjectURL(file);
      setPreviews((prev) => ({
        ...prev,
        [docType]: previewUrl,
      }));
    } else {
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
    }

    setFiles((prev) => ({
      ...prev,
      [docType]: file,
    }));
  }

  function handleDrop(docType, event) {
    event.preventDefault();
    setDraggingDocType(null);
    handleFileChange(docType, event.dataTransfer.files?.[0] || null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (Object.keys(files).length === 0) {
      setFormError('Choose at least one requested document before submitting.');
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
      setFormError(err.message || 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-content-center justify-items-center gap-4 bg-[#f4f7fb] px-4 text-slate-500">
        <span className="grid size-12 place-items-center rounded-2xl border border-blue-100 bg-white text-blue-700 shadow-sm">
          <span className="size-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
        </span>
        <p className="text-sm font-medium">Validating your secure upload link…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_12px_36px_rgba(20,48,82,0.08)] sm:p-8">
          <img src="/department-logo.png" alt="Department of Software Engineering" className="mx-auto mb-6 size-12 object-contain" />
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
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_12px_36px_rgba(20,48,82,0.08)] sm:p-8">
          <img src="/department-logo.png" alt="Department of Software Engineering" className="mx-auto mb-6 size-12 object-contain" />
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <IconDocumentCheck className="size-7" />
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
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-800 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_2px_8px_rgba(20,30,50,0.035)] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/department-logo.png" alt="Department of Software Engineering" className="size-11 shrink-0 object-contain" />
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-blue-700 sm:text-[10px]">Department of Software Engineering</p>
              <h1 className="m-0 text-sm font-bold leading-tight tracking-[-.02em] text-slate-900 sm:text-base">Document Verification Portal</h1>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[10px] font-semibold text-blue-700 sm:px-3 sm:text-[11px]">
            <IconShield className="size-3.5" />
            <span className="sm:hidden">Secure</span>
            <span className="hidden sm:inline">Secure single-use</span>
          </span>
        </header>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(20,30,50,0.025)] sm:p-5" aria-label="Applicant and link details">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.09em] text-slate-500">Applicant</p>
              <p className="m-0 truncate text-sm font-semibold text-slate-900">{tokenData.maskedFullName}</p>
            </div>
            {tokenData.applicationNo && <div className="text-right">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.09em] text-slate-500">Application no.</p>
              <p className="m-0 font-mono text-xs font-semibold text-slate-900">{tokenData.applicationNo}</p>
            </div>}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11px]">
            <span className="text-slate-500">Submission attempt <strong className="ml-1 font-semibold text-slate-800">#{tokenData.attemptCount}</strong></span>
            <span className="text-slate-500">Link expires <strong className="ml-1 font-semibold text-amber-700">{expiresDate}</strong></span>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_rgba(20,48,82,0.055)]">
          <div className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <IconUploadCloud className="size-[18px]" />
              </span>
              <div>
                <h2 className="m-0 text-sm font-bold tracking-[-.01em] text-slate-900">Documents to upload</h2>
                <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">
                  Upload at least one requested document. Use a clear photo or scan where your name, roll number and marks are readable.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-slate-500">
              <span>JPEG, PNG or PDF</span>
              <span>Maximum 5 MB per file</span>
            </div>
          </div>

          <div className="space-y-3 px-5 pb-5 sm:px-6">
            {allowedDocs.map((docType) => {
              const label = DOC_LABELS[docType] || docType.replace(/_/g, ' ');
              const selectedFile = files[docType];

              return (
                <div key={docType} className="rounded-xl border border-slate-200 p-3.5 transition-colors hover:border-blue-200 sm:p-4">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <label htmlFor={`file-${docType}`} className="text-xs font-semibold text-slate-800">{label}</label>
                    {selectedFile && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Added
                    </span>}
                  </div>

                  {selectedFile ? (
                    <div className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 sm:p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {previews[docType] ? (
                          <button
                            type="button"
                            onClick={() => setLightboxImage({ url: previews[docType], title: label })}
                            className="group relative size-12 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-emerald-300/90 bg-white shadow-xs transition hover:ring-2 hover:ring-blue-400"
                            title="Click to inspect photo in full resolution"
                          >
                            <img
                              src={previews[docType]}
                              alt={label}
                              className="size-full object-cover transition-transform duration-200 group-hover:scale-110"
                            />
                            <span className="absolute inset-0 grid place-items-center bg-slate-950/30 opacity-0 transition-opacity group-hover:opacity-100">
                              <IconEye className="size-4 text-white" />
                            </span>
                          </button>
                        ) : selectedFile.type === 'application/pdf' ? (
                          <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700 shadow-xs">
                            PDF
                          </span>
                        ) : (
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-emerald-700 shadow-xs">
                            <IconDocumentCheck className="size-5" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="m-0 truncate text-xs font-semibold text-slate-800">{selectedFile.name}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{(selectedFile.size / 1024).toFixed(0)} KB</span>
                            {previews[docType] && (
                              <button
                                type="button"
                                onClick={() => setLightboxImage({ url: previews[docType], title: label })}
                                className="inline-flex items-center gap-0.5 font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                              >
                                <IconEye className="size-3" />
                                Inspect photo
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleFileChange(docType, null)}
                        className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-40"
                        aria-label={`Remove ${label}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label
                      htmlFor={`file-${docType}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDraggingDocType(docType);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setDraggingDocType(null);
                      }}
                      onDrop={(event) => handleDrop(docType, event)}
                      className={`relative flex min-h-[92px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ${
                        draggingDocType === docType
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-slate-300 bg-slate-50/70 hover:border-blue-300 hover:bg-blue-50/50'
                      }`}
                    >
                      <IconUploadCloud className="mb-1.5 size-5 text-blue-600" />
                      <span className="text-xs font-semibold text-blue-700">Choose a file <span className="font-normal text-slate-500">or drag it here</span></span>
                      <input
                        id={`file-${docType}`}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                        onChange={(event) => handleFileChange(docType, event.target.files?.[0] || null)}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
            <label htmlFor="remarks" className="block text-xs font-semibold text-slate-700">Additional notes <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea
              id="remarks"
              rows={2}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Add any details that may help with your document review."
              className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
            {formError && <p className="mb-0 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-800" role="alert">{formError}</p>}
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 flex items-center gap-1.5 text-[10px] leading-4 text-slate-500">
                <IconShield className="size-3.5 shrink-0 text-blue-600" />
                Your documents are shared securely with admissions.
              </p>
              <Button
                type="submit"
                disabled={submitting}
                className="min-h-10 w-full rounded-lg px-5 text-xs font-semibold shadow-sm sm:w-auto"
              >
                {submitting ? 'Encrypting & submitting…' : 'Submit for verification'}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Full-Screen Document Image Lightbox Modal */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div>
                <h3 className="m-0 text-sm font-bold text-slate-900">{lightboxImage.title}</h3>
                <p className="mb-0 mt-0.5 text-[11px] text-slate-500">Ensure text, roll number, and marks breakdown are clearly readable</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close preview"
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center overflow-auto bg-slate-950/5 p-4">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title}
                className="max-h-[65vh] w-auto max-w-full rounded-lg object-contain shadow-xs"
              />
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3">
              <span className="text-[11px] text-slate-500">If text is blurry or cropped, please remove and take a clearer photo.</span>
              <Button variant="subtle" onClick={() => setLightboxImage(null)}>
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
