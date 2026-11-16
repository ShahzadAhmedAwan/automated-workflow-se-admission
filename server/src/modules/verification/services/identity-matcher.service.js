/**
 * Identity & Name Matching Service
 * Computes Levenshtein edit distance, phonetic and token-based similarity scores
 * to cross-verify applicant names across CNIC, academic marksheets, and declared lead records.
 */

export class IdentityMatcherService {
  /**
   * Classic Levenshtein edit distance with matrix optimization
   * @param {string} a 
   * @param {string} b 
   * @returns {number}
   */
  static calculateLevenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const matrix = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 0; i <= m; i++) matrix[i][0] = i;
    for (let j = 0; j <= n; j++) matrix[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    return matrix[m][n];
  }

  /**
   * Clean and normalize a personal name string
   * @param {string} str 
   * @returns {string}
   */
  static cleanName(str) {
    return String(str || '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Compare two personal names and return similarity percentage with human explanation
   * @param {string} nameA 
   * @param {string} nameB 
   * @returns {{ similarity: number, reason: string, isMatch: boolean }}
   */
  static compareNames(nameA, nameB) {
    const cleanA = this.cleanName(nameA);
    const cleanB = this.cleanName(nameB);

    if (!cleanA || !cleanB) {
      return { similarity: 0, reason: 'Name missing on one or both records', isMatch: false };
    }

    if (cleanA === cleanB) {
      return { similarity: 100, reason: 'Exact match', isMatch: true };
    }

    // Normalize hyphenation and multiple spaces
    const normA = cleanA.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    const normB = cleanB.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

    if (normA === normB) {
      return { similarity: 98, reason: 'Minor hyphenation or spacing difference', isMatch: true };
    }

    // Check token subsets (e.g. declared "haseeb" vs legal "sheikh haseeb ur rehman")
    const tokensA = normA.split(' ').filter(Boolean);
    const tokensB = normB.split(' ').filter(Boolean);

    const isSubset = tokensA.length > 0 && tokensB.length > 0 &&
      (tokensA.every((t) => tokensB.includes(t)) || tokensB.every((t) => tokensA.includes(t)));

    const dist = this.calculateLevenshtein(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);
    const rawSimilarity = Math.max(0, Math.min(100, Math.round((1 - dist / maxLen) * 100)));

    if (isSubset && rawSimilarity < 85) {
      return {
        similarity: 90,
        reason: 'Given name matches full legal name record',
        isMatch: true,
      };
    }

    let reason = 'High confidence match';
    let isMatch = rawSimilarity >= 80;

    if (rawSimilarity >= 95) {
      reason = 'Minor transliteration or spelling variation';
      isMatch = true;
    } else if (rawSimilarity >= 85) {
      reason = 'Acceptable transliteration variation (e.g. vowel differences)';
      isMatch = true;
    } else if (rawSimilarity >= 70) {
      reason = 'Moderate difference (requires staff review)';
      isMatch = false;
    } else {
      reason = 'Significant difference (potential identity mismatch)';
      isMatch = false;
    }

    return { similarity: rawSimilarity, reason, isMatch };
  }

  /**
   * Run comprehensive cross-document identity verification on a student dossier
   * @param {Object} params
   * @param {Object} params.student
   * @param {Array} params.documents
   * @returns {Object}
   */
  static crossCheckStudentIdentity({ student, documents = [] }) {
    const cnicDoc = documents.find((d) => d.doc_type === 'CNIC_FRONT' || d.doc_type === 'CNIC_BACK');
    const fscDoc = documents.find((d) => d.doc_type === 'FSC_MARKSHEET');
    const matricDoc = documents.find((d) => d.doc_type === 'MATRIC_MARKSHEET');

    const parseExtracted = (d) => {
      if (!d) return null;
      if (typeof d.extractedData === 'object' && d.extractedData !== null) return d.extractedData;
      if (typeof d.extracted_data === 'string') {
        try { return JSON.parse(d.extracted_data); } catch { return null; }
      }
      return d.extracted_data || null;
    };

    const cnicOcr = parseExtracted(cnicDoc);
    const fscOcr = parseExtracted(fscDoc);
    const matricOcr = parseExtracted(matricDoc);

    const declaredName = student?.full_name || '';
    const declaredFatherName = student?.father_name || '';

    const comparisons = [];

    // 1. CNIC vs FSc Marksheet
    if (cnicOcr?.candidateName && fscOcr?.candidateName) {
      const res = this.compareNames(cnicOcr.candidateName, fscOcr.candidateName);
      comparisons.push({
        pair: 'CNIC Front ⟷ FSc Marksheet',
        field: 'Candidate Name',
        nameA: cnicOcr.candidateName,
        nameB: fscOcr.candidateName,
        score: res.similarity,
        reason: res.reason,
        isMatch: res.isMatch,
      });
    }

    // 2. CNIC vs Matric Marksheet
    if (cnicOcr?.candidateName && matricOcr?.candidateName) {
      const res = this.compareNames(cnicOcr.candidateName, matricOcr.candidateName);
      comparisons.push({
        pair: 'CNIC Front ⟷ Matric Marksheet',
        field: 'Candidate Name',
        nameA: cnicOcr.candidateName,
        nameB: matricOcr.candidateName,
        score: res.similarity,
        reason: res.reason,
        isMatch: res.isMatch,
      });
    }

    // 3. FSc Marksheet vs Matric Marksheet
    if (fscOcr?.candidateName && matricOcr?.candidateName) {
      const res = this.compareNames(fscOcr.candidateName, matricOcr.candidateName);
      comparisons.push({
        pair: 'FSc Marksheet ⟷ Matric Marksheet',
        field: 'Candidate Name',
        nameA: fscOcr.candidateName,
        nameB: matricOcr.candidateName,
        score: res.similarity,
        reason: res.reason,
        isMatch: res.isMatch,
      });
    }

    // 4. Declared Lead Name vs Primary Legal Name (CNIC or Marksheet)
    const primaryLegalName = cnicOcr?.candidateName || fscOcr?.candidateName || matricOcr?.candidateName || '';
    if (declaredName && primaryLegalName) {
      const res = this.compareNames(declaredName, primaryLegalName);
      comparisons.push({
        pair: 'Declared Lead Name ⟷ Legal Name',
        field: 'Candidate Name',
        nameA: declaredName,
        nameB: primaryLegalName,
        score: res.similarity,
        reason: res.reason,
        isMatch: res.isMatch,
      });
    }

    // 5. Father Name Cross-Check (CNIC vs Marksheet)
    const cnicFather = cnicOcr?.fatherName || '';
    const marksheetFather = fscOcr?.fatherName || matricOcr?.fatherName || '';
    if (cnicFather && marksheetFather) {
      const res = this.compareNames(cnicFather, marksheetFather);
      comparisons.push({
        pair: 'CNIC Front ⟷ Marksheet',
        field: 'Father Name',
        nameA: cnicFather,
        nameB: marksheetFather,
        score: res.similarity,
        reason: res.reason,
        isMatch: res.isMatch,
      });
    }

    // Compute aggregate confidence score
    let overallScore = 100;
    if (comparisons.length > 0) {
      const totalScore = comparisons.reduce((sum, c) => sum + c.score, 0);
      overallScore = Math.round(totalScore / comparisons.length);
    }

    let status = 'CONFIRMED_MATCH';
    let statusLabel = 'High Confidence Match';
    if (overallScore < 75) {
      status = 'REVIEW_REQUIRED';
      statusLabel = 'Identity Review Required';
    } else if (overallScore < 90) {
      status = 'PROBABLE_MATCH';
      statusLabel = 'Probable Match with Minor Variations';
    }

    return {
      overallScore,
      status,
      statusLabel,
      totalComparisons: comparisons.length,
      allMatched: comparisons.every((c) => c.isMatch),
      comparisons,
    };
  }
}
