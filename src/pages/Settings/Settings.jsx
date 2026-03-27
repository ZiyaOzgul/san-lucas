import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import useOnlineStatus from '../../hooks/useOnlineStatus.js'
import './Settings.css'

// ── Icons ────────────────────────────────────────────────────────
const IconBriefcase = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
  </svg>
)
const IconGrid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>
)
const IconTag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
)
const IconGear = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)
const IconPencil = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconDragHandle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="8" y2="6"/><line x1="16" y1="6" x2="16" y2="6"/>
    <line x1="8" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="16" y2="12"/>
    <line x1="8" y1="18" x2="8" y2="18"/><line x1="16" y1="18" x2="16" y2="18"/>
  </svg>
)
const IconCoffee = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
    <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
  </svg>
)
const IconCake = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1"/>
    <path d="M2 21h20"/><path d="M7 8v2"/><path d="M12 8v2"/><path d="M17 8v2"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>
  </svg>
)
const IconCocktail = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 22h8"/><path d="M12 11v11"/><path d="M20 2H4l8 9.46L20 2z"/>
  </svg>
)
const IconFood = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
  </svg>
)

const CATEGORY_ICONS = { coffee: IconCoffee, cake: IconCake, cocktail: IconCocktail, food: IconFood }
const COLOR_PALETTE  = ['#e8975a','#14b8a6','#6366f1','#ef4444','#22c55e','#f59e0b','#ec4899','#8b5cf6']

const IconWifi = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
)

const SUB_NAV = [
  { id: 'cafe',       label: 'Cafe Bilgileri',    Icon: IconBriefcase },
  { id: 'tables',     label: 'Masa Yönetimi',     Icon: IconGrid      },
  { id: 'categories', label: 'Menü Kategorileri', Icon: IconTag       },
  { id: 'connection', label: 'Bağlantı Durumu',   Icon: IconWifi      },
  { id: 'system',     label: 'Sistem',            Icon: IconGear      },
]


// ── Inline editable table row ─────────────────────────────────────
function TableRow({ table, index, onRename, onDelete, autoEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(table.name)
  const inputRef              = useRef(null)

  useEffect(() => { if (autoEdit) { setEditing(true) } }, [autoEdit])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) onRename(table.id, trimmed)
    setEditing(false)
  }
  const cancel = () => { setDraft(table.name); setEditing(false) }

  return (
    <div className="st-table-row">
      <span className="st-drag-handle" title="Sırala"><IconDragHandle /></span>
      <span className="st-table-num">{index + 1}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="st-inline-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        />
      ) : (
        <span className="st-table-name">{table.name}</span>
      )}
      <div className="st-row-actions">
        <button className="st-icon-btn" onClick={() => setEditing(true)} title="Düzenle"><IconPencil /></button>
        <button className="st-icon-btn st-icon-btn--danger" onClick={() => onDelete(table.id)} title="Sil"><IconTrash /></button>
      </div>
    </div>
  )
}

