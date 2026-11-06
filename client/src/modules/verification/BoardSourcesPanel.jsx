import { useEffect, useState } from 'react';
import { verificationApi } from './verificationApi.js';
import { Button } from '../../core/ui/primitives.jsx';

const emptyForm = { boardName: '', boardAliases: '', academicYear: '', sourceType: 'PORTAL_URL', resultUrl: '', gazette: null };

export function BoardSourcesPanel() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

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
      sourceType: source.source_type,
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
    body.set('sourceType', form.sourceType);
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

  async function deactivate(source) {
    if (!confirm(`Turn off the ${source.board_name} ${source.academic_year} source?`)) return;
    try {
      await verificationApi.deactivateBoardSource(source.id);
      await loadSources();
      setMessage('Board source turned off.');
    } catch (error) { setMessage(error.message || 'Could not update this board source.'); }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(20,30,50,0.035)]">
        <h2 className="m-0 text-base font-semibold text-slate-900">{editingId ? 'Update board source' : 'Add a board source'}</h2>
        <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">Add an official result page or a gazette staff can check during review.</p>
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
            <input required maxLength={20} value={form.academicYear} onChange={(event) => setForm({ ...form, academicYear: event.target.value.toUpperCase() })} placeholder={form.sourceType === 'PORTAL_URL' ? 'e.g. 2026 or ALL' : 'e.g. 2026 or 2026-27'} className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
            {form.sourceType === 'PORTAL_URL' && <span className="mt-1 block font-normal text-slate-500">Use ALL when the portal serves multiple years.</span>}
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Result source
            <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value, resultUrl: '', gazette: null })} className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">
              <option value="PORTAL_URL">Official result page</option>
              <option value="GAZETTE">PDF gazette</option>
            </select>
          </label>
          {form.sourceType === 'PORTAL_URL' ? (
            <label className="block text-xs font-medium text-slate-700">
              Official HTTPS URL
              <input required type="url" value={form.resultUrl} onChange={(event) => setForm({ ...form, resultUrl: event.target.value })} placeholder="https://board.example/results" className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 px-3 font-normal" />
            </label>
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
                  <p className="m-0 truncate text-sm font-semibold text-slate-800">{source.board_name} <span className="font-normal text-slate-500">· {source.academic_year}</span></p>
                  <p className="mb-0 mt-1 truncate text-xs text-slate-500">{source.is_active ? (source.source_type === 'GAZETTE' ? source.gazette_filename : source.result_url) : 'Inactive'}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="subtle" onClick={() => editSource(source)}>Edit</Button>
                  {source.is_active && <Button size="sm" variant="subtle" onClick={() => deactivate(source)}>Turn off</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
