import { useState } from 'react'
import './CloseTableModal.css'

function CloseTableModal({ table, order, onCancel, onConfirm }) {
  const [paymentMethod, setPaymentMethod] = useState(null)

  const handleConfirm = () => {
    if (!paymentMethod) return
    onConfirm({ paymentMethod })
  }

  return (
    <div className="modal-overlay">
      <div className="modal close-table-modal">
        <div className="modal__header">
          <h2 className="modal__title">{table?.name} — Hesap</h2>
          <button className="modal__close" onClick={onCancel}>✕</button>
        </div>

        <div className="close-table-modal__items">
          {/* order items summary */}
        </div>

        <div className="divider" />

        <div className="close-table-modal__total">
          Toplam: <strong>₺0,00</strong>
        </div>

        <div className="close-table-modal__payment">
          <p className="close-table-modal__payment-label">Ödeme Yöntemi</p>
          <div className="close-table-modal__payment-options">
            <button
              className={`close-table-modal__payment-btn ${paymentMethod === 'cash' ? 'close-table-modal__payment-btn--active' : ''}`}
              onClick={() => setPaymentMethod('cash')}
            >
              Nakit
            </button>
            <button
              className={`close-table-modal__payment-btn ${paymentMethod === 'card' ? 'close-table-modal__payment-btn--active' : ''}`}
              onClick={() => setPaymentMethod('card')}
            >
              Kart
            </button>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onCancel}>İptal</button>
          <button
            className="btn btn--primary"
            onClick={handleConfirm}
            disabled={!paymentMethod}
          >
            Tahsil Et
          </button>
        </div>
      </div>
    </div>
  )
}

export default CloseTableModal
