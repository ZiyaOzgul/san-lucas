/**
 * localDb.js
 * SQLite database via sql.js (WASM), persisted to Electron userData/san-lucas.db.
 *
 * Data ownership:
 *   table_defs                → LOCAL ONLY (never synced to Supabase)
 *   categories                → LOCAL + SUPABASE  (is_synced flag, synced via sync.js when online)
 *   products                  → LOCAL + SUPABASE  (is_synced flag, synced via sync.js when online)
 *   ingredients               → LOCAL + SUPABASE  (is_synced flag)
 *   product_variants          → LOCAL + SUPABASE  (is_synced flag)
 *   product_variant_ingredients → LOCAL ONLY (rebuilt from variants on sync)
 */

import initSqlJs from 'sql.js'

let db = null

function requireDb() {
  if (!db) throw new Error('[localDb] Database not initialized — call initDb() first')
}

export function isDbInitialized() { return db !== null }

// ── Seed data (inserted once on first run) ────────────────────────
const SEED_TABLE_DEFS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Masa-${i + 1}` }))


// ── Schema ────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS table_defs (
    id   INTEGER PRIMARY KEY,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL,
    icon       TEXT    NOT NULL DEFAULT 'tag',
    is_synced  INTEGER NOT NULL DEFAULT 0,
    remote_id  TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    price       REAL    NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER NOT NULL,
    image_url   TEXT,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    remote_id   TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY,
    local_id       TEXT    UNIQUE NOT NULL,
    table_id       INTEGER NOT NULL,
    table_name     TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'completed',
    payment_method TEXT    NOT NULL,
    subtotal       REAL    NOT NULL DEFAULT 0,
    tax            REAL    NOT NULL DEFAULT 0,
    discount       REAL    NOT NULL DEFAULT 0,
    total          REAL    NOT NULL DEFAULT 0,
    is_synced      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL,
    closed_at      TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY,
    local_id   TEXT    UNIQUE NOT NULL,
    order_id   INTEGER NOT NULL,
    product_id INTEGER,
    name       TEXT    NOT NULL,
    quantity   INTEGER NOT NULL,
    unit_price REAL    NOT NULL,
    is_synced  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS pending_deletes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL,
    remote_id   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    unit             TEXT    NOT NULL DEFAULT 'adet',
    stock_amount     REAL    NOT NULL DEFAULT 0,
    min_stock_alert  REAL    NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    is_synced        INTEGER NOT NULL DEFAULT 0,
    remote_id        TEXT
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    price      REAL    NOT NULL,
    created_at TEXT    NOT NULL,
    is_synced  INTEGER NOT NULL DEFAULT 0,
    remote_id  TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_variant_ingredients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id    INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    amount_used   REAL    NOT NULL,
    FOREIGN KEY (variant_id)    REFERENCES product_variants(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)      ON DELETE CASCADE
  );
`

