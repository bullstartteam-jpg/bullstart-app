import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', new_password_confirmation: '' });
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [botUsername, setBotUsername] = useState('');
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileForm({ name: user.name || '', email: user.email || '' });
    }
  }, [user?.id]);

  // Pull the Telegram bot username (global config) so we can build the t.me link.
  useEffect(() => {
    api.get('/me').then(res => setBotUsername(res.data.telegram_bot_username || '')).catch(() => {});
  }, []);

  const reloadMe = async () => {
    try {
      const res = await api.get('/me');
      setUser(res.data.user);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setBotUsername(res.data.telegram_bot_username || '');
    } catch {}
  };

  const openTelegramBot = () => {
    if (!botUsername) return;
    const url = `https://t.me/${botUsername}`;
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank', 'noreferrer');
  };

  const handleUnlinkTelegram = async () => {
    if (!confirm('Unlink Telegram? You will stop receiving order notifications.')) return;
    setUnlinking(true);
    try {
      await api.post('/telegram/unlink');
      await reloadMe();
      alert('Telegram unlinked');
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setUnlinking(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.put('/profile', profileForm);
      await reloadMe();
      alert('Profile updated');
    } catch (err) {
      alert(err.response?.data?.message || JSON.stringify(err.response?.data?.errors) || 'Error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.new_password_confirmation) {
      alert('New passwords do not match');
      return;
    }
    setSavingPw(true);
    try {
      await api.post('/change-password', pwForm);
      setPwForm({ current_password: '', new_password: '', new_password_confirmation: '' });
      alert('Password changed');
    } catch (err) {
      alert(err.response?.data?.message || JSON.stringify(err.response?.data?.errors) || 'Error');
    } finally {
      setSavingPw(false);
    }
  };

  const handleShowApiKey = async () => {
    if (apiKey && showApiKey) {
      setShowApiKey(false);
      return;
    }
    try {
      const res = await api.get('/me/api-key');
      setApiKey(res.data.api_key);
      setShowApiKey(true);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleRegenApiKey = async () => {
    if (!confirm('Regenerate API key? Existing integrations using the old key will stop working.')) return;
    try {
      const res = await api.post('/me/regenerate-api-key');
      setApiKey(res.data.api_key);
      setShowApiKey(true);
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleLogoutAll = async () => {
    if (!confirm('Log out of all sessions on every device?')) return;
    try {
      await api.post('/logout-all');
      await logout();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  if (!user) return <div className="p-6 text-neutral-400">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Profile</h2>
        <p className="text-xs text-neutral-500 mt-1">Manage your account info, password, and API key.</p>
      </div>

      {/* Account snapshot */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Role" value={user.role?.name || '-'} />
        <Stat label="Tier" value={user.tier?.name || '-'} />
        <Stat label="Wallet" value={`$${user.wallet ?? 0}`} tone="text-green-600" />
        <Stat label="Convert" value={user.convert ? 'On' : 'Off'} tone={user.convert ? 'text-blue-600' : 'text-neutral-400'} />
      </div>

      {/* Telegram notifications */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">Telegram notifications</h3>
        {user.telegram_linked_at ? (
          <p className="text-sm text-green-600">
            ✓ Linked
            <span className="text-xs text-neutral-500 ml-2">since {new Date(user.telegram_linked_at).toLocaleString()}</span>
          </p>
        ) : (
          <p className="text-sm text-neutral-500">Not linked yet — link your account to get a Telegram message when you create orders.</p>
        )}

        <div className="text-xs text-neutral-600 bg-[#faf8f6] border border-neutral-200 rounded-lg p-3 space-y-1">
          <p className="font-semibold text-neutral-700">How to link:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open the Telegram bot{botUsername ? <> (<span className="font-mono">@{botUsername}</span>)</> : ''}.</li>
            <li>Send: <code className="font-mono bg-white px-1 rounded border border-neutral-200">/login {user.email} your_password</code></li>
          </ol>
          <p className="text-neutral-400">Your password is only used once to link and the message is auto-deleted.</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {botUsername && (
            <button onClick={openTelegramBot} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg">
              Open Telegram bot
            </button>
          )}
          {user.telegram_linked_at && (
            <button onClick={handleUnlinkTelegram} disabled={unlinking} className="px-4 py-2 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-500 text-sm rounded-lg">
              {unlinking ? 'Unlinking…' : 'Unlink'}
            </button>
          )}
        </div>
      </div>

      {/* Edit profile */}
      <form onSubmit={handleSaveProfile} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">Edit profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-neutral-500">Name</label>
            <input
              value={profileForm.name}
              onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
              required
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Email</label>
            <input
              type="email"
              value={profileForm.email}
              onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
              required
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={savingProfile}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg"
        >{savingProfile ? 'Saving…' : 'Save changes'}</button>
      </form>

      {/* Change password */}
      <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">Change password</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-neutral-500">Current password</label>
            <input
              type="password"
              value={pwForm.current_password}
              onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))}
              required
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">New password</label>
            <input
              type="password"
              value={pwForm.new_password}
              onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))}
              minLength={6}
              required
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Confirm new</label>
            <input
              type="password"
              value={pwForm.new_password_confirmation}
              onChange={e => setPwForm(f => ({ ...f, new_password_confirmation: e.target.value }))}
              minLength={6}
              required
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={savingPw}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg"
        >{savingPw ? 'Saving…' : 'Update password'}</button>
      </form>

      {/* API Key */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">API key</h3>
        <p className="text-xs text-neutral-500">Use this key in the <span className="font-mono">X-API-KEY</span> header to fulfill orders externally via <span className="font-mono">POST /api/fulfill</span>.</p>
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={handleShowApiKey} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
            {showApiKey ? 'Hide' : 'Show key'}
          </button>
          <button onClick={handleRegenApiKey} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-lg">
            Regenerate
          </button>
          {showApiKey && apiKey && (
            <code className="text-xs px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg font-mono break-all">{apiKey}</code>
          )}
        </div>
      </div>

      {/* Sessions */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">Sessions</h3>
        <p className="text-xs text-neutral-500">Sign out of every device — useful if you suspect your token is compromised.</p>
        <button onClick={handleLogoutAll} className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-500 text-sm rounded-lg">
          Logout all sessions
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-base font-semibold ${tone || 'text-neutral-800'}`}>{value}</div>
    </div>
  );
}
