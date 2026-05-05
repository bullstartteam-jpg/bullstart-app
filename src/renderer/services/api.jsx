import axios from 'axios';

const DEFAULT_API_URL = 'https://bullstart.us/api';

// Migrate older installs that had the localhost default cached in localStorage
// — silently swap them over to the production URL on app start.
if (localStorage.getItem('api_url') === 'http://localhost:8000/api') {
  localStorage.removeItem('api_url');
}

const API_URL = localStorage.getItem('api_url') || DEFAULT_API_URL;

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    // Disable HTTP caching — Electron's Chromium otherwise caches GETs and we
    // end up showing stale order/wallet data after a server-side change.
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
});

// Attach token + cache-bust GET requests so any intermediate cache (proxy,
// service worker, browser) can't return a stale response.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if ((config.method || 'get').toLowerCase() === 'get') {
    config.params = { ...(config.params || {}), _: Date.now() };
  }
  return config;
});

// Handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.hash = '#/login';
    }
    return Promise.reject(error);
  }
);

export const setApiUrl = (url) => {
  localStorage.setItem('api_url', url);
  api.defaults.baseURL = url;
};

export const getApiUrl = () => api.defaults.baseURL;

export default api;
