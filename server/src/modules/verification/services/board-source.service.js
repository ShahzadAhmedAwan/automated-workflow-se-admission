import { pool } from '../../../core/db/pool.js';
import { ensureDatabaseMigrations } from '../../../core/db/migrate-schema.js';
import { AppError } from '../../../core/errors/app-error.js';
import { StorageService } from './storage/storage.service.js';

function normalizeBoard(value) {
  return String(value || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function getBoardFamily(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('federal') || s.includes('fbise') || s.includes('islamabad')) return 'fbise';
  if (s.includes('ajk') || s.includes('mirpur') || s.includes('kashmir')) return 'ajk';
  if (s.includes('lahore')) return 'lahore';
  if (s.includes('rawalpindi') || s.includes('rwp')) return 'rawalpindi';
  if (s.includes('gujranwala')) return 'gujranwala';
  if (s.includes('multan')) return 'multan';
  if (s.includes('faisalabad')) return 'faisalabad';
  if (s.includes('sargodha')) return 'sargodha';
  if (s.includes('sahiwal')) return 'sahiwal';
  if (s.includes('bahawalpur')) return 'bahawalpur';
  if (s.includes('dg khan') || s.includes('deraghazikhan') || s.includes('d.g. khan')) return 'dgkhan';
  if (s.includes('peshawar')) return 'peshawar';
  if (s.includes('abbottabad')) return 'abbottabad';
  if (s.includes('mardan')) return 'mardan';
  if (s.includes('swat') || s.includes('malakand')) return 'swat';
  if (s.includes('karachi') || s.includes('bsek') || s.includes('biek')) return 'karachi';
  if (s.includes('hyderabad')) return 'hyderabad';
  if (s.includes('sukkur')) return 'sukkur';
  if (s.includes('quetta')) return 'quetta';
  return null;
}

export class BoardSourceService {
  static async list({ activeOnly = false } = {}, db = pool) {
    let rows;
    try {
      const [res] = await db.execute(
        `SELECT id, board_name, board_aliases, academic_year, exam_level, exam_session, exam_part,
                source_type, portal_adapter, result_url, gazette_filename, is_active, created_at, updated_at
           FROM adm_board_sources ${activeOnly ? 'WHERE is_active = TRUE' : ''}
          ORDER BY board_name ASC, academic_year DESC`
      );
      rows = res;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
        ensureDatabaseMigrations(db).catch(() => {});
        const [res] = await db.execute(
          `SELECT id, board_name, board_aliases, academic_year,
                  source_type, result_url, gazette_filename, is_active, created_at, updated_at
             FROM adm_board_sources ${activeOnly ? 'WHERE is_active = TRUE' : ''}
            ORDER BY board_name ASC, academic_year DESC`
        );
        rows = res.map((r) => ({
          ...r,
          exam_level: 'ALL',
          exam_session: 'ALL',
          exam_part: 'ALL',
          portal_adapter: 'AUTO_FORM',
        }));
      } else {
        throw err;
      }
    }
    return rows;
  }

  static async findForBoard(boardName, academicYear, db = pool) {
    let rows;
    try {
      const [res] = await db.execute(
        `SELECT id, board_name, board_aliases, academic_year, exam_level, exam_session, exam_part,
                source_type, portal_adapter, result_url, gazette_filename, storage_provider, storage_key
           FROM adm_board_sources WHERE is_active = TRUE ORDER BY (source_type = 'PORTAL_URL') DESC, academic_year DESC, id DESC`
      );
      rows = res;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
        ensureDatabaseMigrations(db).catch(() => {});
        const [res] = await db.execute(
          `SELECT id, board_name, board_aliases, academic_year,
                  source_type, result_url, gazette_filename, storage_provider, storage_key
             FROM adm_board_sources WHERE is_active = TRUE ORDER BY (source_type = 'PORTAL_URL') DESC, academic_year DESC, id DESC`
        );
        rows = res.map((r) => ({
          ...r,
          exam_level: 'ALL',
          exam_session: 'ALL',
          exam_part: 'ALL',
          portal_adapter: 'AUTO_FORM',
        }));
      } else {
        throw err;
      }
    }
    const input = normalizeBoard(boardName);
    const matches = rows.filter((row) => {
      const aliases = typeof row.board_aliases === 'string' ? JSON.parse(row.board_aliases) : (row.board_aliases || []);
      return [row.board_name, ...aliases].some((name) => {
        const candidate = normalizeBoard(name);
        return input && (candidate === input || (candidate.length >= 5 && (input.includes(candidate) || candidate.includes(input))));
      });
    });
    if (!matches.length) return null;
    return matches.find((row) => String(row.academic_year) === String(academicYear))
      || matches.find((row) => row.academic_year === 'ALL')
      || null;
  }

  static async findMatchingSources({ boardName, academicYear, examLevel, examSession, examPart, sourceType }, db = pool) {
    let rows;
    try {
      const [res] = await db.execute(
        `SELECT id, board_name, board_aliases, academic_year, exam_level, exam_session, exam_part,
                source_type, portal_adapter, result_url, gazette_filename, storage_provider, storage_key
           FROM adm_board_sources WHERE is_active = TRUE AND source_type = ?
          ORDER BY academic_year DESC, id DESC`,
        [sourceType]
      );
      rows = res;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
        ensureDatabaseMigrations(db).catch(() => {});
        const [res] = await db.execute(
          `SELECT id, board_name, board_aliases, academic_year,
                  source_type, result_url, gazette_filename, storage_provider, storage_key
             FROM adm_board_sources WHERE is_active = TRUE AND source_type = ?
            ORDER BY academic_year DESC, id DESC`,
          [sourceType]
        );
        rows = res.map((r) => ({
          ...r,
          exam_level: 'ALL',
          exam_session: 'ALL',
          exam_part: 'ALL',
          portal_adapter: 'AUTO_FORM',
        }));
      } else {
        throw err;
      }
    }
    const input = normalizeBoard(boardName);
    const metadataMatches = (sourceValue, requestedValue) => {
      if (!sourceValue || sourceValue === 'ALL') return true;
      if (!requestedValue || requestedValue === 'ALL' || requestedValue === 'UNKNOWN') return true;
      return String(sourceValue).toUpperCase() === String(requestedValue).toUpperCase();
    };

    const GENERIC_BOARD_WORDS = new Set(['bise', 'board', 'intermediate', 'secondary', 'education']);
    const inputTokens = String(boardName || '').toLowerCase().split(/[\s,._-]+/).filter((t) => t.length >= 3 && !GENERIC_BOARD_WORDS.has(t));

    const inputFamily = getBoardFamily(boardName);

    const matches = rows.filter((row) => {
      const aliases = typeof row.board_aliases === 'string' ? JSON.parse(row.board_aliases) : (row.board_aliases || []);
      const boardMatches = [row.board_name, ...aliases].some((name) => {
        const candidate = normalizeBoard(name);
        if (!input && !candidate) return true;
        if (input && candidate === input) return true;
        if (input && candidate.length >= 3 && (input.includes(candidate) || candidate.includes(input))) return true;
        // Board family matching (e.g. 'fbise' vs 'federal board islamabad', 'ajk' vs 'aj&k mirpur')
        const nameFamily = getBoardFamily(name);
        if (inputFamily && nameFamily && inputFamily === nameFamily) return true;
        // Check non-generic word token overlap (e.g. 'ajk', 'mirpur', 'lahore', 'rawalpindi')
        const nameTokens = String(name || '').toLowerCase().split(/[\s,._-]+/).filter((t) => t.length >= 3 && !GENERIC_BOARD_WORDS.has(t));
        return inputTokens.length > 0 && nameTokens.length > 0 && inputTokens.some((it) => nameTokens.includes(it));
      });

      const parsedDocYear = parseInt(academicYear, 10);
      const parsedRowYear = parseInt(row.academic_year, 10);
      const isYearClose = Number.isFinite(parsedDocYear) && Number.isFinite(parsedRowYear) && Math.abs(parsedDocYear - parsedRowYear) <= 2;

      const yearMatches = !academicYear || academicYear === 'ALL'
        || String(row.academic_year) === String(academicYear)
        || row.academic_year === 'ALL'
        || isYearClose;

      return boardMatches && yearMatches
        && metadataMatches(row.exam_level, examLevel)
        && metadataMatches(row.exam_session, examSession)
        && metadataMatches(row.exam_part, examPart);
    }).sort((left, right) => {
      const specificity = (row) => [
        row.academic_year === String(academicYear) ? 10 : 0,
        Math.abs(parseInt(row.academic_year, 10) - parseInt(academicYear, 10)) <= 1 ? 5 : 0,
        row.academic_year !== 'ALL' ? 2 : 0,
        Boolean(row.exam_level && row.exam_level !== 'ALL') ? 2 : 0,
        Boolean(row.exam_session && row.exam_session !== 'ALL') ? 1 : 0,
        Boolean(row.exam_part && row.exam_part !== 'ALL') ? 1 : 0,
      ].reduce((score, value) => score + Number(value), 0);
      return specificity(right) - specificity(left);
    });

    // Fallback: If no sources matched the specific year or session, but sources exist for the board & level,
    // return all active sources for that board and exam level so gazette cross-check is never missed.
    if (!matches.length && rows.length > 0) {
      const fallback = rows.filter((row) => {
        const aliases = typeof row.board_aliases === 'string' ? JSON.parse(row.board_aliases) : (row.board_aliases || []);
        const boardMatches = [row.board_name, ...aliases].some((name) => {
          const candidate = normalizeBoard(name);
          if (input && (candidate === input || (candidate.length >= 3 && (input.includes(candidate) || candidate.includes(input))))) return true;
          const nameFamily = getBoardFamily(name);
          if (inputFamily && nameFamily && inputFamily === nameFamily) return true;
          const nameTokens = String(name || '').toLowerCase().split(/[\s,._-]+/).filter((t) => t.length >= 3 && !GENERIC_BOARD_WORDS.has(t));
          return inputTokens.length > 0 && nameTokens.length > 0 && inputTokens.some((it) => nameTokens.includes(it));
        });
        return boardMatches && metadataMatches(row.exam_level, examLevel);
      });
      if (fallback.length > 0) return fallback;

      // Secondary fallback for gazettes: if examLevel matches (e.g. HSSC for FSc, SSC for Matric),
      // return active gazettes for that level so roll numbers are never missed even if board spelling varies
      if (sourceType === 'GAZETTE') {
        const levelMatches = rows.filter((row) => metadataMatches(row.exam_level, examLevel));
        return levelMatches;
      }
    }

    return matches;
  }

  static async save({ id, boardName, boardAliases, academicYear, examLevel, examSession, examPart, sourceType, portalAdapter, resultUrl, file, actorId }, db = pool) {
    await ensureDatabaseMigrations(db).catch(() => {});
    const normalizedName = String(boardName || '').trim().replace(/\s+/g, ' ');
    const year = String(academicYear || '').trim();
    if (id !== undefined && !/^\d+$/.test(String(id))) throw new AppError(400, 'INVALID_BOARD_SOURCE', 'Board source ID is invalid.');
    if (normalizedName.length < 2 || normalizedName.length > 160) throw new AppError(400, 'INVALID_BOARD_NAME', 'Enter a board name between 2 and 160 characters.');
    const aliases = [...new Set((Array.isArray(boardAliases) ? boardAliases : String(boardAliases || '').split(',')).map((value) => String(value).trim().replace(/\s+/g, ' ')).filter(Boolean))];
    if (aliases.some((value) => value.length < 2 || value.length > 160) || aliases.length > 10) throw new AppError(400, 'INVALID_BOARD_ALIASES', 'Board aliases must be 2 to 160 characters each, with no more than 10 aliases.');
    if (!(/^(\d{4})([-/](\d{2,4}))?$/.test(year) || (year === 'ALL' && sourceType === 'PORTAL_URL'))) {
      throw new AppError(400, 'INVALID_ACADEMIC_YEAR', 'Enter a year such as 2026 or 2026-27. Use ALL only for a year-independent result portal.');
    }
    if (!['PORTAL_URL', 'GAZETTE'].includes(sourceType)) throw new AppError(400, 'INVALID_SOURCE_TYPE', 'Choose a result portal or gazette source.');
    const cleanMetadata = (value, allowed, label) => {
      const normalized = String(value || '').trim().toUpperCase();
      if (normalized && !allowed.includes(normalized)) throw new AppError(400, 'INVALID_EXAM_METADATA', `Choose a valid ${label}.`);
      return normalized || null;
    };
    const level = cleanMetadata(examLevel, ['SSC', 'HSSC', 'ALL'], 'exam level');
    const session = cleanMetadata(examSession, ['ANNUAL', 'SUPPLEMENTARY', 'SECOND_ANNUAL', 'ALL'], 'exam session');
    const part = cleanMetadata(examPart, ['PART_I', 'PART_II', 'COMPOSITE', 'ALL', 'UNKNOWN'], 'exam part');
    if (!level || !session || !part) {
      throw new AppError(400, 'EXAM_METADATA_REQUIRED', 'Choose the exam level, session, and part. Select Any when the source covers more than one.');
    }
    const adapter = sourceType === 'PORTAL_URL' ? String(portalAdapter || 'AUTO_FORM').trim().toUpperCase() : null;
    if (sourceType === 'PORTAL_URL' && !['AUTO_FORM', 'FBISE', 'AJKBISE'].includes(adapter)) {
      throw new AppError(400, 'INVALID_PORTAL_ADAPTER', 'Choose a supported board portal adapter.');
    }

    let safeUrl = null;
    if (sourceType === 'PORTAL_URL') {
      try {
        const parsed = new URL(String(resultUrl || '').trim());
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        safeUrl = parsed.href;
      } catch {
        throw new AppError(400, 'INVALID_RESULT_URL', 'Enter a valid HTTPS result portal URL.');
      }
    } else if (file && (file.mimetype !== 'application/pdf' || file.buffer?.subarray(0, 5).toString('ascii') !== '%PDF-')) {
      throw new AppError(400, 'INVALID_GAZETTE', 'Upload a valid PDF gazette.');
    }

    const connection = await db.getConnection();
    let uploaded = null;
    let oldSource = null;
    let committed = false;
    let commitAttempted = false;
    try {
      if (sourceType === 'GAZETTE' && file) uploaded = await StorageService.uploadBoardGazette(file.buffer);
      await connection.beginTransaction();
      const [existing] = await connection.execute(
        `SELECT id, source_type, storage_provider, storage_key FROM adm_board_sources
          WHERE ${id ? 'id = ?' : sourceType === 'PORTAL_URL'
            ? 'board_name = ? AND academic_year = ? AND source_type = ? AND COALESCE(exam_level, \'\') = ? AND COALESCE(exam_session, \'\') = ? AND COALESCE(exam_part, \'\') = ?'
            : '1 = 0'} FOR UPDATE`,
        id ? [Number(id)] : sourceType === 'PORTAL_URL'
          ? [normalizedName, year, sourceType, level || '', session || '', part || '']
          : []
      );
      oldSource = existing[0] || null;
      if (sourceType === 'GAZETTE') {
        if (!file && !oldSource?.storage_key) throw new AppError(400, 'GAZETTE_REQUIRED', 'Upload the PDF gazette for this board and year.');
      }

      const storageProvider = sourceType === 'GAZETTE' ? (uploaded?.storageProvider || oldSource?.storage_provider || null) : null;
      const storageKey = sourceType === 'GAZETTE' ? (uploaded?.storageKey || oldSource?.storage_key || null) : null;
      const filename = sourceType === 'GAZETTE' ? (file?.originalname || oldSource?.gazette_filename || 'board-gazette.pdf').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 240) : null;

      if (oldSource) {
        await connection.execute(
          `UPDATE adm_board_sources SET board_name = ?, board_aliases = ?, academic_year = ?, exam_level = ?, exam_session = ?, exam_part = ?, source_type = ?, portal_adapter = ?, result_url = ?, gazette_filename = ?,
                  storage_provider = ?, storage_key = ?, is_active = TRUE, updated_by = ? WHERE id = ?`,
          [normalizedName, JSON.stringify(aliases), year, level, session, part, sourceType, adapter, safeUrl, filename, storageProvider, storageKey, actorId, oldSource.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO adm_board_sources (board_name, board_aliases, academic_year, exam_level, exam_session, exam_part, source_type, portal_adapter, result_url, gazette_filename,
                  storage_provider, storage_key, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [normalizedName, JSON.stringify(aliases), year, level, session, part, sourceType, adapter, safeUrl, filename, storageProvider, storageKey, actorId, actorId]
        );
      }
      commitAttempted = true;
      await connection.commit();
      committed = true;
    } catch (error) {
      if (!committed) await connection.rollback();
      if (uploaded && !commitAttempted) await StorageService.deleteFile(uploaded.storageKey, uploaded.storageProvider).catch(() => {});
      if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'BOARD_SOURCE_EXISTS', 'A source already exists for this board and academic year.');
      throw error;
    } finally {
      connection.release();
    }

    const newKey = sourceType === 'GAZETTE' ? (uploaded?.storageKey || oldSource?.storage_key) : null;
    if (oldSource?.storage_key && oldSource.storage_key !== newKey) {
      await StorageService.deleteFile(oldSource.storage_key, oldSource.storage_provider).catch((error) => console.error('Could not remove replaced board gazette:', error.message));
    }

    if (sourceType === 'GAZETTE') {
      this.triggerAutoVerificationForGazette({ examLevel: level, actorId, db }).catch((err) =>
        console.warn('[Gazette Auto-Verification] Error triggering scan:', err.message)
      );
    }

    return { success: true };
  }

  /**
   * Auto-scan all pending or manual-review candidate marksheets matching a newly uploaded or updated gazette
   */
  static async triggerAutoVerificationForGazette({ examLevel, actorId, db = pool }) {
    try {
      const targetDocTypes = examLevel === 'SSC' ? ['MATRIC_MARKSHEET']
        : examLevel === 'HSSC' ? ['FSC_MARKSHEET']
        : ['FSC_MARKSHEET', 'MATRIC_MARKSHEET'];

      const placeholders = targetDocTypes.map(() => '?').join(',');
      const [docs] = await db.query(
        `SELECT d.id, d.student_id, d.doc_type, d.extracted_data
           FROM adm_student_documents d
          WHERE d.doc_type IN (${placeholders})
            AND d.verification_status NOT IN ('MATCHED', 'PORTAL_VERIFIED')`,
        targetDocTypes
      );

      const { AdmissionIntakeService } = await import('./admission-intake.service.js');
      for (const doc of docs) {
        const extracted = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : (doc.extracted_data || {});
        if (extracted?.rollNumber) {
          await AdmissionIntakeService.searchGazetteForDocument({
            documentId: doc.id,
            actorId: actorId || null,
            db,
          }).catch((err) => console.warn(`[Gazette Auto-Verification] Error on doc ${doc.id}:`, err.message));
        }
      }
    } catch (err) {
      console.warn('[Gazette Auto-Verification] Failed to scan candidate marksheets:', err.message);
    }
  }

  static async activate(id, actorId, db = pool) {
    const [result] = await db.execute(`UPDATE adm_board_sources SET is_active = TRUE, updated_by = ? WHERE id = ?`, [actorId, id]);
    if (result.affectedRows !== 1) throw new AppError(404, 'BOARD_SOURCE_NOT_FOUND', 'Board source was not found.');

    const [rows] = await db.execute(`SELECT exam_level, source_type FROM adm_board_sources WHERE id = ?`, [id]);
    if (rows.length && rows[0].source_type === 'GAZETTE') {
      this.triggerAutoVerificationForGazette({ examLevel: rows[0].exam_level, actorId, db }).catch((err) =>
        console.warn('[Gazette Auto-Verification] Error triggering scan on activation:', err.message)
      );
    }
    return { success: true };
  }

  static async deactivate(id, actorId, db = pool) {
    const [result] = await db.execute(`UPDATE adm_board_sources SET is_active = FALSE, updated_by = ? WHERE id = ?`, [actorId, id]);
    if (result.affectedRows !== 1) throw new AppError(404, 'BOARD_SOURCE_NOT_FOUND', 'Board source was not found.');
    return { success: true };
  }

  static async delete(id, actorId, db = pool) {
    const [rows] = await db.execute(`SELECT id, storage_key, storage_provider FROM adm_board_sources WHERE id = ?`, [id]);
    if (!rows.length) throw new AppError(404, 'BOARD_SOURCE_NOT_FOUND', 'Board source was not found.');

    const source = rows[0];
    const [result] = await db.execute(`DELETE FROM adm_board_sources WHERE id = ?`, [id]);
    if (result.affectedRows !== 1) throw new AppError(404, 'BOARD_SOURCE_NOT_FOUND', 'Board source was not found.');

    if (source.storage_key) {
      await StorageService.deleteFile(source.storage_key, source.storage_provider).catch((err) =>
        console.warn(`[Board Source Delete] Could not delete stored file ${source.storage_key}:`, err.message)
      );
    }
    return { success: true };
  }
}
