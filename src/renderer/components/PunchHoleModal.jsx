import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from './Dialog';
import { previewPunch, punchHole, punchedKey } from '../services/holePunch';

// Three gates, in this order, and none of them can be skipped:
//   1. review WHERE the hole will go, on the real artwork
//   2. punch + upload to B2 — the live design is still untouched
//   3. review the uploaded file, then replace the link
//
// The punched URL is parked on the check row between gates 2 and 3, so a
// reload (or a different operator) picks the review up where it was left.

const STEPS = ['Xem vị trí', 'Đã đục — xem lại', 'Thay link'];

export default function PunchHoleModal({ check, onClose, onDone }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // { dataUrl, box, source, out }
  const [punched, setPunched] = useState(null);   // { dataUrl, url }
  const [reconvert, setReconvert] = useState(true);
  // Ảnh dọc LUÔN được xoay ngang. Còn có co về khổ chuẩn 1006×634 hay không thì
  // để thợ chọn: co thì sửa luôn lỗi sai size, không co thì giữ nguyên pixel gốc.
  const [normalize, setNormalize] = useState(true);
  // null = để hệ thống tự chọn (ảnh dọc → -90° cho khớp composer). Seller đặt
  // file ở đủ mọi hướng nên thợ xoay tay đè lên được.
  const [rotate, setRotate] = useState(null);
  const [err, setErr] = useState(null);

  const chip = check?.chip;

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const p = await previewPunch(check.url, chip, { normalize, rotate });
        if (alive) setPreview(p);
      } catch (e) {
        if (alive) setErr(e?.message || 'Không dựng được xem trước');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [check?.id, normalize, rotate]);

  // Gate 1 → 2
  const doPunch = async () => {
    if (!window.electronAPI?.s3Upload) {
      setErr('Đục lỗ cần bản desktop (Electron).');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await punchHole(check.url, chip, { normalize, rotate: preview?.rotate ?? rotate });
      const credsRes = await api.get('/gangsheets/storage-credentials');
      const creds = credsRes.data;
      const key = punchedKey(creds, check.order?.system_id || check.order_id, check.order_item_id, chip);
      const bytes = new Uint8Array(await res.blob.arrayBuffer());
      await window.electronAPI.s3Upload({
        credentials: creds, bucket: creds.bucket, key, body: bytes, contentType: 'image/png',
      });
      const url = `${creds.public_url_base}/${key}`;
      await api.post(`/design-checks/${check.id}/punched`, { punched_url: url });
      setPunched({ dataUrl: res.dataUrl, url });
      setStep(1);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || 'Đục lỗ thất bại');
    } finally { setBusy(false); }
  };

  // Gate 3
  const doApply = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post(`/design-checks/${check.id}/apply`, { reconvert });
      notify(res.data.message, { title: 'Đã thay link', kind: 'success' });
      setStep(2);
      onDone?.();
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || 'Thay link thất bại');
    } finally { setBusy(false); }
  };

  if (!check) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-neutral-800">
              Đục lỗ chip — <span className="font-mono text-orange-500">{check.order?.system_id}</span>
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              item #{check.order_item_id} · {check.field} · chip <b>{chip}</b>
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none">×</button>
        </div>

        {/* Ba bước, không bỏ qua bước nào */}
        <div className="px-4 pt-3 flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <span key={s} className={`px-2 py-1 rounded ${i === step ? 'bg-orange-500 text-white' : i < step ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-400'}`}>
              {i + 1}. {s}
            </span>
          ))}
        </div>

        <div className="p-4 space-y-3">
          {err && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded p-2">{err}</div>}

          {step === 0 && (
            <>
              <p className="text-xs text-neutral-500">
                Khung đỏ là chỗ sẽ khoét, lấy đúng mask của template <b>{chip}</b>.
                Ảnh xuất ra <span className="font-mono">{preview?.out.w}×{preview?.out.h}</span> khổ ngang
                {preview?.source && (
                  <> (gốc <span className="font-mono">{preview.source.w}×{preview.source.h}</span>, xoay <b>{preview.rotate}°</b>)</>
                )}.
              </p>
              {busy && !preview && <p className="text-sm text-neutral-400">Đang dựng xem trước…</p>}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-neutral-700 cursor-pointer select-none">
                  <input type="checkbox" checked={normalize} onChange={e => setNormalize(e.target.checked)} className="accent-orange-500" />
                  Co về khổ chuẩn 1006×634
                </label>
                {/* Xoay tay: seller đặt file đủ mọi hướng, tự đoán không đủ. */}
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-xs text-neutral-500">Xoay:</span>
                  <button type="button" onClick={() => setRotate(((preview?.rotate ?? 0) + 270) % 360)}
                    className="px-2 py-1 text-sm rounded bg-neutral-100 hover:bg-neutral-200" title="Xoay trái 90°">⟲</button>
                  <button type="button" onClick={() => setRotate(((preview?.rotate ?? 0) + 90) % 360)}
                    className="px-2 py-1 text-sm rounded bg-neutral-100 hover:bg-neutral-200" title="Xoay phải 90°">⟳</button>
                  <span className="text-xs font-mono text-neutral-600 w-10 text-center">{preview?.rotate ?? '—'}°</span>
                  {rotate !== null && (
                    <button type="button" onClick={() => setRotate(null)}
                      className="text-xs text-neutral-400 hover:text-neutral-600">tự động</button>
                  )}
                </div>
              </div>
              {preview && (
                <>
                  <img src={preview.dataUrl} alt="preview" className="w-full border border-neutral-200 rounded" />
                  <p className="text-xs text-neutral-500">
                    Lỗ: <span className="font-mono">{preview.box.w}×{preview.box.h}px</span> tại
                    <span className="font-mono"> ({preview.box.x}, {preview.box.y})</span>
                  </p>
                </>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg bg-neutral-100 text-neutral-700">Huỷ</button>
                <button onClick={doPunch} disabled={busy || !preview}
                  className="px-4 py-2 text-sm rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-medium">
                  {busy ? 'Đang đục…' : 'Đúng vị trí — đục & upload'}
                </button>
              </div>
            </>
          )}

          {step === 1 && punched && (
            <>
              <p className="text-xs text-neutral-500">
                Đã đục và lưu lên B2. <b>Link thiết kế của đơn vẫn chưa đổi.</b> Xem kỹ lỗ rồi mới thay.
              </p>
              {/* Nền ca-rô để thấy rõ vùng trong suốt vừa khoét */}
              <div className="rounded border border-neutral-200 p-2" style={{
                backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
              }}>
                <img src={punched.dataUrl} alt="punched" className="w-full" />
              </div>
              <p className="text-xs text-neutral-400 break-all font-mono">{punched.url}</p>
              <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
                <input type="checkbox" checked={reconvert} onChange={e => setReconvert(e.target.checked)} className="accent-orange-500" />
                Xoá <span className="font-mono text-xs">_qr</span> để convert lại
              </label>
              <div className="flex justify-between gap-2">
                <button onClick={() => setStep(0)} className="px-3 py-2 text-sm rounded-lg bg-neutral-100 text-neutral-700">← Đục lại</button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg bg-neutral-100 text-neutral-700">Để sau</button>
                  <button onClick={doApply} disabled={busy}
                    className="px-4 py-2 text-sm rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium">
                    {busy ? 'Đang thay…' : 'Duyệt — thay link'}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-emerald-700">
                Đã thay link thiết kế{reconvert ? ' và xoá _qr để convert lại' : ''}. Lượt check sau sẽ đo lại chính file mới này.
              </p>
              <div className="flex justify-end">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white">Đóng</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
