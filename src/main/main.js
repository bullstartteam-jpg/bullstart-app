const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

let mainWindow;

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());

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
