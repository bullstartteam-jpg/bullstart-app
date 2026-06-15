import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from './Dialog';

// Create a resend order from an existing one. Loads the resend config + quota,
// previews the price (settings-driven base-cost support) and creates the order
// unpaid — the seller pays it from the new order via the normal flow.
export default function ResendModal({ order, onClose, onCreated }) {
  const [cfg, setCfg] = useState(null);
  const [method, setMethod] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pricing, setPricing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  // Address prefilled from the original order; editable (resend often ships to
  // a corrected address). Sent as override only when the operator edits it.
  const A = order.address || {};
  const [addr, setAddr] = useState({
    first_name: A.first_name || '', last_name: A.last_name || '',
    address_1: A.address_1 || '', address_2: A.address_2 || '',
    city: A.city || '', state: A.state || '', zipcode: A.zipcode || '',
    country: A.country || '', phone: A.phone || '', email: A.email || '',
  });

  useEffect(() => {
    api.get('/orders/resend-quota').then(res => {
      setCfg(res.data);
      setMethod(res.data.methods?.[0]?.key || '');
      setReason(res.data.reasons?.[0]?.key || '');
    }).catch(() => notify('Không tải được cấu hình resend', { title: 'Resend', kind: 'error' }));
  }, []);

  useEffect(() => {
    if (!method || !reason) return;
    let alive = true;
    api.post(`/orders/${order.id}/resend-preview`, { method, reason })
      .then(res => { if (alive) setPricing(res.data); })
      .catch(() => { if (alive) setPricing(null); });
    return () => { alive = false; };
  }, [method, reason, order.id]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/resend`, { method, reason, note, address: addr });
      await notify(`Đã tạo đơn resend ${res.data.order.system_id} — tổng $${res.data.pricing.total}. Vào đơn mới để thanh toán.`,
        { title: 'Resend', kind: 'success' });
      onCreated?.(res.data.order);
    } catch (err) {
      notify(err.response?.data?.message || 'Tạo resend thất bại', { title: 'Resend', kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-[460px] max-w-[92vw] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-neutral-800 mb-1">Tạo đơn resend</h3>
        <p className="text-xs text-neutral-500 mb-4">Đơn gốc: <span className="font-mono">{order.system_id}</span></p>

        {!cfg ? <div className="text-neutral-400 text-sm py-6">Loading…</div> : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Phương thức gửi lại</label>
              <div className="space-y-1.5">
                {cfg.methods.map(m => (
                  <label key={m.key} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${method === m.key ? 'border-orange-400 bg-orange-50' : 'border-neutral-200'}`}>
                    <input type="radio" name="resend-method" checked={method === m.key} onChange={() => setMethod(m.key)} className="mt-1" />
                    <div>
                      <div className="text-sm font-medium">{m.label} <span className="text-orange-600">${m.price}</span></div>
                      {m.desc && <div className="text-xs text-neutral-500">{m.desc}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-neutral-500 block mb-1">Lý do</label>
              <select value={reason} onChange={e => setReason(e.target.value)} className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
                {cfg.reasons.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-neutral-500 block mb-1">Ghi chú (tuỳ chọn)</label>
              <input value={note} onChange={e => setNote(e.target.value)} className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
            </div>

            {/* Shipping address (prefilled from original; editable). */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-neutral-500">Địa chỉ giao</label>
                <button type="button" onClick={() => setEditAddr(e => !e)} className="text-xs text-orange-600">{editAddr ? 'Thu gọn' : 'Sửa địa chỉ'}</button>
              </div>
              {!editAddr ? (
                <div className="text-xs text-neutral-600 bg-[#faf8f6] border border-neutral-200 rounded-lg p-2 leading-relaxed">
                  {[addr.first_name, addr.last_name].filter(Boolean).join(' ') || <span className="text-neutral-400">— chưa có tên —</span>}<br />
                  {[addr.address_1, addr.address_2].filter(Boolean).join(', ')}<br />
                  {[addr.city, addr.state, addr.zipcode].filter(Boolean).join(' ')} {addr.country}
                  {addr.phone && <><br />📞 {addr.phone}</>}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['first_name', 'First name'], ['last_name', 'Last name'],
                    ['address_1', 'Address 1'], ['address_2', 'Address 2'],
                    ['city', 'City'], ['state', 'State'],
                    ['zipcode', 'Zip'], ['country', 'Country'],
                    ['phone', 'Phone'], ['email', 'Email'],
                  ].map(([k, ph]) => (
                    <input key={k} value={addr[k]} onChange={e => setAddr(a => ({ ...a, [k]: e.target.value }))}
                      placeholder={ph} className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                  ))}
                </div>
              )}
            </div>

            <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              Resend free tháng này: <b className="text-emerald-700">{cfg.free_remaining}</b>/{cfg.free_quota} còn lại
              <span className="text-neutral-500"> (đã dùng {cfg.used})</span>
            </div>

            {pricing && (
              <div className="bg-neutral-50 rounded-lg p-3 text-sm">
                <div className="text-xs text-neutral-400 mb-1.5">Chi tiết phí đơn này</div>
                <div className="space-y-1">
                  {(pricing.components || []).filter(c => c.amount > 0 || c.key === 'base_cost').map(c => (
                    <div key={c.key} className="flex justify-between items-baseline">
                      <span className="text-neutral-600">
                        {c.label}
                        {c.supported && c.support_amount > 0 && (
                          <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            {c.support_pct >= 100 ? 'FREE' : `hỗ trợ ${c.support_pct}%`}
                          </span>
                        )}
                      </span>
                      <span className={c.charged === 0 ? 'text-emerald-600' : 'text-neutral-700'}>
                        {c.charged === 0
                          ? <><span className="line-through text-neutral-400 mr-1">${c.amount}</span>$0</>
                          : (c.support_amount > 0 ? <><span className="line-through text-neutral-400 mr-1">${c.amount}</span>${c.charged}</> : `$${c.amount}`)}
                      </span>
                    </div>
                  ))}
                </div>
                {pricing.support > 0 && (
                  <div className="flex justify-between text-emerald-600 text-xs mt-1.5 pt-1.5 border-t border-neutral-200">
                    <span>Xưởng hỗ trợ tổng</span><span>−${pricing.support}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold border-t border-neutral-200 pt-1.5 mt-1.5">
                  <span>Tổng seller trả</span><span className="text-orange-600">${pricing.total}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800">Huỷ</button>
              <button onClick={create} disabled={busy || !method || !reason} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
                {busy ? 'Đang tạo…' : 'Tạo đơn resend'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
