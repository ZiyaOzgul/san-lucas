import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { getAllStaff } from '../../lib/localDb.js'
import './PaymentModal.css'

const MODES = [
  { id: 'single', label: 'Tek' },
  { id: 'split',  label: 'Eşit Böl' },
  { id: 'custom', label: 'Tutar Gir' },
  { id: 'item',   label: 'Ürün Ürün' },
]

const NUMPAD_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

function fmt(n) { return `₺${Number(n || 0).toFixed(2)}` }

function PaymentModal({ table, partialOrder, onClose, onComplete }) {
  const { kdvRate, kdvEnabled } = useApp()
  const [mode, setMode] = useState('single')

  // Common: cashier
  const [staffList,     setStaffList]     = useState([])
  const [selectedWaiter, setSelectedWaiter] = useState('')

  // Single mode
  const [singleMethod, setSingleMethod] = useState('cash')
  const [cashInput,    setCashInput]    = useState('')

  // Split mode (N kişi)
  const [splitCount,  setSplitCount]  = useState(2)
  const [splitMethod, setSplitMethod] = useState('cash')

  // Custom mode (drafts)
  const [customDrafts, setCustomDrafts] = useState([])
  const [draftAmount,  setDraftAmount]  = useState('')
  const [draftMethod,  setDraftMethod]  = useState('cash')
  const [draftLabel,   setDraftLabel]   = useState('')

  // Item mode
  const [itemSel,    setItemSel]    = useState(new Set())
  const [itemMethod, setItemMethod] = useState('cash')

  useEffect(() => {
    const list = getAllStaff().filter(s => s.isActive)
    setStaffList(list)
  }, [])

  const taxDecimal = kdvEnabled ? kdvRate / 100 : 0
  const items = partialOrder ? partialOrder.items : (table.orderItems || [])
  // Effective unit price = base unit + sum of modifier deltas (each scaled by its own quantity).
  const itemUnit = (i) => i.unitPrice + (i.modifiers?.reduce(
    (s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0
  ) || 0)
  const subtotal = items.reduce((s, i) => s + i.qty * itemUnit(i), 0)
  const tax      = Math.round(subtotal * taxDecimal * 100) / 100
  const discount = table.discount?.amount ?? 0
  const total    = subtotal + tax - discount

  // ── Mode-specific computed values ──────────────────────────────
  const enteredAmount = parseFloat(cashInput) || 0
  const change        = enteredAmount > total ? enteredAmount - total : 0

  const splitShare = splitCount > 0 ? total / splitCount : 0
  const draftsSum  = customDrafts.reduce((s, d) => s + Number(d.amount || 0), 0)

  const paymentsToCommit = useMemo(() => {
    if (mode === 'single') {
      if (total <= 0) return []
      return [{ amount: total, payment_method: singleMethod }]
    }
    if (mode === 'split') {
      if (total <= 0 || splitCount <= 0) return []
      const base = Math.floor((total / splitCount) * 100) / 100
      const rows = []
      let acc = 0
      for (let i = 0; i < splitCount - 1; i++) {
        rows.push({ amount: base, payment_method: splitMethod, payer_label: `Kişi ${i + 1}` })
        acc += base
      }
      rows.push({ amount: Math.round((total - acc) * 100) / 100, payment_method: splitMethod, payer_label: `Kişi ${splitCount}` })
      return rows
    }
    if (mode === 'custom') {
      return customDrafts.map(d => ({
        amount: Number(d.amount),
        payment_method: d.method,
        payer_label: d.label || null,
      }))
    }
    if (mode === 'item') {
      const parts = []
      const ids = []
      let sum = 0
      for (const it of items) {
        if (!itemSel.has(it.id)) continue
        sum += it.qty * itemUnit(it)
        ids.push(it.id)
        parts.push(it.name)
      }
      if (sum <= 0) return []
      return [{
        amount: Math.round(sum * 100) / 100,
        payment_method: itemMethod,
        payer_label: parts.join(', ').slice(0, 200) || null,
        order_item_ids: ids,
      }]
    }
    return []
  }, [mode, total, singleMethod, splitCount, splitMethod, customDrafts, items, itemSel, itemMethod])

  const commitAmount = paymentsToCommit.reduce((s, r) => s + r.amount, 0)
  const commitOverflow = commitAmount > total + 0.001
  const isFullPayment = commitAmount + 0.001 >= total
  const canComplete = !commitOverflow && commitAmount > 0 && (
    mode !== 'single' || singleMethod !== 'cash' || enteredAmount >= total
  )

  // ── Handlers ───────────────────────────────────────────────────
  const handleNumpad = (key) => {
    if (key === 'C')  { setCashInput(''); return }
    if (key === '⌫') { setCashInput(p => p.slice(0, -1)); return }
    if (cashInput.includes('.')) {
      const parts = cashInput.split('.')
      if (parts[1]?.length >= 2) return
    }
    setCashInput(p => p + key)
  }

  const handleQuick = (amount) => {
    setCashInput(String(amount === 'exact' ? total.toFixed(2) : amount))
  }

  const addDraft = () => {
    const amt = parseFloat((draftAmount || '').replace(',', '.'))
    if (!amt || amt <= 0) return
    if (draftsSum + amt > total + 0.001) return
    setCustomDrafts(prev => [...prev, {
      id: Date.now() + Math.random(),
      amount: amt,
      method: draftMethod,
      label: draftLabel.trim(),
    }])
    setDraftAmount('')
    setDraftLabel('')
  }

  const removeDraft = (id) => setCustomDrafts(prev => prev.filter(d => d.id !== id))
  const fillDraftRemaining = () => setDraftAmount(Math.max(total - draftsSum, 0).toFixed(2))

  const toggleItemSel = (id) => setItemSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleComplete = () => {
    if (!canComplete) return
    onComplete({
      tableId:          table.id,
      tableName:        table.name,
      supabaseOrderId:  partialOrder ? (partialOrder.supabaseOrderId ?? null) : (table.orderId ?? null),
      subOrderLocalId:  partialOrder?.localId ?? null,
      items,
      subtotal,
      tax,
      discount,
      total,
      paymentMethod:    mode === 'split' ? splitMethod : (mode === 'item' ? itemMethod : (mode === 'single' ? singleMethod : 'split')),
      cashReceived:     mode === 'single' && singleMethod === 'cash' ? enteredAmount : null,
      change:           mode === 'single' && singleMethod === 'cash' ? change : 0,
      paymentRows:      paymentsToCommit,
      isFullPayment,
      closedAt:         new Date().toISOString(),
      waiterName:       selectedWaiter || null,
    })
  }

  const transactionId = `POS-${Math.floor(10000 + Math.random() * 90000)}-TX`

  return (
    <div className="pm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pm-modal">

        {/* ── Header ── */}
        <div className="pm-header">
          <div className="pm-header__left">
            <div className="pm-header__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <h2 className="pm-header__title">
                Masa {table.name}{partialOrder ? ` – ${partialOrder.label}` : ' – Ödeme'}
              </h2>
              <p className="pm-header__subtitle">
                Açılış: {table.openTime ?? '—'} • Garson: {table.waiter ?? '—'}
              </p>
            </div>
          </div>
          <button className="pm-header__close" onClick={onClose}>✕</button>
        </div>

        {/* ── Body ── */}
        <div className="pm-body">

          {/* LEFT: Order Summary */}
          <div className="pm-left">
            <div className="pm-section-title">
              <span>Sipariş Özeti</span>
              <span className="pm-item-count">{items.length} Ürün</span>
            </div>

            <div className="pm-items">
              <div className="pm-items__head">
                <span>ADET</span>
                <span>ÜRÜN</span>
                <span>BİRİM</span>
                <span>TOPLAM</span>
              </div>
              {items.map((item, idx) => (
                <div key={item.id} className={`pm-item ${idx % 2 === 1 ? 'pm-item--alt' : ''}`}>
                  <span className="pm-item__qty">{item.qty}</span>
                  <div className="pm-item__name-wrap">
                    <span className="pm-item__name">{item.name}</span>
                    {item.note && <span className="pm-item__note">{item.note}</span>}
                  </div>
                  <span className="pm-item__unit">₺{itemUnit(item).toFixed(2)}</span>
                  <span className="pm-item__total">₺{(item.qty * itemUnit(item)).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="pm-totals">
              <div className="pm-totals__row">
                <span>Ara Toplam</span>
                <span>₺{subtotal.toFixed(2)}</span>
              </div>
              {kdvEnabled && (
                <div className="pm-totals__row">
                  <span>KDV (%{kdvRate})</span>
                  <span>₺{tax.toFixed(2)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="pm-totals__row pm-totals__row--discount">
                  <span>{table.discount?.label ?? 'İndirim'}</span>
                  <span>– ₺{discount.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Payment Panel */}
          <div className="pm-right">
            <div className="pm-amount-card">
              <span className="pm-amount-label">ÖDENECEK TOPLAM</span>
              <span className="pm-amount-value">₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
            </div>

            {/* Kasiyer */}
            {staffList.length > 0 && (
              <div className="pm-kasiyer">
                <label className="pm-kasiyer__label">Kasiyer</label>
                <select
                  className="pm-kasiyer__select"
                  value={selectedWaiter}
                  onChange={e => setSelectedWaiter(e.target.value)}
                >
                  <option value="">Seçin...</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.name}>{s.name} — {s.role}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Mode tabs */}
            <div className="pm-mode-tabs">
              {MODES.map(m => (
                <button
                  key={m.id}
                  className={`pm-mode-tab ${mode === m.id ? 'pm-mode-tab--active' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* ── SINGLE ── */}
            {mode === 'single' && (
              <>
                <div className="pm-methods">
                  <button
                    className={`pm-method ${singleMethod === 'cash' ? 'pm-method--active' : ''}`}
                    onClick={() => setSingleMethod('cash')}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>
                    </svg>
                    <span>Nakit</span>
                  </button>
                  <button
                    className={`pm-method ${singleMethod === 'card' ? 'pm-method--active' : ''}`}
                    onClick={() => setSingleMethod('card')}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                    <span>Kart</span>
                  </button>
                </div>

                {singleMethod === 'cash' && (
                  <>
                    <div className="pm-quick">
                      <button className="pm-quick__btn" onClick={() => handleQuick(700)}>700 ₺</button>
                      <button className="pm-quick__btn" onClick={() => handleQuick(1000)}>1000 ₺</button>
                      <button className="pm-quick__btn pm-quick__btn--exact" onClick={() => handleQuick('exact')}>Tam Tutar</button>
                    </div>

                    <div className="pm-cash-display">
                      <span className="pm-cash-display__label">Alınan Nakit</span>
                      <span className="pm-cash-display__value">
                        {cashInput ? `₺${cashInput}` : '—'}
                      </span>
                      {change > 0 && (
                        <span className="pm-cash-display__change">Para Üstü: ₺{change.toFixed(2)}</span>
                      )}
                    </div>

                    <div className="pm-numpad">
                      {NUMPAD_KEYS.map(key => (
                        <button
                          key={key}
                          className={`pm-numpad__key ${key === 'C' ? 'pm-numpad__key--clear' : ''} ${key === '⌫' ? 'pm-numpad__key--back' : ''}`}
                          onClick={() => handleNumpad(key)}
                        >
                          {key === '⌫' ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                              <line x1="18" y1="9" x2="12" y2="15" />
                              <line x1="12" y1="9" x2="18" y2="15" />
                            </svg>
                          ) : key}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── SPLIT (N kişi) ── */}
            {mode === 'split' && (
              <div className="pm-mode-panel">
                <p className="pm-mode-panel__hint">
                  Toplamı eşit parçalara böl. Yuvarlama farkı son kişiye eklenir.
                </p>
                <div className="pm-split-stepper">
                  <span className="pm-split-stepper__label">KİŞİ SAYISI</span>
                  <div className="pm-split-stepper__controls">
                    <button onClick={() => setSplitCount(c => Math.max(2, c - 1))}>−</button>
                    <span>{splitCount}</span>
                    <button onClick={() => setSplitCount(c => Math.min(20, c + 1))}>+</button>
                  </div>
                </div>
                <div className="pm-split-share">
                  <span>KİŞİ BAŞI</span>
                  <strong>{fmt(splitShare)}</strong>
                </div>
                <div className="pm-methods">
                  <button
                    className={`pm-method ${splitMethod === 'cash' ? 'pm-method--active' : ''}`}
                    onClick={() => setSplitMethod('cash')}
                  >Nakit</button>
                  <button
                    className={`pm-method ${splitMethod === 'card' ? 'pm-method--active' : ''}`}
                    onClick={() => setSplitMethod('card')}
                  >Kart</button>
                </div>
              </div>
            )}

            {/* ── CUSTOM (Tutar gir) ── */}
            {mode === 'custom' && (
              <div className="pm-mode-panel">
                <p className="pm-mode-panel__hint">
                  Her kişi/grup için ayrı tutar ekleyin. Toplam ödenecek tutarı geçemez.
                </p>

                {customDrafts.length > 0 && (
                  <div className="pm-drafts">
                    {customDrafts.map(d => (
                      <div key={d.id} className="pm-draft">
                        <span className="pm-draft__method">{d.method === 'cash' ? '💵' : '💳'}</span>
                        <div className="pm-draft__info">
                          <strong>{fmt(d.amount)}</strong>
                          <span>{d.label || (d.method === 'cash' ? 'Nakit' : 'Kart')}</span>
                        </div>
                        <button className="pm-draft__remove" onClick={() => removeDraft(d.id)}>✕</button>
                      </div>
                    ))}
                    <div className="pm-draft__sum">
                      <span>Toplam:</span>
                      <strong>{fmt(draftsSum)}</strong>
                      <span className="pm-draft__remaining">Kalan: {fmt(Math.max(total - draftsSum, 0))}</span>
                    </div>
                  </div>
                )}

                <label className="pm-field-label">TUTAR</label>
                <div className="pm-field-row">
                  <input
                    type="number"
                    className="pm-text-input"
                    value={draftAmount}
                    onChange={e => setDraftAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                  />
                  <button className="pm-fill-btn" onClick={fillDraftRemaining}>Kalan</button>
                </div>

                <label className="pm-field-label">ETİKET (OPSİYONEL)</label>
                <input
                  type="text"
                  className="pm-text-input"
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder="Örn. Müşteri 1, Ali"
                />

                <div className="pm-methods">
                  <button
                    className={`pm-method ${draftMethod === 'cash' ? 'pm-method--active' : ''}`}
                    onClick={() => setDraftMethod('cash')}
                  >Nakit</button>
                  <button
                    className={`pm-method ${draftMethod === 'card' ? 'pm-method--active' : ''}`}
                    onClick={() => setDraftMethod('card')}
                  >Kart</button>
                </div>

                <button className="pm-add-draft-btn" onClick={addDraft}>+ Ödemeye Ekle</button>
              </div>
            )}

            {/* ── ITEM (Ürün ürün) ── */}
            {mode === 'item' && (
              <div className="pm-mode-panel">
                <p className="pm-mode-panel__hint">
                  Ödenecek ürünleri tek tek seçin. Sadece seçim tutarı kadar tahsil edilir.
                </p>
                <div className="pm-item-list">
                  {items.map(it => {
                    const selected = itemSel.has(it.id)
                    return (
                      <div
                        key={it.id}
                        className={`pm-item-pick ${selected ? 'pm-item-pick--on' : ''}`}
                        onClick={() => toggleItemSel(it.id)}
                      >
                        <span className="pm-item-pick__check">{selected ? '☑' : '☐'}</span>
                        <div className="pm-item-pick__main">
                          <strong>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</strong>
                          {it.note ? <span className="pm-item-pick__note">{it.note}</span>
                                   : <span className="pm-item-pick__price">{fmt(it.unitPrice)}</span>}
                        </div>
                        <span className="pm-item-pick__total">{fmt(it.qty * itemUnit(it))}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="pm-methods">
                  <button
                    className={`pm-method ${itemMethod === 'cash' ? 'pm-method--active' : ''}`}
                    onClick={() => setItemMethod('cash')}
                  >Nakit</button>
                  <button
                    className={`pm-method ${itemMethod === 'card' ? 'pm-method--active' : ''}`}
                    onClick={() => setItemMethod('card')}
                  >Kart</button>
                </div>
              </div>
            )}

            {/* Commit summary */}
            <div className="pm-commit-summary">
              <span>TAHSİL EDİLECEK</span>
              <strong className={commitOverflow ? 'pm-commit-summary__error' : ''}>
                {fmt(commitAmount)}{!isFullPayment && commitAmount > 0 ? ' (kısmi)' : ''}
              </strong>
            </div>

            <button
              className={`pm-complete-btn ${!canComplete ? 'pm-complete-btn--disabled' : ''}`}
              onClick={handleComplete}
              disabled={!canComplete}
            >
              {isFullPayment ? 'Tahsil & Kapat' : 'Tahsil Et'}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="pm-footer">
          <span>İŞLEM ID: {transactionId}</span>
          <span>TERMİNAL: 01-FRONT &nbsp; VERSİYON: 1.0.0 SAN LUCAS</span>
        </div>

      </div>
    </div>
  )
}

export default PaymentModal
