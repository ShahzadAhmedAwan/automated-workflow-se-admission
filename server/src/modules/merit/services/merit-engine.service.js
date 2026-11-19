import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { DECISION_STATUS, TIE_BREAKER_TIER } from '../merit.constants.js';
import { MeritPolicyService } from './merit-policy.service.js';
import { ensureMeritSchema } from './merit-schema.service.js';
import { SeetScraperService } from './seet-scraper.service.js';

export class MeritEngineService {
  /**
   * Computes individual student aggregate according to weighted policy
   * Formula:
   * (Matric / MatricTotal * W_Matric) + (FSc / FScTotal * W_FSc) + (Test / TestTotal * W_Test)
   */
  static calculateStudentAggregate(student, policy) {
    const matricObt = Number(student.matric_obtained_marks || student.matricObtainedMarks || 0);
    const matricTot = Number(student.matric_total_marks || student.matricTotalMarks || 1100);
    const fscObt = Number(student.fsc_obtained_marks || student.fscObtainedMarks || 0);
    const fscTot = Number(student.fsc_total_marks || student.fscTotalMarks || 1100);
    const testObt = Number(student.entry_test_marks || student.entryTestMarks || 0);
    const testTot = Number(student.entry_test_total || student.entryTestTotal || 100);

    const matricComponent = matricTot > 0 ? (matricObt / matricTot) * Number(policy.matricWeightage) : 0;
    const fscComponent = fscTot > 0 ? (fscObt / fscTot) * Number(policy.fscWeightage) : 0;
    const testComponent = testTot > 0 ? (testObt / testTot) * Number(policy.entryTestWeightage) : 0;

    const rawAggregate = matricComponent + fscComponent + testComponent;
    const aggregateScore = Number(rawAggregate.toFixed(3));

    return {
      studentId: student.id,
      applicationNo: student.application_no || student.applicationNo,
      fullName: student.full_name || student.fullName,
      fatherName: student.father_name || student.fatherName,
      cnic: student.cnic,
      phoneNormalized: student.phone_normalized || student.phoneNormalized,
      dob: student.dob ? new Date(student.dob) : null,
      quotaCategory: student.quota_category || student.quotaCategory || 'OPEN_MERIT',
      eligibleFor: student.eligible_for || student.eligibleFor || 'SE',
      matricScoreUsed: matricObt,
      matricTotalUsed: matricTot,
      fscScoreUsed: fscObt,
      fscTotalUsed: fscTot,
      entryTestScoreUsed: testObt,
      entryTestTotalUsed: testTot,
      aggregateScore,
    };
  }

  /**
   * Deterministic 4-Tier Tie-Breaking Comparator
   * Tier 1: Higher Entry Test Score
   * Tier 2: Higher FSc Score
   * Tier 3: Higher Matric Score
   * Tier 4: Older Candidate Age (earlier Date of Birth)
   */
  static compareCandidates(a, b) {
    // 1. Primary Aggregate Score (3 decimal precision)
    if (b.aggregateScore !== a.aggregateScore) {
      return b.aggregateScore - a.aggregateScore;
    }

    // Identical aggregate: Resolve via 4-Tier protocol
    // Tier 1: Entry Test Score
    if (b.entryTestScoreUsed !== a.entryTestScoreUsed) {
      a._tieBreakLevel = a._tieBreakLevel || TIE_BREAKER_TIER.ENTRY_TEST;
      b._tieBreakLevel = b._tieBreakLevel || TIE_BREAKER_TIER.ENTRY_TEST;
      return b.entryTestScoreUsed - a.entryTestScoreUsed;
    }

    // Tier 2: FSc Score
    if (b.fscScoreUsed !== a.fscScoreUsed) {
      a._tieBreakLevel = a._tieBreakLevel || TIE_BREAKER_TIER.FSC;
      b._tieBreakLevel = b._tieBreakLevel || TIE_BREAKER_TIER.FSC;
      return b.fscScoreUsed - a.fscScoreUsed;
    }

    // Tier 3: Matric Score
    if (b.matricScoreUsed !== a.matricScoreUsed) {
      a._tieBreakLevel = a._tieBreakLevel || TIE_BREAKER_TIER.MATRIC;
      b._tieBreakLevel = b._tieBreakLevel || TIE_BREAKER_TIER.MATRIC;
      return b.matricScoreUsed - a.matricScoreUsed;
    }

    // Tier 4: Candidate Age (older prioritized: earlier DOB comes first)
    if (a.dob && b.dob && a.dob.getTime() !== b.dob.getTime()) {
      a._tieBreakLevel = a._tieBreakLevel || TIE_BREAKER_TIER.AGE;
      b._tieBreakLevel = b._tieBreakLevel || TIE_BREAKER_TIER.AGE;
      return a.dob.getTime() - b.dob.getTime();
    }

    // Stable deterministic fallback by studentId
    return Number(a.studentId) - Number(b.studentId);
  }

