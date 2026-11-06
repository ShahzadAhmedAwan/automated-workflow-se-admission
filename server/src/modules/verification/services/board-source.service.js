import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { StorageService } from './storage/storage.service.js';

function normalizeBoard(value) {
  return String(value || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export class BoardSourceService {
  static async list({ activeOnly = false } = {}, db = pool) {
    const [rows] = await db.execute(
      `SELECT id, board_name, board_aliases, academic_year, source_type, result_url, gazette_filename, is_active, created_at, updated_at
         FROM adm_board_sources ${activeOnly ? 'WHERE is_active = TRUE' : ''}
        ORDER BY board_name ASC, academic_year DESC`
    );
    return rows;
  }

  static async findForBoard(boardName, academicYear, db = pool) {
    const [rows] = await db.execute(
      `SELECT id, board_name, board_aliases, academic_year, source_type, result_url, gazette_filename
         FROM adm_board_sources WHERE is_active = TRUE ORDER BY academic_year DESC`
    );
    const input = normalizeBoard(boardName);
    const matches = rows.filter((row) => {
      const aliases = typeof row.board_aliases === 'string' ? JSON.parse(row.board_aliases) : (row.board_aliases || []);
      return [row.board_name, ...aliases].some((name) => {
        const candidate = normalizeBoard(name);
        return input && (candidate === input || input.includes(candidate) || candidate.includes(input));
      });
    });
    if (!matches.length) return null;
    return matches.find((row) => String(row.academic_year) === String(academicYear))
      || matches.find((row) => row.academic_year === 'ALL')
      || null;
  }

  static async save({ id, boardName, boardAliases, academicYear, sourceType, resultUrl, file, actorId }, db = pool) {
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
        `SELECT id, storage_provider, storage_key FROM adm_board_sources
          WHERE ${id ? 'id = ?' : 'board_name = ? AND academic_year = ?'} FOR UPDATE`,
        id ? [Number(id)] : [normalizedName, year]
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
          `UPDATE adm_board_sources SET board_name = ?, board_aliases = ?, academic_year = ?, source_type = ?, result_url = ?, gazette_filename = ?,
                  storage_provider = ?, storage_key = ?, is_active = TRUE, updated_by = ? WHERE id = ?`,
          [normalizedName, JSON.stringify(aliases), year, sourceType, safeUrl, filename, storageProvider, storageKey, actorId, oldSource.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO adm_board_sources (board_name, board_aliases, academic_year, source_type, result_url, gazette_filename,
                  storage_provider, storage_key, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [normalizedName, JSON.stringify(aliases), year, sourceType, safeUrl, filename, storageProvider, storageKey, actorId, actorId]
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
    return { success: true };
  }

  static async deactivate(id, actorId, db = pool) {
    const [result] = await db.execute(`UPDATE adm_board_sources SET is_active = FALSE, updated_by = ? WHERE id = ?`, [actorId, id]);
    if (result.affectedRows !== 1) throw new AppError(404, 'BOARD_SOURCE_NOT_FOUND', 'Board source was not found.');
    return { success: true };
  }
}
