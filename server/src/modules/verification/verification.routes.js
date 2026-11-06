import { Router } from 'express';
import multer from 'multer';
import { IntakeController } from './controllers/intake.controller.js';
import { StaffVerificationController } from './controllers/staff-verification.controller.js';
import { authenticate, requirePermission } from '../auth/index.js';
import { DOCUMENT_TYPES, VERIFICATION_PERMISSIONS } from './verification.constants.js';

// Enforce Inode and memory shield: strictly memory storage, max 5MB per file
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 5,                  // max 5 files per submission
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype) && Object.values(DOCUMENT_TYPES).includes(file.fieldname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid document field or file format. Use a supported document type and JPEG, PNG, or PDF file.'));
    }
  },
});

const discrepancyCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed for discrepancy import.'));
    }
  },
});

const gazetteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => file.mimetype === 'application/pdf'
    ? cb(null, true)
    : cb(new Error('Board gazettes must be uploaded as PDF files.')),
});

export const verificationRoutes = Router();

// ============================================================================
// Public Capability-Based Intake Endpoints (No Login Required)
// ============================================================================

verificationRoutes.get('/intake/token/:token', IntakeController.validateToken);

verificationRoutes.post(
  '/intake/token/:token/submit',
  documentUpload.fields(Object.values(DOCUMENT_TYPES).map((name) => ({ name, maxCount: 1 }))),
  IntakeController.submitDocuments
);

// ============================================================================
// Staff-Protected Verification Management Endpoints
// ============================================================================

// List review queue (candidates needing review, under review, or discrepancies)
verificationRoutes.get(
  '/queue',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.listReviewQueue
);

verificationRoutes.get(
  '/board-sources',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.listBoardSources
);
verificationRoutes.post(
  '/board-sources',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.SOURCES_MANAGE),
  gazetteUpload.single('gazette'),
  StaffVerificationController.saveBoardSource
);
verificationRoutes.delete(
  '/board-sources/:sourceId',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.SOURCES_MANAGE),
  StaffVerificationController.deactivateBoardSource
);
verificationRoutes.get(
  '/board-sources/:sourceId/gazette',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.downloadBoardGazette
);

// Get student verification dossier (side-by-side docs, OCR, portal results)
verificationRoutes.get(
  '/students/:studentId/dossier',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.getStudentDossier
);

verificationRoutes.get(
  '/students/:studentId/documents/:documentId/file',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.viewStudentDocument
);

// Update student phone number
verificationRoutes.patch(
  '/students/:studentId/phone',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.updatePhone
);

// Execute review decision (Approve, Override Marks, Reject & Reissue)
verificationRoutes.post(
  '/students/:studentId/action',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.executeReviewAction
);

// Import discrepancy sheet
verificationRoutes.post(
  '/discrepancies/import',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  discrepancyCsvUpload.single('file'),
  StaffVerificationController.importDiscrepancies
);

// Manually reissue token
verificationRoutes.post(
  '/tokens/reissue',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.TOKENS_REISSUE),
  StaffVerificationController.reissueToken
);
