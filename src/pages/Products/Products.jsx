import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import './Products.css'

// ── Add/Edit Modal ────────────────────────────────────────────────
function ProductModal({ product, categories, ingredients, existingVariants, existingProductIngredients, onSave, onClose }) {
  const isEdit = !!product
  const [name,       setName]       = useState(product?.name       ?? '')
  const [price,      setPrice]      = useState(product?.price      ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? (categories[0]?.id ?? ''))
  const [imageUrl,   setImageUrl]   = useState(product?.imageUrl   ?? null)
  const [recipe,     setRecipe]     = useState(product?.recipe     ?? '')
  const [productIngRows, setProductIngRows] = useState(
    existingProductIngredients?.length
      ? existingProductIngredients.map(r => ({
          ingredientId: String(r.ingredientId),
          amountUsed:   String(r.amountUsed),
        }))
      : []
  )
  const [variants,   setVariants]   = useState(
    existingVariants?.length
      ? existingVariants.map(v => ({
          id:          v.id,
          name:        v.name,
          price:       String(v.price),
          ingredients: v.ingredients.map(i => ({
            ingredientId: String(i.ingredientId),
            amountUsed:   String(i.amountUsed),
          })),
        }))
      : []
  )

  const handleImagePick = async () => {
    if (!window.electronAPI?.images) return
    const picked = await window.electronAPI.images.pickAndSave()
    if (picked) setImageUrl(picked)
  }

  const addVariant = () => {
    setVariants(prev => [...prev, { id: `new_${Date.now()}`, name: '', price: '', ingredients: [] }])
  }

  const removeVariant = (idx) => {
    setVariants(prev => prev.filter((_, i) => i !== idx))
  }

  const updateVariant = (idx, field, value) => {
    setVariants(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v))
  }

  const addIngredientRow = (vIdx) => {
    setVariants(prev => prev.map((v, i) =>
      i === vIdx
        ? { ...v, ingredients: [...v.ingredients, { ingredientId: '', amountUsed: '' }] }
        : v
    ))
  }

  const removeIngredientRow = (vIdx, iIdx) => {
    setVariants(prev => prev.map((v, i) =>
      i === vIdx
        ? { ...v, ingredients: v.ingredients.filter((_, j) => j !== iIdx) }
        : v
    ))
  }

  const updateIngredientRow = (vIdx, iIdx, field, value) => {
    setVariants(prev => prev.map((v, i) =>
      i === vIdx
        ? {
            ...v,
            ingredients: v.ingredients.map((r, j) =>
              j === iIdx ? { ...r, [field]: value } : r
            ),
          }
        : v
    ))
  }

  const addProductIngRow    = () => setProductIngRows(prev => [...prev, { ingredientId: '', amountUsed: '' }])
  const removeProductIngRow = (idx) => setProductIngRows(prev => prev.filter((_, i) => i !== idx))
  const updateProductIngRow = (idx, field, value) =>
    setProductIngRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))

  const handleSave = () => {
    if (!name.trim() || !price) return
    onSave({
      product: {
        id:         product?.id ?? Date.now(),
        name:       name.trim(),
        price:      parseFloat(price),
        categoryId: Number(categoryId),
        imageUrl:   imageUrl || null,
        recipe:     recipe.trim() || null,
      },
      variants,
      productIngRows,
    })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal product-modal product-modal--wide">
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? 'Ürünü Düzenle' : 'Yeni Ürün Ekle'}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="product-modal__body">
          <div className="product-modal__fields">
            <div className="pm-field">
              <label className="pm-label">Ürün Adı</label>
              <input className="pm-input" value={name} onChange={e => setName(e.target.value)} placeholder="ör. Caffè Latte" />
            </div>
            <div className="pm-field">
              <label className="pm-label">Kategori</label>
              <select className="pm-input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="pm-field">
              <label className="pm-label">Fiyat (₺) <span className="pm-label__hint">— Varyant yoksa</span></label>
              <input className="pm-input" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
            </div>
            <div className="pm-field">
              <label className="pm-label">Tarif (opsiyonel)</label>
              <textarea
                className="pm-input pm-textarea"
                value={recipe}
                onChange={e => setRecipe(e.target.value)}
                placeholder="Malzemeler ve hazırlanış..."
                rows={3}
              />
            </div>
          </div>

          <div className="product-modal__image-zone" onClick={handleImagePick}>
            {imageUrl ? (
              <img src={imageUrl} alt="Ürün görseli" className="product-modal__image-preview" />
            ) : (
              <>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <p className="product-modal__image-hint">Görsel yükle</p>
                <p className="product-modal__image-hint product-modal__image-hint--small">PNG, JPG, WEBP</p>
              </>
            )}
          </div>
        </div>

        {/* ── Variants section ── */}
        <div className="pm-variants">
          <div className="pm-variants__header">
            <span className="pm-label">Varyantlar</span>
            <button type="button" className="pm-variants__add-btn" onClick={addVariant}>
              + Varyant Ekle
            </button>
          </div>

          {variants.length === 0 && (
            <p className="pm-variants__empty">Varyant eklenmedi — ürün yukarıdaki fiyatla satılacak.</p>
          )}

          {variants.map((v, vIdx) => (
            <div key={v.id} className="pm-variant-row">
              <div className="pm-variant-row__top">
                <input
                  className="pm-input pm-variant-row__name"
                  placeholder="ör. Küçük"
                  value={v.name}
                  onChange={e => updateVariant(vIdx, 'name', e.target.value)}
                />
                <div className="pm-variant-row__price-wrap">
                  <span className="pm-variant-row__currency">₺</span>
                  <input
                    className="pm-input pm-variant-row__price"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={v.price}
                    onChange={e => updateVariant(vIdx, 'price', e.target.value)}
                  />
                </div>
                <button type="button" className="pm-variant-row__remove" onClick={() => removeVariant(vIdx)} title="Varyantı sil">✕</button>
              </div>

              {/* Ingredient recipe rows */}
              <div className="pm-recipe-rows">
                {v.ingredients.map((r, iIdx) => {
                  const selIng = ingredients.find(i => String(i.id) === String(r.ingredientId))
                  return (
                    <div key={iIdx} className="pm-recipe-row">
                      <select
                        className="pm-input pm-recipe-row__select"
                        value={r.ingredientId}
                        onChange={e => updateIngredientRow(vIdx, iIdx, 'ingredientId', e.target.value)}
                      >
                        <option value="">— Malzeme seç —</option>
                        {ingredients.map(i => (
                          <option key={i.id} value={String(i.id)}>{i.name}</option>
                        ))}
                      </select>
                      <input
                        className="pm-input pm-recipe-row__amount"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={r.amountUsed}
                        onChange={e => updateIngredientRow(vIdx, iIdx, 'amountUsed', e.target.value)}
                      />
                      <span className="pm-recipe-row__unit">{selIng?.unit ?? '—'}</span>
                      <button type="button" className="pm-recipe-row__remove" onClick={() => removeIngredientRow(vIdx, iIdx)}>✕</button>
                    </div>
                  )
                })}
                <button type="button" className="pm-recipe-row__add" onClick={() => addIngredientRow(vIdx)}>
                  + Malzeme ekle
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Direct ingredient recipe (no variant needed) ── */}
        <div className="pm-variants">
          <div className="pm-variants__header">
            <span className="pm-label">Malzeme Reçetesi <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted)' }}>(varyant olmadan)</span></span>
            <button type="button" className="pm-variants__add-btn" onClick={addProductIngRow}>
              + Malzeme Ekle
            </button>
          </div>

          {productIngRows.length === 0 && (
            <p className="pm-variants__empty">Malzeme eklenmedi — stok düşümü yapılmayacak.</p>
          )}

          <div className="pm-recipe-rows">
            {productIngRows.map((r, idx) => {
              const selIng = ingredients.find(i => String(i.id) === String(r.ingredientId))
              return (
                <div key={idx} className="pm-recipe-row">
                  <select
                    className="pm-input pm-recipe-row__select"
                    value={r.ingredientId}
                    onChange={e => updateProductIngRow(idx, 'ingredientId', e.target.value)}
                  >
                    <option value="">— Malzeme seç —</option>
                    {ingredients.map(i => (
                      <option key={i.id} value={String(i.id)}>{i.name}</option>
                    ))}
                  </select>
                  <input
                    className="pm-input pm-recipe-row__amount"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={r.amountUsed}
                    onChange={e => updateProductIngRow(idx, 'amountUsed', e.target.value)}
                  />
                  <span className="pm-recipe-row__unit">{selIng?.unit ?? '—'}</span>
                  <button type="button" className="pm-recipe-row__remove" onClick={() => removeProductIngRow(idx)}>✕</button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>İptal</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!name.trim() || !price}>Kaydet</button>
        </div>
      </div>
    </div>
  )
}

// ── Product Detail Modal ──────────────────────────────────────────
function ProductDetailModal({ product, category, variants, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal product-detail-modal">
        <button className="modal__close pdm-close" onClick={onClose}>✕</button>

        <div className="pdm-image">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} />
          ) : (
            <div className="pdm-image__placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          )}
        </div>

        <div className="pdm-body">
          <div className="pdm-meta">
            {category && (
              <span className="pdm-cat-pill" style={{ backgroundColor: category.color + '22', color: category.color }}>
                {category.name}
              </span>
            )}
            <span className="pdm-price">
              {variants?.length
                ? `₺${Math.min(...variants.map(v => v.price)).toLocaleString('tr-TR')} – ₺${Math.max(...variants.map(v => v.price)).toLocaleString('tr-TR')}`
                : `₺${product.price.toLocaleString('tr-TR')}`
              }
            </span>
          </div>
          <h2 className="pdm-name">{product.name}</h2>

          {variants?.length > 0 && (
            <div className="pdm-variants">
              <h3 className="pdm-recipe__title">Varyantlar</h3>
              {variants.map(v => (
                <div key={v.id} className="pdm-variant-row">
                  <span>{v.name}</span>
                  <span className="pdm-variant-row__price">₺{v.price.toLocaleString('tr-TR')}</span>
                </div>
              ))}
            </div>
          )}

          {product.recipe && (
            <div className="pdm-recipe">
              <h3 className="pdm-recipe__title">Tarif</h3>
              <p className="pdm-recipe__text">{product.recipe}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Products page ────────────────────────────────────────────
function Products() {
  const { categories, products, productVariants, productIngredients, ingredients, saveProduct, removeProduct, saveVariants, saveProductIngredients } = useApp()

  const [activeCatId, setActiveCatId] = useState(null)
  const [search,      setSearch]      = useState('')
  const [editProduct, setEditProduct] = useState(undefined) // undefined=closed, null=new, obj=edit
  const [viewProduct, setViewProduct] = useState(null)      // null=closed, obj=view
  const [hoveredId,   setHoveredId]   = useState(null)

  const filtered = products.filter(p => {
    const matchCat    = activeCatId === null || p.categoryId === activeCatId
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const getCategoryForProduct = (catId) => categories.find(c => c.id === catId)

  const handleSave = async ({ product, variants, productIngRows }) => {
    await saveProduct(product)
    await saveVariants(product.id, variants)
    await saveProductIngredients(product.id, productIngRows)
    setEditProduct(undefined)
  }

  const handleDelete = async (id) => {
    await removeProduct(id)
  }

  return (
    <div className="page products-page">
      {/* ── Header ── */}
      <div className="products-header">
        <div className="products-header__left">
          <h1 className="products-title">Ürünler</h1>
        </div>
        <div className="products-header__right">
          <div className="products-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Ürün ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-add-product" onClick={() => setEditProduct(null)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Ürün Ekle
          </button>
        </div>
      </div>

      {/* ── Category filter tabs ── */}
      <div className="products-tabs">
        <button
          className={`products-tab ${activeCatId === null ? 'products-tab--active' : ''}`}
          onClick={() => setActiveCatId(null)}
        >
          Tümü
          <span className="products-tab__count">{products.length}</span>
        </button>
        {categories.map(cat => {
          const count = products.filter(p => p.categoryId === cat.id).length
          return (
            <button
              key={cat.id}
              className={`products-tab ${activeCatId === cat.id ? 'products-tab--active' : ''}`}
              style={activeCatId === cat.id ? { '--tab-color': cat.color } : {}}
              onClick={() => setActiveCatId(cat.id)}
            >
              <span className="products-tab__dot" style={{ backgroundColor: cat.color }} />
              {cat.name}
              <span className="products-tab__count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Product grid ── */}
      <div className="products-grid">
        {filtered.map(product => {
          const cat      = getCategoryForProduct(product.categoryId)
          const variants = productVariants[product.id] ?? []
          const priceLabel = variants.length
            ? `₺${Math.min(...variants.map(v => v.price)).toLocaleString('tr-TR')}${variants.length > 1 ? ' +' : ''}`
            : `₺${product.price.toLocaleString('tr-TR')}`
          return (
            <div
              key={product.id}
              className="product-card"
              onClick={() => setViewProduct(product)}
              onMouseEnter={() => setHoveredId(product.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Image */}
              <div className="product-card__image">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="product-card__image-img" />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                )}
              </div>

              {/* Card body */}
              <div className="product-card__body">
                <p className="product-card__name">{product.name}</p>
                {cat && (
                  <span className="product-card__cat-pill" style={{ backgroundColor: cat.color + '22', color: cat.color }}>
                    {cat.name}
                  </span>
                )}
                <p className="product-card__price">{priceLabel}</p>
                {variants.length > 0 && (
                  <span className="product-card__variants-badge">{variants.length} varyant</span>
                )}
              </div>

              {/* Hover actions */}
              {hoveredId === product.id && (
                <div className="product-card__actions" onClick={e => e.stopPropagation()}>
                  <button className="product-card__action-btn" onClick={() => setEditProduct(product)} title="Düzenle">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button className="product-card__action-btn product-card__action-btn--danger" onClick={() => handleDelete(product.id)} title="Sil">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="products-empty">
            <p>Ürün bulunamadı.</p>
          </div>
        )}
      </div>

      {/* ── Detail Modal ── */}
      {viewProduct && (
        <ProductDetailModal
          product={viewProduct}
          category={getCategoryForProduct(viewProduct.categoryId)}
          variants={productVariants[viewProduct.id] ?? []}
          onClose={() => setViewProduct(null)}
        />
      )}

      {/* ── Add/Edit Modal ── */}
      {editProduct !== undefined && (
        <ProductModal
          product={editProduct}
          categories={categories}
          ingredients={ingredients}
          existingVariants={editProduct ? (productVariants[editProduct.id] ?? []) : []}
          existingProductIngredients={editProduct ? (productIngredients[editProduct.id] ?? []) : []}
          onSave={handleSave}
          onClose={() => setEditProduct(undefined)}
        />
      )}
    </div>
  )
}

export default Products
