import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import './OrderPanel.css'

function OrderPanel({ table, onClose, onCloseTable, onAddItem, onUpdateQty, onRemoveItem }) {
  const { products, categories } = useApp()
  const [search,      setSearch]      = useState('')
  const [activeCatId, setActiveCatId] = useState(null)

  const orderItems = table.orderItems ?? []
  const subtotal   = orderItems.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const tax        = Math.round(subtotal * (table.taxRate ?? 0.10) * 100) / 100
  const discount   = table.discount?.amount ?? 0
  const total      = subtotal + tax - discount
  const isOccupied = orderItems.length > 0

  const filteredProducts = products.filter(p => {
    const matchCat    = activeCatId === null || p.categoryId === activeCatId
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const getOrderItem = (productId) => orderItems.find(i => i.id === productId)

  // Category color for active tab
  const activeCatColor = categories.find(c => c.id === activeCatId)?.color ?? null

  return (
    <div className="om-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="om-modal">

        {/* ── LEFT: Order summary ── */}
        <div className="om-left">

          {/* Header */}
          <div className="om-left__header">
            <div className="om-left__title">
              <span>{table.name}</span>
              <span className={`badge ${isOccupied ? 'badge--success' : 'badge--muted'}`}>
                {isOccupied ? 'Açık' : 'Boş'}
              </span>
            </div>
            <button className="om-close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Items list */}
          <div className="om-items-scroll">
            {orderItems.length === 0 ? (
              <div className="om-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                <p>Henüz ürün eklenmedi.</p>
                <p className="om-empty__hint">Sağdan ürün seçin.</p>
              </div>
            ) : (
              <div className="om-items">
                {orderItems.map(item => (
                  <div key={item.id} className="om-item">
                    <div className="om-item__qty-ctrl">
                      <button
                        className="om-item__qty-btn"
                        onClick={() => onUpdateQty(table.id, item.id, item.qty - 1)}
                      >−</button>
                      <span className="om-item__qty">{item.qty}</span>
                      <button
                        className="om-item__qty-btn"
                        onClick={() => onUpdateQty(table.id, item.id, item.qty + 1)}
                      >+</button>
                    </div>
                    <span className="om-item__name">{item.name}</span>
                    <span className="om-item__total">₺{(item.qty * item.unitPrice).toLocaleString('tr-TR')}</span>
                    <button className="om-item__remove" onClick={() => onRemoveItem(table.id, item.id)}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer: totals + close button */}
          <div className="om-left__footer">
            {isOccupied && (
              <div className="om-totals">
                <div className="om-totals__row">
                  <span>Ara Toplam</span>
                  <span>₺{subtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="om-totals__row">
                  <span>KDV (%{Math.round((table.taxRate ?? 0.10) * 100)})</span>
                  <span>₺{tax.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
                {discount > 0 && (
                  <div className="om-totals__row om-totals__row--discount">
                    <span>{table.discount?.label ?? 'İndirim'}</span>
                    <span>– ₺{discount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="om-totals__row om-totals__row--total">
                  <span>Toplam</span>
                  <strong>₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            )}
            <button
              className="btn btn--primary btn--full"
              disabled={!isOccupied}
              onClick={onCloseTable}
              style={!isOccupied ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
            >
              Masayı Kapat
            </button>
          </div>
        </div>

        {/* ── RIGHT: Product picker ── */}
        <div className="om-right">

          <div className="om-picker-header">
            <input
              className="om-picker__search"
              placeholder="Ürün ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="om-picker__tabs">
              <button
                className={`om-picker__tab ${activeCatId === null ? 'om-picker__tab--active' : ''}`}
                onClick={() => setActiveCatId(null)}
              >Tümü</button>
              {categories.map(c => (
                <button
                  key={c.id}
                  className={`om-picker__tab ${activeCatId === c.id ? 'om-picker__tab--active' : ''}`}
                  style={activeCatId === c.id ? { '--tab-color': c.color } : {}}
                  onClick={() => setActiveCatId(c.id)}
                >{c.name}</button>
              ))}
            </div>
          </div>

          <div className="om-picker__grid">
            {filteredProducts.map(p => {
              const orderItem  = getOrderItem(p.id)
              const inOrder    = !!orderItem
              const outOfStock = p.stock === 0

              // Category color for no-image fallback background
              const cat      = categories.find(c => c.id === p.categoryId)
              const catColor = cat?.color ?? '#e8975a'

              return (
                <button
                  key={p.id}
                  className={`op-product ${inOrder ? 'op-product--in-order' : ''} ${outOfStock ? 'op-product--out' : ''}`}
                  style={p.imageUrl
                    ? { backgroundImage: `url(${p.imageUrl})` }
                    : { '--product-bg': catColor }
                  }
                  onClick={() => !outOfStock && onAddItem(table.id, p)}
                >
                  {inOrder && (
                    <span className="op-product__badge">{orderItem.qty}×</span>
                  )}
                  <div className="op-product__overlay">
                    <span className="op-product__name">{p.name}</span>
                    <span className="op-product__price">
                      {outOfStock ? 'Tükendi' : `₺${p.price.toLocaleString('tr-TR')}`}
                    </span>
                  </div>
                </button>
              )
            })}
            {filteredProducts.length === 0 && (
              <p className="om-picker__empty">Ürün bulunamadı.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

export default OrderPanel
