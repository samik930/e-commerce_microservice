import { useState, useEffect } from 'react';
import './App.css';

// API Gateway route
const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('products');

  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [isLogin, setIsLogin] = useState(true);

  // MOCK PAYMENT MODAL STATE
  const [activePaymentModal, setActivePaymentModal] = useState(null); // { order, paymentData }
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('mock_card');
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentFeedback, setPaymentFeedback] = useState(null);

  // CHECK AUTH SESSION FROM HTTPONLY COOKIE ON MOUNT
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setIsLoggedIn(true);
      } else {
        setUser(null);
        setIsLoggedIn(false);
      }
    } catch (err) {
      console.error('Session check failed:', err);
      setUser(null);
      setIsLoggedIn(false);
    } finally {
      setCheckingAuth(false);
    }
  };

  // AUTO LOAD AFTER LOGIN
  useEffect(() => {
    if (isLoggedIn) {
      fetchProducts();
      fetchOrders();
      fetchCart();
    }
  }, [isLoggedIn]);

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
      console.error(err);
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

  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: authForm.email, password: authForm.password }
        : { name: authForm.name, email: authForm.email, password: authForm.password };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        const userData = data.user || { name: authForm.email };
        setIsLoggedIn(true);
        setUser(userData);
        setAuthForm({ email: '', password: '', name: '' });
        setActiveTab('products');
      } else {
        setError(data.message || 'Authentication failed');
      }
    } catch (err) {
      setError('Authentication error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product) => {
    setCart((prevCart) => {
      let updated;
      const existing = prevCart.find(item => item.productId === product.id);
      if (existing) {
        updated = prevCart.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      } else {
        updated = [...prevCart, { productId: product.id, name: product.name, price: Number(product.price), quantity: 1 }];
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
      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ items: cart })
      });
      
      if (response.ok) {
        const createdOrder = await response.json();
        setCart([]);
        fetchOrders();
        // Immediately initiate payment flow
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

  // INITIATE MOCK PAYMENT
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
      } else {
        alert('Payment initiation failed: ' + (resData.message || 'Server error'));
      }
    } catch (err) {
      console.error('Error initiating payment:', err);
      alert('Payment network error: ' + err.message);
    } finally {
      setPaymentProcessing(false);
    }
  };

  // SIMULATE PAYMENT PROCESSING (Success or Failure)
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
    setActiveTab('orders');
    fetchOrders();
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
          <h1>Microservice Platform</h1>
          <div className="auth-toggle">
            <button className={isLogin ? 'active' : ''} onClick={() => setIsLogin(true)}>Login</button>
            <button className={!isLogin ? 'active' : ''} onClick={() => setIsLogin(false)}>Register</button>
          </div>
          <form onSubmit={handleAuth}>
            {!isLogin && (
              <div className="form-group">
                <label>Name:</label>
                <input type="text" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} required={!isLogin} />
              </div>
            )}
            <div className="form-group">
              <label>Email:</label>
              <input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Loading...' : isLogin ? 'Login' : 'Register'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-container">
      <nav className="navbar">
        <div className="nav-brand">
          <h1>Microservices Dashboard</h1>
          <p>Welcome, {user?.name || 'User'}!</p>
        </div>
        <div className="nav-tabs">
          <button className={activeTab === 'products' ? 'active' : ''} onClick={() => setActiveTab('products')}>Products</button>
          <button className={activeTab === 'cart' ? 'active' : ''} onClick={() => setActiveTab('cart')}>Cart ({cartItemsCount})</button>
          <button className={activeTab === 'orders' ? 'active' : ''} onClick={() => setActiveTab('orders')}>Orders</button>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      <main className="main-content">
        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'products' && (
          <section className="tab-content">
            <h2>Products</h2>
            {loading && products.length === 0 ? <p>Loading...</p> : (
              <div className="products-grid">
                {products.map((p) => (
                  <div key={p.id} className="product-card">
                    <h3>{p.name}</h3>
                    <p>{p.description}</p>
                    <div className="product-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold' }}>₹{Number(p.price).toFixed(2)}</span>
                      <button onClick={() => addToCart(p)} style={{ padding: '6px 14px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Add to Cart</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'cart' && (
          <section className="tab-content">
            <h2>Your Cart</h2>
            {cart.length === 0 ? <p>Cart is empty.</p> : (
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

        {activeTab === 'orders' && (
          <section className="tab-content">
            <h2>Your Orders</h2>
            {orders.length === 0 ? <p>No orders yet.</p> : (
              <div className="orders-list">
                {orders.map(order => {
                  const isPaid = order.status === 'Paid';
                  const isPending = order.status === 'Pending_Payment' || order.status === 'Placed';
                  const isFailed = order.status === 'Payment_Failed';

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
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
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

                          {(isPending || isFailed) && (
                            <button
                              onClick={() => initiatePaymentForOrder(order)}
                              style={{
                                padding: '8px 16px',
                                background: isFailed ? '#dc3545' : '#ff9900',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                              }}
                            >
                              {isFailed ? 'Retry Payment 💳' : 'Pay Now 💳'}
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

      {/* MOCK PAYMENT GATEWAY MODAL */}
      {activePaymentModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0 }}>Razorpay Gateway</h3>
                <span className="mock-badge">DEV MOCK</span>
              </div>
              <button onClick={closePaymentModal} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>

            {paymentFeedback ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                {paymentFeedback.type === 'success' ? (
                  <div>
                    <div style={{ fontSize: '48px', color: '#28a745', marginBottom: '10px' }}>✓</div>
                    <h3 style={{ color: '#28a745', marginBottom: '8px' }}>Payment Successful!</h3>
                    <p style={{ color: '#666', fontSize: '14px', marginBottom: '15px' }}>{paymentFeedback.message}</p>
                    <p style={{ fontSize: '12px', background: '#f8f9fa', padding: '8px', borderRadius: '4px', color: '#333' }}>
                      Txn ID: <strong>{paymentFeedback.transactionId}</strong>
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '48px', color: '#dc3545', marginBottom: '10px' }}>✕</div>
                    <h3 style={{ color: '#dc3545', marginBottom: '8px' }}>Payment Failed</h3>
                    <p style={{ color: '#666', fontSize: '14px', marginBottom: '15px' }}>{paymentFeedback.message}</p>
                  </div>
                )}
                
                <button
                  onClick={closePaymentModal}
                  style={{ marginTop: '20px', width: '100%', padding: '12px', background: '#007bff', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Return to Dashboard
                </button>
              </div>
            ) : (
              <div>
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', marginBottom: '15px', fontSize: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Order ID:</span>
                    <strong>#{activePaymentModal.order.id.substring(0, 8)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Mock Gateway Order:</span>
                    <strong style={{ fontSize: '12px' }}>{activePaymentModal.paymentData.razorpayMock?.order_id}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 'bold', marginTop: '8px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                    <span>Amount Payable:</span>
                    <span style={{ color: '#2563eb' }}>₹{Number(activePaymentModal.order.total).toFixed(2)}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '15px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>Select Payment Method:</label>
                  <div className="payment-method-selector">
                    <button
                      className={`payment-method-btn ${selectedPaymentMethod === 'mock_card' ? 'selected' : ''}`}
                      onClick={() => setSelectedPaymentMethod('mock_card')}
                    >
                      💳 Credit/Debit Card
                    </button>
                    <button
                      className={`payment-method-btn ${selectedPaymentMethod === 'mock_upi' ? 'selected' : ''}`}
                      onClick={() => setSelectedPaymentMethod('mock_upi')}
                    >
                      📱 UPI / QR
                    </button>
                    <button
                      className={`payment-method-btn ${selectedPaymentMethod === 'mock_netbanking' ? 'selected' : ''}`}
                      onClick={() => setSelectedPaymentMethod('mock_netbanking')}
                    >
                      🏦 Net Banking
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                  <button
                    disabled={paymentProcessing}
                    onClick={() => handleSimulatePayment('success')}
                    style={{
                      padding: '12px',
                      background: '#16a34a',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 'bold',
                      fontSize: '15px',
                      cursor: 'pointer'
                    }}
                  >
                    {paymentProcessing ? 'Processing...' : 'Simulate Successful Payment ✓'}
                  </button>

                  <button
                    disabled={paymentProcessing}
                    onClick={() => handleSimulatePayment('failure')}
                    style={{
                      padding: '10px',
                      background: '#fee2e2',
                      color: '#dc2626',
                      border: '1px solid #fca5a5',
                      borderRadius: '6px',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      cursor: 'pointer'
                    }}
                  >
                    Simulate Failed Payment ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;