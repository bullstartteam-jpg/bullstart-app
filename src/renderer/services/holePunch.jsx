import { fetchFileBytes } from './gangsheetBuilder';
import { driveOriginal } from '../utils/drive';
import { SPEC } from './designCheck';

// ---------------------------------------------------------------------------
// Chip-hole punching for card skins whose artwork arrived without a cutout.
//
// The hole is not drawn from numbers — it is lifted straight off the approved
// template as an alpha mask, so its rounded corners and anti-aliased edge come
// along. That keeps a punched file indistinguishable from one the designer cut
// by hand, and means the shape only ever changes by swapping the template.
//
// A portrait design is always rotated to landscape first — that is the
// orientation the composer prints in, and the template's hole is measured in
// it. Whether the artwork is ALSO resized to the reference card is the
// operator's call: normalising fixes a wrong size in the same pass (so the next
// check comes back clean), keeping the source size touches no pixel of the
// artwork but leaves the size fault to be dealt with separately.
// ---------------------------------------------------------------------------

export const TEMPLATES = {
  smallchip: '1W1By6g7fQQeXZEGaesm-_oU_JITtRfX4',
  bigchip: '1T8ef1VhoI2uaOajvh4dubBl7R7fwoBaW',
};

const OUT_W = SPEC.card.w;   // 1006
const OUT_H = SPEC.card.h;   // 634

/**
 * Góc xoay mặc định cho một ảnh: ảnh dọc quay -90° (ngược kim đồng hồ) cho
 * khớp với composeCardSkinOutside — nó dựng bản in bằng đúng phép xoay này,
 * nên đục theo chiều khác là lệch 180°. Seller lại hay đặt file ở đủ mọi
 * hướng, nên thợ vẫn xoay tay đè lên được.
 */
export function defaultRotation(imgW, imgH) {
  return imgH > imgW ? 270 : 0;
}

async function loadImg(url) {
  const bytes = await fetchFileBytes(driveOriginal(url));
  const objUrl = URL.createObjectURL(new Blob([bytes]));
  try {
    return await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Không decode được ảnh'));
      i.src = objUrl;
    });
  } finally {
    // Ảnh đã decode xong nên thu hồi ngay được, bitmap vẫn dùng tiếp bình thường.
    setTimeout(() => URL.revokeObjectURL(objUrl), 0);
  }
}

/** Kích thước sau khi xoay `deg` (0/90/180/270, thuận kim đồng hồ). */
function sizeAfter(img, deg) {
  const swap = deg === 90 || deg === 270;
  return swap
    ? { w: img.height, h: img.width }
    : { w: img.width, h: img.height };
}

/** Vẽ ảnh đã xoay `deg` rồi scale vừa khít canvas w×h. */
function drawRotated(img, deg, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  if (deg === 90) {
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, h, w);
  } else if (deg === 180) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, w, h);
  } else if (deg === 270) {
    ctx.translate(0, h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, h, w);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  ctx.restore();
  return { canvas: c, ctx };
}

// Mask của template chỉ tải một lần mỗi phiên — 2 file, dùng đi dùng lại.
const maskCache = new Map();
const scaledCache = new Map();   // `${chip}@${w}x${h}` → { mask, box }

/**
 * Mask lỗ của template: Float32 0..1 theo từng pixel (1 = khoét hẳn), cùng
 * bounding box để vẽ khung xem trước.
 */
