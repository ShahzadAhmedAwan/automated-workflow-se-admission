import { useEffect, useState } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button, ConfirmDialog } from '../../core/ui/primitives.jsx';

const emptyForm = { boardName: '', boardAliases: '', academicYear: '', examLevel: '', examSession: '', examPart: 'ALL', sourceType: 'PORTAL_URL', portalAdapter: 'AUTO_FORM', resultUrl: '', gazette: null };

export function BoardSourcesPanel() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmSource, setConfirmSource] = useState(null);

  async function loadSources() {
    setLoading(true);
    try { setSources(await verificationApi.listBoardSources()); }
    catch (error) { setMessage(error.message || 'Could not load board sources.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSources(); }, []);

  function editSource(source) {
    setEditingId(source.id);
    setForm({
      boardName: source.board_name,
      boardAliases: (typeof source.board_aliases === 'string' ? JSON.parse(source.board_aliases) : source.board_aliases || []).join(', '),
      academicYear: source.academic_year,
      examLevel: source.exam_level || '',
      examSession: source.exam_session || '',
      examPart: source.exam_part || '',
      sourceType: source.source_type,
      portalAdapter: source.portal_adapter || 'AUTO_FORM',
      resultUrl: source.result_url || '',
      gazette: null,
    });
    setMessage('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
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
      setMessage('Board source saved.');
      setEditingId(null);
      setForm(emptyForm);
      await loadSources();
    } catch (error) {
      setMessage(error.message || 'Could not save this board source.');
    } finally { setSaving(false); }
  }

  function handleDeactivateClick(source) {
    setConfirmSource(source);
  }

  async function confirmDeactivate() {
    if (!confirmSource) return;
    try {
      await verificationApi.deactivateBoardSource(confirmSource.id);
      await loadSources();
      setMessage('Board source turned off.');
    } catch (error) {
      setMessage(error.message || 'Could not update this board source.');
    } finally {
      setConfirmSource(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(20,30,50,0.035)]">
        <h2 className="m-0 text-base font-semibold text-slate-900">{editingId ? 'Update board source' : 'Add a board source'}</h2>
        <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">Configure an official result lookup or add a gazette for automatic matching.</p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-xs font-medium text-slate-700">
            Board name
            <input required maxLength={160} value={form.boardName} onChange={(event) => setForm({ ...form, boardName: event.target.value })} placeholder="e.g. BISE AJK Mirpur" className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Other names on marksheets (optional)
            <input maxLength={1000} value={form.boardAliases} onChange={(event) => setForm({ ...form, boardAliases: event.target.value })} placeholder="e.g. AJK BISE, Mirpur Board" className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
            <span className="mt-1 block font-normal text-slate-500">Separate names with commas to match OCR results.</span>
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Academic year
            <input required maxLength={20} value={form.academicYear} onChange={(event) => setForm({ ...form, academicYear: event.target.value.toUpperCase() })} placeholder="e.g. 2022" className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">Exam level
              <select value={form.examLevel} onChange={(event) => setForm({ ...form, examLevel: event.target.value })} required className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
                <option value="">Choose level</option><option value="SSC">Matric / SSC</option><option value="HSSC">FSc / HSSC</option><option value="ALL">Any level</option>{form.examLevel === 'UNKNOWN' && <option value="UNKNOWN">Needs tagging</option>}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">Exam session
              <select value={form.examSession} onChange={(event) => setForm({ ...form, examSession: event.target.value })} required className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
                <option value="">Choose session</option><option value="ANNUAL">Annual</option><option value="SECOND_ANNUAL">Supplementary / Second Annual</option><option value="ALL">Any session</option>{form.examSession === 'UNKNOWN' && <option value="UNKNOWN">Needs tagging</option>}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">Exam part
              <select value={form.examPart} onChange={(event) => setForm({ ...form, examPart: event.target.value })} required className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
                <option value="">Choose part</option><option value="PART_I">Part I</option><option value="PART_II">Part II</option><option value="COMPOSITE">Composite</option><option value="ALL">Any part</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            Result source
            <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value, resultUrl: '', gazette: null })} className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
              <option value="PORTAL_URL">Official result page</option>
              <option value="GAZETTE">PDF gazette</option>
            </select>
          </label>
          {form.sourceType === 'PORTAL_URL' ? (
            <>
              <label className="block text-xs font-medium text-slate-700">Portal adapter
                <select value={form.portalAdapter} onChange={(event) => setForm({ ...form, portalAdapter: event.target.value })} className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
                  <option value="AUTO_FORM">Automatic public result form</option><option value="FBISE">FBISE result portal</option><option value="AJKBISE">AJKBISE result portal</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">Official HTTPS result page
                <input required type="url" value={form.resultUrl} onChange={(event) => setForm({ ...form, resultUrl: event.target.value })} placeholder="https://official-board-domain/results" className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
                <span className="mt-1 block font-normal text-slate-500">The system submits the roll number and reads the result page. It does not bypass CAPTCHA or login screens.</span>
              </label>
            </>
          ) : (
            <label className="block text-xs font-medium text-slate-700">
              Gazette PDF {editingId && '(choose a file to replace the current one)'}
              <input type="file" accept="application/pdf,.pdf" required={!editingId} onChange={(event) => setForm({ ...form, gazette: event.target.files?.[0] || null })} className="mt-1.5 block w-full rounded-md border border-slate-300 p-2 font-normal file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-blue-700" />
              <span className="mt-1 block font-normal text-slate-500">PDF only, up to 15 MB.</span>
            </label>
          )}
          {message && <p role="status" className="m-0 text-xs text-slate-600">{message}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add source'}</Button>
            {editingId && <Button type="button" variant="subtle" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>}
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_2px_8px_rgba(20,30,50,0.035)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="m-0 text-sm font-semibold text-slate-900">Configured boards</h2><p className="mb-0 mt-1 text-xs text-slate-500">These sources appear in candidate review dossiers.</p></div>
          <Button size="sm" variant="subtle" onClick={loadSources} disabled={loading}>Refresh</Button>
        </div>
        {loading ? <p className="p-8 text-center text-xs text-slate-500">Loading board sources…</p> : sources.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">No board sources have been added.</p>
        ) : (
          <ul className="m-0 divide-y divide-slate-100 p-0">
            {sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-800">{source.board_name} <span className="font-normal text-slate-500">· {source.exam_level === 'UNKNOWN' || source.exam_session === 'UNKNOWN' ? 'Needs exam tags' : `${source.exam_level || 'Any level'} · ${source.academic_year} · ${source.exam_session || 'Any session'}${source.exam_part ? ` · ${source.exam_part.replace('_', ' ')}` : ''}`}</span></p>
                  <p className="mb-0 mt-1 truncate text-xs text-slate-500">{source.is_active ? (source.source_type === 'GAZETTE' ? source.gazette_filename : `${source.portal_adapter || 'AUTO_FORM'} · ${source.result_url}`) : 'Inactive'}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="subtle" onClick={() => editSource(source)}>Edit</Button>
                  {source.is_active && <Button size="sm" variant="subtle" onClick={() => handleDeactivateClick(source)}>Turn off</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
