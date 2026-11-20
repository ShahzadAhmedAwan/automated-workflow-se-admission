import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function textFromHtml(html) {
  return decodeHtml(String(html || '')
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th|tr|p|div|li|br|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function isAllowedBoardHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return false;
  return host === 'ajkbise.net' || host.endsWith('.ajkbise.net')
    || host === 'biselahore.com' || host.endsWith('.biselahore.com')
    || host.endsWith('.edu.pk') || host.endsWith('.gov.pk');
}

function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168));
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return value !== '::' && value !== '::1' && !value.startsWith('fe80:') && !value.startsWith('fc') && !value.startsWith('fd');
  }
  return false;
}

async function isPublicBoardUrl(url, resolveHost = lookup) {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !isAllowedBoardHost(url.hostname)) return false;
  if (isIP(url.hostname)) return false;
  try {
    const addresses = await resolveHost(url.hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}

async function fetchBoardPage(initialUrl, options = {}, fetchImpl = fetch, resolveHost = lookup) {
  let url = new URL(initialUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (!await isPublicBoardUrl(url, resolveHost)) {
        return { ok: false, status: 'PORTAL_URL_REJECTED', text: '' };
      }
      const response = await fetchImpl(url, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'User-Agent': 'SE-Admissions-Result-Verification/1.0 (+staff admissions verification)',
          ...options.headers,
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirects === MAX_REDIRECTS) return { ok: false, status: 'PORTAL_REDIRECT_LIMIT', text: '' };
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) return { ok: false, status: 'PORTAL_HTTP_ERROR', httpStatus: response.status, text: '' };
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > MAX_RESPONSE_BYTES) return { ok: false, status: 'PORTAL_RESPONSE_TOO_LARGE', text: '' };
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return { ok: false, status: 'PORTAL_RESPONSE_TOO_LARGE', text: '' };
      return {
        ok: true,
        text,
        url: response.url || url.href,
        contentType: response.headers.get('content-type') || '',
        cookies: response.headers.getSetCookie?.().map((cookie) => cookie.split(';', 1)[0]).join('; ') || '',
      };
    }
    return { ok: false, status: 'PORTAL_REDIRECT_LIMIT', text: '' };
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 'PORTAL_TIMEOUT' : 'PORTAL_UNAVAILABLE', error: error.message, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function chooseOption(selectHtml, examYear, examLevel, examSession, examPart) {
  const selectAttrs = attributes(selectHtml.match(/^<select\b[^>]*>/i)?.[0] || '');
  const key = `${selectAttrs.name || ''} ${selectAttrs.id || ''}`.toLowerCase();
  const options = [...selectHtml.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => ({
    attrs: attributes(`<option ${match[1]}>`),
    text: textFromHtml(match[2]),
  }));
  const term = /year|session|exam|class|level|part|group|annual/i.test(key);
  if (!term) return options.find((option) => option.attrs.selected)?.attrs.value || options[0]?.attrs.value || '';
  const choices = [
    { pattern: new RegExp(String(examYear || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), value: examYear },
    { pattern: examLevel === 'SSC' ? /(?:^|[^a-z])ssc(?:$|[^a-z])|secondary|matric/i : /hssc|intermediate|fsc/i, value: examLevel },
    { pattern: examSession === 'SECOND_ANNUAL' ? /second\s*annual|supplement|supply|2nd\s*annual/i : /^(?!.*(?:second|2nd|supplement|supply)).*annual/i, value: examSession },
    { pattern: examPart === 'PART_I' ? /part\s*i\b|9th|11th/i : examPart === 'PART_II' ? /part\s*ii|10th|12th/i : /composite/i, value: examPart },
  ].filter((choice) => choice.value);
  const wanted = key.includes('year') ? choices.find((choice) => choice.value === examYear)
    : /session|term|annual/.test(key) ? choices.find((choice) => choice.value === examSession)
      : /class|level|degree|certificate/.test(key) ? choices.find((choice) => choice.value === examLevel)
        : /part/.test(key) ? choices.find((choice) => choice.value === examPart)
          : null;
  if (wanted) {
    const match = options.find((option) => wanted.pattern.test(`${option.text} ${option.attrs.value || ''}`));
    if (match) return match.attrs.value || match.text;
  }
  if (/exam|result/.test(key) && choices.length) {
    const match = options.find((option) => choices.every((choice) => choice.pattern.test(`${option.text} ${option.attrs.value || ''}`)));
    if (match) return match.attrs.value || match.text;
  }
  return options.find((option) => option.attrs.selected)?.attrs.value || options[0]?.attrs.value || '';
}

function buildFormSubmission(html, pageUrl, params) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const form = forms.find(([, , body]) => /roll|seat|result/i.test(body)) || forms[0];
  if (!form) return null;
  const formAttrs = attributes(`<form ${form[1]}>`);
  const action = new URL(formAttrs.action || pageUrl, pageUrl);
  if (action.protocol !== 'https:' || !isAllowedBoardHost(action.hostname)) return null;
  const fields = new URLSearchParams();
  const body = form[2];
  for (const match of body.matchAll(/<input\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    if (attr.name && !['submit', 'button', 'image', 'file'].includes((attr.type || 'text').toLowerCase())) {
      fields.set(attr.name, attr.value || '');
    }
  }
  for (const match of body.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
    const attr = attributes(match[0].match(/^<select\b[^>]*>/i)?.[0] || '');
    if (attr.name) fields.set(attr.name, chooseOption(match[0], params.examYear, params.examLevel, params.examSession, params.examPart));
  }
  for (const match of body.matchAll(/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi)) {
    const attr = attributes(`<textarea ${match[1]}>`);
    if (attr.name) fields.set(attr.name, textFromHtml(match[0].replace(/^<textarea[^>]*>|<\/textarea>$/gi, '')));
  }
  const rollField = [...body.matchAll(/<(input|textarea)\b[^>]*>/gi)]
    .map((match) => attributes(match[0]))
    .find((attr) => attr.name && /roll|seat|examno|exam_no|rollno|roll_no/i.test(`${attr.name} ${attr.id || ''} ${attr.placeholder || ''}`));
  if (!rollField) return null;
  fields.set(rollField.name, params.rollNumber);
  for (const match of body.matchAll(/<button\b[^>]*>|<input\b[^>]*type\s*=\s*["']?submit[^>]*>/gi)) {
    const attr = attributes(match[0]);
    if (attr.name && attr.value) fields.set(attr.name, attr.value);
  }
  return { url: action, method: (formAttrs.method || 'GET').toUpperCase(), fields };
}

function parseResult(html, { rollNumber, candidateName, sourceUrl, adapter }) {
  const text = textFromHtml(html);
  if (/captcha|verify you are human|security challenge|cloudflare/i.test(text)) {
    return { isVerified: false, status: 'PORTAL_INTERACTION_REQUIRED', sourceUrl, portalAdapter: adapter };
  }
  if (/result\s+(not\s+found|does\s+not\s+exist)|invalid\s+roll|no\s+record/i.test(text)) {
    return { isVerified: false, status: 'ROLL_NO_NOT_FOUND', sourceUrl, portalAdapter: adapter };
  }
  const escapedRoll = String(rollNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rollPresent = new RegExp(`\\b${escapedRoll}\\b`).test(text);
  const valueFor = (labels) => {
    for (const label of labels) {
      const pattern = new RegExp(`(?:${label})\\s*[:：-]?\\s*([^\\n|]{2,100})`, 'i');
      const match = text.match(pattern);
      if (match) return match[1].trim().replace(/\s{2,}/g, ' ');
    }
    return null;
  };
  const name = valueFor(['student\\s*name', 'candidate\\s*name', '(?<!father )name']);
  const marksText = valueFor(['marks\\s*obtained', 'obtained\\s*marks', 'grand\\s*total', 'total\\s*marks\\s*obtained']);
  const marksFraction = marksText?.match(/\b(\d{1,4})\s*\/\s*(\d{3,4})\b/);
  const obtainedText = marksFraction?.[1] || marksText?.match(/\b\d{1,4}\b/)?.[0];
  const totalText = marksFraction?.[2] || text.match(/(?:out of|maximum marks)\s*[:/]?\s*(\d{3,4})/i)?.[1];
  const status = valueFor(['result\\s*status', 'pass\\s*\/\\s*fail', 'status']);
  const isPass = status ? /pass/i.test(status) && !/fail/i.test(status) : null;
  if (!rollPresent || !name || !obtainedText) {
    return { isVerified: false, status: 'PORTAL_RESULT_UNCONFIRMED', sourceUrl, portalAdapter: adapter, resultExcerpt: text.slice(0, 1200) };
  }
  const normalizedName = name.replace(/^(?:student\s*name|candidate\s*name|name)\s*[:：-]?\s*/i, '').trim();
  return {
    isVerified: true,
    status: 'PORTAL_MATCHED',
    sourceType: 'PORTAL_URL',
    sourceUrl,
    portalAdapter: adapter,
    rollNumber: String(rollNumber),
    boardMarks: Number(obtainedText),
    totalMarks: totalText ? Number(totalText) : null,
    candidateName: normalizedName || candidateName || null,
    isPass,
    rawDetails: { resultExcerpt: text.slice(0, 1200) },
  };
}

export class BoardRegistryService {
  static async verifyCandidate({ boardName, rollNumber, examYear, examLevel, examSession, examPart, candidateName = '', sourceUrl, portalAdapter = 'AUTO_FORM', fetchImpl, resolveHost }) {
    if (!rollNumber) return { isVerified: false, status: 'NO_ROLL_NUMBER' };
    if (!sourceUrl) return { isVerified: false, status: 'PORTAL_NOT_CONFIGURED' };
    const normalizedBoard = String(boardName || '').toUpperCase();
    const adapter = String(portalAdapter || 'AUTO_FORM').toUpperCase();
    if (adapter === 'FBISE' && !/FBISE|FEDERAL|ISLAMABAD/.test(normalizedBoard)) return { isVerified: false, status: 'ADAPTER_BOARD_MISMATCH' };
    if (adapter === 'AJKBISE' && !/AJK|MIRPUR/.test(normalizedBoard)) return { isVerified: false, status: 'ADAPTER_BOARD_MISMATCH' };
    if (!['AUTO_FORM', 'FBISE', 'AJKBISE'].includes(adapter)) return { isVerified: false, status: 'UNSUPPORTED_ADAPTER' };
    try {
      const target = new URL(sourceUrl);
      if (adapter === 'FBISE' && target.hostname !== 'portal.fbise.edu.pk' && !target.hostname.endsWith('.fbise.edu.pk')) {
        return { isVerified: false, status: 'ADAPTER_URL_MISMATCH' };
      }
      if (adapter === 'AJKBISE' && target.hostname !== 'ajkbise.net' && !target.hostname.endsWith('.ajkbise.net')) {
        return { isVerified: false, status: 'ADAPTER_URL_MISMATCH' };
      }
    } catch {
      return { isVerified: false, status: 'PORTAL_URL_REJECTED' };
    }
    if ((!fetchImpl && process.env.NODE_ENV === 'test') || (process.env.NODE_ENV !== 'production' && process.env.USE_MOCK_BOARD === '1')) {
      return { ...this._mockVerify({ rollNumber, candidateName }), portalAdapter: adapter, sourceUrl };
    }
    const request = fetchImpl || fetch;
    const resolver = resolveHost || lookup;
    const first = await fetchBoardPage(sourceUrl, {}, request, resolver);
    if (!first.ok) return { isVerified: false, sourceType: 'PORTAL_URL', sourceUrl, portalAdapter: adapter, ...first };
    if (/application\/json/i.test(first.contentType)) return this._parseJson(first.text, { rollNumber, candidateName, sourceUrl, adapter });
    const params = { rollNumber: String(rollNumber), examYear, examLevel, examSession, examPart };
    const form = buildFormSubmission(first.text, first.url, params);
    if (!form) return { isVerified: false, status: 'PORTAL_FORM_UNSUPPORTED', sourceType: 'PORTAL_URL', sourceUrl, portalAdapter: adapter };
    const targetUrl = new URL(form.url.href);
    if (form.method === 'GET') {
      for (const [key, value] of form.fields) targetUrl.searchParams.set(key, value);
    }
    const response = await fetchBoardPage(targetUrl.href, {
      method: form.method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: first.url, ...(first.cookies ? { Cookie: first.cookies } : {}) },
      ...(form.method === 'GET' ? {} : { body: form.fields.toString() }),
    }, request, resolver);
    if (!response.ok) return { isVerified: false, sourceType: 'PORTAL_URL', sourceUrl, portalAdapter: adapter, ...response };
    if (/application\/json/i.test(response.contentType)) return this._parseJson(response.text, { rollNumber, candidateName, sourceUrl, adapter });
    return parseResult(response.text, { rollNumber, candidateName, sourceUrl, adapter });
  }

  static _parseJson(text, context) {
    try {
      const data = JSON.parse(text);
      const entry = data.result || data.data || data.candidate || data;
      const candidateName = entry.candidateName || entry.candidate_name || entry.name || entry.student_name;
      const boardMarks = Number(entry.obtainedMarks ?? entry.obtained_marks ?? entry.total_obtained ?? entry.marks);
      const returnedRoll = entry.rollNumber ?? entry.roll_number ?? entry.roll_no;
      const roll = String(returnedRoll || '');
      if (!returnedRoll || roll !== String(context.rollNumber) || !candidateName || !Number.isFinite(boardMarks)) {
        return { isVerified: false, status: 'PORTAL_RESULT_UNCONFIRMED', sourceType: 'PORTAL_URL', sourceUrl: context.sourceUrl, portalAdapter: context.adapter };
      }
      return {
        isVerified: true, status: 'PORTAL_MATCHED', sourceType: 'PORTAL_URL', sourceUrl: context.sourceUrl,
        portalAdapter: context.adapter, rollNumber: roll, candidateName, boardMarks,
        totalMarks: Number(entry.totalMarks ?? entry.total_marks) || null,
        isPass: typeof entry.isPass === 'boolean' ? entry.isPass
          : typeof entry.is_pass === 'boolean' ? entry.is_pass
            : /^(?:PASS|PASSED)$/i.test(String(entry.status || '')) ? true
              : /^(?:FAIL|FAILED|COMPARTMENT|ABSENT|WITHHELD)$/i.test(String(entry.status || '')) ? false : null,
        rawDetails: entry,
      };
    } catch {
      return { isVerified: false, status: 'PORTAL_INVALID_RESPONSE', sourceType: 'PORTAL_URL', sourceUrl: context.sourceUrl, portalAdapter: context.adapter };
    }
  }

  static _mockVerify({ rollNumber, candidateName }) {
    if (String(rollNumber).startsWith('999')) return { isVerified: false, status: 'ROLL_NO_NOT_FOUND', isMock: true };
    return { isVerified: true, isMock: true, status: 'PORTAL_MATCHED', boardMarks: 940, candidateName: candidateName || 'Muhammad Usman', rawDetails: { rollNumber, boardMarks: 940 } };
  }
}
