import { useState, useEffect } from 'react';
import './App.css';

// API Gateway route (via Nginx Load Balancer or direct gateway on port 5000)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

function App() {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [analytics, setAnalytics] = useState({ totalRevenue: 0, totalOrders: 0, statusBreakdown: [], recentSales: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('products');
  const [searchQuery, setSearchQuery] = useState('');

  // Auth Form State
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '', role: 'customer' });
  const [isLogin, setIsLogin] = useState(true);

  // Seller Product Form / Modal State
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', stock: '', brand: '', imageUrl: '' });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [productSubmitting, setProductSubmitting] = useState(false);

  // Mock Payment Modal State
  const [activePaymentModal, setActivePaymentModal] = useState(null); // { order, paymentData }
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('mock_card');
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentFeedback, setPaymentFeedback] = useState(null);

  const isSeller = user?.role === 'seller';

  // Check auth session from HttpOnly cookie on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        credentials: 'include',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const userData = data.user;
        setUser(userData);
        setIsLoggedIn(true);
        setActiveTab(userData.role === 'seller' ? 'manage-products' : 'products');
      } else {
        setUser(null);
        setIsLoggedIn(false);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('Session check finished or timed out:', err.name || err.message);
      setUser(null);
      setIsLoggedIn(false);
    } finally {
      setCheckingAuth(false);
    }
  };

  // Auto load data after login
  useEffect(() => {
    if (isLoggedIn) {
      fetchProducts();
      fetchOrders();
      if (!isSeller) {
        fetchCart();
      } else {
        fetchAnalytics();
      }
    }
  }, [isLoggedIn, user?.role]);

  const fetchCart = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/cart`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setCart(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch cart from Redis:', err);
    }
  };

  const syncCartToRedis = async (newCart) => {
    try {
      await fetch(`${API_BASE_URL}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: newCart })
      });
    } catch (err) {
      console.error('Failed to sync cart to Redis:', err);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/products`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setProducts(data || []);
      } else if (response.status === 401) {
        handleLogout();
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setOrders(data || []);
      } else if (response.status === 401) {
        handleLogout();
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/analytics/summary`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  };

  // Dedicated Login Executor
  const executeLogin = async (email, password) => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        const userData = data.user || { name: email, role: 'customer' };
        setUser(userData);
        setIsLoggedIn(true);
        setActiveTab(userData.role === 'seller' ? 'manage-products' : 'products');
        setAuthForm({ email: '', password: '', name: '', role: 'customer' });
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (err) {
      setError('Login error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Demo Login Handler
  const handleDemoLogin = (type) => {
    if (type === 'seller') {
      executeLogin('seller@demo.com', 'seller123');
    } else {
      executeLogin('customer@demo.com', 'customer123');
    }
  };

  // Regular Auth Form Submission
  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: authForm.email, password: authForm.password }
        : { name: authForm.name, email: authForm.email, password: authForm.password, role: authForm.role };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        const userData = data.user || { name: authForm.email, role: authForm.role };
        setUser(userData);
        setIsLoggedIn(true);
        setActiveTab(userData.role === 'seller' ? 'manage-products' : 'products');
        setAuthForm({ email: '', password: '', name: '', role: 'customer' });
      } else {
        setError(data.message || 'Authentication failed');
      }
    } catch (err) {
      setError('Authentication error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error(err);
    }
    setIsLoggedIn(false);
    setUser(null);
    setOrders([]);
    setProducts([]);
    setCart([]);
  };

  // ==========================================
  // SELLER PRODUCT MANAGEMENT ACTIONS
  // ==========================================
  const openAddProductModal = () => {
    setEditingProduct(null);
    setProductForm({ name: '', description: '', price: '', stock: '', brand: '', imageUrl: '' });
    setShowProductModal(true);
  };

  const openEditProductModal = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      description: product.description || '',
      price: product.price,
      stock: product.stock,
      brand: product.attributes?.brand || '',
      imageUrl: product.attributes?.imageUrl || product.attributes?.image_url || ''
    });
    setShowProductModal(true);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return alert('Please select a valid image file (PNG, JPG, WEBP, etc.)');
    }

    const formData = new FormData();
    formData.append('image', file);

    setUploadingImage(true);
    try {
      const res = await fetch(`${API_BASE_URL}/products/upload-image`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      const data = await res.json();
      if (res.ok && data.imageUrl) {
        setProductForm(prev => ({ ...prev, imageUrl: data.imageUrl }));
      } else {
        alert(data.message || 'Image upload failed. You can paste a direct image URL manually below.');
      }
    } catch (err) {
      alert('Upload network error: ' + err.message + '. You can paste a direct image URL manually below.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setProductSubmitting(true);
    try {
      const isEdit = !!editingProduct;
      const url = isEdit ? `${API_BASE_URL}/products/${editingProduct.id}` : `${API_BASE_URL}/products`;
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        name: productForm.name,
        description: productForm.description,
        price: parseFloat(productForm.price),
        stock: parseInt(productForm.stock, 10),
        imageUrl: productForm.imageUrl || undefined,
        attributes: {
          ...(productForm.brand ? { brand: productForm.brand } : {}),
          ...(productForm.imageUrl ? { imageUrl: productForm.imageUrl } : {})
        }
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setShowProductModal(false);
        setEditingProduct(null);
        fetchProducts();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to save product');
      }
    } catch (err) {
      alert('Error saving product: ' + err.message);
    } finally {
      setProductSubmitting(false);
    }
  };

  const handleDeleteProduct = async (productId, productName) => {
    if (!window.confirm(`Are you sure you want to delete "${productName}"?`)) return;
    try {
      const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        fetchProducts();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to delete product');
      }
    } catch (err) {
      alert('Error deleting product: ' + err.message);
    }
  };

  // ==========================================
  // SELLER ORDER STATUS TRANSITION ACTIONS
  // ==========================================
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        fetchOrders();
        fetchAnalytics();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to update order status');
      }
    } catch (err) {
      alert('Error updating status: ' + err.message);
    }
  };

  // ==========================================
  // CUSTOMER STORE & CHECKOUT ACTIONS
  // ==========================================
  const addToCart = (product) => {
    setCart((prevCart) => {
      let updated;
      const existing = prevCart.find(item => item.productId === product.id);
      const availableStock = product.stock !== undefined ? product.stock : 9999;

      if (existing) {
        if (existing.quantity >= availableStock) {
          alert(`Cannot add more than available stock (${availableStock}) for "${product.name}"!`);
          return prevCart;
        }
        updated = prevCart.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      } else {
        if (availableStock <= 0) {
          alert(`"${product.name}" is currently out of stock!`);
          return prevCart;
        }
        updated = [...prevCart, { productId: product.id, name: product.name, price: Number(product.price), quantity: 1, stock: availableStock }];
      }
      syncCartToRedis(updated);
      return updated;
    });
  };

  const removeFromCart = (productId) => {
    setCart((prevCart) => {
      const updated = prevCart.filter(item => item.productId !== productId);
      syncCartToRedis(updated);
      return updated;
    });
  };

  const placeOrder = async () => {
    if (cart.length === 0) return alert('Cart is empty!');
    setLoading(true);
    try {
      // 🛡️ Feature 4: Unique Idempotency-Key per checkout attempt prevents double charging & duplicate orders
      const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey 
        },
        credentials: 'include',
        body: JSON.stringify({ items: cart })
      });
      
      if (response.ok) {
        const createdOrder = await response.json();
        setCart([]);
        fetchOrders();
        fetchProducts(); // Refresh stock
        initiatePaymentForOrder(createdOrder);
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to place order');
      }
    } catch (err) {
      console.error(err);
      alert('Error placing order');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // PAYMENT FLOW ACTIONS
  // ==========================================
  const openRazorpayCheckout = (order, paymentData) => {
    if (!window.Razorpay) {
      alert('Razorpay Checkout SDK is still loading. Please check your internet connection and try again.');
      return;
    }

    const rzpOptions = {
      key: paymentData.keyId,
      amount: paymentData.razorpayOrder?.amount || Math.round(Number(order.total) * 100),
      currency: paymentData.currency || 'INR',
      name: 'Microservice Store',
      description: `Payment for Order #${order.id.substring(0, 8)}`,
      order_id: paymentData.gatewayOrderId,
      handler: async function (rzpResponse) {
        setPaymentProcessing(true);
        try {
          const verifyRes = await fetch(`${API_BASE_URL}/payments/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              razorpay_order_id: rzpResponse.razorpay_order_id,
              razorpay_payment_id: rzpResponse.razorpay_payment_id,
              razorpay_signature: rzpResponse.razorpay_signature,
              orderId: order.id
            })
          });

          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.success) {
            setPaymentFeedback({
              type: 'success',
              message: 'Payment Verified & Confirmed! (Razorpay)',
              transactionId: rzpResponse.razorpay_payment_id
            });
            setActivePaymentModal({ order, paymentData });
            fetchOrders();
          } else {
            setPaymentFeedback({
              type: 'error',
              message: verifyData.message || 'Signature verification failed',
              transactionId: rzpResponse.razorpay_payment_id
            });
            setActivePaymentModal({ order, paymentData });
            fetchOrders();
          }
        } catch (verifyErr) {
          setPaymentFeedback({
            type: 'error',
            message: 'Verification request failed: ' + verifyErr.message
          });
          setActivePaymentModal({ order, paymentData });
        } finally {
          setPaymentProcessing(false);
        }
      },
      prefill: {
        name: user?.name || 'Customer',
        email: user?.email || 'customer@example.com',
        contact: '9999999999'
      },
      theme: {
        color: '#2563eb'
      },
      method: {
        upi: true,
        card: true,
        netbanking: true,
        wallet: true
      },
      modal: {
        ondismiss: function () {
          console.log('Razorpay modal dismissed.');
        }
      }
    };

    const rzpInstance = new window.Razorpay(rzpOptions);
    rzpInstance.on('payment.failed', function (failResponse) {
      setPaymentFeedback({
        type: 'error',
        message: failResponse.error?.description || 'Payment Failed',
        transactionId: failResponse.error?.metadata?.payment_id || 'N/A'
      });
      setActivePaymentModal({ order, paymentData });
      fetchOrders();
    });
    rzpInstance.open();
  };

  const initiatePaymentForOrder = async (order) => {
    setPaymentFeedback(null);
    setPaymentProcessing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId: order.id })
      });

      let resData;
      try {
        resData = await response.json();
      } catch (_) {
        resData = { message: `HTTP Error ${response.status}` };
      }

      if (response.ok) {
        setActivePaymentModal({ order, paymentData: resData });
        if (resData.isRealRazorpay && window.Razorpay) {
          openRazorpayCheckout(order, resData);
        }
      } else {
        alert('Payment initiation failed: ' + (resData.message || 'Server error'));
      }
    } catch (err) {
      alert('Payment network error: ' + err.message);
    } finally {
      setPaymentProcessing(false);
    }
  };

  const handleSimulatePayment = async (simulateStatus) => {
    if (!activePaymentModal) return;
    setPaymentProcessing(true);
    setPaymentFeedback(null);

    try {
      const response = await fetch(`${API_BASE_URL}/payments/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paymentId: activePaymentModal.paymentData.paymentId,
          orderId: activePaymentModal.order.id,
          paymentMethod: selectedPaymentMethod,
          simulateStatus: simulateStatus
        })
      });

      let resData;
      try {
        resData = await response.json();
      } catch (_) {
        resData = { message: `HTTP Error ${response.status}` };
      }

      if (response.ok && resData.success) {
        setPaymentFeedback({
          type: 'success',
          message: resData.message || 'Payment Successful!',
          transactionId: resData.transactionId
        });
        fetchOrders();
      } else {
        setPaymentFeedback({
          type: 'error',
          message: resData.message || 'Payment Failed (Simulated)',
          transactionId: resData?.transactionId || 'N/A'
        });
        fetchOrders();
        fetchProducts(); // Stock was released back
      }
    } catch (err) {
      setPaymentFeedback({
        type: 'error',
        message: 'Network error during payment processing: ' + err.message
      });
    } finally {
      setPaymentProcessing(false);
    }
  };

  const closePaymentModal = () => {
    setActivePaymentModal(null);
    setPaymentFeedback(null);
    setActiveTab(isSeller ? 'manage-orders' : 'orders');
    fetchOrders();
  };

  // ==========================================
  // RENDER: AUTHENTICATION SCREEN
  // ==========================================
  if (checkingAuth) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center', padding: '40px' }}>
          <h2>Verifying session...</h2>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>E-Commerce Platform</h1>

          {/* Quick Demo Login Section */}
          <div className="demo-login-section">
            <div className="demo-title">⚡ Instant Demo Access</div>
            <div className="demo-buttons-grid">
              <button 
                type="button" 
                className="demo-btn demo-btn-seller" 
                onClick={() => handleDemoLogin('seller')}
                disabled={loading}
              >
                <span>🏪 Demo Seller</span>
                <span className="demo-subtext">seller@demo.com</span>
              </button>
              <button 
                type="button" 
                className="demo-btn demo-btn-customer" 
                onClick={() => handleDemoLogin('customer')}
                disabled={loading}
              >
                <span>🛍️ Demo Customer</span>
                <span className="demo-subtext">customer@demo.com</span>
              </button>
            </div>
          </div>

          <div className="auth-toggle">
            <button className={isLogin ? 'active' : ''} onClick={() => setIsLogin(true)}>Login</button>
            <button className={!isLogin ? 'active' : ''} onClick={() => setIsLogin(false)}>Register</button>
          </div>

          <form onSubmit={handleAuth}>
            {!isLogin && (
              <>
                <div className="form-group">
                  <label>Full Name:</label>
                  <input 
                    type="text" 
                    value={authForm.name} 
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} 
                    placeholder="John Doe"
                    required 
                  />
                </div>
                <div className="form-group">
                  <label>Account Role:</label>
                  <select 
                    value={authForm.role} 
                    onChange={(e) => setAuthForm({ ...authForm, role: e.target.value })}
                  >
                    <option value="customer">Customer (Shop & Buy)</option>
                    <option value="seller">Seller (Manage Products & Orders)</option>
                  </select>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Email Address:</label>
              <input 
                type="email" 
                value={authForm.email} 
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} 
                placeholder="name@example.com"
                required 
              />
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input 
                type="password" 
                value={authForm.password} 
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} 
                placeholder="••••••••"
                required 
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // 🔍 Keyword search filter (matches name, description, or brand)
  const filteredProducts = products.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(q);
    const descMatch = (p.description || '').toLowerCase().includes(q);
    const brandMatch = (p.attributes?.brand || '').toLowerCase().includes(q);
    return nameMatch || descMatch || brandMatch;
  });

  // ==========================================
  // RENDER: MAIN APPLICATION DASHBOARD
  // ==========================================
  return (
    <div className="app-container">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-brand">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h1>Microservices Platform</h1>
            <span className={`role-badge ${isSeller ? 'role-seller' : 'role-customer'}`}>
              {isSeller ? '🏪 Seller Portal' : '🛍️ Customer Store'}
            </span>
          </div>
          <p>Logged in as: <strong>{user?.name || user?.email}</strong> ({user?.email})</p>
        </div>

        <div className="nav-tabs">
          {isSeller ? (
            <>
              <button 
                className={activeTab === 'manage-products' ? 'active' : ''} 
                onClick={() => setActiveTab('manage-products')}
              >
                📦 Products ({products.length})
              </button>
              <button 
                className={activeTab === 'manage-orders' ? 'active' : ''} 
                onClick={() => { setActiveTab('manage-orders'); fetchOrders(); }}
              >
                📋 Orders ({orders.length})
              </button>
              <button 
                className={activeTab === 'analytics' ? 'active' : ''} 
                onClick={() => { setActiveTab('analytics'); fetchAnalytics(); }}
              >
                📊 Sales & Analytics
              </button>
            </>
          ) : (
            <>
              <button 
                className={activeTab === 'products' ? 'active' : ''} 
                onClick={() => setActiveTab('products')}
              >
                Browse Store
              </button>
              <button 
                className={activeTab === 'cart' ? 'active' : ''} 
                onClick={() => setActiveTab('cart')}
              >
                Cart ({cartItemsCount})
              </button>
              <button 
                className={activeTab === 'orders' ? 'active' : ''} 
                onClick={() => { setActiveTab('orders'); fetchOrders(); }}
              >
                My Orders ({orders.length})
              </button>
            </>
          )}

          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        {error && <div className="error-banner">{error}</div>}

        {/* ==================================================== */}
        {/* SELLER VIEW 1: PRODUCT MANAGEMENT                    */}
        {/* ==================================================== */}
        {isSeller && activeTab === 'manage-products' && (
          <section className="tab-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h2>Product Inventory & Catalog</h2>
                <p style={{ color: '#64748b', fontSize: '14px' }}>Add, edit, modify stock, or remove products from the marketplace.</p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '260px' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="🔍 Filter inventory..."
                    style={{
                      width: '100%',
                      padding: '9px 32px 9px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      background: 'white'
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer'
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button 
                  onClick={openAddProductModal}
                  style={{ 
                    background: '#6366f1', 
                    color: 'white', 
                    padding: '9px 18px', 
                    borderRadius: '6px', 
                    border: 'none', 
                    fontWeight: 'bold', 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px'
                  }}
                >
                  <span>➕</span> Add New Product
                </button>
              </div>
            </div>

            <div className="seller-table-container">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Brand / Attributes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                        {searchQuery ? `No products match "${searchQuery}".` : 'No products found in catalog.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img 
                              src={p.attributes?.imageUrl || p.attributes?.image_url || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60'} 
                              alt={p.name}
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0', flexShrink: 0 }}
                              onError={(e) => {
                                e.target.src = 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60';
                              }}
                            />
                            <div>
                              <strong>{p.name}</strong>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>{p.description}</div>
                            </div>
                          </div>
                        </td>
                        <td><strong>₹{Number(p.price).toFixed(2)}</strong></td>
                        <td>
                          <span style={{ 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            fontSize: '12px', 
                            fontWeight: 'bold',
                            background: p.stock > 10 ? '#dcfce7' : p.stock > 0 ? '#fef3c7' : '#fee2e2',
                            color: p.stock > 10 ? '#166534' : p.stock > 0 ? '#92400e' : '#991b1b'
                          }}>
                            {p.stock} units
                          </span>
                        </td>
                        <td>{p.attributes?.brand || 'Generic'}</td>
                        <td>
                          <button className="action-btn action-edit" onClick={() => openEditProductModal(p)}>✏️ Edit</button>
                          <button className="action-btn action-delete" onClick={() => handleDeleteProduct(p.id, p.name)}>🗑️ Delete</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ==================================================== */}
        {/* SELLER VIEW 2: ORDER MANAGEMENT                      */}
        {/* ==================================================== */}
        {isSeller && activeTab === 'manage-orders' && (
          <section className="tab-content">
            <h2>Order Fulfillment & Status Transitions</h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>Review incoming orders across all customers and transition fulfillment states.</p>

            <div className="seller-table-container">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>Order ID & Customer</th>
                    <th>Items Purchased</th>
                    <th>Total</th>
                    <th>Current Status</th>
                    <th>Fulfillment Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>No customer orders placed yet.</td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>#{o.id.substring(0, 8)}</strong>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {o.customer_name || 'Customer'} ({o.customer_email || 'user'})
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {new Date(o.created_at || Date.now()).toLocaleDateString()}
                          </div>
                        </td>
                        <td>
                          {o.items && o.items.map(it => (
                            <div key={it.id || it.product_id} style={{ fontSize: '13px' }}>
                              • {it.product_name} × {it.quantity} (₹{it.price})
                            </div>
                          ))}
                        </td>
                        <td><strong>₹{Number(o.total).toFixed(2)}</strong></td>
                        <td>
                          <span className={`order-status ${
                            o.status === 'Confirmed' || o.status === 'Delivered' ? 'badge-paid' :
                            o.status === 'Cancelled' || o.status === 'Payment_Failed' ? 'badge-failed' : 'badge-pending'
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td>
                          {o.status === 'Confirmed' && (
                            <>
                              <button className="status-btn btn-process" onClick={() => handleUpdateOrderStatus(o.id, 'Processing')}>
                                Mark Processing 📦
                              </button>
                              <button className="status-btn btn-cancel" onClick={() => handleUpdateOrderStatus(o.id, 'Cancelled')}>
                                Cancel ❌
                              </button>
                            </>
                          )}
                          {o.status === 'Processing' && (
                            <>
                              <button className="status-btn btn-ship" onClick={() => handleUpdateOrderStatus(o.id, 'Shipped')}>
                                Dispatch / Ship 🚚
                              </button>
                              <button className="status-btn btn-cancel" onClick={() => handleUpdateOrderStatus(o.id, 'Cancelled')}>
                                Cancel ❌
                              </button>
                            </>
                          )}
                          {o.status === 'Shipped' && (
                            <button className="status-btn btn-deliver" onClick={() => handleUpdateOrderStatus(o.id, 'Delivered')}>
                              Mark Delivered ✅
                            </button>
                          )}
                          {(o.status === 'Delivered' || o.status === 'Cancelled') && (
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Completed</span>
                          )}
                          {(o.status === 'Awaiting_Payment' || o.status === 'Payment_Initiated') && (
                            <span style={{ fontSize: '12px', color: '#f59e0b' }}>Waiting for payment</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ==================================================== */}
        {/* SELLER VIEW 3: SALES & ANALYTICS                     */}
        {/* ==================================================== */}
        {isSeller && activeTab === 'analytics' && (
          <section className="tab-content">
            <h2>Seller Performance & Sales Analytics</h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>Real-time revenue metrics, order velocity, and recent transactions.</p>

            <div className="kpi-grid">
              <div className="kpi-card" style={{ borderLeftColor: '#10b981' }}>
                <h4>Total Revenue</h4>
                <div className="kpi-value" style={{ color: '#047857' }}>
                  ₹{(analytics.totalRevenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="kpi-card" style={{ borderLeftColor: '#6366f1' }}>
                <h4>Total Orders</h4>
                <div className="kpi-value">{analytics.totalOrders || orders.length}</div>
              </div>
              <div className="kpi-card" style={{ borderLeftColor: '#f59e0b' }}>
                <h4>Catalog Size</h4>
                <div className="kpi-value">{products.length} Products</div>
              </div>
            </div>

            <div className="seller-table-container">
              <h3 style={{ marginBottom: '16px', color: '#334155' }}>Recent Sales Transactions</h3>
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date & Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics.recentSales && analytics.recentSales.length > 0 ? analytics.recentSales : orders.slice(0, 10)).map(s => (
                    <tr key={s.id}>
                      <td><strong>#{s.id.substring(0, 8)}</strong></td>
                      <td>{s.customer_name || 'Customer'} ({s.customer_email || 'user'})</td>
                      <td><strong>₹{Number(s.total).toFixed(2)}</strong></td>
                      <td>
                        <span className={`order-status ${s.status === 'Delivered' || s.status === 'Confirmed' ? 'badge-paid' : 'badge-pending'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: '#64748b' }}>
                        {new Date(s.created_at || Date.now()).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ==================================================== */}
        {/* CUSTOMER VIEW 1: BROWSE PRODUCTS                     */}
        {/* ==================================================== */}
        {!isSeller && activeTab === 'products' && (
          <section className="tab-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h2>Product Catalog</h2>
                <p style={{ color: '#64748b', fontSize: '14px' }}>Browse available items with real-time stock levels.</p>
              </div>

              {/* 🔍 Customer Keyword Search Bar */}
              <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="🔍 Search products, specs, or brands..."
                  style={{
                    width: '100%',
                    padding: '10px 36px 10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    background: 'white',
                    outline: 'none',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {loading && products.length === 0 ? <p>Loading products...</p> : filteredProducts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', color: '#64748b' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔍</div>
                <h3>No matching products found</h3>
                <p>We couldn't find anything matching "{searchQuery}". Try a different keyword or brand.</p>
                <button 
                  onClick={() => setSearchQuery('')}
                  style={{ marginTop: '12px', padding: '6px 16px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}
                >
                  Clear Filter
                </button>
              </div>
            ) : (
              <div className="products-grid">
                {filteredProducts.map((p) => (
                  <div key={p.id} className="product-card">
                    <div className="product-image-container">
                      <img 
                        src={p.attributes?.imageUrl || p.attributes?.image_url || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60'} 
                        alt={p.name}
                        className="product-card-image"
                        loading="lazy"
                        onError={(e) => {
                          e.target.src = 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60';
                        }}
                      />
                    </div>
                    <h3>{p.name}</h3>
                    <p>{p.description}</p>
                    <div style={{ marginBottom: '10px', fontSize: '13px', fontWeight: 'bold', color: p.stock > 0 ? '#28a745' : '#dc3545' }}>
                      {p.stock > 0 ? `In Stock: ${p.stock}` : 'Out of Stock'}
                    </div>
                    <div className="product-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold' }}>₹{Number(p.price).toFixed(2)}</span>
                      <button 
                        onClick={() => addToCart(p)} 
                        disabled={p.stock <= 0}
                        style={{ 
                          padding: '6px 14px', 
                          background: p.stock <= 0 ? '#aaa' : '#007bff', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '4px', 
                          cursor: p.stock <= 0 ? 'not-allowed' : 'pointer', 
                          fontWeight: 'bold' 
                        }}
                      >
                        {p.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ==================================================== */}
        {/* CUSTOMER VIEW 2: CART                                */}
        {/* ==================================================== */}
        {!isSeller && activeTab === 'cart' && (
          <section className="tab-content">
            <h2>Your Shopping Cart</h2>
            {cart.length === 0 ? <p>Your cart is empty.</p> : (
              <div className="cart-container" style={{ background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                {cart.map(item => (
                  <div key={item.productId} className="cart-item" style={{ borderBottom: '1px solid #eee', padding: '15px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ margin: '0 0 5px 0' }}>{item.name}</h4>
                      <p style={{ margin: 0, color: '#666' }}>Qty: {item.quantity} | Unit: ₹{Number(item.price).toFixed(2)} | Total: ₹{(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                    <button style={{ padding: '6px 12px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }} onClick={() => removeFromCart(item.productId)}>Remove</button>
                  </div>
                ))}
                
                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>Grand Total: ₹{cartTotal.toFixed(2)}</div>
                  <button onClick={placeOrder} disabled={loading} style={{ padding: '12px 24px', background: '#28a745', color: 'white', fontSize: '16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {loading ? 'Processing Order...' : 'Proceed to Checkout 💳'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ==================================================== */}
        {/* CUSTOMER VIEW 3: ORDERS                              */}
        {/* ==================================================== */}
        {!isSeller && activeTab === 'orders' && (
          <section className="tab-content">
            <h2>My Orders</h2>
            {orders.length === 0 ? <p>No orders placed yet.</p> : (
              <div className="orders-list">
                {orders.map(order => {
                  const isPaid = order.status === 'Confirmed' || order.status === 'Processing' || order.status === 'Shipped' || order.status === 'Delivered';
                  const isPending = order.status === 'Awaiting_Payment' || order.status === 'Payment_Initiated';
                  const isFailed = order.status === 'Payment_Failed' || order.status === 'Cancelled';

                  return (
                    <div key={order.id} className="order-card" style={{ background: 'white', border: '1px solid #eee', padding: '20px', marginBottom: '15px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', paddingBottom: '10px', marginBottom: '10px' }}>
                        <h3 style={{ margin: 0 }}>Order #{order.id.substring(0, 8)}</h3>
                        <div>
                          <span className={`order-status ${isPaid ? 'badge-paid' : isFailed ? 'badge-failed' : 'badge-pending'}`}>
                            {order.status}
                          </span>
                        </div>
                      </div>

                      <div>
                        {order.items && order.items.map(item => (
                          <div key={item.id || item.product_id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                            <span>- {item.product_name} x{item.quantity}</span>
                            <span>₹{Number(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          Placed on: {new Date(order.created_at || Date.now()).toLocaleString()}
                        </span>
                        
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>
                            Total: ₹{Number(order.total).toFixed(2)}
                          </span>

                          {(isPending || order.status === 'Payment_Failed') && (
                            <button 
                              onClick={() => initiatePaymentForOrder(order)}
                              disabled={paymentProcessing}
                              style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              💳 Pay Now
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* ==================================================== */}
      {/* SELLER MODAL: ADD / EDIT PRODUCT                     */}
      {/* ==================================================== */}
      {showProductModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
              <button 
                onClick={() => setShowProductModal(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProduct}>
              <div className="form-group">
                <label>Product Name:</label>
                <input 
                  type="text" 
                  value={productForm.name} 
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} 
                  placeholder="e.g. Ergonomic Chair"
                  required 
                />
              </div>

              <div className="form-group">
                <label>Description:</label>
                <input 
                  type="text" 
                  value={productForm.description} 
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} 
                  placeholder="e.g. High-back mesh office chair"
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Price (₹):</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    value={productForm.price} 
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} 
                    placeholder="999.00"
                    required 
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Initial Stock:</label>
                  <input 
                    type="number" 
                    min="0" 
                    value={productForm.stock} 
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} 
                    placeholder="50"
                    required 
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Brand / Manufacturer:</label>
                <input 
                  type="text" 
                  value={productForm.brand} 
                  onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} 
                  placeholder="e.g. Logitech"
                />
              </div>

              <div className="form-group">
                <label>Product Picture (Cloudinary Upload or Image URL):</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                  <label 
                    style={{ 
                      padding: '8px 14px', 
                      background: uploadingImage ? '#94a3b8' : '#2563eb', 
                      color: 'white', 
                      borderRadius: '6px', 
                      cursor: uploadingImage ? 'not-allowed' : 'pointer', 
                      fontWeight: 'bold', 
                      fontSize: '13px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>{uploadingImage ? 'Uploading... ☁️' : '📁 Upload Image'}</span>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleImageUpload} 
                      disabled={uploadingImage} 
                      style={{ display: 'none' }} 
                    />
                  </label>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>or paste an image link below:</span>
                </div>
                <input 
                  type="url" 
                  value={productForm.imageUrl} 
                  onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })} 
                  placeholder="https://res.cloudinary.com/... or https://images.unsplash.com/..." 
                />
                {productForm.imageUrl && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img 
                      src={productForm.imageUrl} 
                      alt="Preview" 
                      style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600' }}>✓ Image preview active</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowProductModal(false)} 
                  style={{ flex: 1, padding: '10px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={productSubmitting} 
                  style={{ flex: 2, padding: '10px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  {productSubmitting ? 'Saving...' : editingProduct ? 'Update Product' : 'Add to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* CUSTOMER MODAL: RAZORPAY PAYMENT GATEWAY             */}
      {/* ==================================================== */}
      {activePaymentModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>💳</span>
                <h3 style={{ margin: 0, color: '#0f172a' }}>Razorpay Payment Gateway</h3>
              </div>
              <span 
                className="mock-badge" 
                style={activePaymentModal.paymentData.isRealRazorpay ? { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' } : {}}
              >
                {activePaymentModal.paymentData.isRealRazorpay ? 'Razorpay Live Test' : 'Mock Sandbox'}
              </span>
            </div>

            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', marginBottom: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b', fontSize: '13px' }}>Order Reference:</span>
                <span style={{ fontWeight: '600', fontSize: '13px' }}>#{activePaymentModal.order.id.substring(0, 8)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b', fontSize: '13px' }}>Razorpay Order ID:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{activePaymentModal.paymentData.gatewayOrderId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontSize: '13px' }}>Amount to Pay:</span>
                <span style={{ fontWeight: '700', color: '#16a34a', fontSize: '16px' }}>₹{Number(activePaymentModal.order.total).toFixed(2)}</span>
              </div>
            </div>

            {!paymentFeedback && (
              <>
                {activePaymentModal.paymentData.isRealRazorpay ? (
                  <div style={{ textAlign: 'center', padding: '10px 0' }}>
                    <p style={{ fontSize: '14px', color: '#475569', marginBottom: '15px' }}>
                      Official Razorpay test checkout is active. Complete payment via the official Razorpay modal.
                    </p>
                    <button
                      onClick={() => openRazorpayCheckout(activePaymentModal.order, activePaymentModal.paymentData)}
                      disabled={paymentProcessing}
                      style={{ width: '100%', padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '10px' }}
                    >
                      {paymentProcessing ? 'Processing...' : 'Open Razorpay Checkout 💳'}
                    </button>
                    <button
                      onClick={closePaymentModal}
                      style={{ width: '100%', padding: '10px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      Pay Later / Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '5px' }}>Select Payment Method:</div>
                    <div className="payment-method-selector">
                      <button 
                        className={`payment-method-btn ${selectedPaymentMethod === 'mock_card' ? 'selected' : ''}`}
                        onClick={() => setSelectedPaymentMethod('mock_card')}
                      >
                        Credit / Debit Card
                      </button>
                      <button 
                        className={`payment-method-btn ${selectedPaymentMethod === 'mock_upi' ? 'selected' : ''}`}
                        onClick={() => setSelectedPaymentMethod('mock_upi')}
                      >
                        UPI / QR Code
                      </button>
                      <button 
                        className={`payment-method-btn ${selectedPaymentMethod === 'mock_netbanking' ? 'selected' : ''}`}
                        onClick={() => setSelectedPaymentMethod('mock_netbanking')}
                      >
                        Net Banking
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                      <button 
                        onClick={() => handleSimulatePayment('success')}
                        disabled={paymentProcessing}
                        style={{ flex: 1, padding: '12px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        {paymentProcessing ? 'Processing...' : 'Simulate Success ✅'}
                      </button>
                      <button 
                        onClick={() => handleSimulatePayment('failure')}
                        disabled={paymentProcessing}
                        style={{ flex: 1, padding: '12px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        {paymentProcessing ? 'Processing...' : 'Simulate Failure ❌'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {paymentFeedback && (
              <div style={{ marginTop: '15px', padding: '15px', borderRadius: '8px', background: paymentFeedback.type === 'success' ? '#dcfce7' : '#fee2e2', color: paymentFeedback.type === 'success' ? '#166534' : '#991b1b', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>
                  {paymentFeedback.type === 'success' ? '🎉' : '⚠️'}
                </div>
                <h4 style={{ margin: '0 0 5px 0' }}>{paymentFeedback.message}</h4>
                <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>Txn ID: {paymentFeedback.transactionId}</div>
                <button 
                  onClick={closePaymentModal}
                  style={{ marginTop: '15px', padding: '8px 24px', background: paymentFeedback.type === 'success' ? '#166534' : '#991b1b', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Done & View Orders
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
