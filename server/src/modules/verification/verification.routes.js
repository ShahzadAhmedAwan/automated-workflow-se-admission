import { Router } from 'express';
import multer from 'multer';
import { IntakeController } from './controllers/intake.controller.js';
import { StaffVerificationController } from './controllers/staff-verification.controller.js';
import { authenticate, requirePermission } from '../auth/index.js';
import { VERIFICATION_PERMISSIONS } from './verification.constants.js';

// Enforce Inode and memory shield: strictly memory storage, max 5MB per file
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 5,                  // max 5 files per submission
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPEG, PNG, and PDF files are allowed.'));
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

export const verificationRoutes = Router();

// ============================================================================
// Public Capability-Based Intake Endpoints (No Login Required)
// ============================================================================

verificationRoutes.get('/intake/token/:token', IntakeController.validateToken);

verificationRoutes.post(
  '/intake/token/:token/submit',
  documentUpload.any(),
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

// Get student verification dossier (side-by-side docs, OCR, portal results)
verificationRoutes.get(
  '/students/:studentId/dossier',
  authenticate,
  requirePermission(VERIFICATION_PERMISSIONS.DOCUMENTS_REVIEW),
  StaffVerificationController.getStudentDossier
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
