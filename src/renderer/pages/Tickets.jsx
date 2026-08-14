import { useState, useEffect } from 'react';
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
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [list, setList] = useState({ data: [], last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

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
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được ticket', { title: 'Tickets', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [filters.page, filters.status, filters.platform, filters.unresolved]);

  const search = (e) => { e.preventDefault(); setFilters(f => ({ ...f, page: 1 })); fetchList(); };

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

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200 bg-[#faf8f6]">
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
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">Loading…</td></tr>
            ) : list.data.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">Không có ticket nào</td></tr>
            ) : list.data.map(t => (
              <tr key={t.id} onClick={() => setOpenId(t.id)}
                className="border-b border-neutral-100 hover:bg-orange-50/40 cursor-pointer">
                <td className="py-2 px-3 font-mono text-orange-500 text-xs">{t.order?.system_id || `#${t.order_id}`}</td>
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