// ── Init ──────────────────────────────────────────────────────────
export async function initDb() {
  if (db) return db

  const SQL = await initSqlJs({
    locateFile: () => './sql-wasm.wasm',
  })

  // Load existing db file from Electron userData (null on first run)
  let loaded = null
  if (window.electronAPI?.db?.read) {
    try { loaded = await window.electronAPI.db.read() } catch (e) {
      console.warn('[localDb] Could not read DB file from disk', e)
    }
  }
  try {
    db = loaded ? new SQL.Database(new Uint8Array(loaded)) : new SQL.Database()
  } catch (e) {
    console.warn('[localDb] Existing DB unreadable — starting fresh', e)
    db = new SQL.Database()
  }

  db.run(SCHEMA)

  // Migrations — idempotent, no-op if column already exists
  const migrations = [
    `ALTER TABLE categories ADD COLUMN icon      TEXT    NOT NULL DEFAULT 'tag'`,
    `ALTER TABLE categories ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN remote_id TEXT`,
    `ALTER TABLE products   ADD COLUMN is_synced  INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE products   ADD COLUMN remote_id  TEXT`,
    `ALTER TABLE products   ADD COLUMN image_url  TEXT`,
    `ALTER TABLE products   ADD COLUMN recipe     TEXT`,
    // orders / order_items tables added in schema; these cover old DBs that ran schema before orders existed
    `ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN tax      REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN table_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE order_items ADD COLUMN name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN cash_amount REAL`,
    `ALTER TABLE orders ADD COLUMN card_amount REAL`,
    `ALTER TABLE orders ADD COLUMN remote_id   TEXT`,
    `ALTER TABLE order_items ADD COLUMN variant_id INTEGER`,
    `ALTER TABLE ingredients ADD COLUMN container_name TEXT`,
    `ALTER TABLE ingredients ADD COLUMN container_size REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ingredients ADD COLUMN image_url TEXT`,
    `ALTER TABLE orders ADD COLUMN waiter_name TEXT`,
    `CREATE TABLE IF NOT EXISTS product_ingredients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      amount_used   REAL    NOT NULL,
      FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    )`,
  ]
  for (const sql of migrations) {
    try { db.run(sql) } catch { /* column already exists — ignore */ }
  }

  // Seed on first run (empty tables)
  const isEmpty = db.exec('SELECT COUNT(*) as c FROM table_defs')[0]?.values[0][0] === 0
  if (isEmpty) {
    for (const t of SEED_TABLE_DEFS) {
      db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [t.id, t.name])
    }
    await persistDb()
  }

  // One-time migration: replace old zero-padded / incomplete table list with Masa-1..20
  const hasOldNames = db.exec("SELECT COUNT(*) FROM table_defs WHERE name LIKE 'Masa-0%'")?.[0]?.values?.[0]?.[0] > 0
  const tableCount  = db.exec('SELECT COUNT(*) FROM table_defs WHERE id BETWEEN 1 AND 20')?.[0]?.values?.[0]?.[0]
  if (hasOldNames || tableCount < 20) {
    db.run('DELETE FROM table_defs WHERE id BETWEEN 1 AND 20')
    for (let i = 1; i <= 20; i++) {
      db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [i, `Masa-${i}`])
    }
    await persistDb()
  }

  return db
}

// ── Persist to disk ───────────────────────────────────────────────
export async function persistDb() {
  if (!db || !window.electronAPI?.db?.write) return
  const data = db.export()
  await window.electronAPI.db.write(data)
}

// ── table_defs (LOCAL ONLY) ───────────────────────────────────────
export function getAllTableDefs() {
  requireDb()
  const res = db.exec('SELECT id, name FROM table_defs ORDER BY id')
  if (!res.length) return []
  return res[0].values.map(([id, name]) => ({ id, name }))
}

export async function insertTableDef(name) {
  requireDb()
  const id = Date.now()
  db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [id, name])
  await persistDb()
  return { id, name }
}

export async function updateTableDef(id, name) {
  requireDb()
  db.run('UPDATE table_defs SET name = ? WHERE id = ?', [name, id])
  await persistDb()
}

export async function deleteTableDef(id) {
  requireDb()
  db.run('DELETE FROM table_defs WHERE id = ?', [id])
  await persistDb()
}

// ── categories (LOCAL + SUPABASE) ────────────────────────────────
export function getAllCategories() {
  requireDb()
  const res = db.exec('SELECT id, name, color, icon, is_synced, remote_id FROM categories ORDER BY id')
  if (!res.length) return []
  return res[0].values.map(([id, name, color, icon, is_synced, remote_id]) => ({
    id, name, color, icon, is_synced: !!is_synced, remote_id,
  }))
}

export async function insertCategory({ name, color, icon = 'tag' }) {
  requireDb()
  const id = Date.now()
  db.run(
    'INSERT INTO categories (id, name, color, icon, is_synced) VALUES (?, ?, ?, ?, 0)',
    [id, name, color, icon]
  )
  await persistDb()
  return { id, name, color, icon, is_synced: false }
}

export async function updateCategory(id, fields) {
  requireDb()
  const { name, color, icon } = fields
  db.run(
    'UPDATE categories SET name = ?, color = ?, icon = ?, is_synced = 0 WHERE id = ?',
    [name, color, icon, id]
  )
  await persistDb()
}

export async function deleteCategory(id) {
  requireDb()
  const remoteRes = db.exec('SELECT remote_id FROM categories WHERE id = ?', [id])
  const remoteId = remoteRes[0]?.values[0]?.[0]
  db.run('DELETE FROM categories WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('category', ?)", [remoteId])
  }
  await persistDb()
}

