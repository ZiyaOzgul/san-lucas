import { NavLink } from 'react-router-dom'
import './Navbar.css'

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Masalar',
    icon: <img src="/icons/tables.png" alt="" className="navbar__icon-img" />,
  },
  {
    to: '/orders',
    label: 'Siparişler',
    icon: <img src="/icons/orders.png" alt="" className="navbar__icon-img" />,
  },
  {
    to: '/products',
    label: 'Ürünler',
    icon: <img src="/icons/products.png" alt="" className="navbar__icon-img" />,
  },
  {
    to: '/reports',
    label: 'Raporlar',
    icon: <img src="/icons/monitor.png" alt="" className="navbar__icon-img" />,
  },
]

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar__brand">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
        <span className="navbar__brand-text">San Lucas</span>
      </div>

      <ul className="navbar__items">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `navbar__item${isActive ? ' navbar__item--active' : ''}`
              }
            >
              <span className="navbar__icon">{item.icon}</span>
              <span className="navbar__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="navbar__bottom">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `navbar__item${isActive ? ' navbar__item--active' : ''}`
          }
        >
          <span className="navbar__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span className="navbar__label">Ayarlar</span>
        </NavLink>
        <p className="navbar__tagline">San Lucas Cafe POS</p>
      </div>
    </nav>
  )
}

export default Navbar
