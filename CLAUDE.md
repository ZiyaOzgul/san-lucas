# San Lucas Cafe POS — CLAUDE.md

## Project Overview
Windows desktop POS application for a cafe. Built with Electron + React + Vite. No CSS frameworks — all styles are custom CSS. Backend is Supabase (database + realtime). Supports full offline operation via sql.js with automatic sync on reconnect.

---

## Tech Stack
- **Electron** — desktop wrapper
- **React 19** — UI
- **Vite** — bundler
- **React Router DOM** — navigation
- **Supabase JS Client** — database + realtime sync
- **sql.js** — local offline database
- **Custom CSS only** — no Tailwind, no Bootstrap, nothing

---

## Folder Structure
```
san-lucas/
├── electron/
│   ├── main.js
│   └── preload.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── styles/
│   │   ├── global.css
│   │   ├── layout.css
│   │   └── components.css
│   ├── pages/
│   │   ├── Tables/
│   │   │   ├── Tables.jsx
│   │   │   └── Tables.css
│   │   ├── Orders/
│   │   │   ├── Orders.jsx
│   │   │   └── Orders.css
│   │   ├── Products/
│   │   │   ├── Products.jsx
│   │   │   └── Products.css
│   │   ├── Reports/
│   │   │   ├── Reports.jsx
│   │   │   └── Reports.css
│   │   └── Settings/
│   │       ├── Settings.jsx
│   │       └── Settings.css
│   ├── components/
│   │   ├── Navbar/
│   │   │   ├── Navbar.jsx
│   │   │   └── Navbar.css
│   │   ├── TableCard/
│   │   │   ├── TableCard.jsx
│   │   │   └── TableCard.css
│   │   ├── OrderPanel/
│   │   │   ├── OrderPanel.jsx
│   │   │   └── OrderPanel.css
│   │   ├── CloseTableModal/
│   │   │   ├── CloseTableModal.jsx
│   │   │   └── CloseTableModal.css
│   │   └── shared/
│   │       ├── Button.jsx
│   │       ├── Modal.jsx
│   │       └── Badge.jsx
│   ├── lib/
│   │   ├── supabase.js
│   │   ├── localDb.js
│   │   └── sync.js
│   └── hooks/
│       ├── useTables.js
│       ├── useOrders.js
│       ├── useProducts.js
│       └── useOnlineStatus.js
├── .env
├── CLAUDE.md
└── package.json
```

---

## Database Schema (Supabase)

```sql
create table tables (
  id serial primary key,
  name text not null,
  status text default 'empty', -- 'empty' | 'occupied'
  created_at timestamp default now()
);

create table categories (
  id serial primary key,
  name text not null,
  color text default '#e8975a'
);

create table products (
  id serial primary key,
  name text not null,
  price decimal(10,2) not null,
  stock integer default 0,
  category_id integer references categories(id),
  image_url text,
  is_active boolean default true,
  created_at timestamp default now()
);

create table orders (
  id serial primary key,
  local_id text unique,         -- uuid generated offline
  table_id integer references tables(id),
  status text default 'active', -- 'active' | 'completed' | 'cancelled'
  payment_method text,          -- 'cash' | 'card'
  total decimal(10,2) default 0,
  is_synced boolean default false,
  created_at timestamp default now(),
  closed_at timestamp
);

create table order_items (
  id serial primary key,
  local_id text unique,         -- uuid generated offline
  order_id integer references orders(id),
  product_id integer references products(id),
  quantity integer not null,
  unit_price decimal(10,2) not null,
  is_synced boolean default false
);
```

---

## Design System (CSS Variables)

Defined in `src/styles/global.css`. Use everywhere — zero hardcoded colors.