// ── products (LOCAL + SUPABASE) ───────────────────────────────────
export function getAllProducts() {
  requireDb()
  const res = db.exec(
    'SELECT id, name, price, stock, category_id, image_url, recipe, is_synced, remote_id FROM products ORDER BY id'
  )
  if (!res.length) return []
  return res[0].values.map(([id, name, price, stock, category_id, image_url, recipe, is_synced, remote_id]) => ({
    id, name, price, stock, categoryId: category_id, imageUrl: image_url ?? null,
    recipe: recipe ?? null, is_synced: !!is_synced, remote_id,
  }))
}

export async function upsertProduct({ id, name, price, stock, categoryId, imageUrl = null, recipe = null }) {
  requireDb()
  const existing = db.exec('SELECT id FROM products WHERE id = ?', [id])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE products SET name = ?, price = ?, stock = ?, category_id = ?, image_url = ?, recipe = ?, is_synced = 0 WHERE id = ?',
      [name, price, stock, categoryId, imageUrl, recipe, id]
    )
  } else {
    db.run(
      'INSERT INTO products (id, name, price, stock, category_id, image_url, recipe, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [id, name, price, stock, categoryId, imageUrl, recipe]
    )
  }
  await persistDb()
}

export async function deleteProduct(id) {
  requireDb()
  const res = db.exec('SELECT image_url, remote_id FROM products WHERE id = ?', [id])
  const imageUrl = res[0]?.values[0]?.[0]
  const remoteId = res[0]?.values[0]?.[1]
  db.run('DELETE FROM products WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('product', ?)", [remoteId])
  }
  await persistDb()
  return imageUrl
}

export async function clearAllDataExceptTables() {
  requireDb()
  db.run('DELETE FROM order_items')
  db.run('DELETE FROM orders')
  db.run('DELETE FROM products')
  db.run('DELETE FROM categories')
  await persistDb()
}

// ── ingredients (LOCAL + SUPABASE) ───────────────────────────────
export function getAllIngredients() {
  requireDb()
  const res = db.exec(
    'SELECT id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id, container_name, container_size, image_url FROM ingredients ORDER BY name'
  )
  if (!res.length) return []
  return res[0].values.map(([id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id, container_name, container_size, image_url]) => ({
    id, name, unit, stockAmount: stock_amount, minStockAlert: min_stock_alert,
    createdAt: created_at, is_synced: !!is_synced, remote_id,
    containerName: container_name || null, containerSize: container_size || 0, imageUrl: image_url || null,
  }))
}

export async function upsertIngredient({ id, name, unit, stockAmount, minStockAlert, containerName, containerSize, imageUrl }) {
  requireDb()
  const now = new Date().toISOString()
  const cn = containerName || null
  const cs = containerSize || 0
  const img = imageUrl || null
  const existing = db.exec('SELECT id FROM ingredients WHERE id = ?', [id])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE ingredients SET name=?, unit=?, stock_amount=?, min_stock_alert=?, container_name=?, container_size=?, image_url=?, is_synced=0 WHERE id=?',
      [name, unit, stockAmount, minStockAlert, cn, cs, img, id]
    )
  } else {
    db.run(
      'INSERT INTO ingredients (id, name, unit, stock_amount, min_stock_alert, container_name, container_size, image_url, created_at, is_synced) VALUES (?,?,?,?,?,?,?,?,?,0)',
      [id, name, unit, stockAmount, minStockAlert, cn, cs, img, now]
    )
  }
  await persistDb()
}

export async function deleteIngredient(id) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM ingredients WHERE id = ?', [id])
  const remoteId = res[0]?.values[0]?.[0]
  db.run('DELETE FROM ingredients WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('ingredient', ?)", [remoteId])
  }
  await persistDb()
}

