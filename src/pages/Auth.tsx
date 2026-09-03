import React, { useState, useEffect } from 'react';
import { EyeIcon, EyeOffIcon, AlertCircleIcon, ShieldCheckIcon, GiftIcon, ThumbsUpIcon, Loader2Icon, SettingsIcon, XIcon, CheckIcon } from 'lucide-react';
import { supabase } from '../lib/supabaseClient'; 
import { setApiUrl, API_URL, getBaseUrl, fetchWithTimeout, api } from '../lib/api';
import type { User } from '../types';

interface AuthProps {
  onLogin: (user: User) => void;
}

export function Auth({ onLogin }: AuthProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [authMode, setAuthMode] = useState<'login' | 'forgot' | 'verify'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [shopSettings, setShopSettings] = useState<any>(null);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resetEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetchWithTimeout(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() })
      });
      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new Error('Server returned an invalid response. Please restart your terminal application (npm run electron-dev) to apply the password reset backend routes.');
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send reset code.');
      }
      setSuccessMessage(data.message || 'Verification code has been sent to your email.');
      setAuthMode('verify');
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (verificationCode.trim().length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetchWithTimeout(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail.trim(),
          code: verificationCode.trim(),
          newPassword: newPassword
        })
      });
      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new Error('Server returned an invalid response. Please restart your terminal application (npm run electron-dev) to apply the password reset backend routes.');
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password.');
      }
      setSuccessMessage(data.message || 'Password has been reset successfully.');
      setAuthMode('login');
      setEmail(resetEmail);
      setPassword('');
      setResetEmail('');
      setVerificationCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [hostAddressInput, setHostAddressInput] = useState(() => {
    const isElectron = typeof window !== 'undefined' && (
      Boolean((window as any).electronAPI) || 
      window.location.protocol === 'file:' || 
      (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
    );

    const stored = localStorage.getItem('erp_host_address') || localStorage.getItem('api_server_url') || localStorage.getItem('server_address');
    if (stored) return stored;

    if (!isElectron && typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname || '';
      const isLocalWeb = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
      if (!isLocalWeb) {
        return window.location.origin;
      }
    }
    return 'http://localhost:5001';
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    let isMounted = true;
    // Pre-auth background sync: Pull newly created staff profiles from cloud on startup
    api.sync.pullDownstream().catch(() => {});

    const fetchSettings = async () => {
      const activeBaseUrl = getBaseUrl();
      try {
        // Fast pre-flight health check to verify server connectivity
        const healthRes = await fetchWithTimeout(`${activeBaseUrl}/health`, {}, 4000).catch(() => null);
        if (healthRes && healthRes.ok && isMounted) {
          setConnectionError(false);
        }

        const { data, error } = await supabase.from('system_settings').select('*').single();
        if (error) throw error;
        if (data && isMounted) {
          setShopSettings(data);
          setConnectionError(false);
        }
      } catch (err) {
        console.warn('[Connection Check] Database check notice:', err);
        if (isMounted) {
          const isElectron = typeof window !== 'undefined' && (
            Boolean((window as any).electronAPI) || 
            window.location.protocol === 'file:' || 
            (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
          );
          const hostname = typeof window !== 'undefined' ? (window.location.hostname || '') : '';
          const isLiveWebDomain = !isElectron && Boolean(hostname && hostname !== 'localhost' && hostname !== '127.0.0.1');

          if (isLiveWebDomain) {
            try {
              const check = await fetchWithTimeout(`${activeBaseUrl}/health`, {}, 3000);
              if (check.ok) {
                setConnectionError(false);
                return;
              }
            } catch (_) {}
          }
          setConnectionError(true);
        }
      }
    };
    fetchSettings();
    return () => { isMounted = false; };
  }, []);

  const handleTestConnection = async () => {
    if (!hostAddressInput) {
      setConnectionTestResult({ success: false, message: 'Please enter a host address.' });
      return;
    }
    
    let cleanAddress = hostAddressInput.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(cleanAddress)) {
      cleanAddress = `http://${cleanAddress}`;
    }
    
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    
    try {
      const healthUrl = cleanAddress.endsWith('/api') ? `${cleanAddress}/health` : `${cleanAddress}/api/health`;
      let res = await fetchWithTimeout(healthUrl, {}, 5000).catch(() => null);
      if (!res || !res.ok) {
        const settingsUrl = cleanAddress.endsWith('/api') ? `${cleanAddress}/settings` : `${cleanAddress}/api/settings`;
        res = await fetchWithTimeout(settingsUrl, {}, 5000);
      }
      if (res && res.ok) {
        setConnectionTestResult({ 
          success: true, 
          message: 'Connection successful! Host is online.' 
        });
        setConnectionError(false);
      } else {
        setConnectionTestResult({ 
          success: false, 
          message: `Failed to connect (Status: ${res?.status || 'unreachable'}). Verify this is a Muthuwadige ERP host.` 
        });
      }
    } catch (err: any) {
      setConnectionTestResult({ 
        success: false, 
        message: `Connection failed: ${err.message || 'Host is unreachable.'}` 
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault();
    let cleanAddress = hostAddressInput.trim().replace(/\/$/, '');
    if (!cleanAddress) {
      setApiUrl(null);
      alert("Switched to Standalone Host mode. The application will reload.");
      window.location.reload();
      return;
    }
    if (!/^https?:\/\//i.test(cleanAddress)) {
      cleanAddress = `http://${cleanAddress}`;
    }
    setApiUrl(cleanAddress);
    alert(`Connected to Host: ${cleanAddress}. Reloading app...`);
    window.location.reload();
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validations
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }

    setIsLoading(true);

    try {
      // Login Logic
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      if (data.user) {
        // Fetch the real, Super Admin approved role from the protected profiles table
        const { data: profile } = await supabase.from('profiles').select('*').eq('email', data.user.email).single();
        
        const finalRole = profile?.role || data.user.user_metadata?.role || 'Cashier';
        const finalName = profile?.name || data.user.user_metadata?.full_name || 'Hardware Staff';
        
        const rawPerms = profile?.custom_permissions !== undefined 
          ? profile.custom_permissions 
          : (profile?.permissions !== undefined ? profile.permissions : (data.user.custom_permissions || data.user.permissions));
        
        let parsedPermissions: string[] | undefined = undefined;
        if (rawPerms) {
          if (Array.isArray(rawPerms)) {
            parsedPermissions = rawPerms;
          } else if (typeof rawPerms === 'string' && rawPerms.trim().length > 0) {
            try {
              parsedPermissions = JSON.parse(rawPerms);
            } catch {
              parsedPermissions = rawPerms.split(',').map((p: string) => p.trim());
            }
          }
        }

        const loggedInUser: User = {
          id: profile?.id || data.user.id,
          email: data.user.email || '',
          name: finalName,
          full_name: finalName,
          role: finalRole, 
          avatar: profile?.avatar || data.user.email?.charAt(0).toUpperCase() || 'U',
          custom_permissions: parsedPermissions,
          permissions: parsedPermissions
        };

        if (parsedPermissions) {
          sessionStorage.setItem('custom_permissions', JSON.stringify(parsedPermissions));
          localStorage.setItem('custom_permissions', JSON.stringify(parsedPermissions));
        }

        onLogin(loggedInUser);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-gray-50">
      
      {/* Left Branding Panel (Ash & Gold Theme) */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#464646] flex-col justify-between p-12 relative overflow-hidden shadow-2xl z-10">
        {/* Decorative Gold Glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-[#DAA520]/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-[#DAA520]/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10">
          {/* Logo and Brand Name */}
          <div className="flex items-center gap-4 mb-12">
            <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-lg p-1.5 shrink-0">
              <img 
                src={shopSettings?.logo_path || "./images/logo.png"} 
                alt="Logo" 
                className="w-full h-full object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-white font-black text-2xl tracking-tight leading-none mb-1">
                {(shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE').split(' ')[0] || ''}
              </span>
              <span className="text-[#DAA520] font-black text-2xl tracking-widest leading-none">
                {(shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE').split(' ').slice(1).join(' ') || ''}
              </span>
            </div>
          </div>

          <h2 className="text-5xl font-black text-white leading-[1.1] mb-6">
            Your Trusted <br/> <span className="text-[#DAA520]">Hardware Partner</span> <br/> for Every Project.
          </h2>
          <p className="text-gray-300 text-lg font-medium max-w-md">
            Welcome to Muthuwadige Hardware. We offer premium building materials, tools, and outstanding services.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-4 bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
             <div className="p-3 bg-[#DAA520]/20 rounded-xl"><ShieldCheckIcon className="text-[#DAA520] w-6 h-6" /></div>
             <div>
                <p className="text-white font-black text-sm">Premium Quality</p>
                <p className="text-gray-400 text-xs font-medium mt-0.5">100% genuine products from leading brands</p>
             </div>
          </div>
          <div className="flex items-center gap-4 bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
             <div className="p-3 bg-white/10 rounded-xl"><GiftIcon className="text-white w-6 h-6" /></div>
             <div>
                <p className="text-white font-black text-sm">Loyalty Program</p>
                <p className="text-gray-400 text-xs font-medium mt-0.5">Earn reward points and enjoy exclusive discounts</p>
             </div>
          </div>
          <div className="flex items-center gap-4 bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
             <div className="p-3 bg-white/10 rounded-xl"><ThumbsUpIcon className="text-white w-6 h-6" /></div>
             <div>
                <p className="text-white font-black text-sm">Customer First</p>
                <p className="text-gray-400 text-xs font-medium mt-0.5">Helpful staff, fast delivery, and expert recommendations</p>
             </div>
          </div>
        </div>
      </div>

      {/* Right Side Form Panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md animate-in slide-in-from-right-8 duration-500">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-10">
            
            <h1 className="text-3xl font-black text-[#464646] mb-2">
              {authMode === 'login' && 'Staff Login'}
              {authMode === 'forgot' && 'Reset Password'}
              {authMode === 'verify' && 'Verify Code'}
            </h1>
            <p className="text-gray-500 mb-8 text-sm font-medium">
              {authMode === 'login' && 'Enter your credentials to access the ERP'}
              {authMode === 'forgot' && "We'll send a 6-digit verification code to your email address"}
              {authMode === 'verify' && 'Enter the 6-digit verification code and your new password'}
            </p>

            {connectionError && (
              <div className="flex flex-col gap-1.5 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-5 py-4 mb-6 text-xs font-bold animate-in slide-in-from-top-2 text-left">
                <div className="flex items-center gap-2">
                  <AlertCircleIcon className="w-5 h-5 flex-shrink-0 text-amber-600" />
                  <span>Cannot connect to database server</span>
                </div>
                <p className="text-gray-500 font-medium text-[11px] leading-relaxed">
                  The local database server is unreachable at <code className="bg-amber-100/50 px-1 py-0.5 rounded font-mono font-bold">{API_URL}</code>. If this app is hosted on Vercel or running on a client machine, please update the Server Address.
                </p>
                <button
                  type="button"
                  onClick={() => setShowConnectionSettings(true)}
                  className="text-amber-800 hover:text-amber-950 underline text-left w-fit mt-1"
                >
                  Configure Connection Settings
                </button>
              </div>
            )}

            {successMessage && (
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl px-5 py-4 mb-6 text-sm font-bold animate-in slide-in-from-top-2">
                <CheckIcon className="w-5 h-5 flex-shrink-0" />
                {successMessage}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-100 text-red-600 rounded-xl px-5 py-4 mb-6 text-sm font-bold animate-in slide-in-from-top-2">
                <AlertCircleIcon className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}

            {authMode === 'login' && (
              <form onSubmit={handleAuth} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Email Address</label>
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] bg-gray-50/50 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] pr-12 bg-gray-50/50 transition-all"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#DAA520] transition-colors"
                    >
                      {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                    </button>
                  </div>
                  <div className="text-right mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setResetEmail(email);
                        setAuthMode('forgot');
                      }}
                      className="text-xs font-bold text-[#DAA520] hover:underline"
                    >
                      Forgot Password?
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#DAA520] hover:bg-[#B8860B] text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Verifying Credentials...' : 'Secure Login'}
                </button>
              </form>
            )}

            {authMode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Email Address</label>
                  <input
                    type="email"
                    placeholder="Enter your email address"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] bg-gray-50/50 transition-all"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#DAA520] hover:bg-[#B8860B] text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Sending Reset Code...' : 'Send Reset Code'}
                </button>

                <div className="text-center mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setAuthMode('login');
                    }}
                    className="text-xs font-bold text-gray-500 hover:underline"
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            )}

            {authMode === 'verify' && (
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Verification Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] bg-gray-50/50 transition-all text-center tracking-[0.5em] text-lg font-mono font-black"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">New Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] bg-gray-50/50 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#DAA520] outline-none text-sm font-bold text-[#464646] bg-gray-50/50 transition-all"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#DAA520] hover:bg-[#B8860B] text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Resetting Password...' : 'Reset Password'}
                </button>

                <div className="text-center mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setAuthMode('login');
                    }}
                    className="text-xs font-bold text-gray-500 hover:underline"
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            )}

            <div className="mt-8 text-center pt-6 border-t border-gray-100 flex flex-col items-center gap-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {localStorage.getItem('erp_host_address') ? '📡 Connected to Remote Host' : '🔒 SECURE LOCAL DATABASE ACTIVE'}
              </div>
              <button
                type="button"
                onClick={() => setShowConnectionSettings(true)}
                className="text-[10px] font-black text-[#DAA520] hover:text-[#B8860B] uppercase tracking-wider transition-colors hover:underline flex items-center gap-1"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                Connection Settings
              </button>
            </div>
            
          </div>
        </div>
      </div>

      {/* Connection Settings Modal */}
      {showConnectionSettings && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleSaveConnection} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95 text-left">
            <div className="flex justify-between items-center mb-2">
              <div>
                <h3 className="font-black text-xl text-[#464646]">Connection Settings</h3>
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Configure Database API Host</p>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setShowConnectionSettings(false);
                  setConnectionTestResult(null);
                }} 
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Host Server Address / IP</label>
                <input 
                  type="text" 
                  value={hostAddressInput} 
                  onChange={e => setHostAddressInput(e.target.value)} 
                  placeholder="e.g. http://192.168.1.50:5001 or localhost:5001" 
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-mono font-bold text-xs text-slate-700 bg-white" 
                />
                <p className="text-[9px] text-gray-400 mt-1 font-bold">
                  Enter the IP and Port of your local server laptop (e.g. <code className="font-mono">192.168.1.100:5001</code>). If hosted remotely, enter the public domain or ngrok/tunnel URL.
                </p>
              </div>

              <div className="flex gap-2">
                <button 
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !hostAddressInput}
                  className="px-4 py-2.5 bg-[#464646] hover:bg-[#333333] disabled:bg-gray-200 disabled:text-gray-400 text-white text-[10px] font-black rounded-xl uppercase tracking-widest transition-all shadow-md flex items-center gap-1.5"
                >
                  {isTestingConnection && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />}
                  Test Connection
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    setHostAddressInput('');
                    setConnectionTestResult(null);
                  }}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] font-black rounded-xl uppercase tracking-widest transition-all"
                >
                  Reset / Standalone
                </button>
              </div>

              {connectionTestResult && (
                <div className={`p-3.5 rounded-xl border text-xs font-bold ${
                  connectionTestResult.success 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {connectionTestResult.message}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button 
                type="button" 
                onClick={() => {
                  setShowConnectionSettings(false);
                  setConnectionTestResult(null);
                }} 
                className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all"
              >
                Save & Reload
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}