import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { autoStartConverters, stopAllConverters } from '../services/converter';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      // Verify token is still valid
      api.get('/me').then(res => {
        setUser(res.data.user);
        localStorage.setItem('user', JSON.stringify(res.data.user));
      }).catch(() => {
        logout();
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Restore each converter job (QR / Convert Label) based on the user's last
  // saved auto preference. Stopping is a soft-stop on logout so the next
  // login can resume whichever jobs were on.
  useEffect(() => {
    if (user && user.convert) {
      autoStartConverters();
    } else {
      stopAllConverters();
    }
    return () => stopAllConverters();
  }, [user?.id, user?.convert]);

  const login = async (email, password) => {
    const res = await api.post('/login', { email, password });
    const { token, user } = res.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
    return user;
  };

  const logout = async () => {
    try { await api.post('/logout'); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    stopAllConverters();
    setUser(null);
  };

  const hasRole = (role) => user?.role?.slug === role;
  const hasPermission = (module, action = 'can_view') => {
    if (!user?.role?.permissions) return false;
    const perm = user.role.permissions.find(p => p.module === module);
    return perm?.[action] ?? false;
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, loading, hasRole, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
