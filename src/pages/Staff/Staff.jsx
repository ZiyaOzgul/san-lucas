import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { getStaffPerformance, getStaffItemBreakdown } from '../../lib/localDb.js'
import './Staff.css'

const TABS = [
  { id: 'today', label: 'Bugün' },
  { id: 'week',  label: 'Bu Hafta' },
  { id: 'month', label: 'Bu Ay' },
]

function getDateRange(tabId) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (tabId === 'today') {
    const today = fmt(now)
    return [today, today]
  }
  if (tabId === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return [fmt(mon), fmt(sun)]
  }
  // month
  const y = now.getFullYear(), m = now.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  return [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(daysInMonth)}`]
}

function fmtCurrency(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function AvatarInitial({ name }) {
  return (
    <div className="sf-avatar">
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

function StaffCard({ staff, start, end }) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState(null)
  const [loadingItems, setLoadingItems] = useState(false)

  function handleToggle() {
    if (!expanded && items === null) {
      setLoadingItems(true)
      const data = getStaffItemBreakdown(staff.name, start, end)
      setItems(data)
      setLoadingItems(false)
    }
    setExpanded(p => !p)
  }

  return (
    <div className="sf-card">
      <button className="sf-card__header" onClick={handleToggle}>
        <AvatarInitial name={staff.name} />
        <div className="sf-card__info">
          <span className="sf-card__name">{staff.name}</span>
          <div className="sf-card__stats">
            <span className="sf-card__stat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              {staff.orderCount} sipariş
            </span>
            <span className="sf-card__dot">·</span>
            <span className="sf-card__revenue">{fmtCurrency(staff.revenue)}</span>
          </div>
        </div>
        <span className={`sf-card__chevron${expanded ? ' sf-card__chevron--open' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="sf-card__body">
          {loadingItems ? (
            <p className="sf-card__loading">Yükleniyor…</p>
          ) : items && items.length > 0 ? (
            <table className="sf-items-table">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="sf-items-table__num">Adet</th>
                  <th className="sf-items-table__num">Gelir</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td>
                    <td className="sf-items-table__num">× {item.qty}</td>
                    <td className="sf-items-table__num sf-items-table__revenue">{fmtCurrency(item.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sf-card__empty-items">Bu dönemde sipariş yok.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Staff() {
  const { dbReady } = useApp()
  const [activeTab, setActiveTab] = useState('today')
  const [staffData, setStaffData] = useState([])

  useEffect(() => {
    if (!dbReady) return
    const [start, end] = getDateRange(activeTab)
    setStaffData(getStaffPerformance(start, end))
  }, [activeTab, dbReady])

  const [start, end] = getDateRange(activeTab)
  const totalRevenue = staffData.reduce((s, d) => s + d.revenue, 0)
  const totalOrders  = staffData.reduce((s, d) => s + d.orderCount, 0)

  return (
    <div className="page staff-page">

      {/* ── Header ── */}
      <div className="sf-header">
        <div className="sf-header__left">
          <h1 className="sf-title">Personel Performansı</h1>
          <span className="sf-subtitle">{staffData.length} aktif çalışan</span>
        </div>
        <div className="sf-header__right">
          <div className="sf-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`sf-tab${activeTab === t.id ? ' sf-tab--active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Summary KPIs ── */}
      {staffData.length > 0 && (
        <div className="sf-kpis">
          <div className="sf-kpi">
            <span className="sf-kpi__label">Toplam Ciro</span>
            <span className="sf-kpi__value">{fmtCurrency(totalRevenue)}</span>
          </div>
          <div className="sf-kpi">
            <span className="sf-kpi__label">Toplam Sipariş</span>
            <span className="sf-kpi__value">{totalOrders}</span>
          </div>
          <div className="sf-kpi">
            <span className="sf-kpi__label">Çalışan Başına Ort.</span>
            <span className="sf-kpi__value">{fmtCurrency(staffData.length ? totalRevenue / staffData.length : 0)}</span>
          </div>
        </div>
      )}

      {/* ── Staff cards ── */}
      <div className="sf-list">
        {!dbReady ? (
          <div className="sf-empty">Veritabanı yükleniyor…</div>
        ) : staffData.length === 0 ? (
          <div className="sf-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <p>Bu dönemde kasiyer bilgisi olan sipariş yok.</p>
            <p className="sf-empty__sub">Ödeme ekranındaki "Kasiyer" alanını doldurun.</p>
          </div>
        ) : (
          staffData.map(staff => (
            <StaffCard key={staff.name} staff={staff} start={start} end={end} />
          ))
        )}
      </div>

    </div>
  )
}

export default Staff
