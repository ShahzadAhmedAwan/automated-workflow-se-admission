import { useState, useEffect } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button } from '../../core/ui/primitives.jsx';
import {
  IconDocumentCheck,
  IconShield,
  IconUploadCloud,
  IconEye,
  IconClose,
  IconCheck,
  IconAlertTriangle,
} from '../../core/icons/Icons.jsx';

const DOC_METADATA = {
  MATRIC_MARKSHEET: {
    title: 'Matric / SSC Marksheet (Result Card)',
    hint: 'Official board marksheet showing your roll number, total marks, and passing grade.',
  },
  FSC_MARKSHEET: {
    title: 'FSc / HSSC Intermediate Marksheet',
    hint: 'Part-II final marksheet or complete transcript with official board controller seal.',
  },
  CNIC_FRONT: {
    title: 'CNIC / B-Form (Front Side)',
    hint: 'Clear, uncropped photo of your National Identity Card or Smart B-Form front side.',
  },
  CNIC_BACK: {
    title: 'CNIC / B-Form (Back Side)',
    hint: 'Clear, uncropped photo of your National Identity Card back side.',
  },
  DOMICILE: {
    title: 'State Domicile Certificate',
    hint: 'Official district magistrate domicile certificate.',
  },
  EQUIVALENCE_CERTIFICATE: {
    title: 'IBCC Equivalence Certificate',
    hint: 'Official IBCC equivalence certificate for O/A Level candidates.',
  },
  OTHER: {
    title: 'Supplementary Educational Document',
    hint: 'Any supporting certificate or official document requested by admissions staff.',
  },
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
      setFormError('Please choose a valid JPEG, PNG or PDF file.');
      return;
    }

    if (previews[docType]) {
      URL.revokeObjectURL(previews[docType]);
    }

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
      setFormError('Please choose at least one requested document before submitting.');
      return;
    }

    try {
      setSubmitting(true);
      const formData = new FormData();
      for (const [docType, file] of Object.entries(files)) {
        formData.append(docType, file);
      }
      if (remarks.trim()) {
        formData.append('remarks', remarks.trim());
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
      <main className="grid min-h-screen place-content-center justify-items-center gap-4 bg-[#f8fafc] px-4 text-slate-500">
        <span className="grid size-12 place-items-center rounded-2xl border border-slate-200 bg-white text-blue-700 shadow-xs">
          <span className="size-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
        </span>
        <p className="text-xs font-semibold text-slate-600">Validating your secure upload link...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs sm:p-8">
          <img src="/department-logo.png" alt="Department of Software Engineering" className="mx-auto mb-5 size-14 object-contain" />
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600 border border-rose-100 mb-4">
            <IconAlertTriangle className="size-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 m-0">Upload Link Unavailable</h1>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">{error}</p>
          <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-3.5 text-xs text-slate-600 text-left">
            <p className="m-0 font-semibold text-slate-800">Need a fresh upload link?</p>
            <p className="mt-1 text-[11px] text-slate-500 leading-normal mb-0">
              If your link has expired or you need to replace a document, reply directly to the Admissions WhatsApp chat to request a new link.
            </p>
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4 text-[10px] text-slate-400">
            Department of Software Engineering Admissions Desk
          </div>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs sm:p-8">
          <img src="/department-logo.png" alt="Department of Software Engineering" className="mx-auto mb-5 size-14 object-contain" />
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 mb-4">
            <IconDocumentCheck className="size-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 m-0">Documents Submitted!</h1>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Thank you, <strong className="text-slate-900">{tokenData.maskedFullName}</strong>. Your documents have been safely received by the Admissions Office.
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-4 text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Application Reference:</span>
              <strong className="font-mono text-slate-800">{tokenData.applicationNo || `#${tokenData.studentId}`}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status:</span>
              <span className="font-semibold text-blue-700">Under Review</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Target Program:</span>
              <span className="font-semibold text-slate-800">B.Sc. Software Engineering</span>
            </div>
          </div>
          <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
            Our automated OCR system and admissions staff are now cross-verifying your submission with official board gazettes. You will receive a notification on WhatsApp once verified.
          </p>
          <div className="mt-6 border-t border-slate-100 pt-4 text-[10px] text-slate-400">
            This single-use upload link has been safely consumed. Reference: #{tokenData.studentId}
          </div>
        </div>
      </main>
    );
  }

  const allowedDocs = tokenData.allowedDocTypes || ['FSC_MARKSHEET'];
  const expiresDate = new Date(tokenData.expiresAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 text-slate-800 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        {/* Centered Institutional Header */}
        <div className="text-center mb-6">
          <img
            src="/department-logo.png"
            alt="Department of Software Engineering"
            className="mx-auto size-14 object-contain mb-3 drop-shadow-2xs"
          />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 m-0">
            Document Verification Portal
          </h1>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            Department of Software Engineering · Fall 2026 Intake
          </p>
        </div>

        {/* Main Upload Card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {/* Applicant Summary Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                Applicant
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <strong className="text-sm font-bold text-slate-900">
                  {tokenData.maskedFullName}
                </strong>
                {tokenData.applicationNo && (
                  <span className="rounded bg-slate-200/70 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-slate-700">
                    {tokenData.applicationNo}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200/80 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                <IconShield className="size-3 text-blue-600" />
                <span>Secure Link</span>
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 m-0">
                    Required Documents ({allowedDocs.length})
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                    Upload clear photos or PDF scans. Please ensure roll numbers and marks are readable.
                  </p>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">
                  Valid until: {expiresDate}
                </span>
              </div>

              {/* Document Items List */}
              <div className="space-y-3.5 pt-1">
                {allowedDocs.map((docType) => {
                  const docDef = DOC_METADATA[docType] || {
                    title: docType.replace(/_/g, ' '),
                    hint: 'Please upload a clear photo or PDF scan.',
                  };
                  const selectedFile = files[docType];

                  return (
                    <div key={docType} className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 bg-white">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <label htmlFor={`file-${docType}`} className="text-xs font-bold text-slate-900 block cursor-pointer">
                            {docDef.title}
                          </label>
                          <p className="mt-0.5 text-[11px] text-slate-500 leading-normal mb-0">
                            {docDef.hint}
                          </p>
                        </div>
                        {selectedFile ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 shrink-0">
                            <IconCheck className="size-3 text-emerald-600" />
                            <span>Added</span>
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shrink-0">
                            Required
                          </span>
                        )}
                      </div>

                      {selectedFile ? (
                        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 sm:p-3">
                          <div className="flex min-w-0 items-center gap-3">
                            {previews[docType] ? (
                              <button
                                type="button"
                                onClick={() => setLightboxImage({ url: previews[docType], title: docDef.title })}
                                className="group relative size-12 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-emerald-300 bg-white shadow-2xs"
                                title="Click to zoom and verify photo clarity"
                              >
                                <img
                                  src={previews[docType]}
                                  alt={docDef.title}
                                  className="size-full object-cover transition group-hover:scale-105"
                                />
                                <span className="absolute inset-0 grid place-items-center bg-slate-950/30 opacity-0 transition-opacity group-hover:opacity-100">
                                  <IconEye className="size-4 text-white" />
                                </span>
                              </button>
                            ) : selectedFile.type === 'application/pdf' ? (
                              <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700">
                                PDF
                              </span>
                            ) : (
                              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-emerald-700 shadow-2xs">
                                <IconDocumentCheck className="size-5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="m-0 truncate text-xs font-semibold text-slate-900">{selectedFile.name}</p>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                                <span>{(selectedFile.size / 1024).toFixed(0)} KB</span>
                                {previews[docType] && (
                                  <button
                                    type="button"
                                    onClick={() => setLightboxImage({ url: previews[docType], title: docDef.title })}
                                    className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                  >
                                    <IconEye className="size-3" />
                                    <span>Zoom check</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleFileChange(docType, null)}
                            className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 transition cursor-pointer disabled:opacity-40"
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
                          className={`mt-2 flex min-h-[92px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-3.5 text-center transition ${
                            draggingDocType === docType
                              ? 'border-blue-500 bg-blue-50/70'
                              : 'border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/30'
                          }`}
                        >
                          <IconUploadCloud className="size-5 text-blue-600 mb-1" />
                          <span className="text-xs font-semibold text-slate-800">
                            <span className="text-blue-700 hover:underline">Choose a file</span> or take a photo
                          </span>
                          <span className="mt-0.5 text-[10px] text-slate-400">
                            JPEG, PNG or PDF (up to 5 MB)
                          </span>
                          <input
                            id={`file-${docType}`}
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            className="sr-only"
                            onChange={(event) => handleFileChange(docType, event.target.files?.[0] || null)}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Form Footer */}
            <div className="border-t border-slate-100 bg-slate-50/60 p-5 sm:p-6 space-y-4">
              <div>
                <label htmlFor="remarks" className="block text-xs font-semibold text-slate-700 mb-1">
                  Additional notes or comments <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="remarks"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any details regarding your marks, roll number, or board..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>

              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex items-center gap-2">
                  <IconAlertTriangle className="size-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <IconShield className="size-3.5 text-blue-600 shrink-0" />
                  <span>256-Bit Encrypted Transfer · Verified against official gazettes</span>
                </span>
                <Button
                  type="submit"
                  disabled={submitting || Object.keys(files).length === 0}
                  className="min-h-10 px-6 text-xs font-bold shadow-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl w-full sm:w-auto"
                >
                  {submitting ? 'Submitting & Encrypting...' : 'Submit for Verification'}
                </Button>
              </div>
            </div>
          </form>
        </div>

        {/* Assistance Footer */}
        <p className="mt-5 text-center text-xs text-slate-500">
          Need assistance with your submission? Reply directly on WhatsApp to contact admissions staff.
        </p>
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
                className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
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