// ── Category card ─────────────────────────────────────────────────
function CategoryCard({ cat, autoEdit, onRename, onColorChange, onDelete }) {
  const [editing, setEditing]       = useState(false)
  const [draft, setDraft]           = useState(cat.name)
  const [showPicker, setShowPicker] = useState(false)
  const inputRef                    = useRef(null)
  const CatIcon                     = CATEGORY_ICONS[cat.icon] || IconCoffee

  useEffect(() => { if (autoEdit) setEditing(true) }, [autoEdit])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) onRename(cat.id, trimmed)
    setEditing(false)
  }
  const cancel = () => { setDraft(cat.name); setEditing(false) }

  return (
    <div className="st-cat-card" onDoubleClick={() => !editing && setEditing(true)}>
      {/* Color dot + picker */}
      <div className="st-cat-dot-wrap">
        <button
          className="st-cat-dot"
          style={{ backgroundColor: cat.color }}
          onClick={() => setShowPicker(p => !p)}
          title="Rengi değiştir"
        />
        {showPicker && (
          <div className="st-color-picker">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                className={`st-color-swatch ${cat.color === c ? 'st-color-swatch--active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => { onColorChange(cat.id, c); setShowPicker(false) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Icon */}
      <div className="st-cat-icon" style={{ color: cat.color }}>
        <CatIcon />
      </div>

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          className="st-inline-input st-inline-input--center"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        />
      ) : (
        <span className="st-cat-name">{cat.name}</span>
      )}

      {/* Hover actions */}
      <div className="st-cat-actions">
        <button className="st-icon-btn" onClick={() => setEditing(true)} title="Düzenle"><IconPencil /></button>
        <button className="st-icon-btn st-icon-btn--danger" onClick={() => onDelete(cat.id)} title="Sil"><IconTrash /></button>
      </div>
    </div>
  )
}

// ── Main Settings page ─────────────────────────────────────────────
function Settings() {
  const {
    tableDefs,  addTableDef,  editTableDef,  removeTableDef,
    categories, addCategory,  editCategory,  removeCategory,
    isSyncing, lastSyncAt, unsyncedCount, triggerSync,
  } = useApp()
  const { isOnline } = useOnlineStatus()

  const [cafeName, setCafeName] = useState('Artisan Brew Co.')
  const [phone, setPhone]       = useState('+90 212 555 12 34')
  const [address, setAddress]   = useState('Karaköy Mah. Şair Nedim Cad.\nNo:12, Beyoğlu, İstanbul')

  const [activeSection,   setActiveSection]   = useState('cafe')
  const [autoEditTableId, setAutoEditTableId] = useState(null)
  const [autoEditCatId,   setAutoEditCatId]   = useState(null)
  const [tableError,      setTableError]      = useState(null)
  const [catError,        setCatError]        = useState(null)

  const sectionRefs = {
    cafe:       useRef(null),
    tables:     useRef(null),
    categories: useRef(null),
    connection: useRef(null),
    system:     useRef(null),
  }

  const scrollTo = (id) => {
    setActiveSection(id)
    sectionRefs[id]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Table handlers ─────────────────────────────────────────────
  const handleAddTable = async () => {
    try {
      setTableError(null)
      const row = await addTableDef(`Masa ${tableDefs.length + 1}`)
      setAutoEditTableId(row.id)
    } catch (err) {
      setTableError(`Masa eklenemedi: ${err.message}`)
    }
  }
  const handleRenameTable = async (id, name) => {
    try {
      await editTableDef(id, name)
      setAutoEditTableId(null)
    } catch (err) {
      setTableError(`Kaydedilemedi: ${err.message}`)
    }
  }
  const handleDeleteTable = async (id) => {
    try {
      await removeTableDef(id)
      setAutoEditTableId(null)
    } catch (err) {
      setTableError(`Silinemedi: ${err.message}`)
    }
  }

  // ── Category handlers ──────────────────────────────────────────
  const handleAddCategory = async () => {
    try {
      setCatError(null)
      const row = await addCategory({ name: 'Yeni Kategori', color: '#e8975a', icon: 'coffee' })
      setAutoEditCatId(row?.id ?? null)
    } catch (err) {
      setCatError(`Kategori eklenemedi: ${err.message}`)
    }
  }
  const handleRenameCategory = async (id, name) => {
    const cat = categories.find(c => c.id === id)
    if (cat) await editCategory(id, { name, color: cat.color, icon: cat.icon })
    setAutoEditCatId(null)
  }
  const handleChangeColor = async (id, color) => {
    const cat = categories.find(c => c.id === id)
    if (cat) await editCategory(id, { name: cat.name, color, icon: cat.icon })
  }
  const handleDeleteCategory = async (id) => {
    await removeCategory(id)
    setAutoEditCatId(null)
  }

  const handleSave   = () => console.log('[Settings] saved cafe info', { cafeName, phone, address })
  const handleCancel = () => window.location.reload()

  return (
    <div className="settings-page">

      {/* ── Page header ── */}
      <div className="settings-topbar">
        <h1 className="settings-topbar__title">Ayarlar</h1>
        <div className="settings-topbar__right">
          <div className="settings-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Ayar ara..." />
          </div>
          <button className="settings-icon-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
          <button className="settings-icon-btn settings-icon-btn--user">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="settings-body">

        {/* Sub-nav */}
        <nav className="settings-subnav">
          {SUB_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`settings-subnav__item ${activeSection === id ? 'settings-subnav__item--active' : ''}`}
              onClick={() => scrollTo(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="settings-content">

          {/* ── 1. Cafe Bilgileri ── */}
          <div ref={sectionRefs.cafe} className="settings-card">
            <h2 className="settings-card__title">Cafe Bilgileri</h2>
            <div className="settings-cafe-grid">
              <div className="settings-cafe-fields">
                <div className="settings-field">
                  <label className="settings-label">Cafe Adı</label>
                  <input className="settings-input" value={cafeName} onChange={e => setCafeName(e.target.value)} />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Telefon</label>
                  <input className="settings-input" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Adres</label>
                  <textarea className="settings-input settings-textarea" value={address} onChange={e => setAddress(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="settings-logo-zone">
                <div className="settings-logo-placeholder">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </div>
                <p className="settings-logo-hint">Logo yüklemek için tıklayın veya sürükleyin.</p>
                <p className="settings-logo-hint settings-logo-hint--small">(PNG, JPG - Max 2MB)</p>
              </div>
            </div>
          </div>

          {/* ── 2. Masa Yönetimi ── */}
          <div ref={sectionRefs.tables} className="settings-card">
            <div className="settings-card__header">
              <h2 className="settings-card__title">Masa Yönetimi</h2>
              <button className="st-add-btn" onClick={handleAddTable}>+ Yeni Masa Ekle</button>
            </div>
            {tableError && <p className="st-error">{tableError}</p>}
            <div className="st-table-list">
              {tableDefs.map((table, idx) => (
                <TableRow
                  key={table.id}
                  table={table}
                  index={idx}
                  autoEdit={table.id === autoEditTableId}
                  onRename={handleRenameTable}
                  onDelete={handleDeleteTable}
                />
              ))}
              {tableDefs.length === 0 && (
                <p className="st-empty-hint">Henüz masa yok. "+ Yeni Masa Ekle" ile başlayın.</p>
              )}
            </div>
          </div>

          {/* ── 3. Menü Kategorileri ── */}
          <div ref={sectionRefs.categories} className="settings-card">
            <div className="settings-card__header">
              <h2 className="settings-card__title">Menü Kategorileri</h2>
              <button className="st-add-link" onClick={handleAddCategory}>+ Kategori Ekle</button>
            </div>
            {catError && <p className="st-error">{catError}</p>}
            <div className="st-cat-grid">
              {categories.map(cat => (
                <CategoryCard
                  key={cat.id}
                  cat={cat}
                  autoEdit={cat.id === autoEditCatId}
                  onRename={handleRenameCategory}
                  onColorChange={handleChangeColor}
                  onDelete={handleDeleteCategory}
                />
              ))}
            </div>
          </div>

          {/* ── 4. Bağlantı Durumu ── */}
          <div ref={sectionRefs.connection} className="settings-card">
            <h2 className="settings-card__title">Bağlantı Durumu</h2>
            <div className="st-connection-grid">
              <div className="st-conn-row">
                <span className="st-conn-label">İnternet Bağlantısı</span>
                <span className={`st-conn-badge ${isOnline ? 'st-conn-badge--online' : 'st-conn-badge--offline'}`}>
                  {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
                </span>
              </div>
              <div className="st-conn-row">
                <span className="st-conn-label">Supabase</span>
                <span className={`st-conn-badge ${isOnline ? 'st-conn-badge--online' : 'st-conn-badge--offline'}`}>
                  {isOnline ? 'Bağlı' : 'Bağlantı Kesildi'}
                </span>
              </div>
              <div className="st-conn-row">
                <span className="st-conn-label">Bekleyen Kayıt</span>
                <span className="st-conn-count">{unsyncedCount} kayıt</span>
              </div>
              <button
                className="st-sync-btn"
                onClick={triggerSync}
                disabled={!isOnline || isSyncing || unsyncedCount === 0}
              >
                {isSyncing
                  ? 'Senkronize Ediliyor…'
                  : lastSyncAt
                    ? `Şimdi Senkronize Et · Son: ${lastSyncAt.toLocaleTimeString('tr-TR')}`
                    : 'Şimdi Senkronize Et'
                }
              </button>
            </div>
          </div>

          {/* ── 5. Sistem ── */}
          <div ref={sectionRefs.system} className="settings-card">
            <h2 className="settings-card__title">Sistem</h2>
            <div className="st-sistem-grid">
              <div>
                <label className="settings-label">Para Birimi Formatı</label>
                <div className="st-currency-display">1.250,00 ₺</div>
              </div>
              <div>
                <label className="settings-label">Hızlı İşlemler</label>
                <div className="st-quick-actions">
                  <button className="st-quick-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                    <span>Verileri Yedekle</span>
                    <svg className="st-quick-row__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  <button className="st-quick-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    <span>Güncelleme Kontrol Et</span>
                    <span className="st-version-badge">v1.0.0</span>
                  </button>
                  <button className="st-quick-row st-quick-row--danger">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Tüm Verileri Sıfırla</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="settings-footer">
            <button className="settings-footer__cancel" onClick={handleCancel}>Vazgeç</button>
            <button className="settings-footer__save" onClick={handleSave}>Değişiklikleri Kaydet</button>
          </div>

        </div>
      </div>
    </div>
  )
}

export default Settings
