import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { ensureMeritSchema } from './merit-schema.service.js';

export class MeritPolicyService {
  /**
   * Retrieves the currently active policy for a program (default: 'SE')
   */
  static async getActivePolicy(programCode = 'SE', db = pool) {
    await ensureMeritSchema(db);

    const [rows] = await db.query(
      `SELECT id, name, version, is_active, program_code, matric_weightage, fsc_weightage,
              entry_test_weightage, tie_breaker_rules, quota_definitions, created_by, created_at, updated_at
       FROM mrt_policies
       WHERE is_active = TRUE AND program_code = ?
       ORDER BY id DESC
       LIMIT 1`,
      [programCode]
    );

    if (!rows.length) {
      // Fallback to any active policy
      const [anyActive] = await db.query(
        `SELECT id, name, version, is_active, program_code, matric_weightage, fsc_weightage,
                entry_test_weightage, tie_breaker_rules, quota_definitions, created_by, created_at, updated_at
         FROM mrt_policies
         WHERE is_active = TRUE
         ORDER BY id DESC
         LIMIT 1`
      );
      if (anyActive.length) {
        return MeritPolicyService.formatPolicyRow(anyActive[0]);
      }
      return null;
    }

    return MeritPolicyService.formatPolicyRow(rows[0]);
  }

  /**
   * List all policies
   */
  static async listPolicies(db = pool) {
    await ensureMeritSchema(db);

    const [rows] = await db.query(
      `SELECT id, name, version, is_active, program_code, matric_weightage, fsc_weightage,
              entry_test_weightage, tie_breaker_rules, quota_definitions, created_by, created_at, updated_at
       FROM mrt_policies
       ORDER BY id DESC`
    );

    return rows.map(MeritPolicyService.formatPolicyRow);
  }

  /**
   * Get single policy by ID
   */
  static async getPolicyById(policyId, db = pool) {
    await ensureMeritSchema(db);

    const [rows] = await db.query(
      `SELECT id, name, version, is_active, program_code, matric_weightage, fsc_weightage,
              entry_test_weightage, tie_breaker_rules, quota_definitions, created_by, created_at, updated_at
       FROM mrt_policies
       WHERE id = ?`,
      [policyId]
    );

    if (!rows.length) {
      throw new AppError(404, 'POLICY_NOT_FOUND', `Admission policy with ID ${policyId} not found.`);
    }

    return MeritPolicyService.formatPolicyRow(rows[0]);
  }

  /**
   * Create a new admission policy
   */
  static async createPolicy(payload, userId = null, db = pool) {
    const {
      name,
      version = '1.0',
      programCode = 'SE',
      isActive = true,
      matricWeightage = 10,
      fscWeightage = 40,
      entryTestWeightage = 50,
      tieBreakerRules = ['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE'],
      quotaDefinitions = [
        { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
        { code: 'AJK_REGIONAL', title: 'AJK District Quota', seats: 15 },
        { code: 'SPORTS', title: 'Sports Quota', seats: 5 },
      ],
    } = payload;

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const shouldRelease = typeof db.getConnection === 'function' && typeof connection.release === 'function';

    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
      }

      // If active, deactivate other policies for the same program
      if (isActive) {
        await connection.execute(
          `UPDATE mrt_policies SET is_active = FALSE WHERE program_code = ?`,
          [programCode]
        );
      }

      const [result] = await connection.execute(
        `INSERT INTO mrt_policies (
           name, version, is_active, program_code, matric_weightage, fsc_weightage,
           entry_test_weightage, tie_breaker_rules, quota_definitions, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          version,
          isActive,
          programCode,
          matricWeightage,
          fscWeightage,
          entryTestWeightage,
          JSON.stringify(tieBreakerRules),
          JSON.stringify(quotaDefinitions),
          userId,
        ]
      );

      if (typeof connection.commit === 'function') {
        await connection.commit();
      }

      return {
        id: result.insertId,
        name,
        version,
        programCode,
        isActive,
        matricWeightage,
        fscWeightage,
        entryTestWeightage,
        tieBreakerRules,
        quotaDefinitions,
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
   * Update an existing admission policy
   */
  static async updatePolicy(policyId, payload, _userId = null, db = pool) {
    const existing = await MeritPolicyService.getPolicyById(policyId, db);

    const matricWeightage = payload.matricWeightage !== undefined ? Number(payload.matricWeightage) : existing.matricWeightage;
    const fscWeightage = payload.fscWeightage !== undefined ? Number(payload.fscWeightage) : existing.fscWeightage;
    const entryTestWeightage = payload.entryTestWeightage !== undefined ? Number(payload.entryTestWeightage) : existing.entryTestWeightage;

    const sum = matricWeightage + fscWeightage + entryTestWeightage;
    if (Math.abs(sum - 100) > 0.01) {
      throw new AppError(400, 'INVALID_WEIGHTAGE_SUM', `The sum of weights must equal 100% (currently ${sum}%).`);
    }

    const updates = [];
    const params = [];

    if (payload.name) {
      updates.push('name = ?');
      params.push(payload.name);
    }
    if (payload.version) {
      updates.push('version = ?');
      params.push(payload.version);
    }
    if (payload.programCode) {
      updates.push('program_code = ?');
      params.push(payload.programCode);
    }
    if (payload.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(payload.isActive);
    }
    if (payload.matricWeightage !== undefined) {
      updates.push('matric_weightage = ?');
      params.push(payload.matricWeightage);
    }
    if (payload.fscWeightage !== undefined) {
      updates.push('fsc_weightage = ?');
      params.push(payload.fscWeightage);
    }
    if (payload.entryTestWeightage !== undefined) {
      updates.push('entry_test_weightage = ?');
      params.push(payload.entryTestWeightage);
    }
    if (payload.tieBreakerRules) {
      updates.push('tie_breaker_rules = ?');
      params.push(JSON.stringify(payload.tieBreakerRules));
    }
    if (payload.quotaDefinitions) {
      updates.push('quota_definitions = ?');
      params.push(JSON.stringify(payload.quotaDefinitions));
    }

    if (!updates.length) return existing;

    params.push(policyId);
    await db.execute(`UPDATE mrt_policies SET ${updates.join(', ')} WHERE id = ?`, params);

    return MeritPolicyService.getPolicyById(policyId, db);
  }

  static formatPolicyRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      isActive: Boolean(row.is_active),
      programCode: row.program_code,
      matricWeightage: Number(row.matric_weightage),
      fscWeightage: Number(row.fsc_weightage),
      entryTestWeightage: Number(row.entry_test_weightage),
      tieBreakerRules: typeof row.tie_breaker_rules === 'string'
        ? JSON.parse(row.tie_breaker_rules)
        : row.tie_breaker_rules || ['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE'],
      quotaDefinitions: typeof row.quota_definitions === 'string'
        ? JSON.parse(row.quota_definitions)
        : row.quota_definitions || [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