export async function getHoleMask(chip) {
  if (maskCache.has(chip)) return maskCache.get(chip);
  const fid = TEMPLATES[chip];
  if (!fid) throw new Error(`Chưa có template cho "${chip}"`);

  const img = await loadImg(`https://drive.google.com/file/d/${fid}/view`);
  const { ctx } = drawRotated(img, defaultRotation(img.width, img.height), OUT_W, OUT_H);
  const px = ctx.getImageData(0, 0, OUT_W, OUT_H).data;

  // Vùng trong suốt chạm mép = nền + bo góc thẻ → loại. Phần còn lại là lỗ.
  const clear = new Uint8Array(OUT_W * OUT_H);
  for (let i = 0; i < OUT_W * OUT_H; i++) clear[i] = px[i * 4 + 3] < 128 ? 1 : 0;
  const outside = new Uint8Array(OUT_W * OUT_H);
  const stack = [];
  const push = (i) => { if (clear[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < OUT_W; x++) { push(x); push((OUT_H - 1) * OUT_W + x); }
  for (let y = 0; y < OUT_H; y++) { push(y * OUT_W); push(y * OUT_W + OUT_W - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % OUT_W; const y = (i - x) / OUT_W;
    if (x > 0) push(i - 1);
    if (x < OUT_W - 1) push(i + 1);
    if (y > 0) push(i - OUT_W);
    if (y < OUT_H - 1) push(i + OUT_W);
  }

  // Khung lỗ = CHỈ những pixel trong suốt hẳn mà không thông ra mép. Không thể
  // gom luôn pixel nửa trong suốt ở đây: viền ngoài của thẻ cũng khử răng cưa
  // (alpha 128–249), không bị flood fill chạm tới, và nếu tính chúng là lỗ thì
  // khung nở ra bằng cả tấm thẻ.
  let x0 = OUT_W; let y0 = OUT_H; let x1 = -1; let y1 = -1;
  for (let i = 0; i < OUT_W * OUT_H; i++) {
    if (!clear[i] || outside[i]) continue;
    const x = i % OUT_W; const y = (i - x) / OUT_W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error(`Template "${chip}" không tìm thấy lỗ khoét`);

  // Trong khung đó thì lấy nguyên alpha gốc (nới 3px để ôm hết mép khử răng
  // cưa của lỗ) → mép lỗ mượt đúng như template, ngoài khung tuyệt đối không
  // đụng vào.
  const PAD = 3;
  const bx0 = Math.max(0, x0 - PAD); const by0 = Math.max(0, y0 - PAD);
  const bx1 = Math.min(OUT_W - 1, x1 + PAD); const by1 = Math.min(OUT_H - 1, y1 + PAD);
  const mask = new Float32Array(OUT_W * OUT_H);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = y * OUT_W + x;
      if (outside[i]) continue;
      const a = px[i * 4 + 3];
      if (a >= 250) continue;
      mask[i] = 1 - a / 255;
    }
  }

  const out = { mask, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
  maskCache.set(chip, out);
  return out;
}

/**
 * Mask của template kéo về đúng khổ ảnh đích. Template đo ở 1006×634; design
 * giữ nguyên kích thước gốc (hoặc xuất ở 2×) thì lỗ phải co giãn theo, nếu
 * không sẽ khoét lệch chỗ.
 */
async function maskFor(chip, w, h) {
  if (w === OUT_W && h === OUT_H) return getHoleMask(chip);
  const key = `${chip}@${w}x${h}`;
  if (scaledCache.has(key)) return scaledCache.get(key);

  const base = await getHoleMask(chip);
  // Vẽ mask gốc (alpha = mức khoét) rồi scale bằng chính bộ nội suy của canvas.
  const src = document.createElement('canvas');
  src.width = OUT_W;
  src.height = OUT_H;
  const sctx = src.getContext('2d');
  const im = sctx.createImageData(OUT_W, OUT_H);
  for (let i = 0; i < OUT_W * OUT_H; i++) im.data[i * 4 + 3] = Math.round(base.mask[i] * 255);
  sctx.putImageData(im, 0, 0);

  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext('2d', { willReadFrequently: true });
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(src, 0, 0, w, h);
  const d = dctx.getImageData(0, 0, w, h).data;

  const mask = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] / 255;
  const sx = w / OUT_W; const sy = h / OUT_H;
  const out = {
    mask,
    box: {
      x: Math.round(base.box.x * sx), y: Math.round(base.box.y * sy),
      w: Math.round(base.box.w * sx), h: Math.round(base.box.h * sy),
    },
  };
  scaledCache.set(key, out);
  return out;
}

/**
 * Xem trước: ảnh đích đã chuẩn hoá + khung đỏ đúng chỗ sẽ đục. Không sửa gì.
 * Trả dataURL để hiển thị và số đo để đối chiếu.
 */
export async function previewPunch(url, chip, { normalize = true, rotate = null } = {}) {
  const img = await loadImg(url);
  const deg = rotate === null ? defaultRotation(img.width, img.height) : ((rotate % 360) + 360) % 360;
  const rot = sizeAfter(img, deg);
  const size = normalize ? { w: OUT_W, h: OUT_H } : rot;
  const { canvas, ctx } = drawRotated(img, deg, size.w, size.h);
  const { box } = await maskFor(chip, size.w, size.h);

  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 6]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(239,68,68,0.18)';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();

  return {
    dataUrl: canvas.toDataURL('image/png'),
    box,
    source: { w: img.width, h: img.height },
    rotate: deg,
    out: size,
  };
}

/** Đục thật: xoá alpha theo mask template, trả PNG blob (giữ trong suốt). */
export async function punchHole(url, chip, { normalize = true, rotate = null } = {}) {
  const img = await loadImg(url);
  const deg = rotate === null ? defaultRotation(img.width, img.height) : ((rotate % 360) + 360) % 360;
  const rot = sizeAfter(img, deg);
  const size = normalize ? { w: OUT_W, h: OUT_H } : rot;
  const { canvas, ctx } = drawRotated(img, deg, size.w, size.h);
  const { mask, box } = await maskFor(chip, size.w, size.h);

  const px = ctx.getImageData(0, 0, size.w, size.h);
  const d = px.data;
  for (let i = 0; i < size.w * size.h; i++) {
    const m = mask[i];
    if (m > 0) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - m));
  }
  ctx.putImageData(px, 0, 0);

  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png');
  });

  return {
    blob,
    dataUrl: canvas.toDataURL('image/png'),
    box,
    source: { w: img.width, h: img.height },
    rotate: deg,
    out: size,
  };
}

/** Tên file B2 cho bản đã đục — giữ dấu vết đơn/item để truy ngược. */
export function punchedKey(creds, systemId, itemId, chip) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  return `${creds.folder}/punched/${systemId}_${itemId}_${chip}_${stamp}.png`;
}