```css
:root {
  --color-bg-page: #f5f5f0;
  --color-bg-card: #ffffff;
  --color-bg-navbar: #ffffff;
  --color-accent: #e8975a;
  --color-accent-hover: #d4824a;
  --color-accent-light: #fdf0e8;
  --color-success: #22c55e;
  --color-success-light: #dcfce7;
  --color-danger: #ef4444;
  --color-danger-light: #fee2e2;
  --color-warning: #f59e0b;
  --color-warning-light: #fef3c7;
  --color-text-primary: #1a1a2e;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border: #e5e7eb;
  --color-shadow: 0 1px 3px rgba(0,0,0,0.08);
  --color-shadow-md: 0 4px 12px rgba(0,0,0,0.1);
  --radius-card: 10px;
  --radius-input: 6px;
  --radius-pill: 20px;
  --navbar-width: 72px;
  --panel-width: 320px;
  --font-main: 'Segoe UI', system-ui, sans-serif;
}
```

---

## Layout

`App.jsx` wraps everything in a two-column layout:
- Left: `Navbar` (72px fixed width, full height)
- Right: `<Outlet />` fills remaining space

```
┌─────────────────────────────────────────────┐
│ [Navbar 72px] │ Page Content (flex: 1)      │
│               │                             │
│  logo         │  <Outlet />                 │
│  tables       │                             │
│  orders       │                             │
│  products     │                             │
│  reports      │                             │
│               │                             │
│  settings     │                             │
└─────────────────────────────────────────────┘
```

---

## Navbar

Vertical left navbar, 72px wide, white background, subtle right border.

Items (top to bottom):
- San Lucas logo / coffee icon (branding only)
- Tables (grid icon)
- Orders (receipt icon)
- Products (box icon)
- Reports (chart icon)
- [spacer flex-grow]
- Settings (gear icon, pinned to bottom)

Active item: amber background pill, icon + label white.
Inactive: muted gray icon + label.
Each item: icon centered + label text below (11px).

---

## Pages

### Tables Page (`/`)
- Header: "Masalar" + "X aktif masa" + live clock (top right)
- Summary chips: "Toplam Ciro: ₺X" | "Aktif Masa: X" | "Bekleyen Sipariş: X"
- Grid: 4 cards per row, responsive
- **Empty card**: white, light border, table number, gray "Boş" badge
- **Occupied card**: white, 3px left border green, green "Dolu" badge, item count, total ₺, time open ("32 dk")
- **Selected card**: 3px left border amber, soft amber background tint
- Clicking occupied table → slides in `OrderPanel` from right

**OrderPanel** (320px right panel):
- Header: table name + green "Açık" badge + X close
- Scrollable items: quantity chip | name | unit price | line total
- Divider → "Toplam: ₺X" bold right-aligned
- Payment selector: [Nakit] [Kart] segmented control
- "Masayı Kapat" full-width amber button → opens `CloseTableModal`

**CloseTableModal**:
- Centered overlay, white modal
- Header: "Masa X — Hesap"
- Items summary + total bold
- [Nakit] [Kart] toggle (required)
- [İptal] [Tahsil Et] buttons
- On confirm: order → completed, table → empty, save locally + sync if online

### Orders Page (`/orders`)
- Header: "Siparişler"
- Filter tabs: [Tümü] [Aktif] [Tamamlandı] [İptal Edildi]
- Right: date picker + search input
- Table columns: # | Masa | Ürün Özeti | Tutar | Ödeme | Saat | Durum | İşlem
- Row left border: Active → green | Cancelled → red (muted row) | Completed → none
- Status badges: green "Aktif" | gray "Tamamlandı" | red "İptal"
- Eye icon → order detail modal (items + total + payment + status timeline)

### Products Page (`/products`)
- Header: "Ürünler"
- Category filter tabs: [Tümü] + dynamic categories
- Right: search input + "+ Ürün Ekle" amber button
- Grid: 4 cards per row
- Card: square image (gray placeholder) | name bold | category pill | price amber | stock + progress bar (green >10 | amber 5-10 | red <5) | edit/delete on hover
- Add/Edit modal: Ürün Adı, Kategori, Fiyat (₺), Başlangıç Stoğu, Görsel (drag & drop)
- [İptal] [Kaydet] buttons

