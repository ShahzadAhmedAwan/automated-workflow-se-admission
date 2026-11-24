import { useEffect, useState, useMemo } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button, ConfirmDialog } from '../../core/ui/primitives.jsx';
import {
  IconSearch,
  IconCheck,
  IconAlertTriangle,
  IconUploadCloud,
  IconRefresh,
  IconShield,
} from '../../core/icons/Icons.jsx';

const BOARD_PRESETS = [
  {
    name: 'Federal Board (FBISE)',
    shortName: 'FBISE Islamabad',
    aliases: 'Federal Board, FBISE, Islamabad Board, Federal Board of Intermediate and Secondary Education, FBISE Islamabad',
  },
  {
    name: 'BISE AJK Mirpur',
    shortName: 'BISE AJK Mirpur',
    aliases: 'AJK BISE, Mirpur Board, BISE Mirpur, Azad Jammu and Kashmir Board, AJ&K Board of Intermediate and Secondary Education',
  },
  {
    name: 'BISE Lahore',
    shortName: 'BISE Lahore',
    aliases: 'Lahore Board, BISE LHR, Board of Intermediate and Secondary Education Lahore',
  },
  {
    name: 'BISE Rawalpindi',
    shortName: 'BISE Rawalpindi',
    aliases: 'Rawalpindi Board, BISE RWP, Board of Intermediate and Secondary Education Rawalpindi',
  },
  {
    name: 'BISE Gujranwala',
    shortName: 'BISE Gujranwala',
    aliases: 'Gujranwala Board, BISE GRW, Board of Intermediate and Secondary Education Gujranwala',
  },
  {
    name: 'BISE Faisalabad',
    shortName: 'BISE Faisalabad',
    aliases: 'Faisalabad Board, BISE FSD, Board of Intermediate and Secondary Education Faisalabad',
  },
  {
    name: 'BISE Multan',
    shortName: 'BISE Multan',
    aliases: 'Multan Board, BISE MTN, Board of Intermediate and Secondary Education Multan',
  },
  {
    name: 'BISE Peshawar',
    shortName: 'BISE Peshawar',
    aliases: 'Peshawar Board, BISE Pesh, Board of Intermediate and Secondary Education Peshawar',
  },
];

function computeStandardName(board, level, year, session) {
  const cleanBoard = String(board || '').replace(/\s*-\s*(HSSC|SSC|Universal).*$/i, '').trim() || 'Board';
  const levelLabel = level === 'HSSC' ? 'HSSC (FSc)' : level === 'SSC' ? 'SSC (Matric)' : 'Universal';
  const sessionLabel = session === 'SECOND_ANNUAL' ? 'Second Annual' : 'Annual';
  return `${cleanBoard} - ${levelLabel} ${year || '2024'} ${sessionLabel}`;
}

const emptyForm = {
  boardName: '',
  boardAliases: '',
  academicYear: '2024',
  examLevel: 'HSSC',
  examSession: 'ANNUAL',
  examPart: 'ALL',
  sourceType: 'GAZETTE',
  portalAdapter: 'AUTO_FORM',
  resultUrl: '',
  gazette: null,
};

