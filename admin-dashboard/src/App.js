import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://trackisto-backend.onrender.com';

function App() {
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // Dashboard state
  const [dashboardTab, setDashboardTab] = useState('recent'); // 'recent', 'pending', 'fulfilled'
  const [shipments, setShipments] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [fulfilledOrders, setFulfilledOrders] = useState([]); // NY STATE
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('all');
  const [stats, setStats] = useState({ total: 0, today: 0, pending: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Navigation state
  const [currentPage, setCurrentPage] = useState('dashboard'); // 'dashboard', 'stores', 'settings'

  // Check auth on mount
  useEffect(() => {
    if (token) {
      verifyToken();
    }
  }, []);

  // Fetch data when logged in
  useEffect(() => {
    if (isLoggedIn && token) {
      fetchDashboardData();
    }
  }, [isLoggedIn, token]);

  const verifyToken = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem('token');
        setToken('');
        setIsLoggedIn(false);
      }
    } catch (error) {
      console.error('Token verification error:', error);
      localStorage.removeItem('token');
      setToken('');
      setIsLoggedIn(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        setIsLoggedIn(true);
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setIsLoggedIn(false);
    setShipments([]);
    setPendingOrders([]);
    setFulfilledOrders([]);
    setStores([]);
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchShipments(),
        fetchStats(),
        fetchStores(),
        fetchPendingOrders(),
        fetchFulfilledOrders() // NY FETCH
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchShipments = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shipments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setShipments(data.shipments || []);
      }
    } catch (error) {
      console.error('Error fetching shipments:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shipments/stats/dashboard`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchStores = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shopify/stores`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setStores(data.stores || []);
      }
    } catch (error) {
      console.error('Error fetching stores:', error);
    }
  };

  // OPDATERET: Henter kun unfulfilled ordrer
  const fetchPendingOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shopify/pending-orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPendingOrders(data.orders || []);
        // Opdater pending count i stats
        setStats(prev => ({ ...prev, pending: (data.orders || []).length }));
      }
    } catch (error) {
      console.error('Error fetching pending orders:', error);
    }
  };

  // NY FUNKTION: Henter fulfilled ordrer
  const fetchFulfilledOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shopify/fulfilled-orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setFulfilledOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Error fetching fulfilled orders:', error);
    }
  };

  const fetchAndFulfillOrders = async () => {
    if (!window.confirm('This will fulfill ALL pending orders and send tracking emails to customers. Continue?')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/shopify/fetch-and-fulfill`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Success! Fulfilled ${data.fulfilled} orders.`);
        // Refresh all data
        await fetchDashboardData();
      } else {
        setError(data.error || 'Failed to fulfill orders');
      }
    } catch (error) {
      console.error('Error fulfilling orders:', error);
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const connectShopify = () => {
    const shop = prompt('Enter your Shopify store domain (e.g., mystore.myshopify.com):');
    if (shop) {
      window.location.href = `${API_URL}/api/shopify/auth?shop=${shop}`;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('da-DK');
  };

  const formatCurrency = (amount, currency = 'EUR') => {
    return `${currency} ${parseFloat(amount).toFixed(2)}`;
  };

  // Filter orders by selected store
  const filterByStore = (orders) => {
    if (selectedStore === 'all') return orders;
    return orders.filter(order => order.store_domain === selectedStore);
  };

  // Login Page
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>🚚 Trackisto</h1>
          <h2>Admin Login</h2>
          
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                placeholder="Enter username"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="Enter password"
                required
              />
            </div>

            {loginError && <div className="error-message">{loginError}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>🚚 Trackisto</h1>
        </div>
        <nav className="header-nav">
          <button 
            className={currentPage === 'dashboard' ? 'active' : ''} 
            onClick={() => setCurrentPage('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={currentPage === 'stores' ? 'active' : ''} 
            onClick={() => setCurrentPage('stores')}
          >
            Stores
          </button>
        </nav>
        <div className="header-right">
          <span>Welcome, {user?.username}</span>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {error && <div className="error-banner">{error}</div>}

        {currentPage === 'dashboard' && (
          <>
            <h2>Dashboard Overview</h2>

            {/* Stats Cards */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">TOTAL SHIPMENTS</div>
                <div className="stat-value">{stats.total}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">TODAY'S SHIPMENTS</div>
                <div className="stat-value">{stats.today}</div>
              </div>
              <div className="stat-card pending">
                <div className="stat-label">PENDING ORDERS</div>
                <div className="stat-value">{pendingOrders.length}</div>
              </div>
            </div>

            {/* Tab Navigation - OPDATERET MED 3 TABS */}
            <div className="dashboard-tabs">
              <button 
                className={dashboardTab === 'recent' ? 'active' : ''} 
                onClick={() => setDashboardTab('recent')}
              >
                Recent Shipments
              </button>
              <button 
                className={dashboardTab === 'pending' ? 'active' : ''} 
                onClick={() => setDashboardTab('pending')}
              >
                Pending Shipments
              </button>
              <button 
                className={dashboardTab === 'fulfilled' ? 'active' : ''} 
                onClick={() => setDashboardTab('fulfilled')}
              >
                Fulfilled Shipments
              </button>

              <select 
                value={selectedStore} 
                onChange={(e) => setSelectedStore(e.target.value)}
                className="store-filter"
              >
                <option value="all">All Stores</option>
                {stores.map(s => (
                  <option key={s.id} value={s.domain}>{s.domain}</option>
                ))}
              </select>

              <button onClick={fetchDashboardData} className="refresh-btn" disabled={loading}>
                🔄 Refresh
              </button>

              {dashboardTab === 'pending' && (
                <button 
                  onClick={fetchAndFulfillOrders} 
                  className="fetch-btn"
                  disabled={loading || pendingOrders.length === 0}
                >
                  ⬇ Fetch Pending Parcels
                </button>
              )}
            </div>

            {/* Recent Shipments Tab */}
            {dashboardTab === 'recent' && (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TRACKING #</th>
                      <th>CUSTOMER</th>
                      <th>COUNTRY</th>
                      <th>STATUS</th>
                      <th>CREATED</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="empty-state">No shipments found</td>
                      </tr>
                    ) : (
                      shipments.map(shipment => (
                        <tr key={shipment.id}>
                          <td className="tracking-number">{shipment.tracking_number}</td>
                          <td>{shipment.customer_name}</td>
                          <td>{shipment.country}</td>
                          <td>
                            <span className={`status-badge ${shipment.status}`}>
                              {shipment.status}
                            </span>
                          </td>
                          <td>{formatDate(shipment.created_at)}</td>
                          <td>
                            <button 
                              className="view-btn"
                              onClick={() => window.open(`https://grand-sorbet-268b5e.netlify.app/?tracking=${shipment.tracking_number}`, '_blank')}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pending Shipments Tab - OPDATERET */}
            {dashboardTab === 'pending' && (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ORDER #</th>
                      <th>CUSTOMER</th>
                      <th>COUNTRY</th>
                      <th>AMOUNT</th>
                      <th>ORDER DATE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterByStore(pendingOrders).length === 0 ? (
                      <tr>
                        <td colSpan="6" className="empty-state">
                          🎉 No pending orders - all orders are fulfilled!
                        </td>
                      </tr>
                    ) : (
                      filterByStore(pendingOrders).map(order => (
                        <tr key={order.id}>
                          <td>#{order.order_number}</td>
                          <td>{order.customer_name}</td>
                          <td>{order.country}</td>
                          <td>{formatCurrency(order.total_price, order.currency)}</td>
                          <td>{formatDate(order.created_at)}</td>
                          <td>
                            <span className="status-badge unfulfilled">
                              unfulfilled
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fulfilled Shipments Tab - NY TAB */}
            {dashboardTab === 'fulfilled' && (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ORDER #</th>
                      <th>CUSTOMER</th>
                      <th>COUNTRY</th>
                      <th>AMOUNT</th>
                      <th>ORDER DATE</th>
                      <th>FULFILLMENT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterByStore(fulfilledOrders).length === 0 ? (
                      <tr>
                        <td colSpan="6" className="empty-state">No fulfilled orders found</td>
                      </tr>
                    ) : (
                      filterByStore(fulfilledOrders).map(order => (
                        <tr key={order.id}>
                          <td>#{order.order_number}</td>
                          <td>{order.customer_name}</td>
                          <td>{order.country}</td>
                          <td>{formatCurrency(order.total_price, order.currency)}</td>
                          <td>{formatDate(order.created_at)}</td>
                          <td>
                            <span className="status-badge fulfilled">
                              fulfilled
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Stores Page */}
        {currentPage === 'stores' && (
          <>
            <h2>Connected Stores</h2>
            
            <button onClick={connectShopify} className="connect-btn">
              + Connect Shopify Store
            </button>

            <div className="stores-grid">
              {stores.length === 0 ? (
                <div className="empty-state">No stores connected yet</div>
              ) : (
                stores.map(store => (
                  <div key={store.id} className="store-card">
                    <div className="store-header">
                      <h3>{store.domain}</h3>
                      <span className={`status-indicator ${store.status}`}>
                        {store.status}
                      </span>
                    </div>
                    <div className="store-details">
                      <p><strong>Delivery Days:</strong> {store.delivery_days || 7}</p>
                      <p><strong>Fulfillment Time:</strong> {store.fulfillment_time || '16:00'}</p>
                      <p><strong>Origin:</strong> {store.country_origin || 'United Kingdom'}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