  /**
   * Distributes candidates across Open Merit and Reserved Quotas
   * Enforces Minimum Eligibility Criteria:
   * - Must have SEET entry test score recorded if test has policy weightage
   * - Must meet the minimum aggregate cutoff threshold (>= 40.00%)
   */
  static allocateQuotas(rankedCandidates, quotaDefinitions = [], policy = {}) {
    const quotaLimits = {};
    const quotaAllocated = {};

    quotaDefinitions.forEach((q) => {
      quotaLimits[q.code] = Number(q.seats) || 0;
      quotaAllocated[q.code] = 0;
    });

    const openMeritSeats = quotaLimits['OPEN_MERIT'] !== undefined ? quotaLimits['OPEN_MERIT'] : 70;
    let openMeritCount = 0;

    const entries = [];

    // Step 1: Open Merit allocation (highest scores take Open Merit regardless of their quota)
    const remainingForQuotas = [];

    rankedCandidates.forEach((candidate, index) => {
      candidate.meritPosition = index + 1;
      candidate.tieBreakLevel = candidate._tieBreakLevel || TIE_BREAKER_TIER.NONE;

      // Minimum Eligibility Validation:
      // 1. Candidate must have taken the entry test if policy assigns weight to it
      const requiresEntryTest = Number(policy.entryTestWeightage || 0) > 0;
      const hasTakenEntryTest = !requiresEntryTest || Number(candidate.entryTestScoreUsed || 0) > 0;
      // 2. Candidate must meet the minimum merit aggregate threshold (40.00%)
      const meetsMinCutoff = Number(candidate.aggregateScore || 0) >= 40.0;
      const isEligibleForSelection = hasTakenEntryTest && meetsMinCutoff;

      if (!hasTakenEntryTest) {
        candidate.ineligibilityReason = 'SEET entry test score pending / unrecorded';
      } else if (!meetsMinCutoff) {
        candidate.ineligibilityReason = 'Aggregate score below minimum 40.00% cutoff';
      } else {
        candidate.ineligibilityReason = null;
      }

      if (isEligibleForSelection && openMeritCount < openMeritSeats) {
        candidate.allocatedQuota = 'OPEN_MERIT';
        candidate.decisionStatus = DECISION_STATUS.SELECTED;
        openMeritCount++;
        entries.push(candidate);
      } else {
        remainingForQuotas.push(candidate);
      }
    });

    // Step 2: Reserved Quota allocations
    remainingForQuotas.forEach((candidate) => {
      const qCode = candidate.quotaCategory;
      const limit = quotaLimits[qCode] || 0;
      const current = quotaAllocated[qCode] || 0;

      const requiresEntryTest = Number(policy.entryTestWeightage || 0) > 0;
      const hasTakenEntryTest = !requiresEntryTest || Number(candidate.entryTestScoreUsed || 0) > 0;
      const meetsMinCutoff = Number(candidate.aggregateScore || 0) >= 40.0;
      const isEligibleForSelection = hasTakenEntryTest && meetsMinCutoff;

      if (isEligibleForSelection && qCode !== 'OPEN_MERIT' && limit > 0 && current < limit) {
        candidate.allocatedQuota = qCode;
        candidate.decisionStatus = DECISION_STATUS.SELECTED;
        quotaAllocated[qCode] = current + 1;
      } else {
        candidate.allocatedQuota = qCode || 'OPEN_MERIT';
        candidate.decisionStatus = DECISION_STATUS.WAITLISTED;
      }

      entries.push(candidate);
    });

    // Sort final entries by meritPosition
    entries.sort((a, b) => a.meritPosition - b.meritPosition);

    return {
      entries,
      totalProcessed: entries.length,
      selectedCount: entries.filter((e) => e.decisionStatus === DECISION_STATUS.SELECTED).length,
      waitlistedCount: entries.filter((e) => e.decisionStatus === DECISION_STATUS.WAITLISTED).length,
    };
  }