// ── product_variants + recipes (LOCAL + SUPABASE) ─────────────────
export function getVariantsForProduct(productId) {
  requireDb()
  const vRes = db.exec(
    'SELECT id, product_id, name, price FROM product_variants WHERE product_id = ? ORDER BY id',
    [productId]
  )
  if (!vRes.length) return []
  const variants = vRes[0].values.map(([id, product_id, name, price]) => ({
    id, productId: product_id, name, price, ingredients: [],
  }))
  for (const v of variants) {
    const rRes = db.exec(
      `SELECT pvi.id, pvi.ingredient_id, i.name, i.unit, pvi.amount_used
       FROM product_variant_ingredients pvi
       JOIN ingredients i ON i.id = pvi.ingredient_id
       WHERE pvi.variant_id = ?`,
      [v.id]
    )
    if (rRes.length && rRes[0].values.length) {
      v.ingredients = rRes[0].values.map(([id, ingredientId, ingName, unit, amountUsed]) => ({
        id, ingredientId, name: ingName, unit, amountUsed,
      }))
    }
  }
  return variants
}

export function getAllVariantsAll() {
  requireDb()
  const vRes = db.exec('SELECT id, product_id, name, price FROM product_variants ORDER BY product_id, id')
  if (!vRes.length) return {}
  const map = {}
  const variantObjs = vRes[0].values.map(([id, product_id, name, price]) => {
    if (!map[product_id]) map[product_id] = []
    const v = { id, productId: product_id, name, price, ingredients: [] }
    map[product_id].push(v)
    return v
  })
  const rRes = db.exec(
    `SELECT pvi.variant_id, pvi.ingredient_id, i.name, i.unit, pvi.amount_used
     FROM product_variant_ingredients pvi
     JOIN ingredients i ON i.id = pvi.ingredient_id`
  )
  if (rRes.length && rRes[0].values.length) {
    const byVariant = {}
    variantObjs.forEach(v => { byVariant[v.id] = v })
    for (const [variant_id, ingredientId, ingName, unit, amountUsed] of rRes[0].values) {
      if (byVariant[variant_id]) {
        byVariant[variant_id].ingredients.push({ ingredientId, name: ingName, unit, amountUsed })
      }
    }
  }
  return map
}

export async function replaceVariants(productId, variants) {
  requireDb()
  // Delete existing variants (cascades to product_variant_ingredients)
  db.run('DELETE FROM product_variants WHERE product_id = ?', [productId])
  const now = new Date().toISOString()
  for (const v of variants) {
    const vid = v.id && !String(v.id).startsWith('new_') ? v.id : Date.now() + Math.floor(Math.random() * 10000)
    db.run(
      'INSERT INTO product_variants (id, product_id, name, price, created_at, is_synced) VALUES (?,?,?,?,?,0)',
      [vid, productId, v.name, parseFloat(v.price) || 0, now]
    )
    for (const ing of (v.ingredients ?? [])) {
      if (!ing.ingredientId) continue
      db.run(
        'INSERT INTO product_variant_ingredients (variant_id, ingredient_id, amount_used) VALUES (?,?,?)',
        [vid, ing.ingredientId, parseFloat(ing.amountUsed) || 0]
      )
    }
  }
  await persistDb()
}

