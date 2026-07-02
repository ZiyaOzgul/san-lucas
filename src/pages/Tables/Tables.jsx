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
  const { tableDefs, triggerSync, isOnline, kdvRate, kdvEnabled, runtimeStates, setRuntimeStates, currentUser, logoutUser } = useApp()
  const effectiveTaxRate = kdvEnabled ? kdvRate / 100 : 0
  const [clock,          setClock]          = useState(getLiveTime)
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [paymentTable,   setPaymentTable]   = useState(null)
  const [paymentOrder,   setPaymentOrder]   = useState(null)
  const [qrTable,        setQrTable]        = useState(null)
  const [qrQueue,        setQrQueue]        = useState([])
  const [profileOpen,    setProfileOpen]    = useState(false)
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

  // ── Realtime: payments + payment_items → trigger sync ───────────
  // When the mobile app records a split payment for a shared order, pull it
  // down so the desktop UI reflects the new "paid" state quickly.
  useEffect(() => {
    if (!isSupabaseReady) return
    const ch = supabase
      .channel('payments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        if (isOnline) triggerSync()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_items' }, () => {
        if (isOnline) triggerSync()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [isOnline, triggerSync])

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
          console.log('[QR-DEBUG] Realtime INSERT received:', newOrder)
          if (!newOrder?.table_id) {
            console.warn('[QR-DEBUG] Aborted: order has no table_id', newOrder)
            return
          }

          const openMinutes = newOrder.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(newOrder.created_at).getTime()) / 60000))
            : 0

          let orderItems = []
          try {
            const { data, error } = await supabase
              .from('order_items')
              .select('id, quantity, unit_price, products(name), order_item_modifiers(id, modifier_id, name, price_delta, quantity)')
              .eq('order_id', newOrder.id)
            if (error) console.warn('[QR-DEBUG] order_items query error:', error)
            console.log('[QR-DEBUG] order_items fetched:', data)
            if (data) {
              orderItems = data.map(item => ({
                id:        item.id,
                name:      item.products?.name ?? 'Ürün',
                qty:       item.quantity,
                unitPrice: item.unit_price,
                note:      '',
                modifiers: (item.order_item_modifiers ?? []).map(m => ({
                  id:         m.id,
                  modifierId: m.modifier_id ?? null,
                  name:       m.name,
                  priceDelta: Number(m.price_delta) || 0,
                  quantity:   Number(m.quantity) || 1,
                })),
              }))
            }
          } catch (e) {
            console.warn('[QR-DEBUG] Could not fetch QR order items', e)
          }

          console.log('[QR-DEBUG] Pushing to qrQueue:', { tableId: newOrder.table_id, orderId: newOrder.id, itemCount: orderItems.length })
          setQrQueue(prev => [...prev, {
            tableId:    newOrder.table_id,
            orderId:    newOrder.id,
            openMinutes,
            orderItems,
          }])
          setRuntimeStates(prev => ({
            ...prev,
            [newOrder.table_id]: {
              ...(prev[newOrder.table_id] ?? {}),
              status: 'occupied',
              type:   'qr',
            },
          }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Auto-open QR approval modal when a new QR order arrives
  useEffect(() => {
    if (qrTable) { console.log('[QR-DEBUG] auto-open skipped: modal already open'); return }
    if (qrQueue.length === 0) return
    const next = qrQueue[0]
    const def = tableDefs.find(t => t.id === Number(next.tableId))
    console.log('[QR-DEBUG] auto-open useEffect ran', {
      queueLen: qrQueue.length,
      nextTableId: next.tableId,
      tableDefsIds: tableDefs.map(t => t.id),
      defFound: !!def,
    })
    if (def) setQrTable({ ...def, ...next })
    else console.warn('[QR-DEBUG] No matching tableDef for tableId', next.tableId)
  }, [qrQueue, tableDefs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge tableDefs with runtime states — new tables from Settings appear as empty
  const displayTables = tableDefs.map(def => {
    const state = runtimeStates[def.id] ?? { status: 'empty' }
    const orderItems = (state.orders ?? []).flatMap(o => o.items)
    const openMinutes = state.openedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(state.openedAt).getTime()) / 60000))
      : 0
    return { ...def, ...state, orderItems, openMinutes }
  })

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
    if (table.type === 'qr') {
      // Pull first queued order for this table to show in approval modal
      const queued = qrQueue.find(q => q.tableId === table.id)
      if (queued) {
        const def = tableDefs.find(t => t.id === Number(queued.tableId))
        if (def) setQrTable({ ...def, ...queued })
      }
      return
    }
    setSelectedTableId(prev => prev === table.id ? null : table.id)
  }

  // ── Item management ─────────────────────────────────────────────
  // Mobile parity model: every unit is its own row (qty always 1).
  // Adding the same product twice creates TWO rows so each can carry its own note.
  const makeLineItem = (product, modifiers = []) => ({
    id:        crypto.randomUUID(),          // unique per row, regardless of product
    productId: product.productId ?? product.id,
    name:      product.name,
    unitPrice: product.price,
    qty:       1,
    note:      '',
    variantId: product.variantId ?? null,
    modifiers: Array.isArray(modifiers) ? modifiers : [],
    addedAt:   new Date().toISOString(),
  })

  const handleAddItem = (tableId, product, targetGroupId = null, modifiers = []) => {
    const newItem = makeLineItem(product, modifiers)
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) {
        return {
          ...prev,
          [tableId]: {
            status: 'occupied',
            type: 'normal',
            openTime: getLiveTime(),
            openedAt: new Date().toISOString(),
            openMinutes: 0,
            waiter: '—',
            taxRate: effectiveTaxRate,
            orders: [{ localId: crypto.randomUUID(), label: 'Sipariş 1', supabaseOrderId: null, items: [newItem] }],
          },
        }
      }
      const orders = existing.orders ?? []
      if (targetGroupId) {
        const idx = orders.findIndex(o => o.localId === targetGroupId)
        if (idx !== -1) {
          const newOrders = orders.map((o, i) => i === idx ? { ...o, items: [...o.items, newItem] } : o)
          return { ...prev, [tableId]: { ...existing, status: 'occupied', orders: newOrders } }
        }
      }
      // Find first manual group (supabaseOrderId === null), or create new one
      const manualIdx = orders.findIndex(o => o.supabaseOrderId === null)
      let newOrders
      if (manualIdx === -1) {
        const newGroup = { localId: crypto.randomUUID(), label: `Sipariş ${orders.length + 1}`, supabaseOrderId: null, items: [newItem] }
        newOrders = [...orders, newGroup]
      } else {
        newOrders = orders.map((o, idx) => idx === manualIdx ? { ...o, items: [...o.items, newItem] } : o)
      }
      return { ...prev, [tableId]: { ...existing, status: 'occupied', orders: newOrders } }
    })
  }

  // Replace the modifier list on an existing line item (driven by the
  // customize modal in 'edit' mode). The customize flow no longer surfaces
  // a free-text note field, so `note` is left untouched.
  const handleUpdateItemModifiers = (tableId, itemId, modifiers, subOrderLocalId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? []).map(o => {
        if (subOrderLocalId && o.localId !== subOrderLocalId) return o
        return { ...o, items: o.items.map(i => i.id === itemId ? { ...i, modifiers: Array.isArray(modifiers) ? modifiers : [] } : i) }
      })
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
    })
  }

  // Move the whole order group from one table to another (empty) table.
  const handleMoveOrderToTable = (fromTableId, subOrderLocalId, toTableId) => {
    setRuntimeStates(prev => {
      const fromState = prev[fromTableId]
      if (!fromState) return prev
      const group = (fromState.orders ?? []).find(o => o.localId === subOrderLocalId)
      if (!group) return prev
      const remainingOrders = (fromState.orders ?? []).filter(o => o.localId !== subOrderLocalId)
      const next = { ...prev }
      if (remainingOrders.length === 0) delete next[fromTableId]
      else next[fromTableId] = { ...fromState, orders: remainingOrders }

      const toState = prev[toTableId]
      if (!toState) {
        next[toTableId] = {
          status: 'occupied',
          type: 'normal',
          openTime: getLiveTime(),
          openedAt: new Date().toISOString(),
          openMinutes: 0,
          waiter: '—',
          taxRate: effectiveTaxRate,
          orders: [group],
        }
      } else {
        next[toTableId] = {
          ...toState,
          status: 'occupied',
          orders: [...(toState.orders ?? []), group],
        }
      }
      return next
    })
  }

  // Move selected items from one order group into another table's active group.
  const handleMoveItemsToTable = (fromTableId, subOrderLocalId, itemIds, toTableId, toSubOrderLocalId = null) => {
    if (!itemIds || itemIds.length === 0) return
    const idSet = new Set(itemIds)
    setRuntimeStates(prev => {
      const fromState = prev[fromTableId]
      if (!fromState) return prev
      const fromOrders = fromState.orders ?? []
      const fromIdx = fromOrders.findIndex(o => o.localId === subOrderLocalId)
      if (fromIdx === -1) return prev
      const fromGroup = fromOrders[fromIdx]
      const movingItems = fromGroup.items.filter(i => idSet.has(i.id))
      const remainingFromItems = fromGroup.items.filter(i => !idSet.has(i.id))

      const newFromOrders = remainingFromItems.length === 0
        ? fromOrders.filter((_, i) => i !== fromIdx)
        : fromOrders.map((o, i) => i === fromIdx ? { ...o, items: remainingFromItems } : o)

      const next = { ...prev }
      if (newFromOrders.length === 0) delete next[fromTableId]
      else next[fromTableId] = { ...fromState, orders: newFromOrders }

      const toState = prev[toTableId] ?? {
        status: 'occupied',
        type: 'normal',
        openTime: getLiveTime(),
        openedAt: new Date().toISOString(),
        openMinutes: 0,
        waiter: '—',
        taxRate: effectiveTaxRate,
        orders: [],
      }
      const toOrders = toState.orders ?? []
      let targetIdx = toSubOrderLocalId
        ? toOrders.findIndex(o => o.localId === toSubOrderLocalId)
        : toOrders.findIndex(o => o.supabaseOrderId === null)
      let newToOrders
      if (targetIdx === -1) {
        newToOrders = [...toOrders, { localId: crypto.randomUUID(), label: `Sipariş ${toOrders.length + 1}`, supabaseOrderId: null, items: movingItems }]
      } else {
        newToOrders = toOrders.map((o, i) => i === targetIdx ? { ...o, items: [...o.items, ...movingItems] } : o)
      }
      next[toTableId] = { ...toState, status: 'occupied', orders: newToOrders }
      return next
    })
  }

  const handleNewGroup = (tableId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId] ?? {}
      const orders = existing.orders ?? []
      const newGroupId = crypto.randomUUID()
      const newGroup = { localId: newGroupId, label: `Sipariş ${orders.length + 1}`, supabaseOrderId: null, items: [] }
      return {
        ...prev,
        [tableId]: { ...existing, orders: [...orders, newGroup], activeGroupId: newGroupId },
      }
    })
  }

  const handleUpdateQty = (tableId, itemId, newQty, subOrderLocalId) => {
    if (newQty <= 0) { handleRemoveItem(tableId, itemId, subOrderLocalId); return }
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? []).map(o => {
        if (subOrderLocalId && o.localId !== subOrderLocalId) return o
        return { ...o, items: o.items.map(i => i.id === itemId ? { ...i, qty: newQty } : i) }
      })
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
    })
  }

  const handleRemoveItem = (tableId, itemId, subOrderLocalId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? [])
        .map(o => {
          if (subOrderLocalId && o.localId !== subOrderLocalId) return o
          return { ...o, items: o.items.filter(i => i.id !== itemId) }
        })
        .filter(o => o.items.length > 0)
      if (newOrders.length === 0) {
        const next = { ...prev }
        delete next[tableId]
        return next
      }
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
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
          .update({ status: 'completed', payment_method: transactionData.paymentMethod, total: transactionData.total, closed_at: transactionData.closedAt })
          .eq('id', transactionData.supabaseOrderId)
      }
      if (isOnline) triggerSync()
    } catch (e) {
      console.error('[Tables] Failed to save order to DB', e)
    }
  }

  const handlePartialPaymentComplete = async (transactionData) => {
    setRuntimeStates(prev => {
      const existing = prev[transactionData.tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? []).filter(o => o.localId !== transactionData.subOrderLocalId)
      if (newOrders.length === 0) {
        const next = { ...prev }
        delete next[transactionData.tableId]
        return next
      }
      return { ...prev, [transactionData.tableId]: { ...existing, orders: newOrders } }
    })
    setPaymentOrder(null)
    try {
      const { lowStockWarnings } = await saveCompletedOrder(transactionData)
      refreshRevenue()
      if (lowStockWarnings?.length) setLowStockAlerts(lowStockWarnings)
      console.log(`[Tables] ✓ Partial order paid — Masa ${transactionData.tableId} | ₺${transactionData.total?.toFixed(2)} | ${transactionData.paymentMethod}`)
      if (transactionData.supabaseOrderId && isSupabaseReady) {
        await supabase
          .from('orders')
          .update({ status: 'completed', payment_method: transactionData.paymentMethod, total: transactionData.total, closed_at: transactionData.closedAt })
          .eq('id', transactionData.supabaseOrderId)
      }
      if (isOnline) triggerSync()
    } catch (e) {
      console.error('[Tables] Failed to save partial order to DB', e)
    }
  }

  const handleQRApprove = async () => {
    const current = qrQueue[0]
    if (!current) return
    const moreForSameTable = qrQueue.slice(1).some(o => o.tableId === current.tableId)
    setQrQueue(prev => prev.slice(1))
    setRuntimeStates(prev => {
      const existing = prev[current.tableId] ?? {}
      const prevOrders = existing.orders ?? []
      const qrCount = prevOrders.filter(o => o.supabaseOrderId !== null).length
      const label = qrCount === 0 ? 'QR Sipariş' : `QR Sipariş ${qrCount + 1}`
      const newGroup = { localId: crypto.randomUUID(), label, supabaseOrderId: current.orderId, items: current.orderItems }
      return {
        ...prev,
        [current.tableId]: {
          ...existing,
          status:   'occupied',
          type:     moreForSameTable ? 'qr' : 'normal',
          openTime: existing.openTime ?? getLiveTime(),
          openedAt: existing.openedAt ?? new Date().toISOString(),
          waiter:   existing.waiter ?? 'Garson',
          orders:   [...prevOrders, newGroup],
        },
      }
    })
    setQrTable(null)
    if (current.orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'active' }).eq('id', current.orderId)
      } catch (e) {
        console.warn('[Tables] Could not update QR order status to active', e)
      }
    }
  }

  const handleQRReject = async () => {
    const current = qrQueue[0]
    if (!current) return
    const moreForSameTable = qrQueue.slice(1).some(o => o.tableId === current.tableId)
    setQrQueue(prev => prev.slice(1))
    if (!moreForSameTable) {
      setRuntimeStates(prev => {
        const next = { ...prev }
        delete next[current.tableId]
        return next
      })
    }
    setQrTable(null)
    if (current.orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'cancelled' }).eq('id', current.orderId)
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
            <button className="icon-btn icon-btn--user" aria-label="Kullanıcı" onClick={() => setProfileOpen(true)}>
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
                  ? table.orderItems.reduce((s, i) => {
                      const modSum = (i.modifiers || []).reduce((ms, m) => ms + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
                      return s + i.qty * (i.unitPrice + modSum)
                    }, 0)
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
          tables={displayTables}
          onClose={() => setSelectedTableId(null)}
          onCloseTable={() => setPaymentTable(selectedTable)}
          onAddItem={(tableId, product, modifiers) => handleAddItem(tableId, product, selectedTable.activeGroupId ?? null, modifiers)}
          onUpdateNote={handleUpdateItemModifiers}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onNewGroup={handleNewGroup}
          onMoveOrderToTable={handleMoveOrderToTable}
          onMoveItemsToTable={handleMoveItemsToTable}
          onPayOrder={(tableId, subOrderLocalId) => {
            const tbl = displayTables.find(t => t.id === tableId)
            const order = (runtimeStates[tableId]?.orders ?? []).find(o => o.localId === subOrderLocalId)
            if (tbl && order) setPaymentOrder({ ...order, tableId })
          }}
        />
      )}

      {paymentOrder && (
        <PaymentModal
          table={displayTables.find(t => t.id === paymentOrder.tableId) ?? {}}
          partialOrder={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onComplete={handlePartialPaymentComplete}
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

      {profileOpen && (
        <ProfileModal
          user={currentUser}
          onClose={() => setProfileOpen(false)}
          onLogout={() => { setProfileOpen(false); logoutUser() }}
        />
      )}
    </div>
  )
}

// ── Profile Modal ─────────────────────────────────────────────────

function ProfileModal({ user, onClose, onLogout }) {
  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '?'

  const roleLabel = user?.role === 'admin' ? 'Yönetici' : (user?.role ?? '—')

  const today = new Date().toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="profile-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profile-modal">

        <button className="profile-modal__close-x" onClick={onClose} aria-label="Kapat">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Avatar */}
        <div className="profile-modal__avatar">{initials}</div>

        {/* Info */}
        <div className="profile-modal__info">
          <p className="profile-modal__email">{user?.email ?? '—'}</p>
          <span className="profile-modal__role-badge">{roleLabel}</span>
        </div>

        {/* Details */}
        <div className="profile-modal__details">
          <div className="profile-modal__detail-row">
            <span className="profile-modal__detail-label">Oturum tarihi</span>
            <span className="profile-modal__detail-value">{today}</span>
          </div>
          <div className="profile-modal__detail-row">
            <span className="profile-modal__detail-label">Kullanıcı ID</span>
            <span className="profile-modal__detail-value">#{user?.id ?? '—'}</span>
          </div>
        </div>

        {/* Logout */}
        <button className="profile-modal__logout" onClick={onLogout}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Çıkış Yap
        </button>

      </div>
    </div>
  )
}

export default Tables
