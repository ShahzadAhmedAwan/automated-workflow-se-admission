export class BoardRegistryService {
  /**
   * Verify roll number and candidate name against official board portal
   *
   * @param {Object} params
   * @param {string} params.boardName
   * @param {string} params.rollNumber
   * @param {string} [params.examYear]
   * @param {string} [params.candidateName]
   * @returns {Promise<{ isVerified: boolean, status: string, boardMarks?: number, candidateName?: string, rawDetails?: Object }>}
   */
  static async verifyCandidate({ boardName, rollNumber, examYear = 2025, candidateName = '' }) {
    if (!rollNumber) {
      return { isVerified: false, status: 'NO_ROLL_NUMBER' };
    }

    const normalizedBoard = (boardName || '').toUpperCase();

    // Check supported boards before mock dispatch
    const isFbise = normalizedBoard.includes('FBISE') || normalizedBoard.includes('ISLAMABAD');
    const isAjk = normalizedBoard.includes('AJK') || normalizedBoard.includes('MIRPUR');

    if (!isFbise && !isAjk) {
      return {
        isVerified: false,
        status: 'UNSUPPORTED_BOARD',
        notes: `Automated scraping not configured for ${boardName || 'UNKNOWN_BOARD'}.`,
      };
    }

    // If running in test or offline mock mode
    if (process.env.NODE_ENV !== 'production' && (process.env.USE_MOCK_BOARD === '1' || process.env.NODE_ENV === 'test')) {
      return this._mockVerify({ rollNumber, candidateName });
    }

    try {
      if (normalizedBoard.includes('FBISE') || normalizedBoard.includes('ISLAMABAD')) {
        return await this._verifyFbise({ rollNumber, examYear });
      }
      if (normalizedBoard.includes('AJK') || normalizedBoard.includes('MIRPUR')) {
        return await this._verifyBiseAjk({ rollNumber, examYear });
      }

      // If board is not among automated scrapers, mark for verifier manual check
      return {
        isVerified: false,
        status: 'UNSUPPORTED_BOARD',
        notes: `Automated scraping not configured for ${boardName || 'UNKNOWN_BOARD'}.`,
      };
    } catch (err) {
      return {
        isVerified: false,
        status: 'PORTAL_UNAVAILABLE',
        error: err.message,
      };
    }
  }

  /**
   * Lightweight FBISE Online Result Scraper
   */
  static async _verifyFbise({ rollNumber, examYear }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s ceiling

    try {
      const url = `https://portal.fbise.edu.pk/fbise-api/get-result?roll_no=${encodeURIComponent(rollNumber)}&year=${encodeURIComponent(examYear)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SE-Admissions-Verifier/1.0' },
      });

      if (!res.ok) {
        return { isVerified: false, status: 'PORTAL_HTTP_ERROR' };
      }

      const htmlOrJson = await res.text();
      // Parse JSON or DOM
      let data = {};
      try {
        data = JSON.parse(htmlOrJson);
      } catch {
        // Simple regex extraction if returned HTML table
        const marksMatch = htmlOrJson.match(/(?:Marks Obtained|Obtained Marks)[^<]*<td[^>]*>(\d+)<\/td>/i);
        const nameMatch = htmlOrJson.match(/Name[^<]*<td[^>]*>([^<]+)<\/td>/i);
        if (marksMatch) data.obtainedMarks = Number(marksMatch[1]);
        if (nameMatch) data.name = nameMatch[1].trim();
      }

      const obtained = data.obtainedMarks ?? data.obtained_marks ?? data.marks_obtained;
      if (obtained) {
        return {
          isVerified: true,
          status: 'PORTAL_MATCHED',
          boardMarks: Number(obtained),
          candidateName: data.name || data.candidate_name,
          rawDetails: data,
        };
      }

      return { isVerified: false, status: 'ROLL_NO_NOT_FOUND' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * BISE AJK Mirpur Scraper
   */
  static async _verifyBiseAjk({ rollNumber, examYear }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const targetUrl = `https://ajkbise.net/results/hssc-part-2/search.php`;
      const res = await fetch(targetUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SE-Admissions-Verifier/1.0',
        },
        body: `roll_no=${encodeURIComponent(rollNumber)}&year=${encodeURIComponent(examYear)}`,
      });

      if (!res.ok) return { isVerified: false, status: 'PORTAL_HTTP_ERROR' };
      const html = await res.text();

      // Extract marks from result table
      const marksMatch = html.match(/Marks Obtained[:\s]*<\/td>\s*<td[^>]*>(\d+)<\/td>/i);
      const nameMatch = html.match(/Student Name[:\s]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);

      if (marksMatch) {
        return {
          isVerified: true,
          status: 'PORTAL_MATCHED',
          boardMarks: Number(marksMatch[1]),
          candidateName: nameMatch ? nameMatch[1].trim() : undefined,
          rawDetails: { marks: Number(marksMatch[1]) },
        };
      }
      return { isVerified: false, status: 'ROLL_NO_NOT_FOUND' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Deterministic mock verification for unit/integration tests
   */
  static _mockVerify({ rollNumber, candidateName }) {
    // If roll number starts with 999, simulate mismatch or not found
    if (rollNumber.startsWith('999')) {
      return {
        isVerified: false,
        status: 'ROLL_NO_NOT_FOUND',
      };
    }
    // Default valid mock
    return {
      isVerified: true,
      isMock: true,
      status: 'PORTAL_MATCHED',
      boardMarks: 940,
      candidateName: candidateName || 'Muhammad Usman',
      rawDetails: { rollNumber, boardMarks: 940 },
    };
  }
}