export function consumeIngredients(items) {
  requireDb()
  const lowStock = []
  const warned = new Set()

  const checkLowStock = (ingredient_id) => {
    if (warned.has(ingredient_id)) return
    const sRes = db.exec(
      'SELECT name, stock_amount, min_stock_alert FROM ingredients WHERE id = ?',
      [ingredient_id]
    )
    if (sRes.length && sRes[0].values.length) {
      const [name, stock_amount, min_stock_alert] = sRes[0].values[0]
      if (min_stock_alert > 0 && stock_amount <= min_stock_alert) {
        lowStock.push({ id: ingredient_id, name, stockAmount: stock_amount, minStockAlert: min_stock_alert })
        warned.add(ingredient_id)
      }
    }
  }

  for (const item of items) {
    if (!item.variantId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_variant_ingredients WHERE variant_id = ?',
      [item.variantId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = MAX(0, stock_amount - ?), is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
      checkLowStock(ingredient_id)
    }
  }

  // Direct product→ingredient recipe (no variant)
  for (const item of items) {
    if (item.variantId) continue
    if (!item.productId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_ingredients WHERE product_id = ?',
      [item.productId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = MAX(0, stock_amount - ?), is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
      checkLowStock(ingredient_id)
    }
  }

  return lowStock
}

// ── product_ingredients (direct recipe, no variant) ───────────────
export function getIngredientsForProduct(productId) {
  requireDb()
  const res = db.exec(
    `SELECT pi.id, pi.ingredient_id, i.name, i.unit, pi.amount_used
     FROM product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     WHERE pi.product_id = ? ORDER BY pi.id`,
    [productId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, ingredient_id, name, unit, amount_used]) => ({
    id, ingredientId: ingredient_id, name, unit, amountUsed: amount_used,
  }))
}

export async function replaceProductIngredients(productId, rows) {
  requireDb()
  db.run('DELETE FROM product_ingredients WHERE product_id = ?', [productId])
  for (const row of rows) {
    if (!row.ingredientId || !row.amountUsed) continue
    db.run(
      'INSERT INTO product_ingredients (product_id, ingredient_id, amount_used) VALUES (?,?,?)',
      [productId, Number(row.ingredientId), parseFloat(row.amountUsed)]
    )
  }
  await persistDb()
}

export function getAllProductIngredientsAll() {
  requireDb()
  const res = db.exec(
    `SELECT pi.product_id, pi.ingredient_id, i.name, i.unit, pi.amount_used
     FROM product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     ORDER BY pi.product_id, pi.id`
  )
  if (!res.length) return {}
  const map = {}
  for (const [product_id, ingredient_id, name, unit, amount_used] of res[0].values) {
    if (!map[product_id]) map[product_id] = []
    map[product_id].push({ ingredientId: ingredient_id, name, unit, amountUsed: amount_used })
  }
  return map
}

// ── orders / order_items ──────────────────────────────────────────

export async function saveCompletedOrder(txData) {
  requireDb()
  const orderId   = Date.now()
  const localId   = crypto.randomUUID()
  const now       = new Date().toISOString()
  const closedAt  = txData.closedAt ?? now

  const isSplit = txData.paymentMethod === 'split'
  const cashAmt = isSplit ? (txData.splitCash ?? null)
                : txData.paymentMethod === 'cash' ? txData.total : null
  const cardAmt = isSplit ? (txData.splitCard ?? null)
                : txData.paymentMethod === 'card' ? txData.total : null

  // If this was a QR order already in Supabase, mark as pre-synced to avoid duplicate
  const isSynced = txData.supabaseOrderId ? 1 : 0
  const remoteId = txData.supabaseOrderId ?? null

  db.run(
    `INSERT INTO orders
       (id, local_id, table_id, table_name, status, payment_method,
        subtotal, tax, discount, total, cash_amount, card_amount, is_synced, remote_id, created_at, closed_at, waiter_name)
     VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      localId,
      txData.tableId,
      txData.tableName ?? '',
      txData.paymentMethod,
      txData.subtotal ?? txData.total,
      txData.tax ?? 0,
      txData.discount ?? 0,
      txData.total,
      cashAmt,
      cardAmt,
      isSynced,
      remoteId,
      now,
      closedAt,
      txData.waiterName ?? null,
    ]
  )

  for (const item of (txData.items ?? [])) {
    db.run(
      `INSERT INTO order_items
         (local_id, order_id, product_id, variant_id, name, quantity, unit_price, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        crypto.randomUUID(),
        orderId,
        item.productId ?? item.id ?? null,
        item.variantId ?? null,
        item.name,
        item.qty,
        item.unitPrice,
      ]
    )
  }

  const lowStockWarnings = consumeIngredients(txData.items ?? [])
  await persistDb()
  return { lowStockWarnings }
}

export function getDailyRevenue() {
  requireDb()
  const res = db.exec(
    `SELECT COALESCE(SUM(total), 0)
     FROM orders
     WHERE status = 'completed'
       AND date(closed_at) = date('now', 'localtime')`
  )
  return res[0]?.values[0][0] ?? 0
}

// ── Pull helpers (used by sync.js to write Supabase data into localDb) ───────

export async function upsertCategoryFromRemote({ remoteId, name, color, icon }) {
  requireDb()
  const existing = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const localId = existing[0].values[0][0]
    db.run(
      'UPDATE categories SET name=?, color=?, icon=?, is_synced=1 WHERE id=?',
      [name, color, icon ?? 'tag', localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, color, icon, is_synced, remote_id) VALUES (?,?,?,?,1,?)',
      [localId, name, color, icon ?? 'tag', String(remoteId)]
    )
  }
}

