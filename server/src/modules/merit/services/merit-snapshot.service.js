import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import { AppError } from '../../../core/errors/app-error.js';
import { DECISION_STATUS } from '../merit.constants.js';
import { MeritEngineService } from './merit-engine.service.js';
import { MeritPolicyService } from './merit-policy.service.js';
import { ensureMeritSchema } from './merit-schema.service.js';

export class MeritSnapshotService {
  /**
   * Calculates merit and optionally generates an immutable snapshot record
   */
  static async calculateAndSaveSnapshot(
    { policyId = null, snapshotTitle = null, iterationNumber = 1, isDryRun = false, userId = null },
    db = pool
  ) {
    await ensureMeritSchema(db);

    // 1. Run engine calculation
    const calcResult = await MeritEngineService.runCalculation({ policyId }, db);

    if (isDryRun) {
      return {
        isDryRun: true,
        policy: calcResult.policy,
        totalCandidates: calcResult.totalCandidates,
        selectedCount: calcResult.selectedCount,
        waitlistedCount: calcResult.waitlistedCount,
        entries: calcResult.entries,
      };
    }

    const title = snapshotTitle || `${calcResult.policy.name} - Merit List (Iteration ${iterationNumber})`;

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const shouldRelease = typeof db.getConnection === 'function' && typeof connection.release === 'function';

    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
      }

      // Check if there is an existing snapshot for this policy and iteration
      const [existing] = await connection.query(
        `SELECT id, is_locked FROM mrt_snapshots WHERE policy_id = ? AND iteration_number = ?`,
        [calcResult.policy.id, iterationNumber]
      );

      if (existing.length && existing[0].is_locked) {
        throw new AppError(
          409,
          'SNAPSHOT_LOCKED',
          `Iteration ${iterationNumber} for this policy is locked and legally immutable. Increment iteration number for subsequent lists.`
        );
      }

      let snapshotId;
      if (existing.length) {
        snapshotId = existing[0].id;
        // Update existing unlocked snapshot
        await connection.execute(
          `UPDATE mrt_snapshots
           SET snapshot_title = ?, total_candidates = ?, selected_count = ?, waitlisted_count = ?
           WHERE id = ?`,
          [title, calcResult.totalCandidates, calcResult.selectedCount, calcResult.waitlistedCount, snapshotId]
        );
        // Delete previous unlocked entries to replace with newly calculated ranking
        await connection.execute(`DELETE FROM mrt_entries WHERE snapshot_id = ?`, [snapshotId]);
      } else {
        const [insertSnap] = await connection.execute(
          `INSERT INTO mrt_snapshots (
             policy_id, snapshot_title, iteration_number, is_locked, total_candidates,
             selected_count, waitlisted_count, created_by
           ) VALUES (?, ?, ?, FALSE, ?, ?, ?, ?)`,
          [
            calcResult.policy.id,
            title,
            iterationNumber,
            calcResult.totalCandidates,
            calcResult.selectedCount,
            calcResult.waitlistedCount,
            userId,
          ]
        );
        snapshotId = insertSnap.insertId;
      }

      // Insert ranked entries
      for (const entry of calcResult.entries) {
        await connection.execute(
          `INSERT INTO mrt_entries (
             snapshot_id, student_id, merit_position, quota_category,
             matric_score_used, matric_total_used, fsc_score_used, fsc_total_used,
             entry_test_score_used, entry_test_total_used, aggregate_score,
             tie_break_level, decision_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshotId,
            entry.studentId,
            entry.meritPosition,
            entry.allocatedQuota || entry.quotaCategory || 'OPEN_MERIT',
            entry.matricScoreUsed,
            entry.matricTotalUsed,
            entry.fscScoreUsed,
            entry.fscTotalUsed,
            entry.entryTestScoreUsed,
            entry.entryTestTotalUsed,
            entry.aggregateScore,
            entry.tieBreakLevel || 0,
            entry.decisionStatus,
          ]
        );
      }

      if (typeof connection.commit === 'function') {
        await connection.commit();
      }

      return {
        id: snapshotId,
        policyId: calcResult.policy.id,
        snapshotTitle: title,
        iterationNumber,
        isLocked: false,
        totalCandidates: calcResult.totalCandidates,
        selectedCount: calcResult.selectedCount,
        waitlistedCount: calcResult.waitlistedCount,
        entries: calcResult.entries,
      };
    } catch (err) {
      if (typeof connection.rollback === 'function') {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (shouldRelease) {
        connection.release();
      }
    }
  }

  /**
   * Locks snapshot, making it permanently immutable (Super Admin action)
   */
  static async lockSnapshot(snapshotId, userId, db = pool) {
    const [rows] = await db.query(
      `SELECT id, snapshot_title, is_locked FROM mrt_snapshots WHERE id = ?`,
      [snapshotId]
    );

    if (!rows.length) {
      throw new AppError(404, 'SNAPSHOT_NOT_FOUND', `Snapshot with ID ${snapshotId} not found.`);
    }

    if (rows[0].is_locked) {
      return { id: snapshotId, isLocked: true, message: 'Snapshot is already locked.' };
    }

    await db.execute(
      `UPDATE mrt_snapshots
       SET is_locked = TRUE, locked_by = ?, locked_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [userId, snapshotId]
    );

    return {
      id: snapshotId,
      snapshotTitle: rows[0].snapshot_title,
      isLocked: true,
      lockedAt: new Date().toISOString(),
    };
  }

