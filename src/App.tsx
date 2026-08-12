import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Sales } from './pages/Sales';
import { Purchasing } from './pages/Purchasing';
import { Customers } from './pages/Customers';
import { Suppliers } from './pages/Suppliers';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { Database } from './pages/Database';
import { Settings } from './pages/Settings';
import { Finance } from './pages/Finance';
import { AuditLogs } from './pages/AuditLogs';
import { CurrencyProvider } from './context/CurrencyContext';
import { ROLE_PERMISSIONS } from './utils/permissions'; 
import { API_URL, fetchWithTimeout } from './lib/api';
import type { User, PageName } from './types';
import { Notifications, notify } from './components/Notifications';
import { Trash2, AlertTriangle, CheckCircle, HelpCircle, MessageSquare } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { Modal } from './components/Modal';

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState<PageName>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [salesTab, setSalesTab] = useState<'new' | 'history' | 'credit' | 'credit_history' | 'quotes'>('new');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  const [, setPermissionsTick] = useState(0);
  useEffect(() => {
    const handlePermsUpdate = () => setPermissionsTick(t => t + 1);
    window.addEventListener('permissions-updated', handlePermsUpdate);
    return () => window.removeEventListener('permissions-updated', handlePermsUpdate);
  }, []);

  const [shopSettings, setShopSettings] = useState<any>(null);

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data) setShopSettings(data);
    } catch (err) {
      console.error("Failed to load settings in App:", err);
    }
  };

  useEffect(() => {
    fetchSettings();
    window.addEventListener('settings-updated', fetchSettings);
    return () => window.removeEventListener('settings-updated', fetchSettings);
  }, []);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/permissions`, {}, 8000);
        if (res.ok) {
          const perms = await res.json();
          localStorage.setItem('custom_permissions', JSON.stringify(perms));
          window.dispatchEvent(new Event('permissions-updated'));
        }
      } catch (err) {
        console.error("Failed to fetch custom permissions from backend:", err);
      }
    };
    fetchPermissions();
  }, []);

  // Fetch low-stock products and update notifications dynamically
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const { data: products } = await supabase.from('products').select('*');
        const list: any[] = [];
        
        if (products) {
          const lowStock = products.filter((p: any) => {
            const minStk = p.minStock !== undefined ? p.minStock : p.min_stock !== undefined ? p.min_stock : 10;
            return p.stock < minStk;
          });
          
          lowStock.forEach((p: any) => {
            list.push({
              id: `low-stock-${p.id}`,
              title: 'Low Stock Alert',
              message: `"${p.name}" is low on stock (${p.stock} left). Please restock soon!`,
              time: 'Alert',
              type: 'warning',
              read: false
            });
          });

          // Check for products expiring in 7 days or less
          products.forEach((p: any) => {
            const expStr = p.expiryDate || p.expiry_date;
            if (expStr) {
              const expiry = new Date(expStr);
              const now = new Date();
              expiry.setHours(0, 0, 0, 0);
              now.setHours(0, 0, 0, 0);
              const timeDiff = expiry.getTime() - now.getTime();
              const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
              if (diffDays <= 7) {
                let msg = '';
                if (diffDays < 0) {
                  msg = `"${p.name}" expired on ${expStr}!`;
                } else if (diffDays === 0) {
                  msg = `"${p.name}" expires today!`;
                } else {
                  msg = `"${p.name}" will expire in ${diffDays} days (${expStr}).`;
                }
                list.push({
                  id: `expiry-alert-${p.id}`,
                  title: 'Expiry Warning',
                  message: msg,
                  time: 'Alert',
                  type: 'warning',
                  read: false
                });
              }
            }
          });
        }
        
        setNotifications(list);
      } catch (err) {
        console.error("Error loading notifications:", err);
      }
    };
    
    if (currentUser) {
      fetchNotifications();
    }
  }, [currentUser, currentPage]);

  const handleNotificationWhatsApp = async (productId: string) => {
    try {
      const { data: products } = await supabase.from('products').select('*').eq('id', productId);
      if (!products || products.length === 0) {
        alert("Product not found.");
        return;
      }
      const product = products[0];
      
      let phone = product.supplierPhone || product.supplier_phone;
      const supplierName = product.supplier;
      
      if (!phone && supplierName) {
        const { data: suppliers } = await supabase.from('suppliers').select('*');
        const s = suppliers?.find((supplier: any) => supplier.name.toLowerCase() === supplierName.toLowerCase());
        if (s && s.phone) {
          phone = s.phone;
        }
      }
      
      if (!phone) {
        alert(`No phone number found for supplier "${supplierName || 'N/A'}".`);
        return;
      }
      
      const message = `Stock Alert: Product "${product.name}" (SKU: ${product.sku}) is low on stock. Current stock is ${product.stock} left. Please restock soon!`;
      let cleanPhone = phone.replace(/[\s_.-]/g, '');
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '94' + cleanPhone.substring(1);
      } else if (cleanPhone.startsWith('7')) {
        cleanPhone = '94' + cleanPhone;
      } else if (cleanPhone.startsWith('+')) {
        cleanPhone = cleanPhone.substring(1);
      }
      cleanPhone = cleanPhone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    } catch (err) {
      console.error(err);
      alert("Error generating WhatsApp alert.");
    }
  };

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  
  // --- Splash Screen State ---
  const [showSplash, setShowSplash] = useState(true);

  // --- Splash Screen Timer (4 seconds) ---
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // --- SECURITY GUARD: Role-Based Access Control ---
  useEffect(() => {
    if (currentUser) {
      const allowedPages = ROLE_PERMISSIONS[currentUser.role] || [];
      
      if (!allowedPages.includes(currentPage)) {
        console.warn(`Access Denied: ${currentUser.role} cannot access ${currentPage}`);
        
        if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
          setCurrentPage('dashboard');
        } else {
          setCurrentPage('sales');
        }
      }
    }
  }, [currentPage, currentUser]);

  useEffect(() => {
    const originalAlert = window.alert;
    (window as any).alert = (message: unknown) => {
      const text = typeof message === 'string' ? message : JSON.stringify(message);
      const lowerCase = text.toLowerCase();
      const type = lowerCase.match(/\b(delete|deleted|remove|removed|remove user|delete user)\b/)
        ? 'delete'
        : lowerCase.match(/\b(success|saved|created|imported|updated|emailed|generated|added|completed)\b/)
        ? 'success'
        : lowerCase.match(/\b(fail|error|failed|cannot|expired|missing|invalid)\b/)
        ? 'error'
        : 'info';
      notify(text, 'Muthuwadige Hardware ERP', type);
    };

    (window as any).showConfirm = (message: string, onConfirm: () => void, title: string = 'Confirm Action') => {
      setConfirmDialog({
        isOpen: true,
        title,
        message,
        onConfirm: () => {
          onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        },
        onCancel: () => {
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
    };

    return () => {
      (window as any).alert = originalAlert;
    };
  }, []);

  const handleLogin = (user: User) => {
    console.log("✅ User logged in with role:", user.role); 
    setCurrentUser(user);
    
    if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'manager') {
      setCurrentPage('dashboard');
    } else {
      setCurrentPage('sales'); 
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentPage('dashboard');
  };

  // ==========================================
  // 1. RENDER SPLASH SCREEN (First 4 Seconds)
  // ==========================================
  if (showSplash) {
    return (
      <div 
        className="h-screen w-full relative flex flex-col items-center justify-center overflow-hidden"
        style={{
          backgroundImage: 'url("https://images.unsplash.com/photo-1541888086225-eb81f8f6d78c?q=80&w=2070&auto=format&fit=crop")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Ash overlay with Gold glow */}
        <div className="absolute inset-0 bg-[#2b2b2b]/85 z-0 flex items-center justify-center overflow-hidden">
          <div className="absolute w-[800px] h-[800px] bg-[#DAA520]/10 rounded-full blur-[100px] z-[-1]" />
        </div>
        
        {/* Central Content Container with Custom Pop-Up Animation */}
        <div className="flex flex-col items-center animate-pop-up relative z-10">
          
          {/* Bigger Logo with No White Background + Gold Drop Shadow */}
          <div className="relative mb-10 w-64 h-64 flex items-center justify-center drop-shadow-[0_15px_35px_rgba(218,165,32,0.3)]">
             <img 
               src={shopSettings?.logo_path || "./images/logo.png"} 
               alt="Hardware Logo" 
               className="w-full h-full object-contain" 
               onError={(e) => { e.currentTarget.style.display = 'none'; }}
             />
          </div>
          
          {/* Branding Section */}
          <div className="text-center mb-8 px-6">
            <h1 className="text-gray-100 font-bold text-5xl md:text-6xl tracking-tighter mb-4 font-sans drop-shadow-lg">
              <span className="text-[#DAA520] font-black">H</span>ardware <span className="text-[#DAA520] font-black">ERP</span>
            </h1>
            <h2 className="text-[#DAA520] font-black text-2xl md:text-3xl tracking-widest uppercase border-t border-gray-500/40 pt-5 mb-8">
              {shopSettings?.shop_name || "Muthuwadige Hardware"}
            </h2>
          </div>
          
          {/* Details & Contacts */}
          <div className="bg-[#333333]/80 backdrop-blur-md border border-[#DAA520]/20 p-8 rounded-[2.5rem] shadow-2xl text-center space-y-4 px-12 md:px-20">
            <p className="text-gray-200 text-sm md:text-base font-black tracking-widest uppercase drop-shadow-md">
              {shopSettings?.address || "No: 80, Mahahunupitiya, Negombo"}
            </p>
            <p className="text-[#DAA520] font-black text-3xl md:text-4xl tracking-widest drop-shadow-lg">
              📞 {shopSettings?.phone || "077 076 076 7"}
            </p>
          </div>
          
          {/* Loading Indicator */}
          <div className="mt-16 flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-[#DAA520]/30 border-t-[#DAA520] rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(218,165,32,0.5)]"></div>
            <p className="text-[#DAA520] text-xs font-black uppercase tracking-widest animate-pulse drop-shadow-md">Loading System...</p>
          </div>
        </div>

        {/* CSS Keyframes for Pop-up Animation */}
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes pop-up {
            0% { transform: scale(0.85); opacity: 0; }
            60% { transform: scale(1.02); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          .animate-pop-up {
            animation: pop-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}} />
      </div>
    );
  }

  // ==========================================
  // 2. RENDER LOGIN PAGE (If not logged in)
  // ==========================================
  if (!currentUser) {
    return <Auth onLogin={handleLogin} />;
  }

  // ==========================================
  // 3. RENDER MAIN APPLICATION
  // ==========================================
  const renderPage = () => {
    const allowedPages = ROLE_PERMISSIONS[currentUser.role] || [];
    
    if (!allowedPages.includes(currentPage)) {
      return (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') 
        ? <Dashboard onNavigate={(page, tab) => {
            if (page === 'sales' && tab) {
              setSalesTab(tab as any);
            }
            setCurrentPage(page as PageName);
          }} /> 
        : <Sales initialTab={salesTab} />;
    }

    switch (currentPage) {
      case 'dashboard': return (
        <Dashboard 
          onNavigate={(page, tab) => {
            if (page === 'sales' && tab) {
              setSalesTab(tab as any);
            }
            setCurrentPage(page as PageName);
          }} 
        />
      );
      case 'inventory': return <Inventory />;
      case 'sales': return <Sales initialTab={salesTab} />;
      case 'purchasing': return <Purchasing />;
      case 'customers': return <Customers />;
      case 'suppliers': return <Suppliers />;
      case 'reports': return <Reports />;
      case 'users': return <Users />;
      case 'database': return <Database />;
      case 'settings': return <Settings />;
      case 'finance': return <Finance />;
      case 'audit_logs': return <AuditLogs />;
      default: return (
        <Dashboard 
          onNavigate={(page, tab) => {
            if (page === 'sales' && tab) {
              setSalesTab(tab as any);
            }
            setCurrentPage(page as PageName);
          }} 
        />
      );
    }
  };

  return (
    <CurrencyProvider>
      <div className="flex h-screen w-full bg-gray-50 overflow-hidden animate-in fade-in duration-700">
        <Sidebar
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          currentUser={currentUser}
          onLogout={handleLogout}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)} 
          setSalesTab={setSalesTab}
        />

        <div className="flex-1 flex flex-col min-w-0 lg:ml-64 relative">
          <Header
            currentPage={currentPage}
            currentUser={currentUser}
            onMenuToggle={() => setSidebarOpen(!sidebarOpen)} 
            onNotificationClick={() => setShowNotificationsModal(true)}
            unreadNotifications={notifications.filter(n => !n.read).length}
          />

          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto h-full">
              {renderPage()}
            </div>
          </main>

          <Notifications />

          <Modal 
            isOpen={showNotificationsModal} 
            onClose={() => {
              setShowNotificationsModal(false);
              // Mark all as read when closing the modal
              setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            }} 
            title="System Notifications & Alerts"
            size="sm"
          >
            <div className="space-y-4 py-2 text-left">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-gray-400 font-bold">
                  No active notifications at this time.
                </div>
              ) : (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {notifications.map((n) => (
                    <div 
                      key={n.id} 
                      className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
                        n.type === 'warning' 
                          ? 'bg-amber-50/70 border-amber-200 text-amber-900' 
                          : 'bg-slate-50/70 border-slate-200 text-slate-900'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        n.type === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-slate-200/80 text-slate-600'
                      }`}>
                        {n.type === 'warning' ? (
                          <AlertTriangle className="w-4.5 h-4.5" />
                        ) : (
                          <CheckCircle className="w-4.5 h-4.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-black uppercase tracking-wider opacity-60">
                            {n.title}
                          </span>
                          <span className="text-[8px] font-black uppercase tracking-wider opacity-40 bg-white/80 px-1.5 py-0.5 rounded-lg border border-black/5">
                            {n.time}
                          </span>
                        </div>
                        <p className="text-xs font-bold mt-1.5 leading-relaxed">{n.message}</p>
                        {n.id.startsWith('low-stock-') && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                          <button
                            onClick={() => handleNotificationWhatsApp(n.id.replace('low-stock-', ''))}
                            className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1 w-fit"
                          >
                            <MessageSquare className="w-3 h-3" /> WhatsApp Supplier
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button 
                onClick={() => {
                  setShowNotificationsModal(false);
                  setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                }}
                className="w-full mt-4 py-3.5 bg-[#464646] hover:bg-[#333333] text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-black/15"
              >
                Mark all as read & Close
              </button>
            </div>
          </Modal>

          {confirmDialog.isOpen && (() => {
            const text = (confirmDialog.title + ' ' + confirmDialog.message).toLowerCase();
            const isDelete = text.match(/\b(delete|remove|clear|cancel|wipe|warn|warning)\b/);
            const isSuccess = text.match(/\b(receive|increase|restock|adjust|save|add|create|success)\b/);
            
            return (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#464646]/60 backdrop-blur-sm" onClick={confirmDialog.onCancel} />
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 text-center animate-in zoom-in duration-300 border border-gray-100">
                  {isDelete ? (
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto border border-red-100 shadow-inner mb-4">
                      <Trash2 className="w-8 h-8" />
                    </div>
                  ) : isSuccess ? (
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100 shadow-inner mb-4">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 bg-amber-50 text-[#DAA520] rounded-2xl flex items-center justify-center mx-auto border border-amber-100 shadow-inner mb-4">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                  )}
                  <h3 className="font-black text-slate-800 text-lg mb-2">{confirmDialog.title}</h3>
                  <p className="text-xs text-gray-500 font-bold leading-relaxed mb-6">
                    {confirmDialog.message}
                  </p>
                  <div className="flex gap-3">
                    <button 
                      onClick={confirmDialog.onCancel} 
                      className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs transition-all border border-gray-200"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={confirmDialog.onConfirm} 
                      className={`flex-1 py-3 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg ${
                        isDelete ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-[#DAA520] hover:bg-[#B8860B] shadow-[#DAA520]/20'
                      }`}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
          
          {sidebarOpen && (
            <div 
              className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </div>
      </div>
    </CurrencyProvider>
  );
}