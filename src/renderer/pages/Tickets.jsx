import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Pagination from '../components/Pagination';
import { notify } from '../components/Dialog';
import {
  TicketThreadModal, TicketStatusPill as StatusPill, TICKET_PLATFORM as PLATFORM, fmtTime as fmt,
} from '../components/TicketModals';

// Order support threads. Staff read every ticket; the API scopes sellers and
// partners for themselves (Ticket::scopeVisibleTo), so this screen sends no
// role filter of its own.
const FILTER_DEFAULTS = { status: '', platform: '', system_id: '', subject: '', unresolved: true, page: 1 };

export default function Tickets() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [list, setList] = useState({ data: [], last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState([]);

  const tickets = list.data || [];

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () => {
    if (selected.length === tickets.length && tickets.length > 0) setSelected([]);
    else setSelected(tickets.map(t => t.id));
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, per_page: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.platform) params.platform = filters.platform;
      if (filters.system_id) params.system_id = filters.system_id;
      if (filters.subject) params.subject = filters.subject;
      // Only meaningful without an explicit status — the two would fight.
      if (filters.unresolved && !filters.status) params.unresolved = 1;
      const res = await api.get('/tickets', { params });
      setList(res.data);
      setSelected([]);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được ticket', { title: 'Tickets', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [filters.page, filters.status, filters.platform, filters.unresolved]);

  const search = (e) => { e.preventDefault(); setFilters(f => ({ ...f, page: 1 })); fetchList(); };

  const copySelected = (field, label) => {
    const vals = tickets.filter(t => selected.includes(t.id)).map(t =>
      field === 'system_id' ? (t.order?.system_id || String(t.order_id)) : String(t.id)
    ).filter(Boolean);
    navigator.clipboard.writeText(vals.join('\n'));
    notify(`Đã copy ${vals.length} ${label}`, { kind: 'success' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-800">Tickets</h2>
        <span className="text-xs text-neutral-500">Tổng: {list.total ?? 0}</span>
      </div>

      <form onSubmit={search} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">System ID</label>
          <input value={filters.system_id} onChange={e => setFilters(f => ({ ...f, system_id: e.target.value }))}
            placeholder="PS_C3071"
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono w-40" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Subject</label>
          <input value={filters.subject} onChange={e => setFilters(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm w-48" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Status</label>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
            className="mt-1 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả</option>
            <option value="1">Open</option>
            <option value="3">Tin mới</option>
            <option value="2">Đã xong</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Platform</label>
          <select value={filters.platform} onChange={e => setFilters(f => ({ ...f, platform: e.target.value, page: 1 }))}
            className="mt-1 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả</option>
            <option value="1">Seller</option>
            <option value="2">Partner</option>
          </select>
        </div>
        <label className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg cursor-pointer ${filters.status ? 'opacity-40' : ''}`}>
          <input type="checkbox" checked={filters.unresolved} disabled={!!filters.status}
            onChange={e => setFilters(f => ({ ...f, unresolved: e.target.checked, page: 1 }))}
            className="accent-orange-500" />
          <span className="text-neutral-600">Chưa xử lý</span>
        </label>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Search</button>
        <button type="button" onClick={() => { setFilters(FILTER_DEFAULTS); }}
          className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Clear</button>
      </form>

      {selected.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-orange-700 font-medium">Đã chọn {selected.length} ticket</span>
          <button onClick={() => copySelected('system_id', 'System ID')}
            className="px-3 py-1 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg text-neutral-700 text-xs">Copy System ID</button>
          <button onClick={() => copySelected('id', 'Ticket ID')}
            className="px-3 py-1 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg text-neutral-700 text-xs">Copy Ticket ID</button>
          <button onClick={() => setSelected([])}
            className="ml-auto text-neutral-400 hover:text-neutral-700 text-xs">Bỏ chọn</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200 bg-[#faf8f6]">
              <th className="py-2 px-3 w-8" onClick={e => e.stopPropagation()}>
                <input type="checkbox"
                  checked={tickets.length > 0 && selected.length === tickets.length}
                  onChange={toggleSelectAll}
                  className="accent-orange-500 cursor-pointer" />
              </th>
              <th className="py-2 px-3 text-left">Order</th>
              <th className="py-2 px-3 text-left">Subject</th>
              <th className="py-2 px-3 text-left">Người tạo</th>
              <th className="py-2 px-3 text-left">Platform</th>
              <th className="py-2 px-3 text-center">Trả lời</th>
              <th className="py-2 px-3 text-left">Status</th>
              <th className="py-2 px-3 text-left">Tạo lúc</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-6 text-center text-neutral-400">Loading…</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={8} className="py-6 text-center text-neutral-400">Không có ticket nào</td></tr>
            ) : tickets.map(t => (
              <tr key={t.id} onClick={() => setOpenId(t.id)}
                className={`border-b border-neutral-100 hover:bg-orange-50/40 cursor-pointer ${selected.includes(t.id) ? 'bg-orange-50' : ''}`}>
                <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)}
                    className="accent-orange-500 cursor-pointer" />
                </td>
                <td className="py-2 px-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-orange-500">{t.order?.system_id || `#${t.order_id}`}</span>
                    <button title="Copy System ID" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(t.order?.system_id || String(t.order_id)); notify('Đã copy System ID', { kind: 'success' }); }}
                      className="text-neutral-400 hover:text-orange-500 leading-none select-none">⎘</button>
                    <button title="Copy Ticket ID" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(String(t.id)); notify(`Đã copy ticket #${t.id}`, { kind: 'success' }); }}
                      className="text-neutral-300 hover:text-neutral-600 leading-none font-mono select-none">#{t.id}</button>
                    <button title="Mở đơn hàng" onClick={e => { e.stopPropagation(); navigate(`/orders/${t.order_id}`); }}
                      className="text-neutral-400 hover:text-blue-500 leading-none select-none text-[11px]">↗</button>
                  </div>
                </td>
                <td className="py-2 px-3 text-neutral-800">{t.subject}</td>
                <td className="py-2 px-3 text-neutral-600">{t.creator?.name || '—'}</td>
                <td className="py-2 px-3 text-neutral-600">{PLATFORM[t.platform] || t.platform}</td>
                <td className="py-2 px-3 text-center text-neutral-600">{t.items_count ?? 0}</td>
                <td className="py-2 px-3"><StatusPill status={t.status} /></td>
                <td className="py-2 px-3 text-neutral-500 text-xs">{fmt(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={filters.page}
        lastPage={list.last_page}
        onChange={(p) => setFilters(f => ({ ...f, page: p }))}
      />

      {openId && <TicketThreadModal id={openId} onClose={() => setOpenId(null)} onChanged={fetchList} />}
    </div>
  );
}