  /**
   * Lists all merit snapshots
   */
  static async listSnapshots(db = pool) {
    await ensureMeritSchema(db);

    const [rows] = await db.query(
      `SELECT s.id, s.policy_id, s.snapshot_title, s.iteration_number, s.is_locked,
              s.total_candidates, s.selected_count, s.waitlisted_count,
              s.created_by, s.locked_by, s.locked_at, s.created_at, s.updated_at,
              p.name AS policy_name, p.program_code,
              u1.display_name AS creator_name,
              u2.display_name AS locker_name
       FROM mrt_snapshots s
       JOIN mrt_policies p ON p.id = s.policy_id
       LEFT JOIN sys_users u1 ON u1.id = s.created_by
       LEFT JOIN sys_users u2 ON u2.id = s.locked_by
       ORDER BY s.id DESC`
    );

    return rows.map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      policyName: r.policy_name,
      programCode: r.program_code,
      snapshotTitle: r.snapshot_title,
      iterationNumber: r.iteration_number,
      isLocked: Boolean(r.is_locked),
      totalCandidates: r.total_candidates,
      selectedCount: r.selected_count,
      waitlistedCount: r.waitlisted_count,
      createdBy: r.created_by,
      creatorName: r.creator_name,
      lockedBy: r.locked_by,
      lockerName: r.locker_name,
      lockedAt: r.locked_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Retrieves full snapshot details with all ranked candidate entries
   */
  static async getSnapshotDetails(snapshotId, db = pool) {
    await ensureMeritSchema(db);

    const [snapRows] = await db.query(
      `SELECT s.id, s.policy_id, s.snapshot_title, s.iteration_number, s.is_locked,
              s.total_candidates, s.selected_count, s.waitlisted_count,
              s.created_by, s.locked_by, s.locked_at, s.created_at, s.updated_at,
              p.name AS policy_name, p.program_code, p.matric_weightage, p.fsc_weightage, p.entry_test_weightage,
              u1.display_name AS creator_name,
              u2.display_name AS locker_name
       FROM mrt_snapshots s
       JOIN mrt_policies p ON p.id = s.policy_id
       LEFT JOIN sys_users u1 ON u1.id = s.created_by
       LEFT JOIN sys_users u2 ON u2.id = s.locked_by
       WHERE s.id = ?`,
      [snapshotId]
    );

    if (!snapRows.length) {
      throw new AppError(404, 'SNAPSHOT_NOT_FOUND', `Snapshot with ID ${snapshotId} not found.`);
    }

    const snap = snapRows[0];

    const [entryRows] = await db.query(
      `SELECT e.id, e.snapshot_id, e.student_id, e.merit_position, e.quota_category,
              e.matric_score_used, e.matric_total_used, e.fsc_score_used, e.fsc_total_used,
              e.entry_test_score_used, e.entry_test_total_used, e.aggregate_score,
              e.tie_break_level, e.decision_status, e.notification_sent, e.notification_sent_at,
              std.application_no, std.full_name, std.father_name, std.cnic, std.phone_normalized,
              std.city, std.dob
       FROM mrt_entries e
       JOIN adm_students std ON std.id = e.student_id
       WHERE e.snapshot_id = ?
       ORDER BY e.merit_position ASC`,
      [snapshotId]
    );

    return {
      snapshot: {
        id: snap.id,
        policyId: snap.policy_id,
        policyName: snap.policy_name,
        programCode: snap.program_code,
        matricWeightage: Number(snap.matric_weightage),
        fscWeightage: Number(snap.fsc_weightage),
        entryTestWeightage: Number(snap.entry_test_weightage),
        snapshotTitle: snap.snapshot_title,
        iterationNumber: snap.iteration_number,
        isLocked: Boolean(snap.is_locked),
        totalCandidates: snap.total_candidates,
        selectedCount: snap.selected_count,
        waitlistedCount: snap.waitlisted_count,
        creatorName: snap.creator_name,
        lockerName: snap.locker_name,
        lockedAt: snap.locked_at,
        createdAt: snap.created_at,
      },
      entries: entryRows.map((r) => ({
        id: r.id,
        studentId: r.student_id,
        meritPosition: r.merit_position,
        applicationNo: r.application_no,
        fullName: r.full_name,
        fatherName: r.father_name,
        cnic: r.cnic,
        phoneNormalized: r.phone_normalized,
        city: r.city,
        dob: r.dob,
        quotaCategory: r.quota_category,
        matricScoreUsed: Number(r.matric_score_used),
        matricTotalUsed: Number(r.matric_total_used),
        fscScoreUsed: Number(r.fsc_score_used),
        fscTotalUsed: Number(r.fsc_total_used),
        entryTestScoreUsed: Number(r.entry_test_score_used),
        entryTestTotalUsed: Number(r.entry_test_total_used),
        aggregateScore: Number(r.aggregate_score),
        tieBreakLevel: r.tie_break_level,
        decisionStatus: r.decision_status,
        notificationSent: Boolean(r.notification_sent),
        notificationSentAt: r.notification_sent_at,
      })),
    };
  }

  /**
   * Generates clean CSV string for Excel export
   */
  static async exportSnapshotToCsv(snapshotId, db = pool) {
    const { snapshot, entries } = await MeritSnapshotService.getSnapshotDetails(snapshotId, db);

    const headers = [
      'Merit Position',
      'Application No',
      'Candidate Name',
      'Father Name',
      'CNIC',
      'Contact Phone',
      'Matric Score',
      'FSc Score',
      'Entry Test Score',
      'Aggregate (%)',
      'Quota Category',
      'Decision Status',
      'Tie Break Tier',
    ];

    const rows = entries.map((e) => [
      e.meritPosition,
      `"${e.applicationNo || ''}"`,
      `"${(e.fullName || '').replace(/"/g, '""')}"`,
      `"${(e.fatherName || '').replace(/"/g, '""')}"`,
      `"${e.cnic || ''}"`,
      `"${e.phoneNormalized || ''}"`,
      `${e.matricScoreUsed}/${e.matricTotalUsed}`,
      `${e.fscScoreUsed}/${e.fscTotalUsed}`,
      `${e.entryTestScoreUsed}/${e.entryTestTotalUsed}`,
      e.aggregateScore.toFixed(3),
      `"${e.quotaCategory}"`,
      e.decisionStatus,
      e.tieBreakLevel > 0 ? `Tier ${e.tieBreakLevel}` : 'None',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    return {
      filename: `${snapshot.snapshotTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`,
      csvContent,
    };
  }

  /**
   * Dispatches WhatsApp notifications to SELECTED candidates via outbox_jobs
   */
  static async dispatchSelectedNotifications(snapshotId, options = {}, db = pool) {
    const { customMessage = null, duePaymentDate = 'Friday, 4:00 PM' } = options;
    const { snapshot, entries } = await MeritSnapshotService.getSnapshotDetails(snapshotId, db);

    const selectedEntries = entries.filter((e) => e.decisionStatus === DECISION_STATUS.SELECTED && !e.notificationSent);

    if (!selectedEntries.length) {
      return {
        notifiedCount: 0,
        message: 'No un-notified selected candidates found in this snapshot.',
      };
    }

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const shouldRelease = typeof db.getConnection === 'function' && typeof connection.release === 'function';

    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
      }

      let notifiedCount = 0;

      for (const entry of selectedEntries) {
        if (!entry.phoneNormalized) continue;

        const defaultNotice =
          `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
          `University of Azad Jammu & Kashmir (UAJK)\n\n` +
          `*ADMISSION SELECTION NOTICE*\n\n` +
          `Dear ${entry.fullName},\n\n` +
          `Congratulations! You have been *SELECTED* for admission to B.Sc. Software Engineering under the *${snapshot.snapshotTitle}*.\n\n` +
          `- Merit Position: *#${entry.meritPosition}*\n` +
          `- Aggregate Score: *${entry.aggregateScore.toFixed(3)}%*\n` +
          `- Category: *${entry.quotaCategory}*\n\n` +
          `*Required Action:*\n` +
          `Please report to the Admissions Office with your original academic documents (Matric, FSc, CNIC/Form-B, Domicile, 4 photos) and submit your admission dues before *${duePaymentDate}* to secure your allocated seat.\n\n` +
          `Department Admissions Committee`;

        const messageText = customMessage
          ? customMessage
              .replace(/{name}/gi, entry.fullName)
              .replace(/{rank}/gi, String(entry.meritPosition))
              .replace(/{aggregate}/gi, entry.aggregateScore.toFixed(3))
          : defaultNotice;

        await dispatchJob({
          queueName: 'whatsapp_outreach',
          jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
          payload: {
            recipientPhone: entry.phoneNormalized,
            messageType: 'MERIT_SELECTION',
            messageText,
            metadata: {
              snapshotId,
              studentId: entry.studentId,
              meritPosition: entry.meritPosition,
            },
          },
          availableAt: new Date(),
          connection,
        });

        await connection.execute(
          `UPDATE mrt_entries
           SET notification_sent = TRUE, notification_sent_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [entry.id]
        );

        notifiedCount++;
      }

      if (typeof connection.commit === 'function') {
        await connection.commit();
      }

      return {
        snapshotId,
        notifiedCount,
        message: `Successfully queued WhatsApp selection notices for ${notifiedCount} candidates.`,
      };
    } catch (err) {
      if (typeof connection.rollback === 'function') {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (shouldRelease) {
        connection.release();
      }
    }
  }
}
