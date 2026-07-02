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
    note       TEXT,
    added_at   TEXT,
    is_synced  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY,
    local_id        TEXT    UNIQUE NOT NULL,
    order_id        INTEGER NOT NULL,
    amount          REAL    NOT NULL,
    payment_method  TEXT    NOT NULL,
    payer_label     TEXT,
    processed_by    TEXT,
    device          TEXT    NOT NULL DEFAULT 'desktop',
    is_synced       INTEGER NOT NULL DEFAULT 0,
    remote_id       TEXT,
    created_at      TEXT    NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS payment_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id    INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    is_synced     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (order_item_id),
    FOREIGN KEY (payment_id)    REFERENCES payments(id)    ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
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

  CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'Garson',
    is_active   INTEGER NOT NULL DEFAULT 1,
    permissions TEXT    NOT NULL DEFAULT '{}',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email    TEXT    NOT NULL UNIQUE,
    password TEXT    NOT NULL,
    role     TEXT    NOT NULL DEFAULT 'admin'
  );

  CREATE TABLE IF NOT EXISTS modifiers (
    id          INTEGER PRIMARY KEY,
    local_id    TEXT    UNIQUE NOT NULL,
    category_id INTEGER,
    product_id  INTEGER,
    name        TEXT    NOT NULL,
    price_delta REAL    NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    remote_id   TEXT,
    CHECK ((category_id IS NULL) <> (product_id IS NULL)),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)  REFERENCES products(id)   ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_modifier_excludes (
    product_id  INTEGER NOT NULL,
    modifier_id INTEGER NOT NULL,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, modifier_id),
    FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
    FOREIGN KEY (modifier_id) REFERENCES modifiers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id            INTEGER PRIMARY KEY,
    local_id      TEXT    UNIQUE NOT NULL,
    order_item_id INTEGER NOT NULL,
    modifier_id   INTEGER,
    name          TEXT    NOT NULL,
    price_delta   REAL    NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 1,
    is_synced     INTEGER NOT NULL DEFAULT 0,
    remote_id     TEXT,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
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
    `ALTER TABLE staff ADD COLUMN contact TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE staff ADD COLUMN email TEXT`,
    `ALTER TABLE staff ADD COLUMN supabase_uid TEXT`,
    `ALTER TABLE categories ADD COLUMN image_url TEXT`,
    `CREATE TABLE IF NOT EXISTS product_ingredients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      amount_used   REAL    NOT NULL,
      FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    )`,
    // Per-item note + timestamp (parity with Supabase migration 2026-06-26)
    `ALTER TABLE order_items ADD COLUMN note TEXT`,
    `ALTER TABLE order_items ADD COLUMN added_at TEXT`,
    // Mobile parity: active orders live in Supabase, status='active' on Windows too
    // (existing rows default to 'completed' — no change needed)
    // payments table — split payment support, mirrors Supabase
    `CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY,
      local_id        TEXT    UNIQUE NOT NULL,
      order_id        INTEGER NOT NULL,
      amount          REAL    NOT NULL,
      payment_method  TEXT    NOT NULL,
      payer_label     TEXT,
      processed_by    TEXT,
      device          TEXT    NOT NULL DEFAULT 'desktop',
      is_synced       INTEGER NOT NULL DEFAULT 0,
      remote_id       TEXT,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`,
    `CREATE TABLE IF NOT EXISTS payment_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id    INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      is_synced     INTEGER NOT NULL DEFAULT 0,
      UNIQUE (order_item_id),
      FOREIGN KEY (payment_id)    REFERENCES payments(id)    ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_payments_order_id        ON payments(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_items_payment_id ON payment_items(payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id     ON order_items(order_id)`,
    `ALTER TABLE order_items ADD COLUMN remote_id TEXT`,
    `ALTER TABLE products ADD COLUMN points_value INTEGER NOT NULL DEFAULT 0`,
    // Modifiers (cafe owner defines per-category/per-product priced extras)
    `CREATE INDEX IF NOT EXISTS idx_modifiers_category_id          ON modifiers(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_modifiers_product_id           ON modifiers(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pmod_excludes_product_id       ON product_modifier_excludes(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item_id   ON order_item_modifiers(order_item_id)`,
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

  // Seed default admin user if no users exist
  const noUsers = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] === 0
  if (noUsers) {
    db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, 'admin')`,
      ['sanlucascafe@gmail.com', '123456789'])
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
  const res = db.exec('SELECT id, name, color, icon, is_synced, remote_id, image_url FROM categories ORDER BY id')
  if (!res.length) return []
  return res[0].values.map(([id, name, color, icon, is_synced, remote_id, image_url]) => ({
    id, name, color, icon, is_synced: !!is_synced, remote_id, imageUrl: image_url ?? null,
  }))
}

export async function insertCategory({ name, color, icon = 'tag', imageUrl = null }) {
  requireDb()
  const id = Date.now()
  db.run(
    'INSERT INTO categories (id, name, color, icon, image_url, is_synced) VALUES (?, ?, ?, ?, ?, 0)',
    [id, name, color, icon, imageUrl]
  )
  await persistDb()
  return { id, name, color, icon, imageUrl, is_synced: false }
}

export async function updateCategory(id, fields) {
  requireDb()
  const { name, color, icon, imageUrl = null } = fields
  db.run(
    'UPDATE categories SET name = ?, color = ?, icon = ?, image_url = ?, is_synced = 0 WHERE id = ?',
    [name, color, icon, imageUrl, id]
  )
  await persistDb()
}

export function getCategoryRemoteId(localId) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM categories WHERE id = ?', [localId])
  return res[0]?.values[0]?.[0] ?? null
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
    'SELECT id, name, price, stock, category_id, image_url, recipe, points_value, is_synced, remote_id FROM products ORDER BY id'
  )
  if (!res.length) return []
  return res[0].values.map(([id, name, price, stock, category_id, image_url, recipe, points_value, is_synced, remote_id]) => ({
    id, name, price, stock, categoryId: category_id, imageUrl: image_url ?? null,
    recipe: recipe ?? null, pointsValue: points_value ?? 0, is_synced: !!is_synced, remote_id,
  }))
}

export async function upsertProduct({ id, name, price, stock, categoryId, imageUrl = null, recipe = null, pointsValue = 0 }) {
  requireDb()
  const existing = db.exec('SELECT id FROM products WHERE id = ?', [id])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE products SET name = ?, price = ?, stock = ?, category_id = ?, image_url = ?, recipe = ?, points_value = ?, is_synced = 0 WHERE id = ?',
      [name, price, stock, categoryId, imageUrl, recipe, pointsValue, id]
    )
  } else {
    db.run(
      'INSERT INTO products (id, name, price, stock, category_id, image_url, recipe, points_value, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [id, name, price, stock, categoryId, imageUrl, recipe, pointsValue]
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

// ── modifiers (LOCAL + SUPABASE) ──────────────────────────────────
// A modifier is either category-scoped (applies to every product in the
// category) or product-scoped (applies only to one product). The owner
// defines them in Settings (category) or in the product edit modal.
// product_modifier_excludes lets a single product opt out of an inherited
// category modifier (e.g., this espresso has no "süt seçimi").

export function getAllModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id
     FROM modifiers
     ORDER BY COALESCE(category_id, 0), COALESCE(product_id, 0), sort_order, id`
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id]) => ({
    id,
    localId: local_id,
    categoryId: category_id ?? null,
    productId: product_id ?? null,
    name,
    priceDelta: Number(price_delta) || 0,
    sortOrder: sort_order ?? 0,
    isActive: !!is_active,
    is_synced: !!is_synced,
    remote_id: remote_id ?? null,
  }))
}

