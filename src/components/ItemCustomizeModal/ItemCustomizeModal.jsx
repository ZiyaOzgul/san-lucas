import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import './ItemCustomizeModal.css'

// Picks the modifier list for a product (category-inherited minus excluded,
// plus product-specific). Re-computed when the modifiers store changes so the
// modal stays live while the cafe owner edits modifiers in another tab.
function useEffectiveModifiers(productId, categoryId) {
  const { modifiers, effectiveModifiersForProduct } = useApp()
  return useMemo(() => {
    if (!productId) return []
    return effectiveModifiersForProduct(productId, categoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, categoryId, modifiers])
}

function ItemCustomizeModal({
  open,
  product,            // { id, name, price, categoryId, ... }  — required for 'add' mode
  variant,            // optional { id, name, price }
  basePrice,          // resolved unit price (variant.price || product.price)
  initialModifiers,   // [{ modifierId, name, priceDelta, quantity }]
  mode = 'add',       // 'add' | 'edit'
  onSubmit,           // (modifiers[]) => void
  onClose,
}) {
  const effective = useEffectiveModifiers(product?.id, product?.categoryId)

  // selected: { [modifierId]: quantity }
  const [selected, setSelected] = useState({})

  useEffect(() => {
    if (!open) return
    const initial = {}
    if (initialModifiers?.length) {
      for (const m of initialModifiers) {
        const key = m.modifierId ?? m.id
        if (key != null) initial[key] = m.quantity || 1
      }
    }
    setSelected(initial)
  }, [open, initialModifiers])

  if (!open || !product) return null

  const unitPrice = Number(basePrice ?? variant?.price ?? product.price ?? 0)
  const modifiersTotal = effective.reduce((sum, m) => {
    const q = selected[m.id] || 0
    return sum + q * (Number(m.priceDelta) || 0)
  }, 0)
  const lineTotal = unitPrice + modifiersTotal

  const inc = (m) => setSelected(prev => ({ ...prev, [m.id]: (prev[m.id] || 0) + 1 }))
  const dec = (m) => setSelected(prev => {
    const next = { ...prev }
    const v = (next[m.id] || 0) - 1
    if (v <= 0) delete next[m.id]
    else next[m.id] = v
    return next
  })

  const submit = () => {
    const out = []
    for (const m of effective) {
      const q = selected[m.id]
      if (!q || q <= 0) continue
      out.push({
        modifierId: m.id,
        name: m.name,
        priceDelta: Number(m.priceDelta) || 0,
        quantity: q,
      })
    }
    onSubmit(out)
  }

  return (
    <div className="icm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="icm-modal">

        <div className="icm-header">
          <div className="icm-header__text">
            <div className="icm-title">{product.name}</div>
            {variant ? (
              <div className="icm-subtitle">{variant.name}</div>
            ) : (
              <div className="icm-subtitle">
                {mode === 'edit' ? 'Ekstraları düzenle' : 'Ekstra ister misiniz?'}
              </div>
            )}
          </div>
          <button className="icm-close-btn" onClick={onClose} aria-label="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {effective.length === 0 ? (
          <div className="icm-empty">
            Bu ürün için tanımlı ekstra yok.
            <div className="icm-empty__hint">Ayarlar → Kategoriler ekranından ekstra tanımlayabilirsiniz.</div>
          </div>
        ) : (
          <div className="icm-list">
            {effective.map(m => {
              const qty = selected[m.id] || 0
              const active = qty > 0
              const deltaLabel = m.priceDelta > 0
                ? `+₺${Number(m.priceDelta).toLocaleString('tr-TR')}`
                : m.priceDelta < 0
                  ? `–₺${Math.abs(Number(m.priceDelta)).toLocaleString('tr-TR')}`
                  : null
              return (
                <div key={m.id} className={`icm-row ${active ? 'icm-row--active' : ''}`}>
                  <div className="icm-row__text">
                    <div className="icm-row__name">{m.name}</div>
                    {deltaLabel && <div className="icm-row__delta">{deltaLabel}</div>}
                  </div>
                  <div className="icm-qty">
                    <button
                      className="icm-qty__btn"
                      onClick={() => dec(m)}
                      disabled={qty === 0}
                      aria-label="Azalt"
                    >−</button>
                    <span className="icm-qty__value">{qty}</span>
                    <button
                      className="icm-qty__btn icm-qty__btn--plus"
                      onClick={() => inc(m)}
                      aria-label="Artır"
                    >+</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="icm-footer">
          <div className="icm-total">
            <span className="icm-total__label">Birim</span>
            <span className="icm-total__value">₺{lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="icm-actions">
            <button className="icm-btn icm-btn--ghost" onClick={onClose}>Vazgeç</button>
            <button className="icm-btn icm-btn--primary" onClick={submit}>
              {mode === 'edit' ? 'Kaydet' : '+ Ekle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ItemCustomizeModal
