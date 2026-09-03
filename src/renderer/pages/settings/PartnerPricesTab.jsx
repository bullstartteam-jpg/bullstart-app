import { useState, useEffect } from 'react';
import api from '../../services/api';
import { notify } from '../../components/Dialog';

/**
 * Partner rate cards — what a partner is paid, per card rather than per
 * partner, so workshops on the same terms share one and a rate is corrected
 * once.
 *
 * A key with no price is simply not paid: that is how "the partner earns the
 * print fees but not shipping" is said. There is deliberately no separate
 * list of enabled keys to fall out of step with the prices, so clearing a box
 * and saving removes the key from the card.
 */
export default function PartnerPricesTab() {
  const [lists, setLists] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadLists = async () => {
    const res = await api.get('/partner-price-lists');
    setLists(res.data || []);
    return res.data || [];
  };
  useEffect(() => { loadLists().catch(() => setLists([])); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/partner-price-lists', { name: newName.trim() });
      setNewName('');
      await loadLists();
      setActiveId(res.data?.list?.id ?? null);
    } catch (err) {
      notify(err?.response?.data?.message || 'Tạo bảng giá thất bại', { title: 'Bảng giá partner', kind: 'error' });
    } finally { setCreating(false); }
  };

  const remove = async (l) => {
    const warn = l.partners_count > 0
      ? `\n\n${l.partners_count} partner đang dùng bảng này sẽ về "chưa có bảng giá" và không tự tính được doanh thu.`
      : '';
    if (!confirm(`Xoá bảng giá "${l.name}"?${warn}`)) return;
    try {
      const res = await api.delete(`/partner-price-lists/${l.id}`);
      notify(res.data?.message || 'Đã xoá', { title: 'Bảng giá partner', kind: 'success' });
      if (activeId === l.id) setActiveId(null);
      await loadLists();
    } catch (err) {
      notify(err?.response?.data?.message || 'Xoá thất bại', { title: 'Bảng giá partner', kind: 'error' });
    }
  };

  if (!lists) return <div className="text-neutral-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Bảng giá partner</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Giá trả cho partner, theo bảng giá chứ không theo từng người — nhiều xưởng cùng đơn giá
          thì dùng chung một bảng, sửa một lần là xong. Key nào không nhập giá thì không được trả.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder="Tên bảng giá, vd: Xưởng Hà Nội"
            className="flex-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
          />
          <button onClick={create} disabled={creating || !newName.trim()}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
            {creating ? 'Đang tạo…' : 'Thêm'}
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có bảng giá nào.</p>
        ) : (
          <div className="space-y-1">
            {lists.map(l => (
              <div key={l.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  activeId === l.id ? 'border-orange-300 bg-orange-50/60' : 'border-neutral-200'
                }`}>
                <button onClick={() => setActiveId(activeId === l.id ? null : l.id)}
                  className="flex-1 text-left">
                  <div className="text-sm font-medium text-neutral-800">{l.name}</div>
                  <div className="text-[11px] text-neutral-500">
                    {l.variant_prices_count + l.accessory_prices_count} dòng giá
                    {l.partners?.length > 0
                      ? ` · ${l.partners.map(p => p.name).join(', ')}`
                      : ' · chưa gán partner'}
                  </div>
                </button>
                <button onClick={() => setActiveId(activeId === l.id ? null : l.id)}
                  className="text-xs text-orange-600 hover:text-orange-700">
                  {activeId === l.id ? 'Đóng' : 'Sửa giá'}
                </button>
                <button onClick={() => remove(l)} className="text-xs text-red-500 hover:text-red-600">Xoá</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {activeId && <PriceEditor listId={activeId} onSaved={loadLists} />}
    </div>
  );
}

function PriceEditor({ listId, onSaved }) {
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});        // "v:<variantId>:<key>" | "a:<id>" -> string
  const [partnerUsers, setPartnerUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await api.get(`/partner-price-lists/${listId}`);
    setData(res.data);
    const v = {};
    for (const variant of res.data.variants || []) {
      for (const k of variant.keys) {
        v[`v:${variant.variant_id}:${k.key}:pub`]  = k.partner_price         == null ? '' : String(k.partner_price);
        v[`v:${variant.variant_id}:${k.key}:priv`] = k.partner_price_private == null ? '' : String(k.partner_price_private);
      }
    }
    for (const a of res.data.accessories || []) {
      v[`a:${a.accessory_price_id}:pub`]  = a.partner_price         == null ? '' : String(a.partner_price);
      v[`a:${a.accessory_price_id}:priv`] = a.partner_price_private == null ? '' : String(a.partner_price_private);
    }
    setVals(v);
    setSelected(new Set((res.data.list?.partners || []).map(p => p.id)));
  };

  useEffect(() => {
    setData(null);
    load().catch(() => setData({ variants: [], accessories: [] }));
    api.get('/gangsheets/partner-users').then(r => setPartnerUsers(r.data || [])).catch(() => {});
  }, [listId]);

  const save = async () => {
    setSaving(true);
    try {
      // Collect pub+priv per (variantId, key) pair, then emit one row each.
      const variantMap = {};
      const accessoryMap = {};
      for (const [k, raw] of Object.entries(vals)) {
        const price = raw.trim() === '' ? null : Number(raw);
        if (price !== null && Number.isNaN(price)) continue;
        if (k.startsWith('v:')) {
          const parts = k.split(':');           // ['v', variantId, ...keyParts, tier]
          const tier = parts[parts.length - 1]; // 'pub' or 'priv'
          const variantId = parts[1];
          const key = parts.slice(2, -1).join(':');
          const mapKey = `${variantId}|${key}`;
          if (!variantMap[mapKey]) variantMap[mapKey] = { product_variant_id: Number(variantId), key };
          if (tier === 'pub')  variantMap[mapKey].price         = price;
          if (tier === 'priv') variantMap[mapKey].price_private = price;
        } else {
          const parts = k.split(':');           // ['a', id, tier]
          const tier = parts[parts.length - 1];
          const id = parts[1];
          if (!accessoryMap[id]) accessoryMap[id] = { accessory_price_id: Number(id) };
          if (tier === 'pub')  accessoryMap[id].price         = price;
          if (tier === 'priv') accessoryMap[id].price_private = price;
        }
      }
      const variants    = Object.values(variantMap);
      const accessories = Object.values(accessoryMap);
      await api.put(`/partner-price-lists/${listId}/prices`, { variants, accessories });
      await api.put(`/partner-price-lists/${listId}/partners`, { user_ids: [...selected] });
      notify('Đã lưu bảng giá', { title: 'Bảng giá partner', kind: 'success' });
      await load();
      onSaved?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu thất bại', { title: 'Bảng giá partner', kind: 'error' });
    } finally { setSaving(false); }
  };

  if (!data) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const set = (k, v) => setVals(p => ({ ...p, [k]: v }));
  const togglePartner = (id) => setSelected(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // Sum of the priced keys — what one unit pays, shown for public tier.
  const variantTotal = (variant) => variant.keys.reduce((s, k) => {
    const raw = vals[`v:${variant.variant_id}:${k.key}:pub`];
    const n = raw?.trim() === '' ? 0 : Number(raw);
    return s + (Number.isNaN(n) ? 0 : n);
  }, 0);

  return (
    <>
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-neutral-700">
            {data.list?.name} — giá theo variant
          </h3>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
            {saving ? 'Đang lưu…' : 'Lưu bảng giá'}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500 mb-3">
          Bỏ trống = không trả key đó. Cột <b>Giá seller</b> chỉ để tham chiếu khi cân biên lợi nhuận,
          sửa ở trang Products.
        </p>

        {data.variants.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có variant nào có bảng giá.</p>
        ) : data.variants.map(v => (
          <div key={v.variant_id} className="mb-4 border border-neutral-100 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[#faf8f6] flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-neutral-800">{v.product}</span>
              <span className="text-xs text-neutral-500">
                {[v.color, v.size].filter(Boolean).join(' / ')}
                {v.sku ? ` · ${v.sku}` : ''}
              </span>
              <span className="ml-auto text-xs text-neutral-500">
                Partner nhận: <b className="text-emerald-700">${variantTotal(v).toFixed(2)}</b> / cái
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 border-b border-neutral-100">
                  <th className="py-1.5 px-3 text-left">Key</th>
                  <th className="py-1.5 px-3 text-left">Giá seller</th>
                  <th className="py-1.5 px-3 text-right w-32">Partner (Public)</th>
                  <th className="py-1.5 px-3 text-right w-32">Partner (Private)</th>
                </tr>
              </thead>
              <tbody>
                {v.keys.map(k => (
                  <tr key={k.key} className="border-b border-neutral-50 last:border-0">
                    <td className="py-1.5 px-3 font-mono text-neutral-700">{k.key}</td>
                    <td className="py-1.5 px-3 text-neutral-500">
                      {k.seller_prices.map(sp => `${sp.tier}: $${sp.price}`).join(' · ')}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <input
                        type="text" inputMode="decimal"
                        value={vals[`v:${v.variant_id}:${k.key}:pub`] ?? ''}
                        onChange={e => set(`v:${v.variant_id}:${k.key}:pub`, e.target.value)}
                        placeholder="—"
                        className="w-24 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-right"
                      />
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <input
                        type="text" inputMode="decimal"
                        value={vals[`v:${v.variant_id}:${k.key}:priv`] ?? ''}
                        onChange={e => set(`v:${v.variant_id}:${k.key}:priv`, e.target.value)}
                        placeholder="—"
                        className="w-24 px-2 py-1 bg-[#faf8f6] border border-purple-200 rounded text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Giá add-on</h3>
        {data.accessories.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có add-on nào.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-200">
                <th className="py-1.5 px-2 text-left">Add-on</th>
                <th className="py-1.5 px-2 text-left">Style</th>
                <th className="py-1.5 px-2 text-left">Tier</th>
                <th className="py-1.5 px-2 text-right">Giá seller</th>
                <th className="py-1.5 px-2 text-right w-32">Giá partner</th>
              </tr>
            </thead>
            <tbody>
              {data.accessories.map(a => (
                <tr key={a.accessory_price_id} className="border-b border-neutral-50">
                  <td className="py-1.5 px-2 text-neutral-700">{a.accessory}</td>
                  <td className="py-1.5 px-2 text-neutral-600">{a.style || '—'}</td>
                  <td className="py-1.5 px-2 text-neutral-500">{a.tier}</td>
                  <td className="py-1.5 px-2 text-right text-neutral-500">${a.seller_price}</td>
                  <td className="py-1.5 px-2 text-right">
                    <input
                      type="text" inputMode="decimal"
                      value={vals[`a:${a.accessory_price_id}`] ?? ''}
                      onChange={e => set(`a:${a.accessory_price_id}`, e.target.value)}
                      placeholder="—"
                      className="w-24 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Partner dùng bảng giá này</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Bỏ tick là partner đó về "chưa có bảng giá" — doanh thu sẽ không tự tính được nữa.
          Lưu cùng lúc với giá ở nút trên.
        </p>
        {partnerUsers.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có tài khoản role <b>partner</b> nào.</p>
        ) : (
          <div className="space-y-1">
            {partnerUsers.map(u => (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => togglePartner(u.id)}
                  className="accent-orange-500" />
                <span className="text-sm text-neutral-800">{u.name}</span>
                <span className="text-xs text-neutral-400">{u.email}</span>
              </label>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
