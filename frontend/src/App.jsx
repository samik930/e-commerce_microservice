import { useState, useEffect } from 'react';
import './App.css';

// API Gateway route
const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('products');

  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [isLogin, setIsLogin] = useState(true);

  // AUTO LOAD AFTER LOGIN
  useEffect(() => {
    if (token) {
      setUser({ authenticated: true });
      fetchProducts();
      fetchOrders();
    }
  }, [token]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/products`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setProducts(data || []);
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
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setOrders(data || []);
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
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser({ name: data.user?.name || authForm.email, authenticated: true });
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
      const existing = prevCart.find(item => item.productId === product.id);
      if (existing) {
        return prevCart.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prevCart, { productId: product.id, name: product.name, price: Number(product.price), quantity: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const placeOrder = async () => {
    if (cart.length === 0) return alert('Cart is empty!');
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ items: cart })
      });
      if (response.ok) {
        const data = await response.json();
        setOrders([data, ...orders]);
        setCart([]);
        setActiveTab('orders');
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

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setOrders([]);
    setProducts([]);
    setCart([]);
  };

  if (!token) {
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
                      <button onClick={() => addToCart(p)} style={{ padding: '5px 10px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add to Cart</button>
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
                  <button onClick={placeOrder} disabled={loading} style={{ padding: '12px 24px', background: '#28a745', color: 'white', fontSize: '16px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    {loading ? 'Placing Order...' : 'Place Order'}
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
                {orders.map(order => (
                  <div key={order.id} className="order-card" style={{ background: 'white', border: '1px solid #eee', padding: '20px', marginBottom: '15px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', paddingBottom: '10px', marginBottom: '10px' }}>
                      <h3 style={{ margin: 0 }}>Order #{order.id}</h3>
                      <span style={{ fontWeight: 'bold', color: order.status === 'Placed' ? 'green' : 'black' }}>{order.status}</span>
                    </div>
                    <div>
                      {order.items && order.items.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span>- {item.product_name} x{item.quantity}</span>
                          <span>₹{Number(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '15px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px' }}>
                      Total: ₹{Number(order.total).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;