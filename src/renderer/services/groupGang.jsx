// Shared automation-gangsheet group helpers, used by BOTH the Groups tab UI and
// the converter.jsx cron jobs (assign + auto-close). Keeping the build →
// upload → finalize pipeline here means manual "Chốt" and the auto-close hook
// produce byte-identical gangsheets through the same path.
//
// All heavy work (PDF build, B2 upload/delete) runs in the Electron renderer —
// there is no server-side build. See doc/automation_gangsheet.md.

import api from './api';
import { buildGangsheetForChunk } from './gangsheetBuilder';

// "Scratch Card" → "scratch-card" (mirror of Gangsheet.jsx slugifyAccessory).
function slugifyAccessory(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function dominantLineId(orders) {
  const counts = {};
  for (const o of orders) for (const it of o.items || []) {
    const li = it.product_variant?.product?.line_id;
    if (li) counts[li] = (counts[li] || 0) + 1;
  }
  let best = '', max = -1;
  for (const [k, v] of Object.entries(counts)) if (v > max) { max = v; best = k; }
  return best;
}

// Filename suffix for a group: accessory slug + `two_size`, matching the
// Compose tab's naming so press operators recognise the batch.
function groupNameSuffix(group, orders) {
  const two = group.side_type === 'two' ? 'two_size' : '';
  let accSlug = '';
  if (group.accessory_id) {
    let name = '';
    for (const o of orders) {
      for (const it of o.items || []) {
        for (const ap of it.accessory_prices || []) {
          if ((ap.accessory_id ?? ap.accessory?.id) == group.accessory_id) { name = ap.accessory?.name; break; }
        }
        const legacy = it.accessory_price;
        if (!name && legacy && (legacy.accessory_id ?? legacy.accessory?.id) == group.accessory_id) {
          name = legacy.accessory?.name;
        }
        if (name) break;
      }
      if (name) break;
    }
    accSlug = slugifyAccessory(name);
  }

  // Material: tag with the group's material name (group material = first item's
  // material; no "mixed" split).
  let matSlug = '';
  if (group.material_id) {
    let name = '';
    for (const o of orders) {
      for (const it of o.items || []) {
        if ((it.material_id ?? it.material?.id) == group.material_id) { name = it.material?.name; break; }
      }
      if (name) break;
    }
    matSlug = slugifyAccessory(name);
  }

  return [accSlug, matSlug, two].filter(Boolean).join('_');
}

/** POST /gangsheet-groups/assign — pull pending orders into open groups. */
export async function runGroupAssign() {
  const res = await api.post('/gangsheet-groups/assign');
  return res.data;
}

/** GET automation config (group_size + auto_close + close marks). */
export async function getAutomationConfig() {
  const res = await api.get('/gangsheet-groups/automation-config');
  return res.data;
}

export async function updateAutomationConfig(payload) {
  const res = await api.put('/gangsheet-groups/automation-config', payload);
  return res.data;
}

// Build + upload + finalize ONE already-claimed group (one bucket = one chunk).
// Always includeProduced=true: a group's membership defines exactly which
// orders belong, and a group reopened after a remove-design has remaining
// orders still flagged production=true — they must still land on the sheet.
async function generateOneClaimedGroup(group, orders, creds, onProgress) {
  const linePrefix = group.line_id || dominantLineId(orders);
  const suffix = groupNameSuffix(group, orders);

  const built = await buildGangsheetForChunk(orders, {
    linePrefix,
    includeProduced: true,
    nameSuffix: suffix,
    seq: group.seq,
    onProgress,
  });

  const key = `${creds.folder}/${built.filename}`;
  const bytes = new Uint8Array(await built.blob.arrayBuffer());
  await window.electronAPI.s3Upload({
    credentials: creds,
    bucket: creds.bucket,
    key,
    body: bytes,
    contentType: 'application/pdf',
  });
  const publicUrl = `${creds.public_url_base}/${key}`;

  const res = await api.post(`/gangsheet-groups/${group.id}/finalize`, {
    filename: built.filename,
    file_url: publicUrl,
    line_id: linePrefix || '',
    first_system_id: built.firstSid,
    last_system_id: built.lastSid,
    orders_count: built.ordersInChunk,
    metas_count: built.metasUsed,
    order_ids: built.orderIds,
    meta_ids: built.metaIds,
  });
  return res.data;
}

/**
 * Claim open groups (atomic on the server) and generate a gangsheet for each.
 * @param groupIds  specific group ids, or null/[] to claim ALL open groups
 *                  (used by the auto-close hook).
 * Returns the finalize responses ([{ group, gangsheet }, ...]).
 */
export async function generateClaimedGroups({ groupIds = null, onProgress } = {}) {
  if (!window.electronAPI?.s3Upload) {
    throw new Error('Cần mở từ app desktop (Electron) để build gangsheet.');
  }
  const creds = (await api.get('/gangsheets/storage-credentials')).data;

  const body = {};
  if (Array.isArray(groupIds) && groupIds.length) body.group_ids = groupIds;
  const groups = (await api.post('/gangsheet-groups/claim', body)).data.groups || [];

  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const { group, orders } = groups[i];
    onProgress?.({ groupIndex: i, totalGroups: groups.length, group, done: 0, total: 0 });
    const result = await generateOneClaimedGroup(group, orders, creds, (p) =>
      onProgress?.({ groupIndex: i, totalGroups: groups.length, group, ...p }));
    out.push(result);
  }
  return out;
}

/** Delete one group (orders → pending); clean up its B2 PDF if it had one. */
export async function deleteGroup(groupId) {
  const data = (await api.delete(`/gangsheet-groups/${groupId}`)).data || {};
  if (data.deleted_file_url) await s3DeleteByUrl(data.deleted_file_url);
  return data;
}

/** Delete ALL open groups (orders → pending) — used to rebuild after changing size. */
export async function deleteOpenGroups() {
  return (await api.post('/gangsheet-groups/delete-open')).data;
}

/** Best-effort delete of a gangsheet PDF on B2 from its public URL. */
export async function s3DeleteByUrl(fileUrl) {
  if (!fileUrl || !window.electronAPI?.s3Delete) return;
  try {
    const creds = (await api.get('/gangsheets/storage-credentials')).data;
    const base = (creds.public_url_base || '').replace(/\/$/, '') + '/';
    let key = fileUrl.startsWith(base) ? fileUrl.slice(base.length) : new URL(fileUrl).pathname.replace(/^\//, '');
    await window.electronAPI.s3Delete({ credentials: creds, bucket: creds.bucket, key });
  } catch (err) {
    console.warn('[group] B2 delete failed (ignored):', err);
  }
}

/**
 * Remove order(s) from a group → back to pending; delete the stale gang + its
 * B2 PDF; if orders remain, regenerate the group keeping the SAME seq.
 */
export async function removeDesignAndRegen(groupId, orderIds, onProgress) {
  const data = (await api.post(`/gangsheet-groups/${groupId}/remove-design`, { order_ids: orderIds })).data || {};
  if (data.deleted_file_url) await s3DeleteByUrl(data.deleted_file_url);

  let regenerated = null;
  if (data.group) {
    const results = await generateClaimedGroups({ groupIds: [groupId], onProgress });
    regenerated = results[0] || null;
  }
  return { ...data, regenerated };
}
