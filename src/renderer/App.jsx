import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import OrderCreate from './pages/OrderCreate';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Inventory from './pages/Inventory';
import Wallet from './pages/Wallet';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Tiers from './pages/Tiers';
import Convert from './pages/Convert';
import ConvertLabel from './pages/ConvertLabel';
import Gangsheet from './pages/Gangsheet';
import GangsheetLabel from './pages/GangsheetLabel';
import AutoPay from './pages/AutoPay';
import Reprint from './pages/Reprint';
import NotDelivered from './pages/NotDelivered';
import ImageUrlCheck from './pages/ImageUrlCheck';
import Reasons from './pages/Reasons';
import Profile from './pages/Profile';
import { DialogHost } from './components/Dialog';
import { ToastHost } from './components/Toast';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-900"><div className="text-slate-400">Loading...</div></div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="reports" element={<Reports />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/create" element={<OrderCreate />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="users" element={<Users />} />
          <Route path="tiers" element={<Tiers />} />
          <Route path="settings" element={<Settings />} />
          <Route path="convert" element={<Convert />} />
          <Route path="convert-label" element={<ConvertLabel />} />
          <Route path="auto-pay" element={<AutoPay />} />
          <Route path="reprint" element={<Reprint />} />
          <Route path="not-delivered" element={<NotDelivered />} />
          <Route path="image-url-check" element={<ImageUrlCheck />} />
          <Route path="reasons" element={<Reasons />} />
          <Route path="gangsheet" element={<Gangsheet />} />
          <Route path="gangsheet-label" element={<GangsheetLabel />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Routes>
      <DialogHost />
      <ToastHost />
    </>
  );
}
