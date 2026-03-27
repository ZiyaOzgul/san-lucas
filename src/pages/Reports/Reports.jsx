import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  getReportKpis, getTopProduct, getRevenueByPeriod,
  getPaymentBreakdown, getTableRevenue, getTopProducts, getProductSalesDetail,
} from '../../lib/localDb.js'
import './Reports.css'

const TABS = [
  { id: 'today', label: 'Bugün',    revenueLabel: 'Günlük Ciro',   orderLabel: 'Bugünkü Sipariş',  chartTitle: 'Saatlik Ciro' },
  { id: 'week',  label: 'Bu Hafta', revenueLabel: 'Haftalık Ciro', orderLabel: 'Haftalık Sipariş', chartTitle: 'Günlük Ciro' },
  { id: 'month', label: 'Bu Ay',    revenueLabel: 'Aylık Ciro',    orderLabel: 'Aylık Sipariş',    chartTitle: 'Günlük Ciro' },
  { id: 'total', label: 'Toplam',   revenueLabel: 'Toplam Ciro',   orderLabel: 'Toplam Sipariş',   chartTitle: 'Aylık Ciro' },
]

const PIE_COLORS = ['#e8975a', '#6366f1']

function getDateRange(tabId) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

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
  if (tabId === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    return [`${y}-${pad(m+1)}-01`, `${y}-${pad(m+1)}-${pad(daysInMonth)}`]
  }
  return [null, null]
}

function fmtCurrency(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rpt-tooltip">
      <span className="rpt-tooltip__label">{label}</span>
      <span className="rpt-tooltip__val">{fmtCurrency(payload[0].value)}</span>
    </div>
  )
}

