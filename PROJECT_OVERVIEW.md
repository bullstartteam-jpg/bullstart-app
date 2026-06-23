# BullStart Desktop App — Tổng quan dự án

> Tài liệu này được tổng hợp tự động từ mã nguồn (phiên bản `1.1.20`). Mục đích là cung cấp cái nhìn tổng thể cho người mới tiếp cận dự án: kiến trúc, các module chức năng, luồng dữ liệu và các tích hợp bên ngoài.

---

## 1. Giới thiệu chung

**BullStart** là một **ứng dụng desktop** được xây dựng bằng **Electron + React**, dùng để quản lý nghiệp vụ **fulfillment / in ấn theo đơn (print-on-demand)**. Ứng dụng đóng vai trò là *client dày* (rich client) kết nối tới backend REST API tại `https://bullstart.us/api`, đồng thời tận dụng tài nguyên máy cục bộ để chạy các tác vụ nặng (dựng file PDF gangsheet, tạo QR/barcode, upload trực tiếp lên S3/B2…).

- **Tên app:** BullStart (`com.bullstart.app`)
- **Phiên bản hiện tại:** `1.1.20`
- **Đối tượng người dùng:** admin, support, seller (phân quyền theo role + tier)
- **Nền tảng build được:** Windows (NSIS), macOS (DMG), Linux
- **Auto-update:** Lấy bản phát hành mới từ GitHub Releases (`bullstartteam-jpg/bullstart-app`) qua `electron-updater`

---

## 2. Ngăn xếp công nghệ (Tech stack)

