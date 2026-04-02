import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { saveCompletedOrder, getDailyRevenue, isDbInitialized } from '../../lib/localDb.js'
import { supabase, isSupabaseReady } from '../../lib/supabase.js'
import { playAlertSound } from '../../lib/alertSound.js'
import TableCard from '../../components/TableCard/TableCard.jsx'
import OrderPanel from '../../components/OrderPanel/OrderPanel.jsx'
import PaymentModal from '../../components/PaymentModal/PaymentModal.jsx'
import QRApprovalModal from '../../components/QRApprovalModal/QRApprovalModal.jsx'
import './Tables.css'


function getLiveTime() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function Tables() {
  const { tableDefs, triggerSync, isOnline, kdvRate } = useApp()
  const [runtimeStates,  setRuntimeStates]  = useState({})
  const [clock,          setClock]          = useState(getLiveTime)
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [paymentTable,   setPaymentTable]   = useState(null)
  const [qrTable,        setQrTable]        = useState(null)
  const [tableFilter,    setTableFilter]    = useState('all') // 'all' | 'open'
  const [dailyRevenue,   setDailyRevenue]   = useState(0)
  const [lowStockAlerts, setLowStockAlerts] = useState([])

  const refreshRevenue = useCallback(() => {
    if (isDbInitialized()) setDailyRevenue(getDailyRevenue())
  }, [])

  useEffect(() => {
    refreshRevenue()
  }, [refreshRevenue])

  useEffect(() => {
    const timer = setInterval(() => setClock(getLiveTime()), 1000)
    return () => clearInterval(timer)
  }, [])

  // ── Realtime QR order subscription ──────────────────────────────
  useEffect(() => {
    if (!isSupabaseReady) return

    const channel = supabase
      .channel('qr-orders-alert')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: 'status=eq.pending' },
        async (payload) => {
          playAlertSound()
          const newOrder = payload.new
          if (!newOrder?.table_id) return

          const openMinutes = newOrder.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(newOrder.created_at).getTime()) / 60000))
            : 0

          let orderItems = []
          try {
            const { data } = await supabase
              .from('order_items')
              .select('id, quantity, unit_price, products(name)')
              .eq('order_id', newOrder.id)
            if (data) {
              orderItems = data.map(item => ({
                id:        item.id,
                name:      item.products?.name ?? 'Ürün',
                qty:       item.quantity,
                unitPrice: item.unit_price,
                note:      '',
              }))
            }
          } catch (e) {
            console.warn('[Tables] Could not fetch QR order items', e)
          }

          setRuntimeStates(prev => ({
            ...prev,
            [newOrder.table_id]: {
              ...(prev[newOrder.table_id] ?? {}),
              status:     'occupied',
              type:       'qr',
              orderId:    newOrder.id,
              openMinutes,
              orderItems,
            },
          }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Auto-open QR approval modal when a new QR order arrives
  useEffect(() => {
    if (qrTable) return  // modal already open — don't interrupt
    const entry = Object.entries(runtimeStates).find(
      ([, s]) => s.type === 'qr' && s.status === 'occupied'
    )
    if (!entry) return
    const [tableId, state] = entry
    const def = tableDefs.find(t => t.id === Number(tableId))
    if (def) setQrTable({ ...def, ...state })
  }, [runtimeStates]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge tableDefs with runtime states — new tables from Settings appear as empty
  const displayTables = tableDefs.map(def => ({
    ...def,
    ...(runtimeStates[def.id] ?? { status: 'empty' }),
  }))

  const visibleTables = tableFilter === 'open'
    ? displayTables.filter(t => t.status === 'occupied')
    : displayTables

  const selectedTable = selectedTableId !== null
    ? displayTables.find(t => t.id === selectedTableId) ?? null
    : null

  const occupied  = displayTables.filter(t => t.status === 'occupied')
  const aktif     = occupied.length
  const bekleyen  = occupied.filter(t => t.type === 'qr').length

  // ── Card click ──────────────────────────────────────────────────
  const handleCardClick = (table) => {
    if (table.type === 'qr') { setQrTable(table); return }
    setSelectedTableId(prev => prev === table.id ? null : table.id)
  }

  // ── Item management ─────────────────────────────────────────────
  const handleAddItem = (tableId, product) => {
    const newItem = {
      id:        product.id,
      productId: product.productId ?? product.id,
      name:      product.name,
      unitPrice: product.price,
      qty:       1,
      note:      '',
      variantId: product.variantId ?? null,
    }
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) {
        return {
          ...prev,
          [tableId]: {
            status: 'occupied',
            type: 'normal',
            openTime: getLiveTime(),
            openMinutes: 0,
            waiter: '—',
            taxRate: kdvRate / 100,
            orderItems: [newItem],
          },
        }
      }
      // Occupied table → increment or append
      const found = existing.orderItems?.find(i => i.id === product.id)
      const newItems = found
        ? existing.orderItems.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...(existing.orderItems ?? []), newItem]
      return { ...prev, [tableId]: { ...existing, status: 'occupied', orderItems: newItems } }
    })
  }

  const handleUpdateQty = (tableId, itemId, newQty) => {
    if (newQty <= 0) { handleRemoveItem(tableId, itemId); return }
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newItems = existing.orderItems.map(i => i.id === itemId ? { ...i, qty: newQty } : i)
      return { ...prev, [tableId]: { ...existing, orderItems: newItems } }
    })
  }

  const handleRemoveItem = (tableId, itemId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newItems = existing.orderItems.filter(i => i.id !== itemId)
      if (newItems.length === 0) {
        // Last item removed — table goes empty
        const next = { ...prev }
        delete next[tableId]
        return next
      }
      return { ...prev, [tableId]: { ...existing, orderItems: newItems } }
    })
  }

  // ── Payment / QR ────────────────────────────────────────────────
  const handlePaymentComplete = async (transactionData) => {
    setRuntimeStates(prev => {
      const next = { ...prev }
      delete next[transactionData.tableId]
      return next
    })
    setPaymentTable(null)
    setSelectedTableId(null)
    try {
      const { lowStockWarnings } = await saveCompletedOrder(transactionData)
      refreshRevenue()
      if (lowStockWarnings?.length) setLowStockAlerts(lowStockWarnings)
      console.log(`[Tables] ✓ Order completed — Masa ${transactionData.tableId} | ₺${transactionData.total?.toFixed(2)} | ${transactionData.paymentMethod}`)
      if (transactionData.supabaseOrderId && isSupabaseReady) {
        await supabase
          .from('orders')
          .update({
            status: 'completed',
            payment_method: transactionData.paymentMethod,
            total: transactionData.total,
            closed_at: transactionData.closedAt,
          })
          .eq('id', transactionData.supabaseOrderId)
      }
      if (isOnline) triggerSync()
    } catch (e) {
      console.error('[Tables] Failed to save order to DB', e)
    }
  }

  const handleQRApprove = async () => {
    const orderId = qrTable?.orderId
    setRuntimeStates(prev => ({
      ...prev,
      [qrTable.id]: { ...prev[qrTable.id], type: 'normal', openTime: getLiveTime(), waiter: 'Garson' },
    }))
    setQrTable(null)
    if (orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'active' }).eq('id', orderId)
      } catch (e) {
        console.warn('[Tables] Could not update QR order status to active', e)
      }
    }
  }

  const handleQRReject = async () => {
    const orderId = qrTable?.orderId
    setRuntimeStates(prev => {
      const next = { ...prev }
      delete next[qrTable.id]
      return next
    })
    setQrTable(null)
    if (orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId)
      } catch (e) {
        console.warn('[Tables] Could not update QR order status to cancelled', e)
      }
    }
  }

  return (
    <div className="tables-page">
      <div className="tables-main">

        {/* ── Header ── */}
        <div className="tables-header">
          <div className="tables-header__left">
            <h1 className="tables-title">Masalar</h1>
            <span className="tables-subtitle">{aktif} açık masa</span>
          </div>

          <div className="tables-header__right">
            <div className="stats-chip">
              <span className="stats-chip__label">CİRO</span>
              <span className="stats-chip__value">₺{dailyRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="stats-chip">
              <span className="stats-chip__label">AKTİF</span>
              <span className="stats-chip__value">{aktif}</span>
            </div>
            <div className="stats-chip stats-chip--bordered">
              <span className="stats-chip__label">BEKLEYEN</span>
              <span className="stats-chip__value">{bekleyen}</span>
            </div>
            <div className="stats-clock">
              <span className="stats-clock__label">CANLI SAAT</span>
              <span className="stats-clock__time">{clock}</span>
            </div>
            <button className="icon-btn" aria-label="Bildirimler">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
            <button className="icon-btn icon-btn--user" aria-label="Kullanıcı">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Low stock alert ── */}
      {lowStockAlerts.length > 0 && (
        <div className="tables-low-stock-banner">
          <span>⚠ Düşük stok: {lowStockAlerts.map(a => `${a.name} (${a.stockAmount} kaldı)`).join(', ')}</span>
          <button className="tables-low-stock-banner__close" onClick={() => setLowStockAlerts([])}>✕</button>
        </div>
      )}

      {/* ── Filter tabs ── */}
        <div className="tables-filter-tabs">
          <button
            className={`tables-filter-tab ${tableFilter === 'all' ? 'tables-filter-tab--active' : ''}`}
            onClick={() => setTableFilter('all')}
          >
            Tüm Masalar
            <span className="tables-filter-tab__count">{displayTables.length}</span>
          </button>
          <button
            className={`tables-filter-tab ${tableFilter === 'open' ? 'tables-filter-tab--active' : ''}`}
            onClick={() => setTableFilter('open')}
          >
            Açık Masalar
            <span className="tables-filter-tab__count tables-filter-tab__count--open">{aktif}</span>
          </button>
        </div>

        {/* ── Table Grid ── */}
        <div className="tables-grid">
          {visibleTables.map(table => (
            <TableCard
              key={table.id}
              table={{
                ...table,
                itemCount: table.orderItems?.length ?? 0,
                total: table.orderItems
                  ? table.orderItems.reduce((s, i) => s + i.qty * i.unitPrice, 0)
                  : 0,
              }}
              isSelected={table.id === selectedTableId}
              onClick={() => handleCardClick(table)}
            />
          ))}
        </div>

      </div>

      {/* ── Order Panel ── */}
      {selectedTable && (
        <OrderPanel
          table={selectedTable}
          onClose={() => setSelectedTableId(null)}
          onCloseTable={() => setPaymentTable(selectedTable)}
          onAddItem={handleAddItem}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
        />
      )}

      {paymentTable && (
        <PaymentModal
          table={paymentTable}
          onClose={() => setPaymentTable(null)}
          onComplete={handlePaymentComplete}
        />
      )}

      {qrTable && (
        <QRApprovalModal
          table={qrTable}
          onApprove={handleQRApprove}
          onReject={handleQRReject}
        />
      )}
    </div>
  )
}

export default Tables