export async function upsertProductFromRemote({ remoteId, name, price, stock, remoteCatId, imageUrl }) {
  requireDb()
  // Resolve local category id from its remote_id
  const catRes = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteCatId)])
  const localCatId = catRes.length && catRes[0].values.length ? catRes[0].values[0][0] : remoteCatId

  const existing = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const localId = existing[0].values[0][0]
    db.run(
      'UPDATE products SET name=?, price=?, stock=?, category_id=?, image_url=?, is_synced=1 WHERE id=?',
      [name, price, stock, localCatId, imageUrl ?? null, localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      'INSERT OR IGNORE INTO products (id, name, price, stock, category_id, image_url, is_synced, remote_id) VALUES (?,?,?,?,?,?,1,?)',
      [localId, name, price, stock, localCatId, imageUrl ?? null, String(remoteId)]
    )
  }
}

// ── Sync helpers (used by sync.js) ────────────────────────────────
export function getUnsyncedCategories() {
  const res = db.exec('SELECT * FROM categories WHERE is_synced = 0')
  return res.length ? res[0].values : []
}

export function getUnsyncedProducts() {
  const res = db.exec(
    'SELECT id, name, price, stock, category_id, image_url, recipe FROM products WHERE is_synced = 0'
  )
  return res.length ? res[0].values : []
}

export async function markCategorySynced(id, remoteId) {
  db.run('UPDATE categories SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  await persistDb()
}

export async function markProductSynced(id, remoteId) {
  db.run('UPDATE products SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  await persistDb()
}

export function getUnsyncedOrders() {
  const res = db.exec(
    `SELECT id, local_id, table_id, status, payment_method, total, created_at, closed_at, waiter_name
     FROM orders WHERE is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export function getUnsyncedOrderItems() {
  const res = db.exec(
    `SELECT oi.id, oi.local_id, o.remote_id as order_remote_id,
            oi.quantity, oi.unit_price
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markOrderSynced(id, remoteId) {
  db.run('UPDATE orders SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  await persistDb()
}

export function markOrderItemSynced(id) {
  db.run('UPDATE order_items SET is_synced = 1 WHERE id = ?', [id])
}

export function getPendingDeletes() {
  if (!db) return []
  const res = db.exec('SELECT id, entity_type, remote_id FROM pending_deletes')
  if (!res.length) return []
  return res[0].values.map(([id, entity_type, remote_id]) => ({ id, entity_type, remote_id }))
}

export async function clearPendingDelete(id) {
  db.run('DELETE FROM pending_deletes WHERE id = ?', [id])
  await persistDb()
}

export function getUnsyncedCount() {
  if (!db) return 0
  const res = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM categories  WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM products    WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM orders      WHERE is_synced = 0)
    AS total
  `)
  return res[0]?.values[0][0] ?? 0
}

// ── Reporting queries ─────────────────────────────────────────────

function _dateClause(startIso, endIso) {
  if (!startIso && !endIso) return { clause: '', params: [] }
  if (startIso === endIso)  return { clause: "AND date(closed_at,'localtime') = ?", params: [startIso] }
  return {
    clause: "AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?",
    params: [startIso, endIso],
  }
}

export function getReportKpis(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT COALESCE(SUM(total),0), COUNT(*), COALESCE(AVG(total),0)
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const [revenue, orderCount, avgOrder] = res[0]?.values[0] ?? [0, 0, 0]
  return { revenue, orderCount, avgOrder }
}

export function getTopProduct(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY qty DESC LIMIT 1`,
    params
  )
  if (!res.length || !res[0].values.length) return { name: '—', qty: 0 }
  const [name, qty] = res[0].values[0]
  return { name, qty }
}

export function getRevenueByPeriod(mode) {
  requireDb()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const now = new Date()

  if (mode === 'today') {
    const today = fmt(now)
    const res = db.exec(
      `SELECT CAST(strftime('%H', closed_at,'localtime') AS INTEGER) as h, COALESCE(SUM(total),0)
       FROM orders WHERE status='completed' AND date(closed_at,'localtime') = ?
       GROUP BY h`,
      [today]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([h, v]) => { map[h] = v })
    return Array.from({ length: 15 }, (_, i) => {
      const h = i + 8
      return { label: `${pad(h)}:00`, value: map[h] ?? 0 }
    })
  }

  if (mode === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i); return fmt(d)
    })
    const labels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz']
    const res = db.exec(
      `SELECT date(closed_at,'localtime'), COALESCE(SUM(total),0)
       FROM orders WHERE status='completed'
         AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?
       GROUP BY date(closed_at,'localtime')`,
      [days[0], days[6]]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([d, v]) => { map[d] = v })
    return days.map((d, i) => ({ label: labels[i], value: map[d] ?? 0 }))
  }

  if (mode === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const start = `${y}-${pad(m+1)}-01`
    const end   = `${y}-${pad(m+1)}-${pad(daysInMonth)}`
    const res = db.exec(
      `SELECT CAST(strftime('%d', closed_at,'localtime') AS INTEGER) as d, COALESCE(SUM(total),0)
       FROM orders WHERE status='completed'
         AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?
       GROUP BY d`,
      [start, end]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([d, v]) => { map[d] = v })
    return Array.from({ length: daysInMonth }, (_, i) => ({ label: String(i+1), value: map[i+1] ?? 0 }))
  }

  // total — group by month
  const TR_MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
  const res = db.exec(
    `SELECT strftime('%Y-%m', closed_at,'localtime') as mo, COALESCE(SUM(total),0)
     FROM orders WHERE status='completed'
     GROUP BY mo ORDER BY mo`
  )
  if (!res.length || !res[0].values.length) {
    const mo = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
    const [y2, m2] = mo.split('-')
    return [{ label: `${TR_MONTHS[parseInt(m2)-1]} ${y2.slice(2)}`, value: 0 }]
  }
  return res[0].values.map(([mo, v]) => {
    const [y2, m2] = mo.split('-')
    return { label: `${TR_MONTHS[parseInt(m2)-1]} ${y2.slice(2)}`, value: v }
  })
}