export function getModifiersForCategory(categoryId) {
  return getAllModifiers().filter(m => m.categoryId === categoryId && m.isActive)
}

// Returns category-inherited modifiers (minus excluded) + product-specific modifiers,
// shaped for the order-add UI. Each entry: { id, name, priceDelta, source: 'category'|'product', sortOrder }
export function getEffectiveModifiersForProduct(productId, categoryId) {
  requireDb()
  const all = getAllModifiers()
  const excluded = new Set()
  const exRes = db.exec('SELECT modifier_id FROM product_modifier_excludes WHERE product_id = ?', [productId])
  if (exRes.length) {
    for (const [mid] of exRes[0].values) excluded.add(mid)
  }
  const result = []
  for (const m of all) {
    if (!m.isActive) continue
    if (m.categoryId != null && m.categoryId === categoryId && !excluded.has(m.id)) {
      result.push({ ...m, source: 'category' })
    } else if (m.productId != null && m.productId === productId) {
      result.push({ ...m, source: 'product' })
    }
  }
  result.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id))
  return result
}

export async function upsertModifier({ id, localId, categoryId = null, productId = null, name, priceDelta = 0, sortOrder = 0, isActive = true }) {
  requireDb()
  if ((categoryId == null) === (productId == null)) {
    throw new Error('[localDb.upsertModifier] exactly one of categoryId/productId must be set')
  }
  const lid = localId || crypto.randomUUID()
  if (id) {
    db.run(
      `UPDATE modifiers
       SET category_id = ?, product_id = ?, name = ?, price_delta = ?, sort_order = ?, is_active = ?, is_synced = 0
       WHERE id = ?`,
      [categoryId, productId, name, Number(priceDelta) || 0, sortOrder, isActive ? 1 : 0, id]
    )
    await persistDb()
    return id
  }
  const newId = Date.now() + (Math.random() * 1000 | 0)
  db.run(
    `INSERT INTO modifiers (id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [newId, lid, categoryId, productId, name, Number(priceDelta) || 0, sortOrder, isActive ? 1 : 0]
  )
  await persistDb()
  return newId
}

export async function deleteModifier(id) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM modifiers WHERE id = ?', [id])
  const remoteId = res[0]?.values[0]?.[0]
  db.run('DELETE FROM modifiers WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('modifier', ?)", [remoteId])
  }
  await persistDb()
}

export function getProductModifierExcludes(productId) {
  requireDb()
  const res = db.exec('SELECT modifier_id FROM product_modifier_excludes WHERE product_id = ?', [productId])
  if (!res.length) return []
  return res[0].values.map(([mid]) => mid)
}

export async function setProductModifierExclude(productId, modifierId, excluded) {
  requireDb()
  if (excluded) {
    db.run(
      'INSERT OR IGNORE INTO product_modifier_excludes (product_id, modifier_id, is_synced) VALUES (?, ?, 0)',
      [productId, modifierId]
    )
  } else {
    db.run(
      'DELETE FROM product_modifier_excludes WHERE product_id = ? AND modifier_id = ?',
      [productId, modifierId]
    )
  }
  await persistDb()
}

// ── order_item_modifiers ──────────────────────────────────────────
// Attached to a saved order_items row. Snapshots name + price_delta so
// historical orders stay correct even if the modifier catalog changes.

export async function insertOrderItemModifiers(orderItemId, modifiers) {
  requireDb()
  if (!modifiers || !modifiers.length) return
  for (const m of modifiers) {
    const qty = Math.max(1, Number(m.quantity) || 1)
    db.run(
      `INSERT INTO order_item_modifiers
         (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        crypto.randomUUID(),
        orderItemId,
        m.modifierId ?? m.id ?? null,
        m.name,
        Number(m.priceDelta) || 0,
        qty,
      ]
    )
  }
  await persistDb()
}

