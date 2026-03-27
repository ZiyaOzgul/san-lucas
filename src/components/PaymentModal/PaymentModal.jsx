import { useState } from 'react'
import './PaymentModal.css'

const PAYMENT_METHODS = [
  {
    id: 'cash',
    label: 'Nakit',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    ),
  },
  {
    id: 'card',
    label: 'Kredi Kartı',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    id: 'split',
    label: 'Parçalı',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="8" rx="1" />
        <rect x="2" y="13" width="20" height="8" rx="1" />
      </svg>
    ),
  },
]

const NUMPAD_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

function PaymentModal({ table, onClose, onComplete }) {
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashInput,     setCashInput]     = useState('')
  const [splitCash,     setSplitCash]     = useState('')

  const items = table.orderItems || []
  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const tax      = Math.round(subtotal * (table.taxRate ?? 0.10) * 100) / 100
  const discount = table.discount?.amount ?? 0
  const total    = subtotal + tax - discount

  const enteredAmount = parseFloat(cashInput) || 0
  const change        = enteredAmount > total ? enteredAmount - total : 0

  const splitCashNum = parseFloat(splitCash) || 0
  const splitCardNum = Math.max(0, Math.round((total - splitCashNum) * 100) / 100)
  const splitValid   = paymentMethod === 'split' && splitCashNum > 0 && splitCashNum < total

  const handleNumpad = (key) => {
    if (key === 'C')  { setCashInput(''); return }
    if (key === '⌫') { setCashInput(p => p.slice(0, -1)); return }
    // prevent more than 2 decimal digits
    if (cashInput.includes('.')) {
      const parts = cashInput.split('.')
      if (parts[1]?.length >= 2) return
    }
    setCashInput(p => p + key)
  }

  const handleQuick = (amount) => {
    setCashInput(String(amount === 'exact' ? total.toFixed(2) : amount))
  }

  const canComplete =
    (paymentMethod === 'cash'  && enteredAmount >= total && enteredAmount > 0) ||
    (paymentMethod === 'card') ||
    (paymentMethod === 'split' && splitValid)

  const handleComplete = () => {
    if (!canComplete) return
    onComplete({
      tableId: table.id,
      tableName: table.name,
      items,
      subtotal,
      tax,
      discount,
      total,
      paymentMethod,
      cashReceived: paymentMethod === 'cash'  ? enteredAmount : null,
      change:       paymentMethod === 'cash'  ? change        : 0,
      splitCash:    paymentMethod === 'split' ? splitCashNum  : null,
      splitCard:    paymentMethod === 'split' ? splitCardNum  : null,
      closedAt: new Date().toISOString(),
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
              <h2 className="pm-header__title">Masa {table.name} – Ödeme</h2>
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
                  <span className="pm-item__unit">₺{item.unitPrice.toFixed(2)}</span>
                  <span className="pm-item__total">₺{(item.qty * item.unitPrice).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="pm-totals">
              <div className="pm-totals__row">
                <span>Ara Toplam</span>
                <span>₺{subtotal.toFixed(2)}</span>
              </div>
              <div className="pm-totals__row">
                <span>KDV (%{Math.round((table.taxRate ?? 0.10) * 100)})</span>
                <span>₺{tax.toFixed(2)}</span>
              </div>
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
              <span className="pm-loyalty-badge">Sadakat Puanı: +{Math.floor(total / 50)}</span>
            </div>

            {/* Payment methods */}
            <div className="pm-methods">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.id}
                  className={`pm-method ${paymentMethod === m.id ? 'pm-method--active' : ''}`}
                  onClick={() => setPaymentMethod(m.id)}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            {/* Split payment UI */}
            {paymentMethod === 'split' && (
              <div className="pm-split">
                <div className="pm-split__row">
                  <span className="pm-split__icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>
                    </svg>
                  </span>
                  <span className="pm-split__label">Nakit</span>
                  <input
                    type="number"
                    className="pm-split__input"
                    value={splitCash}
                    onChange={e => setSplitCash(e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    autoFocus
                  />
                </div>
                <div className="pm-split__row pm-split__row--card">
                  <span className="pm-split__icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                  </span>
                  <span className="pm-split__label">Kart</span>
                  <span className="pm-split__auto">
                    {splitCashNum > 0 && splitCashNum < total
                      ? `₺${splitCardNum.toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className={`pm-split__total${splitValid ? ' pm-split__total--ok' : ''}`}>
                  <span>Toplam</span>
                  <span>₺{total.toFixed(2)}{splitValid ? ' ✓' : ''}</span>
                </div>
              </div>
            )}

            {/* Quick amounts (cash only) */}
            {paymentMethod === 'cash' && (
              <>
                <div className="pm-quick">
                  <button className="pm-quick__btn" onClick={() => handleQuick(700)}>700 ₺</button>
                  <button className="pm-quick__btn" onClick={() => handleQuick(1000)}>1000 ₺</button>
                  <button className="pm-quick__btn pm-quick__btn--exact" onClick={() => handleQuick('exact')}>Tam Tutar</button>
                </div>

                {/* Cash entered display */}
                <div className="pm-cash-display">
                  <span className="pm-cash-display__label">Alınan Nakit</span>
                  <span className="pm-cash-display__value">
                    {cashInput ? `₺${cashInput}` : '—'}
                  </span>
                  {change > 0 && (
                    <span className="pm-cash-display__change">Para Üstü: ₺{change.toFixed(2)}</span>
                  )}
                </div>

                {/* Numpad */}
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

            {/* Action buttons */}
            <div className="pm-actions">
              <button className="pm-action-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Fiş Yazdır
              </button>
              <button className="pm-action-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                E-Fatura
              </button>
            </div>

            <button
              className={`pm-complete-btn ${!canComplete ? 'pm-complete-btn--disabled' : ''}`}
              onClick={handleComplete}
              disabled={!canComplete}
            >
              Ödemeyi Tamamla
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
