import { IntakeTokenService } from '../services/intake-token.service.js';
import { AdmissionIntakeService } from '../services/admission-intake.service.js';
import { tokenParamSchema, submitDocumentsSchema } from '../verification.schemas.js';

export class IntakeController {
  /**
   * Public metadata lookup: validates single-use capability token
   */
  static async validateToken(req, res, next) {
    try {
      const { token } = tokenParamSchema.parse(req.params);
      const tokenData = await IntakeTokenService.validateToken(token);
      res.json({ status: 'success', data: tokenData });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public submission of documents against capability token
   */
  static async submitDocuments(req, res, next) {
    try {
      const { token } = tokenParamSchema.parse(req.params);
      const payload = submitDocumentsSchema.parse(req.body || {});
      const files = req.files || [];

      const result = await AdmissionIntakeService.submitDocuments({
        rawToken: token,
        files,
        remarks: payload.remarks || '',
      });

      res.status(201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }
}
