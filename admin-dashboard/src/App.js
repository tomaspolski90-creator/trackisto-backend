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

  // Navigation state
  const [currentPage, setCurrentPage] = useState('dashboard');

  // Dashboard state
  const [dashboardTab, setDashboardTab] = useState('recent');
  const [shipments, setShipments] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [fulfilledOrders, setFulfilledOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('all');
  const [stats, setStats] = useState({ total: 0, today: 0, pending: 0 });
  const [loading, setLoading] = useState(false);

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
        fetchFulfilledOrders()
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

  const fetchPendingOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shopify/pending-orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPendingOrders(data.orders || []);
        setStats(prev => ({ ...prev, pending: (data.orders || []).length }));
      }
    } catch (error) {
      console.error('Error fetching pending orders:', error);
    }
  };

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

    try {
      const response = await fetch(`${API_URL}/api/shopify/fetch-and-fulfill`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Success! Fulfilled ${data.fulfilled} orders.`);
        await fetchDashboardData();
      } else {
        alert(data.error || 'Failed to fulfill orders');
      }
    } catch (error) {
      console.error('Error fulfilling orders:', error);
      alert('Connection error. Please try again.');
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
          <p>Admin Dashboard</p>
          
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

            {loginError && <p style={{ color: 'red', marginBottom: '15px' }}>{loginError}</p>}

            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          
          <p className="hint">Demo: admin / admin123</p>
        </div>
      </div>
    );
  }

  // Main App with Sidebar
  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo">
          <h2>🚚 Trackisto</h2>
        </div>
        
        <p className="nav-title">Navigation</p>
        <ul className="nav-menu">
          <li 
            className={currentPage === 'dashboard' ? 'active' : ''} 
            onClick={() => setCurrentPage('dashboard')}
          >
            📊 Dashboard
          </li>
          <li 
            className={currentPage === 'shipments' ? 'active' : ''} 
            onClick={() => setCurrentPage('shipments')}
          >
            📦 All Shipments
          </li>
          <li 
            className={currentPage === 'stores' ? 'active' : ''} 
            onClick={() => setCurrentPage('stores')}
          >
            🏪 Shopify Stores
          </li>
          <li 
            className={currentPage === 'manual' ? 'active' : ''} 
            onClick={() => setCurrentPage('manual')}
          >
            ✏️ Manual Entry
          </li>
        </ul>

        <div className="nav-bottom">
          <div className="user-info">
            Logged in as: {user?.username}
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        
        {/* Dashboard Page */}
        {currentPage === 'dashboard' && (
          <>
            <h1>Dashboard Overview</h1>

            {/* Stats Cards */}
            <div className="stats-grid">
              <div className="stat-card blue">
                <h3>Total Shipments</h3>
                <div className="stat-number">{stats.total}</div>
              </div>
              <div className="stat-card green">
                <h3>Today's Shipments</h3>
                <div className="stat-number">{stats.today}</div>
              </div>
              <div className="stat-card orange">
                <h3>Pending Orders</h3>
                <div className="stat-number">{pendingOrders.length}</div>
              </div>
            </div>

            {/* Dashboard Tabs */}
            <div className="dashboard-tabs">
              <button 
                className={`tab-btn ${dashboardTab === 'recent' ? 'active' : ''}`}
                onClick={() => setDashboardTab('recent')}
              >
                Recent Shipments
              </button>
              <button 
                className={`tab-btn ${dashboardTab === 'pending' ? 'active' : ''}`}
                onClick={() => setDashboardTab('pending')}
              >
                Pending Shipments
              </button>
              <button 
                className={`tab-btn ${dashboardTab === 'fulfilled' ? 'active' : ''}`}
                onClick={() => setDashboardTab('fulfilled')}
              >
                Fulfilled Shipments
              </button>

              <div className="store-filter">
                <select 
                  value={selectedStore} 
                  onChange={(e) => setSelectedStore(e.target.value)}
                >
                  <option value="all">All Stores</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.domain}>{s.domain}</option>
                  ))}
                </select>
              </div>

              <button 
                className="refresh-btn" 
                onClick={fetchDashboardData} 
                disabled={loading}
              >
                🔄 Refresh
              </button>

              {dashboardTab === 'pending' && (
                <button 
                  className="fetch-btn"
                  onClick={fetchAndFulfillOrders}
                  disabled={loading || pendingOrders.length === 0}
                >
                  <span className="fetch-icon">⬇</span>
                  Fetch Pending Parcels
                </button>
              )}
            </div>

            {/* Recent Shipments Tab */}
            {dashboardTab === 'recent' && (
              <div className="recent-shipments">
                <h2>Recent Shipments</h2>
                {shipments.length === 0 ? (
                  <p className="no-data">No shipments found</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Tracking #</th>
                        <th>Customer</th>
                        <th>Country</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shipments.map(shipment => (
                        <tr key={shipment.id}>
                          <td>{shipment.tracking_number}</td>
                          <td>{shipment.customer_name}</td>
                          <td>{shipment.country}</td>
                          <td>
                            <span className={`status ${shipment.status}`}>
                              {shipment.status}
                            </span>
                          </td>
                          <td>{formatDate(shipment.created_at)}</td>
                          <td>
                            <button 
                              className="btn-small"
                              onClick={() => window.open(`https://grand-sorbet-268b5e.netlify.app/?tracking=${shipment.tracking_number}`, '_blank')}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Pending Shipments Tab */}
            {dashboardTab === 'pending' && (
              <div className="pending-shipments">
                <h2>Pending Shipments (Unfulfilled Orders)</h2>
                {loading ? (
                  <p className="loading-state">Loading...</p>
                ) : filterByStore(pendingOrders).length === 0 ? (
                  <p className="no-data">🎉 No pending orders - all orders are fulfilled!</p>
                ) : (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Customer</th>
                          <th>Country</th>
                          <th>Amount</th>
                          <th>Order Date</th>
                          <th>Fulfillment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterByStore(pendingOrders).map(order => (
                          <tr key={order.id}>
                            <td>#{order.order_number}</td>
                            <td>{order.customer_name}</td>
                            <td>{order.country}</td>
                            <td>{formatCurrency(order.total_price, order.currency)}</td>
                            <td>{formatDate(order.created_at)}</td>
                            <td>
                              <span className="fulfillment-status unfulfilled">
                                unfulfilled
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="pending-info">
                      Showing {filterByStore(pendingOrders).length} unfulfilled orders
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Fulfilled Shipments Tab */}
            {dashboardTab === 'fulfilled' && (
              <div className="pending-shipments">
                <h2>Fulfilled Shipments</h2>
                {loading ? (
                  <p className="loading-state">Loading...</p>
                ) : filterByStore(fulfilledOrders).length === 0 ? (
                  <p className="no-data">No fulfilled orders found</p>
                ) : (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Customer</th>
                          <th>Country</th>
                          <th>Amount</th>
                          <th>Order Date</th>
                          <th>Fulfillment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterByStore(fulfilledOrders).map(order => (
                          <tr key={order.id}>
                            <td>#{order.order_number}</td>
                            <td>{order.customer_name}</td>
                            <td>{order.country}</td>
                            <td>{formatCurrency(order.total_price, order.currency)}</td>
                            <td>{formatDate(order.created_at)}</td>
                            <td>
                              <span className="fulfillment-status fulfilled">
                                fulfilled
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="pending-info">
                      Showing {filterByStore(fulfilledOrders).length} fulfilled orders
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* All Shipments Page */}
        {currentPage === 'shipments' && (
          <div className="shipments">
            <h1>All Shipments</h1>
            {shipments.length === 0 ? (
              <p className="no-data">No shipments found</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tracking #</th>
                    <th>Customer</th>
                    <th>Email</th>
                    <th>Country</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map(shipment => (
                    <tr key={shipment.id}>
                      <td>{shipment.tracking_number}</td>
                      <td>{shipment.customer_name}</td>
                      <td>{shipment.customer_email || '-'}</td>
                      <td>{shipment.country}</td>
                      <td>
                        <span className={`status ${shipment.status}`}>
                          {shipment.status}
                        </span>
                      </td>
                      <td>{formatDate(shipment.created_at)}</td>
                      <td>
                        <button 
                          className="btn-small"
                          onClick={() => window.open(`https://grand-sorbet-268b5e.netlify.app/?tracking=${shipment.tracking_number}`, '_blank')}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Stores Page */}
        {currentPage === 'stores' && (
          <div className="shopify-settings">
            <h1>Shopify Stores</h1>
            <p className="description">Connect and manage your Shopify stores</p>

            <button className="btn-add-store" onClick={connectShopify}>
              + Connect New Shopify Store
            </button>

            <div className="stores-table">
              <h2>Connected Stores</h2>
              {stores.length === 0 ? (
                <p className="no-stores">No stores connected yet</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Store Domain</th>
                      <th>Delivery Days</th>
                      <th>Fulfillment Time</th>
                      <th>Origin Country</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map(store => (
                      <tr key={store.id}>
                        <td>{store.domain}</td>
                        <td>{store.delivery_days || 7}</td>
                        <td>{store.fulfillment_time || '16:00'}</td>
                        <td>{store.country_origin || 'United Kingdom'}</td>
                        <td>
                          <span className={`status-indicator ${store.status || 'active'}`}>
                            {store.status === 'active' ? '✓' : '✗'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Manual Entry Page */}
        {currentPage === 'manual' && (
          <div className="manual-entry">
            <h1>Manual Shipment Entry</h1>
            <div className="manual-entry-container">
              <div className="manual-entry-info">
                <p><strong>Manual Entry:</strong> Use this form to create shipments manually without Shopify integration.</p>
                <p>This is useful for orders from other platforms or custom shipments.</p>
              </div>
              
              <div className="manual-form">
                <p className="no-data">Manual entry form coming soon...</p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