### Runtime & Framework
- **Electron 41** — vỏ desktop, tách biệt main process / renderer.
- **React 19** + **React Router 7** (HashRouter, do file:// scheme khi đóng gói).
- **Tailwind CSS 4** + PostCSS — styling.
- **Webpack 5** + Babel — bundler cho renderer.

### Thư viện nghiệp vụ chính
| Thư viện | Mục đích |
|---|---|
| `axios` | HTTP client gọi backend (`/api`) |
| `@aws-sdk/client-s3` | Upload/Delete file lên Backblaze B2 (S3-compatible) |
| `pdf-lib`, `jspdf`, `jspdf-autotable`, `pdfjs-dist` | Dựng & đọc PDF (gangsheet, invoice, label) |
| `qrcode`, `qrcode.react`, `jsbarcode`, `bwip-js` | Tạo QR / barcode để in lên design |
| `electron-updater` | Cập nhật tự động qua GitHub release |

---

## 3. Cấu trúc thư mục

```
bullstart-app/
├── package.json                 # Cấu hình app + electron-builder
├── webpack.renderer.config.js   # Bundle renderer (React)
├── postcss.config.js
├── build-resources/             # Icon dùng cho installer
└── src/
    ├── main/                    # Electron main process (Node)
    │   ├── main.js              # Tạo window, đăng ký IPC handlers, auto-update
    │   ├── preload.js           # contextBridge — expose window.electronAPI
    │   └── icon.png
    └── renderer/                # React app
        ├── index.html / index.jsx
        ├── App.jsx              # Routes + ProtectedRoute
        ├── assets/              # Logo …
        ├── components/          # Layout, Dialog, Pagination, Preview, UploadButton
        ├── contexts/
        │   └── AuthContext.jsx  # Login, role/permission, auto-restart converter
        ├── pages/               # 18 trang chức năng (xem mục 5)
        ├── services/            # api, converter, gangsheetBuilder, groupGang,
        │                          invoicePdf, mergedLabelBuilder, uploadB2
        ├── utils/
        │   └── drive.jsx        # Helper cho URL Google Drive
        └── styles/app.css
```

---

## 4. Kiến trúc tổng thể

### 4.1 Main process (`src/main/main.js`)
- Tạo `BrowserWindow` 1400×900, ẩn title bar (`hiddenInset`), `contextIsolation: true`, **không** bật `nodeIntegration` (renderer chạy như web sandbox).
- Trong dev (`NODE_ENV=development`) load từ `http://localhost:3000`; bản đóng gói load file build.
- Đăng ký các IPC handler để bridge công việc cần quyền Node tới renderer:
  - `get-app-version`, `check-for-updates`
  - `open-external` — mở URL bằng trình duyệt mặc định (whitelist `http(s)`).
  - `s3-upload` / `s3-delete` — thao tác trực tiếp với Backblaze B2 từ máy người dùng, dùng credentials do hub cấp (xem mục 6.2).
  - `fetch-image` — tải binary ảnh để vượt CORS, dùng cho converter cron.
  - `fetch-tracking` — POST URL nhãn vận đơn lên `carrier.pressify.us/track` để lấy tracking number; tự chuyển URL Google Drive `/file/d/` sang dạng `uc?export=download`.
- **Auto-updater:** check sau 3 giây từ khi app ready, có UI hỏi "Restart now / Later" khi tải xong bản mới.

### 4.2 Preload (`src/main/preload.js`)
Expose API duy nhất `window.electronAPI` với các method tương ứng IPC handler ở trên + `onUpdaterStatus(cb)` để renderer subscribe trạng thái cập nhật.

### 4.3 Renderer (React)
- Vào app qua `HashRouter` → `AuthProvider` → `App`.
- `App.jsx` định nghĩa 18 route, mọi route trừ `/login` được bọc bởi `ProtectedRoute` (đọc user từ `AuthContext`, redirect `/login` nếu chưa đăng nhập).
- `DialogHost` (module-level pub/sub) cho phép bất kỳ component nào gọi `notify()` / `askConfirm()` mà không cần prop-drilling.

### 4.4 Auth & phân quyền
`src/renderer/contexts/AuthContext.jsx`:
- Token + user lưu trong `localStorage`; xác thực lại bằng `GET /me` mỗi lần khởi động.
- Helper `hasRole(slug)` và `hasPermission(module, action)` đọc trực tiếp từ `user.role.permissions` (mỗi quyền có cờ `can_view`, `can_*`…).
- Role chính: `admin`, `support`, `seller`. `admin` + `support` được gom thành "staff".
- Khi đăng nhập (và `user.convert === true`) → tự bật lại các converter job; khi đăng xuất → soft-stop để không mất cờ auto đã lưu trên máy.

### 4.5 Lớp gọi API (`services/api.jsx`)
- `baseURL` mặc định `https://bullstart.us/api`, có thể override qua `localStorage.api_url`. Tự migrate các bản cài cũ còn cache `http://localhost:8000/api`.
- Interceptor:
  - Đính kèm `Authorization: Bearer <token>`.
  - Tự thêm query `?_=Date.now()` vào mọi request GET để tránh cache của Chromium / proxy.
  - Bắt 401 → xoá token + redirect `/login`.
- Header `Cache-Control: no-cache, no-store, must-revalidate` mặc định để chống dữ liệu cũ trong Electron.

---

## 5. Các trang chức năng (`src/renderer/pages/`)

| Route | Trang | Vai trò yêu cầu | Mô tả ngắn |
|---|---|---|---|
| `/login` | `Login.jsx` | Public | Form đăng nhập email/password, gradient cam đặc trưng BullStart. |
| `/` | `Dashboard.jsx` | Tất cả | Thống kê đơn (số lượng, doanh thu, đã/chưa thanh toán, chi phí in/ship), top seller (admin), địa chỉ kho (cho seller). |
| `/orders` | `Orders.jsx` | Tất cả (lọc theo role) | **Trái tim app**: list + filter đơn hàng (theo status, paid, ref_id, system_id, tracking, user, ngày). Hỗ trợ bulk pay / bulk status / bulk reconvert / copy IDs / copy tracking / import envelope CSV. Filter được persist vào `sessionStorage`. |
| `/orders/create` | `OrderCreate.jsx` | Có quyền | Tạo đơn mới: chọn variant, material, **multi-accessory** theo tier, mockup, các meta `front/back/left/right/neck/special`. Hỗ trợ tạo hàng loạt qua CSV. |
| `/orders/:id` | `OrderDetail.jsx` | Có quyền | Chi tiết đơn, chỉnh sửa, log thanh toán, xuất invoice PDF. |
| `/products` | `Products.jsx` | Có quyền | List sản phẩm (search), admin có thể tạo mới (name/style/line_id) hoặc xoá. |
| `/products/:id` | `ProductDetail.jsx` | Có quyền | Quản lý variant, accessory + giá theo tier, material … của một product. |
| `/inventory` | `Inventory.jsx` | Có quyền | Hai tab: **Imports** (lịch sử nhập kho, giá per_item / per_package) và **Stock** (tồn kho hiện tại — variant, accessory, material, supply). Có import CSV. |
| `/wallet` | `Wallet.jsx` | Có quyền | Số dư ví + lịch sử giao dịch (tab Deposits / Paid). **VNPay**: tạo URL thanh toán VND → mở browser ngoài → backend cộng USD theo tỉ giá. Admin có thể tạo deposit thủ công cho user khác. |
| `/users` | `Users.jsx` | Admin | CRUD user, gán role + tier. |
| `/tiers` | `Tiers.jsx` | Settings perm | Quản lý các tier giá. |
| `/settings` | `Settings.jsx` | Settings perm | 8 tab cài đặt: Roles & Permissions, Tiers, Invoice Payment, Telegram, VNPay Merchant, Bank Transfer, Stamp Shipping, Gangsheet Auto. |
| `/convert` | `Convert.jsx` | `user.convert === true` | UI điều khiển converter **QR** chạy nền (start/stop/pause/run-now). |
| `/convert-label` | `ConvertLabel.jsx` | Staff + convert mode | UI điều khiển job convert label (in QR/barcode lên file label trước khi vào máy in). |
| `/auto-pay` | `AutoPay.jsx` | Staff | Dashboard quan sát các seller bật auto-pay: ví, số đơn chưa thanh toán, lịch sử auto-pay gần nhất, nút "force run" cho từng seller. Refresh mỗi 30s. |
| `/gangsheet` | `Gangsheet.jsx` | Staff | **Trang lớn nhất** (~80KB). 5 tab: **Compose** (gom design `_qr` thành PDF gangsheet 8.5×11" hoặc 10×7"), **Groups**, **Find / Re-gang**, **Reconvert 11×7**, **Manage** (gán gangsheet cho partner). |
| `/gangsheet-label` | `GangsheetLabel.jsx` | Staff | List label gangsheet, mỗi label link đến trang scan công khai (`/gs/{code}`) cho kho. Hỗ trợ chọn nhiều label rồi merge thành 1 PDF lớn để in. |
| `/profile` | `Profile.jsx` | Tất cả | Đổi tên/email/password, sinh & xoá API key cá nhân. |

> **Sidebar navigation** (`components/Layout.jsx`) lọc menu theo `hasPermission(module)`; một số mục thêm cờ `requiresStaff` và/hoặc `requiresConvert` để chỉ hiện khi user là staff hoặc có flag `convert` được bật.

---

## 6. Các service quan trọng (`src/renderer/services/`)

### 6.1 `converter.jsx` — Hai job nền độc lập
- **QR converter** (`/convert`, mọi user có `convert`): poll `/conversion/pending` mỗi 60s, dựng ảnh có QR/barcode đè lên design và push lại lên server.
- **Convert Label** (`/convert-label`, staff): poll job convert label, vẽ QR/barcode lên file label.
- Mỗi job có **state riêng** (enabled, running, paused, log, pending list, processedTotal, errorTotal) + listener pattern + cờ auto persist trong `localStorage`. Gặp `403` (admin tắt convert mode) thì tự stop.
- Ngoài 2 job chính còn có **Assign job** và **Auto-close job** dùng cho automation gangsheet.

### 6.2 `uploadB2.jsx` — Upload trực tiếp lên Backblaze B2
- Lấy credentials từ `/gangsheets/storage-credentials` (cache trong RAM 30 phút).
- Tự build key dạng `gangsheet/<YYYY-MM-DD>/<folder>/<timestamp>_<filename>` (folder prefix do server quy định, đảm bảo phân ngày).
- Toàn bộ upload chạy qua IPC `window.electronAPI.s3Upload`, không qua hub → tiết kiệm bandwidth server.
- Sanitize filename, đoán content-type theo extension.

### 6.3 `gangsheetBuilder.jsx` — Dựng PDF gangsheet
- Layout pixel-only ở 300 DPI:
  - `original` = 3000×2100 (10×7") — design fill toàn trang, không margin/registration mark.
  - `letter` = 3300×2550 (11×8.5") — design ở giữa + registration marks (L-corner + center tick) cho thợ in căn máy.
- Lựa chọn format được lưu mỗi máy qua `localStorage.gangsheet_page_format`.
- Render mỗi trang vào canvas → embed dưới dạng PNG vào `pdf-lib` PDFDocument.

### 6.4 `groupGang.jsx` — Automation gangsheet
Helpers dùng chung cho **UI tab Groups** và **cron auto-close**. Đảm bảo "Chốt" tay và "auto-close" tự động chạy qua cùng pipeline build → upload B2 → finalize, để gangsheet luôn byte-identical.

### 6.5 `invoicePdf.jsx`
Sinh invoice PDF khổ US Letter, logo BullStart cache base64, header màu cam đặc trưng. Dùng `jspdf` + `jspdf-autotable`.

### 6.6 `mergedLabelBuilder.jsx`
Gộp nhiều label gangsheet thành 1 PDF in hàng loạt cho kho.

### 6.7 `utils/drive.jsx`
Helpers chuyển link Google Drive sang:
- `driveId(url)` — extract FILE_ID.
- `driveThumb(url, size)` — link thumbnail (JPEG, không alpha) cho preview UI.
- `driveOriginal(url)` — link tải file gốc (giữ PNG alpha) — bắt buộc khi đặt QR lên vùng trong suốt.
- `drivePreview(url)` — link viewer Drive cho PDF/ảnh.

---

## 7. Tích hợp bên ngoài

| Dịch vụ | Vai trò |
|---|---|
| **Hub backend** (`bullstart.us/api`) | Source of truth cho user/order/product/wallet/inventory. |
| **Backblaze B2** (S3-compatible) | Lưu PDF gangsheet, mockup, label … upload trực tiếp từ desktop. |
| **Google Drive** | Nguồn lưu design gốc — app chỉ giữ URL và tạo các biến thể thumb/original/preview. |
| **carrier.pressify.us** | Endpoint scrape tracking number từ URL nhãn vận đơn. |
| **VNPay** | Cổng thanh toán nạp ví bằng VND (đổi ra USD theo tỉ giá lưu phía server). |
| **GitHub Releases** | Kênh phân phối bản cập nhật cho `electron-updater`. |
| **Telegram, Stamp shipping…** | Cấu hình trong Settings (admin) — chi tiết quản trị phía hub. |

---

## 8. Scripts & build

Từ `package.json`:

```bash
npm start              # chạy app (đã build sẵn)
npm run dev            # webpack-dev-server + electron song song (hot reload renderer)
npm run build:renderer # bundle production vào build/
npm run build:win      # tạo installer NSIS (Windows)
npm run build:mac      # tạo file DMG (macOS)
npm run build:linux    # tạo gói Linux
```

Cấu hình `electron-builder`:
- `appId: com.bullstart.app`
- Output: `dist/`
- Build resources (icon): `build-resources/icon.png`
- Publish provider: GitHub release của `bullstartteam-jpg/bullstart-app`

---

## 9. Các điểm thiết kế đáng chú ý

1. **Tác vụ nặng chạy phía client.** Dựng PDF gangsheet (vài MB / page) và composite QR lên design đều thực thi trên máy người dùng, server chỉ điều phối — giảm tải hub đáng kể.
2. **Upload thẳng lên B2.** Renderer gọi xuống main process qua IPC; main process dùng AWS SDK với credentials hub cấp tạm thời. Hub chỉ lưu URL công khai về sau.
3. **Hai converter song song & độc lập.** QR và Convert Label có poll interval / log / cờ auto riêng → bật/tắt cái này không ảnh hưởng cái kia.
4. **Auto-pay seller-side.** App seller tự tick mỗi 60s để tự thanh toán đơn từ ví; staff có dashboard `/auto-pay` và nút "force run" khi vừa duyệt top-up.
5. **Filter persist theo session.** Trang Orders nhớ filter + page trong `sessionStorage`, đi vào chi tiết rồi back vẫn giữ vị trí.
6. **Cache-busting GET.** Mọi request GET đính `?_=timestamp` để chống Chromium cache.
7. **Dialog pub/sub.** `notify()` / `askConfirm()` gọi được từ bất kỳ đâu (kể cả service không phải React component), trả về `Promise`.
8. **HashRouter.** Bắt buộc vì khi đóng gói app load từ `file://` — BrowserRouter sẽ vỡ.
9. **Auto-update có dialog tiếng Việt** ngay trong `main.js` (`"BullStart x.y.z đã tải xong. Khởi động lại để cài đặt?"`).
10. **Drive original vs thumb tách bạch.** Thumb (JPEG) không alpha → chỉ dùng để preview UI; khi composite QR phải dùng `driveOriginal` để giữ kênh alpha của PNG.

---

## 10. Quy ước & ràng buộc

- **Vai trò người dùng**: `admin`, `support`, `seller`. Quyền truy cập trang xác định bằng `hasPermission(module)` đọc từ `user.role.permissions` (server-driven).
- **Cờ `user.convert`**: bật mới được dùng Convert / Convert Label.
- **Tier**: mỗi user thuộc 1 tier → giá accessory / variant scope theo tier khi tạo đơn.
- **`line_id`**: prefix sản phẩm (ví dụ `GC`), dùng làm tiền tố `system_id` cho mỗi đơn — cũng là cơ sở để gom đơn vào group gangsheet.
- **Convention naming gangsheet**: `slugifyAccessory(name)` (lowercase, dash-separated, max 24 ký tự) + suffix `two_size` nếu `side_type === 'two'` — đảm bảo file in luôn nhận diện được bởi thợ in.

---

*Cập nhật lần cuối: tổng hợp tự động từ source code phiên bản 1.1.20.*
