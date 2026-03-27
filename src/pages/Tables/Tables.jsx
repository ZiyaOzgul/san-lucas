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

// Demo session runtime states (keyed by tableDef.id matching AppContext SEED_TABLE_DEFS)
// id 1=T-01, 2=T-03, 3=T-04, 4=T-05, 5=T-06, 6=T-08, 7=T-09, 8=T-10, 9=T-12
const DEMO_RUNTIME = {
  1: {
    status: 'occupied', type: 'normal', openMinutes: 18, openTime: '14:34', waiter: 'Ahmet B.',
    taxRate: 0.10,
    orderItems: [
      { id: 1, name: 'Türk Kahvesi', note: 'Az şekerli', qty: 2, unitPrice: 35 },
      { id: 2, name: 'Su Böreği',    note: '',           qty: 1, unitPrice: 55 },
    ],
  },
  2: {
    status: 'occupied', type: 'normal', openMinutes: 45, openTime: '14:07', waiter: 'Selin K.',
    taxRate: 0.10,
    orderItems: [
      { id: 1, name: 'Cappuccino',             note: '',                  qty: 2, unitPrice: 75  },
      { id: 2, name: 'Eggs Benedict',          note: 'Extra hollandaise', qty: 1, unitPrice: 130 },
      { id: 3, name: 'Taze Sıkılmış Portakal', note: '',                  qty: 2, unitPrice: 55  },
      { id: 4, name: 'Croissant',              note: 'Tereyağlı',        qty: 1, unitPrice: 42  },
    ],
  },
  3: {
    status: 'occupied', type: 'normal', openMinutes: 32, openTime: '14:20', waiter: 'Selin K.',
    taxRate: 0.10,
    discount: { label: 'Kampanya İndirimi', amount: 30 },
    orderItems: [
      { id: 1, name: 'Caffè Latte',              note: '+ Yulaf Sütü, Vanilya Şurubu', qty: 2, unitPrice: 85  },
      { id: 2, name: 'Artisan Avokado Toast',    note: 'Ekstra Haşlanmış Yumurta',     qty: 1, unitPrice: 145 },
      { id: 3, name: 'Filtre Kahve',             note: 'Etiyopya Kochere',             qty: 1, unitPrice: 65  },
      { id: 4, name: 'San Sebastian Cheesecake', note: 'Çikolata Soslu',               qty: 2, unitPrice: 120 },
    ],
  },
  // 4 = T-05 → empty (no runtime entry)
  // 5 = T-06 → empty
  6: {
    status: 'occupied', type: 'alert', openMinutes: 160, openTime: '11:52', waiter: 'Ahmet B.',
    taxRate: 0.10,
    orderItems: [
      { id: 1, name: 'Latte Macchiato', note: 'Soya sütü',       qty: 2, unitPrice: 75  },
      { id: 2, name: 'Pancake Stack',   note: 'Akçaağaç şurubu', qty: 2, unitPrice: 110 },
      { id: 3, name: 'Meyve Tabağı',   note: '',                 qty: 1, unitPrice: 95  },
      { id: 4, name: 'Sıcak Çikolata', note: 'Kremalı',          qty: 2, unitPrice: 65  },
      { id: 5, name: 'Brownie',         note: 'Dondurmalı',      qty: 1, unitPrice: 75  },
    ],
  },
  7: {
    status: 'occupied', type: 'qr', openMinutes: 3,
    orderItems: [
      { id: 1, name: 'Flat White',    note: '',          qty: 2, unitPrice: 70 },
      { id: 2, name: 'Avokado Toast', note: 'Limon ile', qty: 1, unitPrice: 95 },
    ],
  },
  8: {
    status: 'occupied', type: 'alert', openMinutes: 135, openTime: '12:17', waiter: 'Mehmet Y.',
    taxRate: 0.10,
    orderItems: [
      { id: 1, name: 'Americano',    note: '',              qty: 3, unitPrice: 55  },
      { id: 2, name: 'Club Sandwich', note: 'Ekstra peynir', qty: 2, unitPrice: 110 },
      { id: 3, name: 'Tiramisu',     note: '',              qty: 1, unitPrice: 85  },
      { id: 4, name: 'Limonata',     note: 'Buzlu',         qty: 2, unitPrice: 45  },
    ],
  },
  9: {
    status: 'occupied', type: 'qr', openMinutes: 1,
    orderItems: [
      { id: 1, name: 'Espresso',   note: 'Doppio',      qty: 1, unitPrice: 45 },
      { id: 2, name: 'Cheesecake', note: 'Frambuazlı',  qty: 1, unitPrice: 95 },
    ],
  },
}

function getLiveTime() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function Tables() {
  const { tableDefs } = useApp()
  const [runtimeStates,  setRuntimeStates]  = useState(DEMO_RUNTIME)
  const [clock,          setClock]          = useState(getLiveTime)
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [paymentTable,   setPaymentTable]   = useState(null)
  const [qrTable,        setQrTable]        = useState(null)
  const [dailyRevenue,   setDailyRevenue]   = useState(0)

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
        { event: 'INSERT', schema: 'public', table: 'orders', filter: 'status=eq.active' },
        (payload) => {
          playAlertSound()
          const newOrder = payload.new
          if (newOrder?.table_id) {
            setRuntimeStates(prev => ({
              ...prev,
              [newOrder.table_id]: {
                ...(prev[newOrder.table_id] ?? {}),
                status:   'occupied',
                tableId:  newOrder.table_id,
                type:     'qr',
                openedAt: newOrder.created_at ?? new Date().toISOString(),
                orderItems: [],
              },
            }))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Merge tableDefs with runtime states — new tables from Settings appear as empty
  const displayTables = tableDefs.map(def => ({
    ...def,
    ...(runtimeStates[def.id] ?? { status: 'empty' }),
  }))

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
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) {
        // Empty table → open it
        return {
          ...prev,
          [tableId]: {
            status: 'occupied',
            type: 'normal',
            openTime: getLiveTime(),
            openMinutes: 0,
            waiter: '—',
            taxRate: 0.10,
            orderItems: [{ id: product.id, name: product.name, unitPrice: product.price, qty: 1, note: '' }],
          },
        }
      }
      // Occupied table → increment or append
      const found = existing.orderItems?.find(i => i.id === product.id)
      const newItems = found
        ? existing.orderItems.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...(existing.orderItems ?? []), { id: product.id, name: product.name, unitPrice: product.price, qty: 1, note: '' }]
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
      await saveCompletedOrder(transactionData)
      refreshRevenue()
    } catch (e) {
      console.error('[Tables] Failed to save order to DB', e)
    }
  }

  const handleQRApprove = () => {
    setRuntimeStates(prev => ({
      ...prev,
      [qrTable.id]: { ...prev[qrTable.id], type: 'normal', openTime: getLiveTime(), waiter: 'Garson' },
    }))
    setQrTable(null)
  }

  const handleQRReject = () => {
    setRuntimeStates(prev => {
      const next = { ...prev }
      delete next[qrTable.id]
      return next
    })
    setQrTable(null)
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

        {/* ── Table Grid ── */}
        <div className="tables-grid">
          {displayTables.map(table => (
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
