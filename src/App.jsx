import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import './styles/layout.css'
import { AppProvider, useApp } from './context/AppContext.jsx'
import Navbar from './components/Navbar/Navbar.jsx'
import useOnlineStatus from './hooks/useOnlineStatus.js'
import Tables from './pages/Tables/Tables.jsx'
import Orders from './pages/Orders/Orders.jsx'
import Products from './pages/Products/Products.jsx'
import Ingredients from './pages/Ingredients/Ingredients.jsx'
import Reports from './pages/Reports/Reports.jsx'
import Staff from './pages/Staff/Staff.jsx'
import Settings from './pages/Settings/Settings.jsx'
import Login from './pages/Login/Login.jsx'
import ClosedTables from './pages/ClosedTables/ClosedTables.jsx'

function AppShell() {
  const { dbReady, dbError, triggerSync } = useApp()
  const { isOnline } = useOnlineStatus({ onReconnect: triggerSync })

  // Sync once on startup if online and DB is ready
  useEffect(() => {
    if (dbReady && navigator.onLine) triggerSync()
  }, [dbReady]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!dbReady) {
    return (
      <div className="app-layout">
        <div className="db-loading">
          <span className="db-loading__dot" />
          Veritabanı yükleniyor…
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <Navbar />
      <div className="page-content">
        {dbError && (
          <div className="db-error-banner">
            ⚠ Veritabanı hatası: {dbError}
          </div>
        )}
        {!isOnline && (
          <div className="offline-banner">
            <span className="offline-banner__dot" />
            Çevrimdışı — Değişiklikler yerel olarak kaydedilecek ve bağlantı kurulduğunda senkronize edilecek.
          </div>
        )}
        <Routes>
          <Route path="/"         element={<Tables />} />
          <Route path="/orders"   element={<Orders />} />
          <Route path="/closed-tables" element={<ClosedTables />} />
          <Route path="/products"    element={<Products />} />
          <Route path="/ingredients" element={<Ingredients />} />
          <Route path="/reports"     element={<Reports />} />
          <Route path="/staff"       element={<Staff />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </div>
  )
}

function AppContent() {
  const { currentUser, loginUser, authReady } = useApp()
  if (!authReady) {
    return (
      <div className="app-layout">
        <div className="db-loading">
          <span className="db-loading__dot" />
          Sunucuya bağlanılıyor…
        </div>
      </div>
    )
  }
  return currentUser ? <AppShell /> : <Login onLogin={loginUser} />
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App