  /**
   * Runs the complete merit calculation engine strictly against VERIFIED students
   */
  static async runCalculation(options = {}, db = pool) {
    const { policyId = null, programCode = 'SE', studentsOverride = null } = options;

    await ensureMeritSchema(db);

    // 1. Resolve Policy
    let policy = policyId
      ? await MeritPolicyService.getPolicyById(policyId, db)
      : await MeritPolicyService.getActivePolicy(programCode, db);

    if (!policy) {
      // Default Fallback Policy if none is registered in DB
      policy = {
        id: 1,
        name: 'B.Sc. Software Engineering - Fall 2026 Policy',
        version: '1.0',
        isActive: true,
        programCode: programCode || 'SE',
        matricWeightage: 10.0,
        fscWeightage: 40.0,
        entryTestWeightage: 50.0,
        tieBreakerRules: ['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE'],
        quotaDefinitions: [
          { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
          { code: 'AJK_REGIONAL', title: 'AJK District Quota', seats: 15 },
          { code: 'SPORTS', title: 'Sports Quota', seats: 5 },
        ],
      };
    }

    // 2. Auto-sync SEET test marks for any verified candidate whose test score is unrecorded
    if (!studentsOverride && options.autoSyncSeet !== false) {
      try {
        await SeetScraperService.syncVerifiedCandidates({ timeoutMs: 2500 }, db);
      } catch (syncErr) {
        // Non-blocking: If portal is slow or offline, proceed with currently recorded marks
      }
    }

    // 3. Fetch candidates (Strict Gatekeeping: WHERE overall_status = 'VERIFIED')
    let verifiedStudents = studentsOverride;
    if (!verifiedStudents) {
      try {
        const [rows] = await db.query(
          `SELECT id, application_no, cnic, full_name, father_name, phone_normalized,
                  email, city, prior_degree, eligible_for, fsc_roll_no, fsc_obtained_marks,
                  fsc_total_marks, matric_obtained_marks, matric_total_marks,
                  entry_test_marks, entry_test_total, entry_test_roll_no, dob,
                  quota_category, overall_status
           FROM adm_students
           WHERE overall_status = 'VERIFIED'
           ORDER BY id ASC`
        );
        verifiedStudents = rows;
      } catch (colErr) {
        // Fallback for missing optional columns (e.g. entry_test_marks, dob, quota_category)
        const [fallbackRows] = await db.query(
          `SELECT id, application_no, cnic, full_name, father_name, phone_normalized,
                  email, city, prior_degree, fsc_roll_no, fsc_obtained_marks,
                  fsc_total_marks, matric_obtained_marks, matric_total_marks,
                  overall_status
           FROM adm_students
           WHERE overall_status = 'VERIFIED'
           ORDER BY id ASC`
        );
        verifiedStudents = fallbackRows.map((r) => ({
          ...r,
          eligible_for: r.eligible_for || 'SE',
          entry_test_marks: 0,
          entry_test_total: 100,
          entry_test_roll_no: null,
          dob: null,
          quota_category: 'OPEN_MERIT',
        }));
      }
    }

    if (!verifiedStudents.length) {
      return {
        policy,
        totalCandidates: 0,
        selectedCount: 0,
        waitlistedCount: 0,
        entries: [],
        message: 'No candidates currently meet the overall_status = VERIFIED requirement.',
      };
    }

    // 3. Compute aggregate scores
    const calculated = verifiedStudents.map((s) => MeritEngineService.calculateStudentAggregate(s, policy));

    // 4. Sort with 4-Tier Tie-Breaking protocol
    calculated.sort(MeritEngineService.compareCandidates);

    // 5. Allocate quota seats with eligibility criteria (SEET test completion and minimum 40% cutoff)
    const allocation = MeritEngineService.allocateQuotas(calculated, policy.quotaDefinitions, policy);

    return {
      policy,
      totalCandidates: allocation.totalProcessed,
      selectedCount: allocation.selectedCount,
      waitlistedCount: allocation.waitlistedCount,
      entries: allocation.entries,
    };
  }
}