function Reports() {
  const { dbReady } = useApp()
  const [activeTab,    setActiveTab]    = useState('today')
  const [kpis,         setKpis]         = useState({ revenue: 0, orderCount: 0, avgOrder: 0 })
  const [topProduct,   setTopProduct]   = useState({ name: '—', qty: 0 })
  const [periodData,   setPeriodData]   = useState([])
  const [paymentData,  setPaymentData]  = useState([{ name: 'Nakit', value: 0 }, { name: 'Kart', value: 0 }])
  const [tableRevData, setTableRevData] = useState([])
  const [topProducts,  setTopProducts]  = useState([])
  const [detailData,   setDetailData]   = useState([])

  useEffect(() => {
    if (!dbReady) return
    const [start, end] = getDateRange(activeTab)
    setKpis(getReportKpis(start, end))
    setTopProduct(getTopProduct(start, end))
    setPeriodData(getRevenueByPeriod(activeTab))
    setPaymentData(getPaymentBreakdown(start, end))
    setTableRevData(getTableRevenue(start, end))
    setTopProducts(getTopProducts(start, end))
    setDetailData(getProductSalesDetail(start, end))
  }, [activeTab, dbReady])

  const tab = TABS.find(t => t.id === activeTab)
  const totalPayment = paymentData.reduce((s, d) => s + d.value, 0)
  const maxTableRev  = tableRevData.reduce((m, r) => Math.max(m, r.value), 0) || 1

  const xAxisInterval = activeTab === 'month' ? 4 : 0

  return (
    <div className="page reports-page">

      {/* ── Header ── */}
      <div className="rpt-header">
        <h1 className="rpt-title">Performans Analizi</h1>
        <div className="rpt-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`rpt-tab${activeTab === t.id ? ' rpt-tab--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="rpt-kpis">
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">{tab.revenueLabel}</span>
          <span className="rpt-kpi__value">{fmtCurrency(kpis.revenue)}</span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">{tab.orderLabel}</span>
          <span className="rpt-kpi__value">{kpis.orderCount} <small>adet</small></span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">Ortalama Sepet</span>
          <span className="rpt-kpi__value">{fmtCurrency(kpis.avgOrder)}</span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">En Çok Satan</span>
          <span className="rpt-kpi__value rpt-kpi__value--sm">{topProduct.name}</span>
          {topProduct.qty > 0 && (
            <span className="rpt-kpi__sub">{topProduct.qty} adet satıldı</span>
          )}
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="rpt-row">

        {/* Left: bar chart + table revenue */}
        <div className="rpt-col-left">

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">{tab.chartTitle}</span>
              {activeTab === 'today' && (
                <span className="rpt-card__sub">08:00 – 22:00</span>
              )}
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={periodData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={xAxisInterval}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => v === 0 ? '' : `₺${v.toLocaleString('tr-TR')}`}
                    width={60}
                  />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'var(--color-accent-light)' }} />
                  <Bar dataKey="value" fill="#e8975a" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">Masa Bazlı Ciro</span>
            </div>
            {tableRevData.length === 0 ? (
              <p className="rpt-empty">Bu dönemde veri yok.</p>
            ) : (
              <div className="rpt-table-bars">
                {tableRevData.map(row => (
                  <div key={row.name} className="rpt-bar-row">
                    <span className="rpt-bar-row__name">{row.name}</span>
                    <div className="rpt-bar-row__track">
                      <div
                        className="rpt-bar-row__fill"
                        style={{ width: `${(row.value / maxTableRev) * 100}%` }}
                      />
                    </div>
                    <span className="rpt-bar-row__val">{fmtCurrency(row.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right: donut + top products */}
        <div className="rpt-col-right">

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">Ödeme Dağılımı</span>
            </div>
            <div className="rpt-donut-wrap">
              <div className="rpt-donut-chart">
                <PieChart width={180} height={180}>
                  <Pie
                    data={paymentData}
                    cx={90} cy={90}
                    innerRadius={54}
                    outerRadius={80}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={totalPayment > 0 ? 2 : 0}
                  >
                    {paymentData.map((_, i) => (
                      <Cell key={i} fill={totalPayment > 0 ? PIE_COLORS[i] : '#e5e7eb'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => [fmtCurrency(v), '']} />
                </PieChart>
                <div className="rpt-donut-center">
                  {totalPayment > 0 ? (
                    <>
                      <span className="rpt-donut-pct">
                        {Math.round((paymentData[0].value / totalPayment) * 100)}%
                      </span>
                      <span className="rpt-donut-sub">Nakit</span>
                    </>
                  ) : (
                    <span className="rpt-donut-sub">Veri yok</span>
                  )}
                </div>
              </div>
              <div className="rpt-donut-legend">
                {paymentData.map((d, i) => (
                  <div key={d.name} className="rpt-legend-item">
                    <span className="rpt-legend-dot" style={{ background: PIE_COLORS[i] }} />
                    <span className="rpt-legend-name">{d.name}</span>
                    <span className="rpt-legend-val">
                      {totalPayment > 0
                        ? Math.round((d.value / totalPayment) * 100) + '%'
                        : '0%'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">En Çok Satan Ürünler</span>
            </div>
            {topProducts.length === 0 ? (
              <p className="rpt-empty">Bu dönemde veri yok.</p>
            ) : (
              <ol className="rpt-top-list">
                {topProducts.map((p, i) => (
                  <li key={p.name} className="rpt-top-item">
                    <span className="rpt-top-num">{i + 1}</span>
                    <span className="rpt-top-name">{p.name}</span>
                    <span className="rpt-top-qty">{p.qty} adet</span>
                    <span className="rpt-top-rev">{fmtCurrency(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

        </div>
      </div>

      {/* ── Product detail table ── */}
      <div className="rpt-card">
        <div className="rpt-card__header">
          <span className="rpt-card__title">Ürün Satış Detayı</span>
        </div>
        {detailData.length === 0 ? (
          <p className="rpt-empty">Bu dönemde satış verisi yok.</p>
        ) : (
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Kategori</th>
                <th>Satış Adedi</th>
                <th>Toplam Gelir</th>
                <th>Günlük Ort.</th>
              </tr>
            </thead>
            <tbody>
              {detailData.map(row => (
                <tr key={row.name}>
                  <td className="rpt-table__name">{row.name}</td>
                  <td>{row.category}</td>
                  <td>{row.qty} adet</td>
                  <td>{fmtCurrency(row.revenue)}</td>
                  <td>{fmtCurrency(row.dailyAvg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="rpt-table__foot-label">Toplam</td>
                <td>{detailData.reduce((s, r) => s + r.qty, 0)} adet</td>
                <td>{fmtCurrency(detailData.reduce((s, r) => s + r.revenue, 0))}</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

    </div>
  )
}

export default Reports