export function getPaymentBreakdown(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method='cash'  THEN total
                         WHEN payment_method='split' THEN COALESCE(cash_amount,0)
                         ELSE 0 END), 0) as nakit,
       COALESCE(SUM(CASE WHEN payment_method='card'  THEN total
                         WHEN payment_method='split' THEN COALESCE(card_amount,0)
                         ELSE 0 END), 0) as kart
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const [nakit, kart] = res[0]?.values[0] ?? [0, 0]
  return [
    { name: 'Nakit', value: nakit },
    { name: 'Kart',  value: kart },
  ]
}

export function getTableRevenue(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT table_name, COALESCE(SUM(total),0) as rev
     FROM orders WHERE status='completed' AND table_name != '' ${clause}
     GROUP BY table_name ORDER BY rev DESC LIMIT 5`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, value]) => ({ name, value }))
}

export function getTopProducts(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as rev
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}

export function getProductSalesDetail(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const daysRes = db.exec(
    `SELECT COUNT(DISTINCT date(closed_at,'localtime'))
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const days = daysRes[0]?.values[0][0] || 1
  const res = db.exec(
    `SELECT oi.name,
            COALESCE(c.name, '—') as cat_name,
            SUM(oi.quantity) as qty,
            SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY revenue DESC`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, category, qty, revenue]) => ({
    name, category, qty, revenue,
    dailyAvg: days > 0 ? revenue / days : 0,
  }))
}

// ── Staff performance queries ─────────────────────────────────────

export function getStaffPerformance(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT waiter_name, COUNT(*) as order_count, COALESCE(SUM(total), 0) as revenue
     FROM orders
     WHERE status = 'completed'
       AND waiter_name IS NOT NULL AND waiter_name != '' ${clause}
     GROUP BY waiter_name
     ORDER BY revenue DESC`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, orderCount, revenue]) => ({ name, orderCount, revenue }))
}

export function getStaffItemBreakdown(staffName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     WHERE o.status = 'completed' AND o.waiter_name = ? ${clause}
     GROUP BY oi.name
     ORDER BY revenue DESC`,
    [staffName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}