### Reports Page (`/reports`)
- Header: "Raporlar"
- Date tabs: [Bugün] [Bu Hafta] [Bu Ay] [Özel Aralık]
- Right: [PDF İndir] [Excel İndir]
- KPI cards (4): Günlük Ciro | Toplam Sipariş | Ortalama Sepet | En Çok Satan
- Left 60%: "Saatlik Ciro" bar chart (canvas, amber, 08–22) + "Masa Bazlı Ciro" horizontal bar
- Right 40%: "Ödeme Dağılımı" donut (Nakit vs Kart) + "En Çok Satan Ürünler" top 5
- Bottom full-width table: Ürün | Kategori | Satış Adedi | Stok Tüketimi | Toplam Gelir | Günlük Ort.

### Settings Page (`/settings`)
- Left section list, right content
- **Cafe Bilgileri**: name, address, phone + save
- **Masa Yönetimi**: list with edit/delete + add table
- **Kategori Yönetimi**: list with color picker + add/delete
- **Bağlantı Durumu**: online/offline badge + Supabase status + unsynced count + "Şimdi Senkronize Et" button

---

## Online / Offline Logic

### `useOnlineStatus.js`
- Listens to `window` online/offline events
- Pings Supabase to confirm real connectivity
- Returns `{ isOnline: boolean }`

### When ONLINE
- All reads from Supabase directly
- Supabase Realtime subscriptions active:
  - `orders` INSERT → refresh Tables page, show notification
  - `orders` UPDATE → update order status
  - `order_items` INSERT → update panel item list
- All writes go directly to Supabase

### When OFFLINE
- QR menu completely inactive (no network = no QR orders)
- Windows app continues working fully
- All reads from local sql.js database
- All writes go to sql.js with `is_synced = false`
- Persistent "Çevrimdışı" warning banner shown on every page

### `sync.js` — Sync Logic
When connection restores (online event fires):
1. Query sql.js for all records where `is_synced = false`
2. Upload orders first, then order_items
3. Upsert by `local_id` (uuid) to avoid duplicates
4. On success: mark `is_synced = true` in local db
5. Refresh all data from Supabase
6. Show notification: "X kayıt senkronize edildi"
7. **Must be idempotent** — running twice must never create duplicates

### `localDb.js`
- Initialize sql.js on app start
- Persist to: `app.getPath('userData') + '/san-lucas.db'`
- Mirrors Supabase schema
- Exports: `initDb()`, `saveOrder()`, `saveOrderItems()`, `getUnsyncedOrders()`, `markAsSynced()`, `getAllTables()`, `updateTableStatus()`

---

## Electron Setup

### `main.js`
- BrowserWindow: 1280×800, minWidth 1024, minHeight 600
- Dev: load `http://localhost:5173`
- Prod: load `dist/index.html`
- Default OS window chrome (no custom frame)

### `preload.js`
- Expose via `contextBridge` only:
  - App version
  - `userData` path (for sql.js persistence)
- Never expose raw Node.js APIs to renderer

---

## Environment Variables (`.env`)
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## Coding Rules

1. **No CSS framework.** Every style is handwritten custom CSS.
2. **Every component has its own CSS file.** No inline styles.
3. **CSS variables everywhere.** Zero hardcoded colors.
4. **Currency**: always use ₺ symbol.
5. **Locale**: all dates/times formatted with `tr-TR` locale.
6. **Electron IPC**: main and renderer communicate via `contextBridge` only.
7. **Security**: never expose Node.js APIs directly to renderer.
8. **sql.js persistence**: write db to disk on every write operation.
9. **Supabase keys**: always in `.env`, never hardcoded.
10. **local_id**: generate uuid for every `order` and `order_item` at creation time for safe offline upserts.
11. **Offline banner**: must be visible on every page when offline.
12. **Sync idempotency**: running sync twice must never create duplicates — always upsert by `local_id`.
