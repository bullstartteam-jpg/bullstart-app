import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import logo from '../assets/logo.png';
import { getUiPrefs } from '../utils/uiPrefs';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '◉', module: 'dashboard' },
  { path: '/reports', label: 'Reports', icon: '▥', module: 'dashboard' },
  { path: '/orders', label: 'Orders', icon: '◈', module: 'orders' },
  { path: '/products', label: 'Products', icon: '◇', module: 'products' },
  { path: '/inventory', label: 'Inventory', icon: '▤', module: 'inventory' },
  { path: '/wallet', label: 'Wallet', icon: '◎', module: 'wallet' },
  { path: '/users', label: 'Users', icon: '◆', module: 'users' },
  { path: '/tiers', label: 'Tiers', icon: '▣', module: 'settings' },
  { path: '/settings', label: 'Settings', icon: '⚙', module: 'settings' },
  { path: '/convert', label: 'Convert', icon: '⟲', requiresConvert: true },
  { path: '/convert-label', label: 'Convert Label', icon: '🏷', requiresStaff: true, requiresConvert: true },
  { path: '/auto-pay', label: 'Auto-pay', icon: '🤖', requiresStaff: true },
  { path: '/reprint', label: 'Reprint', icon: '🔁', requiresStaff: true },
  { path: '/reasons', label: 'Reasons', icon: '🏷', requiresStaff: true },
  { path: '/gangsheet', label: 'Gangsheet', icon: '▦', requiresStaff: true },
  { path: '/gangsheet-label', label: 'Gangsheet Label', icon: '📦', requiresStaff: true },
];

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  // Live UI prefs (show/hide logo + app name), saved per-machine in Settings.
  const [uiPrefs, setUiPrefsState] = useState(getUiPrefs);
  useEffect(() => {
    const sync = () => setUiPrefsState(getUiPrefs());
    window.addEventListener('ui-prefs-changed', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('ui-prefs-changed', sync); window.removeEventListener('storage', sync); };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isStaff = user?.role?.slug === 'admin' || user?.role?.slug === 'support';
  const visibleNav = navItems.filter(item => {
    // Both gates must pass when both flags are set (e.g. Convert Label needs
    // staff + convert mode). Module permission only applies when neither
    // flag is set on the item.
    if (item.requiresStaff && !isStaff) return false;
    if (item.requiresConvert && !user?.convert) return false;
    if (item.requiresStaff || item.requiresConvert) return true;
    return hasPermission(item.module);
  });

  return (
    <div className="flex h-screen bg-[#f5f0eb]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-neutral-200 flex flex-col shadow-sm">
        <div className="p-4 border-b border-neutral-200 titlebar-drag flex items-center gap-2">
          {uiPrefs.showLogo && <img src={logo} alt="BullStart" className="h-8" />}
          {uiPrefs.showAppName && <h1 className="text-lg font-bold text-neutral-800 tracking-wide">BULLSTART</h1>}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {visibleNav.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-orange-500 text-white'
                    : 'text-neutral-600 hover:bg-orange-50 hover:text-orange-600'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-neutral-200">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `block text-left px-2 py-1 rounded transition-colors ${
                isActive ? 'bg-orange-50' : 'hover:bg-orange-50'
              }`
            }
          >
            <div className="text-xs text-neutral-700 font-medium">{user?.name}</div>
            <div className="text-xs text-neutral-400">{user?.role?.name}</div>
          </NavLink>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-neutral-400 hover:text-red-500 py-1 text-left transition-colors mt-1"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