export function BoardSourcesPanel() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmSource, setConfirmSource] = useState(null);

  // Active Filter: 'ALL' | 'HSSC' | 'SSC' | 'PORTAL'
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Live Roll Tester States
  const [expandedTesterId, setExpandedTesterId] = useState(null);
  const [testRollInputs, setTestRollInputs] = useState({});
  const [testRollResults, setTestRollResults] = useState({});
  const [testingRollId, setTestingRollId] = useState(null);

  async function loadSources() {
    setLoading(true);
    try {
      const data = await verificationApi.listBoardSources();
      setSources(data || []);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not load board sources.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSources();
  }, []);

  function applyBoardPreset(preset) {
    const stdName = computeStandardName(preset.name, form.examLevel, form.academicYear, form.examSession);
    setForm((prev) => ({
      ...prev,
      boardName: stdName,
      boardAliases: preset.aliases,
    }));
  }

  function editSource(source) {
    setEditingId(source.id);
    setForm({
      boardName: source.board_name,
      boardAliases: (typeof source.board_aliases === 'string'
        ? JSON.parse(source.board_aliases)
        : source.board_aliases || []
      ).join(', '),
      academicYear: source.academic_year || '2024',
      examLevel: source.exam_level || 'HSSC',
      examSession: source.exam_session || 'ANNUAL',
      examPart: source.exam_part || 'ALL',
      sourceType: source.source_type || 'GAZETTE',
      portalAdapter: source.portal_adapter || 'AUTO_FORM',
      resultUrl: source.result_url || '',
      gazette: null,
    });
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const body = new FormData();
    if (editingId) body.set('id', editingId);
    body.set('boardName', form.boardName.trim());
    body.set('boardAliases', form.boardAliases.trim());
    body.set('academicYear', form.academicYear.trim());
    body.set('examLevel', form.examLevel);
    body.set('examSession', form.examSession);
    body.set('examPart', form.examPart);
    body.set('sourceType', form.sourceType);
    body.set('portalAdapter', form.portalAdapter);
    if (form.sourceType === 'PORTAL_URL') body.set('resultUrl', form.resultUrl.trim());
    if (form.gazette) body.set('gazette', form.gazette);

    try {
      await verificationApi.saveBoardSource(body);
      setMessage({
        type: 'success',
        text: `Official board ${form.sourceType === 'GAZETTE' ? 'gazette' : 'source'} saved successfully.`,
      });
      setEditingId(null);
      setForm(emptyForm);
      await loadSources();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not save this board source.' });
    } finally {
      setSaving(false);
    }
  }

  function handleDeactivateClick(source) {
    setConfirmSource(source);
  }

  async function confirmDeactivate() {
    if (!confirmSource) return;
    try {
      await verificationApi.deactivateBoardSource(confirmSource.id);
      await loadSources();
      setMessage({ type: 'success', text: `Turned off ${confirmSource.board_name} source.` });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not update this board source.' });
    } finally {
      setConfirmSource(null);
    }
  }

  async function handleTestRoll(sourceId) {
    const roll = testRollInputs[sourceId]?.trim();
    if (!roll) return;
    setTestingRollId(sourceId);
    setTestRollResults((prev) => ({ ...prev, [sourceId]: null }));
    try {
      const res = await verificationApi.testRollInGazette(sourceId, roll);
      setTestRollResults((prev) => ({
        ...prev,
        [sourceId]: { success: true, data: res.searchResult },
      }));
    } catch (err) {
      setTestRollResults((prev) => ({
        ...prev,
        [sourceId]: { success: false, error: err.message },
      }));
    } finally {
      setTestingRollId(null);
    }
  }

  function toggleTester(sourceId) {
    setExpandedTesterId((prev) => (prev === sourceId ? null : sourceId));
  }

  // Counts for institutional metrics
  const hsscCount = useMemo(
    () => sources.filter((s) => s.exam_level === 'HSSC' && s.source_type === 'GAZETTE').length,
    [sources]
  );
  const sscCount = useMemo(
    () => sources.filter((s) => s.exam_level === 'SSC' && s.source_type === 'GAZETTE').length,
    [sources]
  );
  const portalCount = useMemo(
    () => sources.filter((s) => s.source_type === 'PORTAL_URL').length,
    [sources]
  );
  const activeCount = useMemo(
    () => sources.filter((s) => s.is_active).length,
    [sources]
  );

  // Filtered sources
  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      // Filter by category tab
      if (activeFilter === 'HSSC' && s.exam_level !== 'HSSC') return false;
      if (activeFilter === 'SSC' && s.exam_level !== 'SSC') return false;
      if (activeFilter === 'PORTAL' && s.source_type !== 'PORTAL_URL') return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = String(s.board_name || '').toLowerCase().includes(query);
        const matchesYear = String(s.academic_year || '').toLowerCase().includes(query);
        const matchesFile = String(s.gazette_filename || '').toLowerCase().includes(query);
        const matchesAliases = String(s.board_aliases || '').toLowerCase().includes(query);
        if (!matchesName && !matchesYear && !matchesFile && !matchesAliases) return false;
      }
      return true;
    });
  }, [sources, activeFilter, searchQuery]);

  // Grouped sources when in 'ALL' view
  const hsscGroup = useMemo(
    () => filteredSources.filter((s) => s.exam_level === 'HSSC' && s.source_type === 'GAZETTE'),
    [filteredSources]
  );
  const sscGroup = useMemo(
    () => filteredSources.filter((s) => s.exam_level === 'SSC' && s.source_type === 'GAZETTE'),
    [filteredSources]
  );
  const portalGroup = useMemo(
    () => filteredSources.filter((s) => s.source_type === 'PORTAL_URL'),
    [filteredSources]
  );
  const otherGroup = useMemo(
    () => filteredSources.filter((s) => s.exam_level === 'ALL' && s.source_type === 'GAZETTE'),
    [filteredSources]
  );

  const standardTitlePreview = computeStandardName(
    form.boardName,
    form.examLevel,
    form.academicYear,
    form.examSession
  );

  return (
    <div className="space-y-6">
      {/* Refined Academic Institutional Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <IconShield className="size-5 text-blue-700" />
            </div>
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-sm font-bold text-slate-900">
                  Official Examination Gazettes & Board Archives
                </h3>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 uppercase tracking-wide border border-slate-200">
                  Intake Registry
                </span>
              </div>
              <p className="m-0 text-xs text-slate-600 max-w-3xl leading-relaxed">
                Official PDF result gazettes and verification adapters for <strong>Intermediate (FSc / HSSC)</strong> and <strong>Matriculation (SSC)</strong>. When candidates submit their marksheets, the automated intake engine extracts student roll numbers and verifies marks directly against these official board records.
              </p>
            </div>
          </div>

          {/* Institutional Status Counters */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-1.5 text-center min-w-[84px]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">HSSC Gazettes</div>
              <div className="text-sm font-bold text-indigo-700">{hsscCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-1.5 text-center min-w-[84px]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">SSC Gazettes</div>
              <div className="text-sm font-bold text-teal-700">{sscCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-1.5 text-center min-w-[84px]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active Total</div>
              <div className="text-sm font-bold text-emerald-700">{activeCount}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.88fr)_minmax(0,1.12fr)]">
        {/* Left Column: Gazette Upload & Source Configuration Form */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col">
          <div className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-sm font-bold text-slate-900">
                {editingId ? 'Update Board Archive' : 'Add Examination Archive / Source'}
              </h2>
              {editingId && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Editing Record #{editingId}
                </span>
              )}
            </div>
            <p className="mb-0 mt-0.5 text-xs text-slate-500">
              Configure official board parameters and register a PDF gazette file or portal adapter.
            </p>
          </div>

          {/* Segmented Source Type Switcher */}
          <div className="mt-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Archive Source Type:
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setForm({ ...form, sourceType: 'GAZETTE', resultUrl: '' })}
                className={`flex items-center justify-center rounded-lg py-1.5 px-3 text-xs font-semibold transition cursor-pointer ${
                  form.sourceType === 'GAZETTE'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PDF Gazette
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, sourceType: 'PORTAL_URL', gazette: null })}
                className={`flex items-center justify-center rounded-lg py-1.5 px-3 text-xs font-semibold transition cursor-pointer ${
                  form.sourceType === 'PORTAL_URL'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Web Result Portal
              </button>
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="mt-4">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Quick Select Board:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {BOARD_PRESETS.map((bp) => {
                const isSelected = form.boardName.toLowerCase().includes(bp.shortName.toLowerCase().split(' ')[1] || bp.shortName.toLowerCase());
                return (
                  <button
                    key={bp.name}
                    type="button"
                    onClick={() => applyBoardPreset(bp)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition cursor-pointer text-left truncate ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    title={bp.name}
                  >
                    {bp.shortName}
                  </button>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Standard Archive Name Helper Bar */}
            {form.sourceType === 'GAZETTE' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Standardized Title Preview:
                  </span>
                  {form.boardName !== standardTitlePreview && (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, boardName: standardTitlePreview }))}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      Use Standard Format
                    </button>
                  )}
                </div>
                <div className="font-mono text-xs font-semibold text-slate-900 mt-1 truncate">
                  {standardTitlePreview}
                </div>
              </div>
            )}

            <label className="block text-xs font-semibold text-slate-700">
              Official Board Name / Archive Title *
              <input
                required
                maxLength={160}
                value={form.boardName}
                onChange={(event) => setForm({ ...form, boardName: event.target.value })}
                placeholder="e.g. BISE AJK Mirpur - HSSC (FSc) 2023 Annual"
                className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              Board Aliases & Variations (Optional)
              <input
                maxLength={1000}
                value={form.boardAliases}
                onChange={(event) => setForm({ ...form, boardAliases: event.target.value })}
                placeholder="e.g. AJK BISE, Mirpur Board, Federal Board, FBISE"
                className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="mt-1 block font-normal text-[11px] text-slate-500">
                Comma-separated names to match OCR variations printed on marksheets.
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                Exam Level *
                <select
                  value={form.examLevel}
                  onChange={(event) => setForm({ ...form, examLevel: event.target.value })}
                  required
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none cursor-pointer"
                >
                  <option value="HSSC">FSc / HSSC (Intermediate 11th & 12th)</option>
                  <option value="SSC">Matric / SSC (Secondary 9th & 10th)</option>
                  <option value="ALL">Any Level (Universal)</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                Academic Year *
                <input
                  required
                  maxLength={20}
                  value={form.academicYear}
                  onChange={(event) => setForm({ ...form, academicYear: event.target.value.toUpperCase() })}
                  placeholder="e.g. 2024 or 2023"
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                Exam Session *
                <select
                  value={form.examSession}
                  onChange={(event) => setForm({ ...form, examSession: event.target.value })}
                  required
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none cursor-pointer"
                >
                  <option value="ANNUAL">Annual Examination</option>
                  <option value="SECOND_ANNUAL">Supplementary / Second Annual</option>
                  <option value="ALL">Any Session</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                Exam Part *
                <select
                  value={form.examPart}
                  onChange={(event) => setForm({ ...form, examPart: event.target.value })}
                  required
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">Composite / Complete (Part I & II)</option>
                  <option value="PART_II">Part II (12th / 10th)</option>
                  <option value="PART_I">Part I (11th / 9th)</option>
                </select>
              </label>
            </div>

            {form.sourceType === 'GAZETTE' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                <span className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Official Gazette PDF File {editingId && '(Choose file to replace existing PDF)'} *
                </span>
                <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-white p-4 text-center hover:border-blue-400 hover:bg-blue-50/20 transition cursor-pointer">
                  <IconUploadCloud className="size-6 text-slate-400 mb-1" />
                  <span className="text-xs font-medium text-slate-700">
                    {form.gazette ? form.gazette.name : 'Click to select official gazette PDF'}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    {form.gazette
                      ? `${(form.gazette.size / (1024 * 1024)).toFixed(2)} MB · Ready for upload`
                      : 'Supports multi-column high volume PDF gazettes (up to 50 MB)'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    required={!editingId}
                    onChange={(event) => setForm({ ...form, gazette: event.target.files?.[0] || null })}
                    className="sr-only"
                  />
                </label>
                {form.gazette && (
                  <div className="mt-2 flex items-center justify-between text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1">
                    <span className="font-semibold flex items-center gap-1.5 truncate">
                      <IconCheck className="size-3.5 text-emerald-600 shrink-0" />
                      {form.gazette.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, gazette: null })}
                      className="text-[11px] font-semibold text-rose-600 hover:underline shrink-0 ml-2 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Portal Adapter
                  <select
                    value={form.portalAdapter}
                    onChange={(event) => setForm({ ...form, portalAdapter: event.target.value })}
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none"
                  >
                    <option value="AUTO_FORM">Automatic Public Result Form</option>
                    <option value="FBISE">FBISE Result Portal</option>
                    <option value="AJKBISE">AJKBISE Result Portal</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Official HTTPS Result URL *
                  <input
                    required
                    type="url"
                    value={form.resultUrl}
                    onChange={(event) => setForm({ ...form, resultUrl: event.target.value })}
                    placeholder="https://official-board.edu.pk/results"
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 font-normal text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none"
                  />
                </label>
              </div>
            )}

            {message && (
              <div
                className={`rounded-lg p-3 text-xs ${
                  message.type === 'error'
                    ? 'border border-rose-200 bg-rose-50 text-rose-800'
                    : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded-lg">
                {saving
                  ? 'Indexing & Uploading...'
                  : editingId
                    ? 'Save Archive Changes'
                    : form.sourceType === 'GAZETTE'
                      ? 'Upload & Index Gazette'
                      : 'Register Portal Source'}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm);
                  }}
                >
                  Cancel Edit
                </Button>
              )}
            </div>
          </form>
        </section>

        {/* Right Column: Registered Examination Archives Organized by Level & Authority */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs flex flex-col">
          {/* Header with Title, Refresh, and Level Category Filter Tabs */}
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="m-0 text-sm font-bold text-slate-900">
                  Registered Examination Archives ({sources.length})
                </h2>
                <p className="mb-0 mt-0.5 text-xs text-slate-500">
                  Organized by education level. Intake documents automatically cross-check against these files.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="subtle" onClick={loadSources} disabled={loading} className="border border-slate-200 bg-white hover:bg-slate-50 text-xs">
                  <IconRefresh className="size-3.5 mr-1" />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Level Category Filter Tabs & Search */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-3">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveFilter('ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    activeFilter === 'ALL'
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  All Sources ({sources.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('HSSC')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    activeFilter === 'HSSC'
                      ? 'bg-white text-indigo-950 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span className="size-2 rounded-full bg-indigo-500" />
                  <span>FSc / HSSC ({hsscCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('SSC')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    activeFilter === 'SSC'
                      ? 'bg-white text-teal-950 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span className="size-2 rounded-full bg-teal-500" />
                  <span>Matric / SSC ({sscCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('PORTAL')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    activeFilter === 'PORTAL'
                      ? 'bg-white text-blue-950 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span className="size-2 rounded-full bg-blue-500" />
                  <span>Result Portals ({portalCount})</span>
                </button>
              </div>

              {/* Quick Search in sources */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter sources..."
                  className="h-8 w-36 sm:w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <p className="p-8 text-center text-xs text-slate-500">Loading board sources...</p>
          ) : filteredSources.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-xs font-medium text-slate-600">
                {searchQuery ? 'No board sources matched your search query.' : 'No board sources found for this category.'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Upload a PDF gazette using the form on the left to activate auto-verification.
              </p>
            </div>
          ) : (
            <div className="max-h-[720px] overflow-y-auto divide-y divide-slate-100">
              {activeFilter === 'ALL' && !searchQuery ? (
                // Grouped Institutional Sections for All
                <div className="divide-y divide-slate-200/80">
                  {/* Section 1: HSSC / Intermediate Gazettes */}
                  {hsscGroup.length > 0 && (
                    <div>
                      <div className="bg-indigo-50/50 px-4 py-2 border-b border-indigo-100/60 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
                          Intermediate / FSc (HSSC) Gazettes
                        </span>
                        <span className="text-[10px] font-bold text-indigo-700 bg-white border border-indigo-200 px-2 py-0.5 rounded-full">
                          {hsscGroup.length} {hsscGroup.length === 1 ? 'Gazette' : 'Gazettes'}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {hsscGroup.map((source) => (
                          <SourceCard
                            key={source.id}
                            source={source}
                            onEdit={editSource}
                            onDeactivate={handleDeactivateClick}
                            onToggleTester={toggleTester}
                            isExpanded={expandedTesterId === source.id}
                            testInput={testRollInputs[source.id] || ''}
                            onTestInputChange={(val) => setTestRollInputs((prev) => ({ ...prev, [source.id]: val }))}
                            onRunTest={() => handleTestRoll(source.id)}
                            testResult={testRollResults[source.id]}
                            isTesting={testingRollId === source.id}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 2: SSC / Matriculation Gazettes */}
                  {sscGroup.length > 0 && (
                    <div>
                      <div className="bg-teal-50/50 px-4 py-2 border-b border-teal-100/60 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-teal-900 uppercase tracking-wider">
                          Matriculation / SSC (Matric) Gazettes
                        </span>
                        <span className="text-[10px] font-bold text-teal-700 bg-white border border-teal-200 px-2 py-0.5 rounded-full">
                          {sscGroup.length} {sscGroup.length === 1 ? 'Gazette' : 'Gazettes'}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {sscGroup.map((source) => (
                          <SourceCard
                            key={source.id}
                            source={source}
                            onEdit={editSource}
                            onDeactivate={handleDeactivateClick}
                            onToggleTester={toggleTester}
                            isExpanded={expandedTesterId === source.id}
                            testInput={testRollInputs[source.id] || ''}
                            onTestInputChange={(val) => setTestRollInputs((prev) => ({ ...prev, [source.id]: val }))}
                            onRunTest={() => handleTestRoll(source.id)}
                            testResult={testRollResults[source.id]}
                            isTesting={testingRollId === source.id}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 3: Universal / Other Gazettes */}
                  {otherGroup.length > 0 && (
                    <div>
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                          General / Universal Gazettes
                        </span>
                        <span className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                          {otherGroup.length}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {otherGroup.map((source) => (
                          <SourceCard
                            key={source.id}
                            source={source}
                            onEdit={editSource}
                            onDeactivate={handleDeactivateClick}
                            onToggleTester={toggleTester}
                            isExpanded={expandedTesterId === source.id}
                            testInput={testRollInputs[source.id] || ''}
                            onTestInputChange={(val) => setTestRollInputs((prev) => ({ ...prev, [source.id]: val }))}
                            onRunTest={() => handleTestRoll(source.id)}
                            testResult={testRollResults[source.id]}
                            isTesting={testingRollId === source.id}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 4: Result Web Portals */}
                  {portalGroup.length > 0 && (
                    <div>
                      <div className="bg-blue-50/50 px-4 py-2 border-b border-blue-100/60 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider">
                          Official Board Result Portals
                        </span>
                        <span className="text-[10px] font-bold text-blue-700 bg-white border border-blue-200 px-2 py-0.5 rounded-full">
                          {portalGroup.length} {portalGroup.length === 1 ? 'Portal' : 'Portals'}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {portalGroup.map((source) => (
                          <SourceCard
                            key={source.id}
                            source={source}
                            onEdit={editSource}
                            onDeactivate={handleDeactivateClick}
                            onToggleTester={toggleTester}
                            isExpanded={expandedTesterId === source.id}
                            testInput={testRollInputs[source.id] || ''}
                            onTestInputChange={(val) => setTestRollInputs((prev) => ({ ...prev, [source.id]: val }))}
                            onRunTest={() => handleTestRoll(source.id)}
                            testResult={testRollResults[source.id]}
                            isTesting={testingRollId === source.id}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Filtered List View
                <div className="divide-y divide-slate-100">
                  {filteredSources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      onEdit={editSource}
                      onDeactivate={handleDeactivateClick}
                      onToggleTester={toggleTester}
                      isExpanded={expandedTesterId === source.id}
                      testInput={testRollInputs[source.id] || ''}
                      onTestInputChange={(val) => setTestRollInputs((prev) => ({ ...prev, [source.id]: val }))}
                      onRunTest={() => handleTestRoll(source.id)}
                      testResult={testRollResults[source.id]}
                      isTesting={testingRollId === source.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Confirmation Dialog */}
      {confirmSource && (
        <ConfirmDialog
          isOpen={Boolean(confirmSource)}
          title="Turn Off Board Source"
          message={`Turn off the ${confirmSource.board_name} (${confirmSource.academic_year}) source? It will no longer be queried during candidate document verification.`}
          confirmLabel="Turn Off Source"
          tone="warning"
          onConfirm={confirmDeactivate}
          onCancel={() => setConfirmSource(null)}
        />
      )}
    </div>
  );
}

/**
 * Clean Institutional Source Card with Collapsible Roll Tester
 */
function SourceCard({
  source,
  onEdit,
  onDeactivate,
  onToggleTester,
  isExpanded,
  testInput,
  onTestInputChange,
  onRunTest,
  testResult,
  isTesting,
}) {
  const isGazette = source.source_type === 'GAZETTE';
  const aliases =
    typeof source.board_aliases === 'string'
      ? JSON.parse(source.board_aliases)
      : source.board_aliases || [];

  return (
    <div className="p-4 transition hover:bg-slate-50/50 space-y-2.5">
      {/* Top Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm text-slate-900">{source.board_name}</span>

            {/* Level Badge */}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                source.exam_level === 'HSSC'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : source.exam_level === 'SSC'
                    ? 'bg-teal-50 text-teal-700 border border-teal-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {source.exam_level === 'HSSC'
                ? 'FSc / HSSC'
                : source.exam_level === 'SSC'
                  ? 'Matric / SSC'
                  : 'Universal'}
            </span>

            {/* Year & Session Badge */}
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200/80 rounded px-1.5 py-0.2">
              {source.academic_year} · {source.exam_session === 'SECOND_ANNUAL' ? '2nd Annual' : 'Annual'}
            </span>

            {/* Active Status */}
            {source.is_active ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.2">
                <span className="size-1.5 rounded-full bg-emerald-600" /> Active
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.2">
                Inactive
              </span>
            )}
          </div>

          {/* Subtitle File / URL Information */}
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2 pt-0.5">
            {isGazette ? (
              <span className="font-mono text-[11px] text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded inline-flex items-center gap-1">
                <span className="font-sans font-semibold text-slate-500">PDF:</span> {source.gazette_filename}
              </span>
            ) : (
              <span className="text-blue-700 bg-blue-50/70 border border-blue-200 px-2 py-0.5 rounded inline-flex items-center gap-1 text-[11px]">
                <span className="font-semibold text-blue-800">Portal:</span> {source.portal_adapter || 'AUTO_FORM'} ·{' '}
                <a
                  href={source.result_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline text-blue-700 truncate max-w-xs"
                >
                  {source.result_url}
                </a>
              </span>
            )}

            {aliases.length > 0 && (
              <span className="text-[11px] text-slate-400 truncate max-w-sm" title={aliases.join(', ')}>
                Aliases: {aliases.slice(0, 3).join(', ')}
                {aliases.length > 3 ? ` +${aliases.length - 3}` : ''}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex shrink-0 items-center gap-1.5">
          {isGazette && source.is_active && (
            <button
              type="button"
              onClick={() => onToggleTester(source.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer border ${
                isExpanded
                  ? 'bg-blue-700 text-white border-blue-700 shadow-2xs'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isExpanded ? 'Hide Test' : 'Test Roll'}
            </button>
          )}
          <Button size="sm" variant="subtle" onClick={() => onEdit(source)} className="border border-slate-200 bg-white hover:bg-slate-50 text-xs">
            Edit
          </Button>
          {source.is_active && (
            <Button size="sm" variant="subtle" onClick={() => onDeactivate(source)} className="border border-slate-200 bg-white hover:bg-slate-50 text-xs text-rose-700 hover:text-rose-800">
              Turn off
            </Button>
          )}
        </div>
      </div>

      {/* Collapsible Roll Number Tester Drawer */}
      {isGazette && source.is_active && isExpanded && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5 mt-2 space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              Test Roll Verification: {source.board_name}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Scans {source.gazette_filename}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={testInput}
              onChange={(e) => onTestInputChange(e.target.value)}
              placeholder="e.g. 535453 or 1056918"
              className="h-8.5 w-48 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onRunTest();
                }
              }}
            />
            <button
              type="button"
              disabled={isTesting || !testInput.trim()}
              onClick={onRunTest}
              className="h-8.5 rounded-lg bg-blue-700 px-3.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer shadow-2xs transition"
            >
              {isTesting ? 'Searching...' : 'Search Gazette'}
            </button>
          </div>

          {/* Search Result Display */}
          {testResult && (
            <div className="text-xs">
              {testResult.success ? (
                testResult.data?.found ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/90 p-2.5 text-emerald-900 space-y-1.5 shadow-2xs">
                    <div className="flex items-center gap-2 font-bold text-emerald-800 text-xs">
                      <IconCheck className="size-4 text-emerald-600" />
                      <span>Roll Number Verified & Extracted</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-white/70 p-2 rounded border border-emerald-100">
                      <div>
                        <span className="text-slate-500 block">Marks Extracted</span>
                        <span className="font-bold text-emerald-950 text-xs">
                          {testResult.data.obtainedMarks} / {testResult.data.totalMarks || 1100}
                          {testResult.data.percentage ? ` (${testResult.data.percentage}%)` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Exam Status</span>
                        <span className="font-bold uppercase text-emerald-800 text-xs">
                          {testResult.data.status || 'PASS'}
                        </span>
                      </div>
                      {testResult.data.candidateName && (
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-500 block">Candidate Name</span>
                          <span className="font-semibold text-slate-900 truncate block">
                            {testResult.data.candidateName}
                          </span>
                        </div>
                      )}
                    </div>
                    {testResult.data.rawSnippet && (
                      <div className="font-mono text-[10px] bg-slate-900 text-slate-100 p-2 rounded break-all select-all">
                        {testResult.data.rawSnippet}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-amber-900 text-xs flex items-center gap-2">
                    <IconAlertTriangle className="size-4 text-amber-600 shrink-0" />
                    <span>{testResult.data?.reason || 'Roll number was not found in this official gazette.'}</span>
                  </div>
                )
              ) : (
                <div className="rounded border border-rose-200 bg-rose-50 p-2.5 text-rose-800 text-xs flex items-center gap-2">
                  <IconAlertTriangle className="size-4 text-rose-600 shrink-0" />
                  <span><strong>Error:</strong> {testResult.error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
