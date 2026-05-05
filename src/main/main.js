const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { autoUpdater } = require('electron-updater');

let mainWindow;

// ---------------------------------------------------------------------------
// Auto-update — pulls latest release from GitHub and installs on next quit.
// ---------------------------------------------------------------------------
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => notifyRenderer('updater-status', { status: 'checking' }));
autoUpdater.on('update-available', (info) => notifyRenderer('updater-status', { status: 'available', version: info?.version }));
autoUpdater.on('update-not-available', () => notifyRenderer('updater-status', { status: 'up-to-date' }));
autoUpdater.on('download-progress', (p) => notifyRenderer('updater-status', {
  status: 'downloading',
  percent: Math.round(p.percent || 0),
  bytesPerSecond: p.bytesPerSecond,
}));
autoUpdater.on('update-downloaded', (info) => {
  notifyRenderer('updater-status', { status: 'downloaded', version: info?.version });
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update ready',
    message: `BullStart ${info?.version} đã tải xong. Khởi động lại để cài đặt?`,
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((res) => {
    if (res.response === 0) autoUpdater.quitAndInstall();
  }).catch(() => {});
});
autoUpdater.on('error', (err) => notifyRenderer('updater-status', { status: 'error', message: err?.message || String(err) }));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[updater] check failed', err?.message || err);
      });
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev', message: 'Skipped in dev build' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { status: r?.updateInfo ? 'available' : 'up-to-date', version: r?.updateInfo?.version };
  } catch (err) {
    return { status: 'error', message: err?.message || String(err) };
  }
});

// Open a URL in the user's default external browser.
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
  return false;
});

// Upload an object directly to an S3-compatible bucket (Backblaze B2) from
// the main process using credentials supplied by the renderer. Hub is not
// involved — it only persists the resulting public URL afterward.
ipcMain.handle('s3-upload', async (_event, { credentials, bucket, key, body, contentType }) => {
  if (!credentials?.access_key_id || !credentials?.secret_access_key) {
    throw new Error('Missing S3 credentials');
  }
  if (!bucket || !key) throw new Error('Missing bucket or key');

  const client = new S3Client({
    region: credentials.region || 'us-west-004',
    endpoint: credentials.endpoint,
    credentials: {
      accessKeyId: credentials.access_key_id,
      secretAccessKey: credentials.secret_access_key,
    },
    forcePathStyle: false,
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(body), // body is Uint8Array transferred from renderer
    ContentType: contentType || 'application/octet-stream',
    ACL: 'public-read',
  }));

  return { ok: true, key };
});

// Fetch image binary from any URL bypassing renderer CORS — used by the QR
// converter cron to grab Drive thumbnails / direct image URLs and re-render
// them locally on a canvas.
ipcMain.handle('fetch-image', async (_event, url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  return { base64: buf.toString('base64'), contentType };
});

// Fetch tracking from carrier.pressify.us by POSTing the shipping label URL.
// Done in the main process so we sidestep renderer CORS and don't need a server
// round-trip just to call the public carrier endpoint.
ipcMain.handle('fetch-tracking', async (_event, labelUrl) => {
  if (typeof labelUrl !== 'string' || !labelUrl) {
    throw new Error('Missing labelUrl');
  }
  // Drive /file/d/{id}/{view|edit|...} → direct download form so the carrier
  // gets the actual PDF rather than Drive's HTML preview wrapper.
  let url = labelUrl;
  const m = url.match(/(?:\/file\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
  if (m) {
    url = `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }

  const res = await fetch('https://carrier.pressify.us/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  let body = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }

  if (!res.ok) {
    const err = new Error(`Carrier HTTP ${res.status}`);
    err.upstreamStatus = res.status;
    err.upstreamBody = body;
    throw err;
  }

  const tracking = body?.tracking_id
    ?? body?.tracking
    ?? body?.trackingNumber
    ?? body?.data?.tracking_id
    ?? null;

  return {
    tracking_id: tracking,
    carrier: body?.carrier ?? null,
    raw: body,
  };
});