export function getOrderItemModifiers(orderItemId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, modifier_id, name, price_delta, quantity, is_synced, remote_id
     FROM order_item_modifiers
     WHERE order_item_id = ?
     ORDER BY id`,
    [orderItemId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, modifier_id, name, price_delta, quantity, is_synced, remote_id]) => ({
    id,
    localId: local_id,
    modifierId: modifier_id ?? null,
    name,
    priceDelta: Number(price_delta) || 0,
    quantity: Number(quantity) || 1,
    is_synced: !!is_synced,
    remote_id: remote_id ?? null,
  }))
}

export function getModifiersForOrderItems(orderItemIds) {
  requireDb()
  if (!orderItemIds?.length) return {}
  const placeholders = orderItemIds.map(() => '?').join(',')
  const res = db.exec(
    `SELECT order_item_id, id, local_id, modifier_id, name, price_delta, quantity
     FROM order_item_modifiers
     WHERE order_item_id IN (${placeholders})
     ORDER BY id`,
    orderItemIds
  )
  if (!res.length) return {}
  const map = {}
  for (const [orderItemId, id, local_id, modifier_id, name, price_delta, quantity] of res[0].values) {
    if (!map[orderItemId]) map[orderItemId] = []
    map[orderItemId].push({
      id,
      localId: local_id,
      modifierId: modifier_id ?? null,
      name,
      priceDelta: Number(price_delta) || 0,
      quantity: Number(quantity) || 1,
    })
  }
  return map
}

export async function deleteOrderItemModifiers(orderItemId) {
  requireDb()
  db.run('DELETE FROM order_item_modifiers WHERE order_item_id = ?', [orderItemId])
  await persistDb()
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
    const itemId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      `INSERT INTO order_items
         (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        itemId,
        crypto.randomUUID(),
        orderId,
        item.productId ?? item.id ?? null,
        item.variantId ?? null,
        item.name,
        item.qty,
        item.unitPrice,
      ]
    )
    if (item.modifiers && item.modifiers.length) {
      for (const m of item.modifiers) {
        db.run(
          `INSERT INTO order_item_modifiers
             (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [
            crypto.randomUUID(),
            itemId,
            m.modifierId ?? m.id ?? null,
            m.name,
            Number(m.priceDelta) || 0,
            Math.max(1, Number(m.quantity) || 1),
          ]
        )
      }
    }
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

export async function upsertCategoryFromRemote({ remoteId, name, color, icon, imageUrl }) {
  requireDb()
  const existing = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const localId = existing[0].values[0][0]
    db.run(
      'UPDATE categories SET name=?, color=?, icon=?, image_url=?, is_synced=1 WHERE id=?',
      [name, color, icon ?? 'tag', imageUrl ?? null, localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, color, icon, image_url, is_synced, remote_id) VALUES (?,?,?,?,?,1,?)',
      [localId, name, color, icon ?? 'tag', imageUrl ?? null, String(remoteId)]
    )
  }
}

export async function upsertIngredientFromRemote({ remoteId, name, unit, stockAmount, minStockAlert }) {
  requireDb()
  const existing = db.exec('SELECT id FROM ingredients WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    // Update fields — preserve local image and container data
    const localId = existing[0].values[0][0]
    db.run(
      'UPDATE ingredients SET name=?, unit=?, stock_amount=?, min_stock_alert=?, is_synced=1 WHERE id=?',
      [name, unit, stockAmount, minStockAlert, localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    const now = new Date().toISOString()
    db.run(
      'INSERT OR IGNORE INTO ingredients (id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id) VALUES (?,?,?,?,?,?,1,?)',
      [localId, name, unit, stockAmount, minStockAlert, now, String(remoteId)]
    )
  }
}

// Insert/update a modifier coming from Supabase. Resolves remote
// category/product ids back to local ids; if the parent isn't pulled
// yet we skip — the next sync pass will pick it up.
export async function upsertModifierFromRemote({ remoteId, remoteCategoryId, remoteProductId, name, priceDelta, sortOrder, isActive }) {
  requireDb()
  let localCatId = null
  let localProdId = null
  if (remoteCategoryId != null) {
    const r = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteCategoryId)])
    localCatId = r.length && r[0].values.length ? r[0].values[0][0] : null
    if (localCatId == null) return false
  }
  if (remoteProductId != null) {
    const r = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteProductId)])
    localProdId = r.length && r[0].values.length ? r[0].values[0][0] : null
    if (localProdId == null) return false
  }

  const existing = db.exec('SELECT id FROM modifiers WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const localId = existing[0].values[0][0]
    db.run(
      `UPDATE modifiers
       SET category_id = ?, product_id = ?, name = ?, price_delta = ?, sort_order = ?, is_active = ?, is_synced = 1
       WHERE id = ?`,
      [localCatId, localProdId, name, Number(priceDelta) || 0, sortOrder ?? 0, isActive ? 1 : 0, localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      `INSERT OR IGNORE INTO modifiers
         (id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [localId, crypto.randomUUID(), localCatId, localProdId,
       name, Number(priceDelta) || 0, sortOrder ?? 0, isActive ? 1 : 0, String(remoteId)]
    )
  }
  return true
}

export async function upsertProductModifierExcludeFromRemote({ remoteProductId, remoteModifierId }) {
  requireDb()
  const pr = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteProductId)])
  const mr = db.exec('SELECT id FROM modifiers WHERE remote_id = ?', [String(remoteModifierId)])
  const localProd = pr.length && pr[0].values.length ? pr[0].values[0][0] : null
  const localMod  = mr.length && mr[0].values.length ? mr[0].values[0][0] : null
  if (localProd == null || localMod == null) return false
  db.run(
    'INSERT OR IGNORE INTO product_modifier_excludes (product_id, modifier_id, is_synced) VALUES (?, ?, 1)',
    [localProd, localMod]
  )
  // Mark existing rows synced (in case they were inserted offline first)
  db.run('UPDATE product_modifier_excludes SET is_synced = 1 WHERE product_id = ? AND modifier_id = ?',
    [localProd, localMod])
  return true
}

