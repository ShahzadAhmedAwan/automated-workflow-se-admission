import { pool } from '../../../core/db/pool.js';
import { MeritPolicyService } from '../services/merit-policy.service.js';
import { MeritEngineService } from '../services/merit-engine.service.js';
import { MeritSnapshotService } from '../services/merit-snapshot.service.js';
import { SeetScraperService } from '../services/seet-scraper.service.js';
import { GazetteStreamParserService } from '../services/gazette-stream-parser.service.js';
import {
  createPolicySchema,
  updatePolicySchema,
  seetLookupSchema,
  saveSeetResultSchema,
  calculateMeritSchema,
  notifySelectedSchema,
} from '../merit.schemas.js';

export class MeritController {
  // Policies
  static async listPolicies(_req, res, next) {
    try {
      const policies = await MeritPolicyService.listPolicies();
      res.json({ status: 'success', data: policies });
    } catch (err) {
      next(err);
    }
  }

  static async getActivePolicy(req, res, next) {
    try {
      const { programCode = 'SE' } = req.query;
      const policy = await MeritPolicyService.getActivePolicy(programCode);
      res.json({ status: 'success', data: policy });
    } catch (err) {
      next(err);
    }
  }

  static async getPolicy(req, res, next) {
    try {
      const policy = await MeritPolicyService.getPolicyById(Number(req.params.id));
      res.json({ status: 'success', data: policy });
    } catch (err) {
      next(err);
    }
  }

  static async createPolicy(req, res, next) {
    try {
      const payload = createPolicySchema.parse(req.body);
      const policy = await MeritPolicyService.createPolicy(payload, req.user?.id || null);
      res.status(201).json({ status: 'success', data: policy });
    } catch (err) {
      next(err);
    }
  }

  static async updatePolicy(req, res, next) {
    try {
      const payload = updatePolicySchema.parse(req.body);
      const policy = await MeritPolicyService.updatePolicy(Number(req.params.id), payload, req.user?.id || null);
      res.json({ status: 'success', data: policy });
    } catch (err) {
      next(err);
    }
  }

  // SEET Result Lookup & Scraper
  static async lookupSeet(req, res, next) {
    try {
      const { cnic, simulate } = seetLookupSchema.parse(req.body);
      const result = await SeetScraperService.lookupByCnic(cnic, { useSimulation: simulate });
      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  static async getSeetPhases(req, res, next) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const phases = await SeetScraperService.getOrDiscoverPhases({ forceRefresh });
      res.json({
        status: 'success',
        data: {
          phases,
          summary: phases.map((p) => p.label).join(', '),
          lastDiscoveredAt: SeetScraperService._phasesCache.timestamp
            ? new Date(SeetScraperService._phasesCache.timestamp).toISOString()
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  static async saveSeetResult(req, res, next) {
    try {
      const payload = saveSeetResultSchema.parse(req.body);
      const result = await SeetScraperService.saveResultAndBackfill(payload);
      res.status(201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  static async syncVerifiedSeet(_req, res, next) {
    try {
      const summary = await SeetScraperService.syncVerifiedCandidates();
      res.json({ status: 'success', data: summary });
    } catch (err) {
      next(err);
    }
  }

  // SEET Gazette PDF Ingestion & Pending Score Sync
  static async uploadGazette(req, res, next) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'An official SEET entrance test PDF gazette file is required under the "file" field.' });
      }
      const { boardOrTestName = 'UAJK_SEET_TEST', academicYear = '2026' } = req.body || {};
      const result = await GazetteStreamParserService.processGazetteBuffer(req.file.buffer, {
        boardOrTestName,
        academicYear,
      });
      res.status(201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  // Merit Calculation & Snapshots
  static async calculateMerit(req, res, next) {
    try {
      const payload = calculateMeritSchema.parse(req.body || {});
      const result = await MeritSnapshotService.calculateAndSaveSnapshot({
        ...payload,
        userId: req.user?.id || null,
      });
      res.status(payload.isDryRun ? 200 : 201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  static async listSnapshots(_req, res, next) {
    try {
      const snapshots = await MeritSnapshotService.listSnapshots();
      res.json({ status: 'success', data: snapshots });
    } catch (err) {
      next(err);
    }
  }

  static async getSnapshot(req, res, next) {
    try {
      const snapshot = await MeritSnapshotService.getSnapshotDetails(Number(req.params.id));
      res.json({ status: 'success', data: snapshot });
    } catch (err) {
      next(err);
    }
  }

  static async lockSnapshot(req, res, next) {
    try {
      const result = await MeritSnapshotService.lockSnapshot(
        Number(req.params.id),
        req.user?.id || null
      );
      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  static async exportSnapshot(req, res, next) {
    try {
      const { filename, csvContent } = await MeritSnapshotService.exportSnapshotToCsv(Number(req.params.id));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(csvContent);
    } catch (err) {
      next(err);
    }
  }

  static async notifySelected(req, res, next) {
    try {
      const payload = notifySelectedSchema.parse({
        snapshotId: Number(req.params.id),
        ...req.body,
      });
      const result = await MeritSnapshotService.dispatchSelectedNotifications(
        payload.snapshotId,
        {
          studentId: payload.studentId,
          customMessage: payload.customMessage,
          duePaymentDate: payload.duePaymentDate,
          forceResend: payload.forceResend,
        }
      );
      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }
}