export async function upsertProductFromRemote({ remoteId, name, price, stock, remoteCatId, imageUrl, pointsValue = 0 }) {
  requireDb()
  // Resolve local category id from its remote_id
  const catRes = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteCatId)])
  const localCatId = catRes.length && catRes[0].values.length ? catRes[0].values[0][0] : remoteCatId

  const existing = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const localId = existing[0].values[0][0]
    db.run(
      'UPDATE products SET name=?, price=?, stock=?, category_id=?, image_url=?, points_value=?, is_synced=1 WHERE id=?',
      [name, price, stock, localCatId, imageUrl ?? null, pointsValue ?? 0, localId]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      'INSERT OR IGNORE INTO products (id, name, price, stock, category_id, image_url, points_value, is_synced, remote_id) VALUES (?,?,?,?,?,?,?,1,?)',
      [localId, name, price, stock, localCatId, imageUrl ?? null, pointsValue ?? 0, String(remoteId)]
    )
  }
}

// ── Sync helpers (used by sync.js) ────────────────────────────────
export function getUnsyncedCategories() {
  const res = db.exec('SELECT id, name, color, icon, image_url FROM categories WHERE is_synced = 0')
  return res.length ? res[0].values : []
}

export function getUnsyncedProducts() {
  const res = db.exec(
    'SELECT id, name, price, stock, category_id, image_url, recipe, points_value, remote_id FROM products WHERE is_synced = 0'
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

export async function markIngredientSynced(id, remoteId) {
  db.run('UPDATE ingredients SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  await persistDb()
}

export function getUnsyncedVariants() {
  requireDb()
  const res = db.exec(
    `SELECT pv.id, pv.remote_id, p.remote_id as product_remote_id, pv.name, pv.price
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.is_synced = 0 AND p.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export async function markVariantSynced(id, remoteId) {
  db.run('UPDATE product_variants SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
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
            oi.quantity, oi.unit_price, p.remote_id as product_remote_id,
            pv.remote_id as variant_remote_id, oi.note, oi.added_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
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

// ── Modifier sync helpers ─────────────────────────────────────────
// A modifier may have either category_id OR product_id; we resolve the
// corresponding remote_id at push time so the row is FK-correct.
export function getUnsyncedModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT m.id, m.local_id, m.category_id, m.product_id, m.name, m.price_delta,
            m.sort_order, m.is_active, m.remote_id,
            c.remote_id as category_remote_id,
            p.remote_id as product_remote_id
     FROM modifiers m
     LEFT JOIN categories c ON c.id = m.category_id
     LEFT JOIN products   p ON p.id = m.product_id
     WHERE m.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markModifierSynced(id, remoteId) {
  db.run('UPDATE modifiers SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  await persistDb()
}

export function getUnsyncedProductModifierExcludes() {
  requireDb()
  const res = db.exec(
    `SELECT pme.product_id, pme.modifier_id,
            p.remote_id as product_remote_id,
            m.remote_id as modifier_remote_id
     FROM product_modifier_excludes pme
     LEFT JOIN products  p ON p.id = pme.product_id
     LEFT JOIN modifiers m ON m.id = pme.modifier_id
     WHERE pme.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markProductModifierExcludeSynced(productId, modifierId) {
  db.run(
    'UPDATE product_modifier_excludes SET is_synced = 1 WHERE product_id = ? AND modifier_id = ?',
    [productId, modifierId]
  )
  await persistDb()
}

export function getUnsyncedOrderItemModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT oim.id, oim.local_id, oi.remote_id as order_item_remote_id,
            m.remote_id as modifier_remote_id,
            oim.name, oim.price_delta, oim.quantity
     FROM order_item_modifiers oim
     JOIN order_items oi  ON oi.id = oim.order_item_id
     LEFT JOIN modifiers m ON m.id = oim.modifier_id
     WHERE oim.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markOrderItemModifierSynced(id, remoteId) {
  db.run('UPDATE order_item_modifiers SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  await persistDb()
}

export async function clearPendingDelete(id) {
  db.run('DELETE FROM pending_deletes WHERE id = ?', [id])
  await persistDb()
}

export function checkLogin(email, password) {
  requireDb()
  const res = db.exec(
    'SELECT id, email, role FROM users WHERE email = ? AND password = ? LIMIT 1',
    [email.trim().toLowerCase(), password]
  )
  if (!res.length || !res[0].values.length) return null
  const [id, em, role] = res[0].values[0]
  return { id, email: em, role }
}

export function getUnsyncedCount() {
  if (!db) return 0
  const res = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM categories               WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM products                 WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM orders                   WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM modifiers                WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM product_modifier_excludes WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM order_item_modifiers     WHERE is_synced = 0)
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

export function getTableProductBreakdown(tableName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' AND o.table_name=? ${clause}
     GROUP BY oi.name ORDER BY revenue DESC`,
    [tableName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}

export function getProductTableBreakdown(productName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT o.table_name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' AND oi.name=? ${clause}
     GROUP BY o.table_name ORDER BY revenue DESC`,
    [productName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([table, qty, revenue]) => ({ table, qty, revenue }))
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

export function getStaffHourlySales(staffName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT CAST(strftime('%H', closed_at) AS INTEGER) as hour,
            COUNT(*) as orders,
            COALESCE(SUM(total), 0) as revenue
     FROM orders
     WHERE status = 'completed' AND waiter_name = ? ${clause}
     GROUP BY hour
     ORDER BY hour`,
    [staffName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([hour, orders, revenue]) => ({ hour, orders, revenue }))
}

// ── Category revenue ──────────────────────────────────────────────

export function getCategoryRevenue(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT COALESCE(c.name, 'Kategorisiz') as category,
            SUM(oi.quantity) as qty,
            SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status = 'completed' ${clause}
     GROUP BY c.name
     ORDER BY revenue DESC`,
    params
  )
  if (!res.length || !res[0].values.length) return []
  const rows = res[0].values.map(([category, qty, revenue]) => ({ category, qty, revenue }))
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1
  return rows.map(r => ({ ...r, pct: Math.round((r.revenue / total) * 100) }))
}

// ── Ingredient consumption ────────────────────────────────────────

export function getIngredientConsumption(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const consumed = {}

  // Direct product recipe consumption
  const directRes = db.exec(
    `SELECT pi.ingredient_id, SUM(pi.amount_used * oi.quantity)
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN product_ingredients pi ON pi.product_id = oi.product_id
     WHERE o.status = 'completed' AND oi.variant_id IS NULL ${clause}
     GROUP BY pi.ingredient_id`,
    params
  )
  if (directRes.length) directRes[0].values.forEach(([id, c]) => { consumed[id] = (consumed[id] || 0) + c })

  // Variant recipe consumption
  const variantRes = db.exec(
    `SELECT pvi.ingredient_id, SUM(pvi.amount_used * oi.quantity)
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN product_variant_ingredients pvi ON pvi.variant_id = oi.variant_id
     WHERE o.status = 'completed' AND oi.variant_id IS NOT NULL ${clause}
     GROUP BY pvi.ingredient_id`,
    params
  )
  if (variantRes.length) variantRes[0].values.forEach(([id, c]) => { consumed[id] = (consumed[id] || 0) + c })

  const ingRes = db.exec('SELECT id, name, unit, stock_amount, min_stock_alert FROM ingredients ORDER BY name')
  if (!ingRes.length) return []
  return ingRes[0].values.map(([id, name, unit, stock_amount, min_stock_alert]) => ({
    id, name, unit,
    currentStock: stock_amount,
    minStockAlert: min_stock_alert,
    consumed: consumed[id] || 0,
  }))
}

// ── Order history ─────────────────────────────────────────────────

export function getOrdersList(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT o.id, o.closed_at, o.table_name, o.payment_method, o.total, o.waiter_name,
            GROUP_CONCAT(oi.name || ' ×' || oi.quantity, ', ') as items_summary
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status = 'completed' ${clause}
     GROUP BY o.id
     ORDER BY o.closed_at DESC`,
    params
  )
  if (!res.length || !res[0].values.length) return []
  const orders = res[0].values.map(([id, closedAt, tableName, paymentMethod, total, waiterName, itemsSummary]) => ({
    id, closedAt, tableName, paymentMethod, total,
    waiterName: waiterName || null,
    itemsSummary: itemsSummary || '',
    items: [],
  }))

  const orderIds = orders.map(o => o.id)
  if (orderIds.length === 0) return orders

  const itemsByOrder = {}
  const allItemIds = []
  const placeholders = orderIds.map(() => '?').join(',')
  const itemsRes = db.exec(
    `SELECT id, order_id, name, quantity, unit_price
     FROM order_items
     WHERE order_id IN (${placeholders})
     ORDER BY id`,
    orderIds
  )
  if (itemsRes.length && itemsRes[0].values.length) {
    for (const [iid, oid, name, qty, unitPrice] of itemsRes[0].values) {
      if (!itemsByOrder[oid]) itemsByOrder[oid] = []
      itemsByOrder[oid].push({ id: iid, name, qty, unitPrice, modifiers: [] })
      allItemIds.push(iid)
    }
  }

  const modsMap = getModifiersForOrderItems(allItemIds)
  for (const items of Object.values(itemsByOrder)) {
    for (const it of items) {
      it.modifiers = modsMap[it.id] || []
    }
  }

  for (const o of orders) {
    o.items = itemsByOrder[o.id] || []
  }
  return orders
}

export function getOrderItems(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT id, name, quantity, unit_price FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  )
  if (!res.length || !res[0].values.length) return []
  const items = res[0].values.map(([id, name, quantity, unitPrice]) => ({
    id, name, quantity, unitPrice, modifiers: [],
  }))
  const modsMap = getModifiersForOrderItems(items.map(i => i.id))
  for (const it of items) {
    it.modifiers = modsMap[it.id] || []
  }
  return items
}

// ── staff CRUD (LOCAL ONLY) ───────────────────────────────────────

const DEFAULT_PERMISSIONS = {
  tables: true,
  orders: true,
  products_view: true,
  products_edit: false,
  reports: false,
  settings: false,
  apply_discount: false,
  cancel_order: false,
  close_table: true,
}

export function getAllStaff() {
  requireDb()
  const res = db.exec('SELECT id, name, role, is_active, permissions, created_at, contact, email, supabase_uid FROM staff ORDER BY name')
  if (!res.length) return []
  return res[0].values.map(([id, name, role, is_active, permissions, created_at, contact, email, supabase_uid]) => ({
    id,
    name,
    role,
    contact: contact || '',
    email: email || '',
    supabaseUid: supabase_uid || null,
    isActive: !!is_active,
    permissions: (() => { try { return { ...DEFAULT_PERMISSIONS, ...JSON.parse(permissions || '{}') } } catch { return { ...DEFAULT_PERMISSIONS } } })(),
    createdAt: created_at,
  }))
}

export async function insertStaff({ name, role = 'Garson', contact = '', email = '', supabaseUid = null, permissions = {} }) {
  requireDb()
  const perms = JSON.stringify({ ...DEFAULT_PERMISSIONS, ...permissions })
  const now   = new Date().toISOString()
  db.run(
    'INSERT INTO staff (name, role, contact, is_active, permissions, created_at, email, supabase_uid) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
    [name.trim(), role.trim(), contact.trim(), perms, now, email.trim(), supabaseUid]
  )
  await persistDb()
  const res = db.exec('SELECT last_insert_rowid()')
  const id  = res[0].values[0][0]
  return { id, name: name.trim(), role: role.trim(), contact: contact.trim(), email: email.trim(), supabaseUid, isActive: true, permissions: { ...DEFAULT_PERMISSIONS, ...permissions }, createdAt: now }
}

export async function updateStaff({ id, name, role, contact = '', isActive, permissions }) {
  requireDb()
  const perms = JSON.stringify({ ...DEFAULT_PERMISSIONS, ...permissions })
  db.run(
    'UPDATE staff SET name = ?, role = ?, contact = ?, is_active = ?, permissions = ? WHERE id = ?',
    [name.trim(), role.trim(), contact.trim(), isActive ? 1 : 0, perms, id]
  )
  await persistDb()
}

export async function deleteStaff(id) {
  requireDb()
  db.run('DELETE FROM staff WHERE id = ?', [id])
  await persistDb()
}

// ── Active order / order items (parity with mobile) ───────────────
// Active orders are kept in Supabase as the source of truth (mobile model).
// Windows mirrors them locally for offline reads & sync queue.

export async function upsertActiveOrderFromRemote(order) {
  requireDb()
  const existing = db.exec('SELECT id FROM orders WHERE remote_id = ?', [String(order.id)])
  const total = Number(order.total || 0)
  if (existing.length && existing[0].values.length) {
    db.run(
      `UPDATE orders SET status=?, payment_method=?, total=?, table_id=?, table_name=?,
                         closed_at=?, waiter_name=?, is_synced=1 WHERE remote_id=?`,
      [order.status, order.payment_method || '', total, order.table_id, order.table_name || '',
       order.closed_at || '', order.waiter_name || null, String(order.id)]
    )
  } else {
    const localId = Date.now() + (Math.random() * 1000 | 0)
    db.run(
      `INSERT OR IGNORE INTO orders
        (id, local_id, table_id, table_name, status, payment_method, total,
         is_synced, remote_id, created_at, closed_at, waiter_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [localId, order.local_id || crypto.randomUUID(), order.table_id,
       order.table_name || '', order.status, order.payment_method || '',
       total, String(order.id), order.created_at || new Date().toISOString(),
       order.closed_at || '', order.waiter_name || null]
    )
  }
}

// ── payments (LOCAL + SUPABASE) ──────────────────────────────────

export async function insertPayment({ localId, orderId, amount, paymentMethod, payerLabel, processedBy, device = 'desktop', createdAt }) {
  requireDb()
  const id = Date.now() + (Math.random() * 1000 | 0)
  const now = createdAt || new Date().toISOString()
  db.run(
    `INSERT INTO payments
       (id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, is_synced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, localId || crypto.randomUUID(), orderId, Number(amount),
     paymentMethod, payerLabel || null, processedBy || null, device, now]
  )
  await persistDb()
  return id
}

export async function insertPaymentItems(paymentId, orderItemIds) {
  requireDb()
  if (!orderItemIds || orderItemIds.length === 0) return
  for (const oid of orderItemIds) {
    db.run(
      `INSERT OR IGNORE INTO payment_items (payment_id, order_item_id, is_synced) VALUES (?, ?, 0)`,
      [paymentId, oid]
    )
  }
  await persistDb()
}

export function getOrderPayments(orderId) {
  requireDb()
  const pRes = db.exec(
    `SELECT id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id
     FROM payments WHERE order_id = ? ORDER BY created_at`,
    [orderId]
  )
  if (!pRes.length) return []
  const payments = pRes[0].values.map(([id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id]) => ({
    id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id,
    order_item_ids: [],
  }))
  const piRes = db.exec(
    `SELECT payment_id, order_item_id FROM payment_items
     WHERE payment_id IN (SELECT id FROM payments WHERE order_id = ?)`,
    [orderId]
  )
  if (piRes.length) {
    const byId = {}
    payments.forEach(p => { byId[p.id] = p })
    for (const [paymentId, orderItemId] of piRes[0].values) {
      if (byId[paymentId]) byId[paymentId].order_item_ids.push(orderItemId)
    }
  }
  return payments
}

export function getPaidItemIds(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT pi.order_item_id
     FROM payment_items pi
     JOIN payments p ON p.id = pi.payment_id
     WHERE p.order_id = ?`,
    [orderId]
  )
  if (!res.length) return new Set()
  return new Set(res[0].values.map(([id]) => id))
}

export function getOrderTotalPaid(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?`,
    [orderId]
  )
  return Number(res[0]?.values[0][0] || 0)
}

// ── Active orders local CRUD (one active order per table) ─────────

export async function insertActiveOrder({ tableId, tableName, waiterName, processedBy }) {
  requireDb()
  const id = Date.now() + (Math.random() * 1000 | 0)
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO orders
       (id, local_id, table_id, table_name, status, payment_method, total,
        is_synced, created_at, closed_at, waiter_name)
     VALUES (?, ?, ?, ?, 'active', '', 0, 0, ?, '', ?)`,
    [id, crypto.randomUUID(), tableId, tableName || '', now, waiterName || null]
  )
  await persistDb()
  return id
}

export function getActiveOrderForTable(tableId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, table_id, table_name, status, payment_method, total,
            is_synced, remote_id, created_at, waiter_name
     FROM orders WHERE table_id = ? AND status = 'active' LIMIT 1`,
    [tableId]
  )
  if (!res.length || !res[0].values.length) return null
  const [id, local_id, table_id, table_name, status, payment_method, total, is_synced, remote_id, created_at, waiter_name] =
    res[0].values[0]
  return {
    id, local_id, table_id, table_name, status, payment_method, total,
    is_synced: !!is_synced, remote_id, created_at, waiter_name,
    order_items: getOrderItemRows(id),
  }
}

export function getOrderItemRows(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced
     FROM order_items WHERE order_id = ? ORDER BY COALESCE(added_at, ''), id`,
    [orderId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced]) => ({
    id, local_id, order_id, product_id, variant_id, name, quantity, unit_price,
    note: note || null, added_at: added_at || null, is_synced: !!is_synced,
  }))
}

export async function insertOrderItem({ orderId, productId, variantId, name, unitPrice, note, modifiers }) {
  requireDb()
  const id = Date.now() + (Math.random() * 1000 | 0)
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO order_items
       (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    [id, crypto.randomUUID(), orderId, productId || null, variantId || null,
     name, Number(unitPrice), note || null, now]
  )
  if (modifiers && modifiers.length) {
    await insertOrderItemModifiers(id, modifiers)
  } else {
    await persistDb()
  }
  return id
}

export async function updateOrderItemNote(itemId, note) {
  requireDb()
  db.run('UPDATE order_items SET note = ?, is_synced = 0 WHERE id = ?', [note || null, itemId])
  await persistDb()
}

export async function deleteOrderItemRow(itemId) {
  requireDb()
  // Track delete for sync if it has a remote_id (via order remote)
  db.run('DELETE FROM order_items WHERE id = ?', [itemId])
  await persistDb()
}

export async function updateOrderTotal(orderId, total) {
  requireDb()
  db.run('UPDATE orders SET total = ?, is_synced = 0 WHERE id = ?', [Number(total), orderId])
  await persistDb()
}

export async function setOrderStatus(orderId, status, extra = {}) {
  requireDb()
  const closedAt = extra.closedAt ?? (status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null)
  const paymentMethod = extra.paymentMethod ?? null
  if (paymentMethod !== null) {
    db.run(
      `UPDATE orders SET status = ?, payment_method = ?, closed_at = ?, is_synced = 0 WHERE id = ?`,
      [status, paymentMethod, closedAt || '', orderId]
    )
  } else {
    db.run(
      `UPDATE orders SET status = ?, closed_at = ?, is_synced = 0 WHERE id = ?`,
      [status, closedAt || '', orderId]
    )
  }
  await persistDb()
}

export async function moveOrderToTable(orderId, newTableId, newTableName) {
  requireDb()
  db.run(
    `UPDATE orders SET table_id = ?, table_name = ?, is_synced = 0 WHERE id = ?`,
    [newTableId, newTableName || '', orderId]
  )
  await persistDb()
}

export async function moveOrderItemsToOrder(itemIds, targetOrderId) {
  requireDb()
  if (!itemIds || itemIds.length === 0) return
  const placeholders = itemIds.map(() => '?').join(',')
  db.run(
    `UPDATE order_items SET order_id = ?, is_synced = 0 WHERE id IN (${placeholders})`,
    [targetOrderId, ...itemIds]
  )
  await persistDb()
}

// ── Sync helpers (used by sync.js) ────────────────────────────────

export function getUnsyncedPayments() {
  requireDb()
  const res = db.exec(
    `SELECT p.id, p.local_id, o.remote_id as order_remote_id,
            p.amount, p.payment_method, p.payer_label, p.processed_by, p.device, p.created_at
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.is_synced = 0 AND o.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export function getUnsyncedPaymentItems() {
  requireDb()
  const res = db.exec(
    `SELECT pi.id, p.remote_id as payment_remote_id, oi.remote_id as order_item_remote_id, pi.payment_id, pi.order_item_id
     FROM payment_items pi
     JOIN payments p ON p.id = pi.payment_id
     LEFT JOIN order_items oi ON oi.id = pi.order_item_id
     WHERE pi.is_synced = 0 AND p.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export async function markPaymentSynced(id, remoteId) {
  requireDb()
  db.run('UPDATE payments SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  await persistDb()
}

export async function markPaymentItemSynced(id) {
  requireDb()
  db.run('UPDATE payment_items SET is_synced = 1 WHERE id = ?', [id])
  await persistDb()
}

// Stamp a freshly-created Supabase remote_id onto an order_item we created locally.
export async function setOrderItemRemoteId(localItemId, remoteId) {
  requireDb()
  // order_items doesn't currently have a remote_id column — add it on first call.
  try { db.run('ALTER TABLE order_items ADD COLUMN remote_id TEXT') } catch {}
  db.run('UPDATE order_items SET remote_id = ?, is_synced = 1 WHERE id = ?', [String(remoteId), localItemId])
  await persistDb()
}

export async function markOrderItemSyncedById(localItemId) {
  requireDb()
  db.run('UPDATE order_items SET is_synced = 1 WHERE id = ?', [localItemId])
  await persistDb()
}
