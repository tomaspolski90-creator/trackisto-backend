import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://trackisto-backend.onrender.com';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [shipments, setShipments] = useState([]);
  const [stores, setStores] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({
    total: 0,
    today: 0,
    pending: 0
  });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [storeForm, setStoreForm] = useState({
    domain: '',
    api_token: '',
    delivery_days: 7,
    send_offset: 0,
    country_origin: 'United Kingdom',
    transit_country: '',
    post_delivery_event: 'None',
    sorting_days: 3,
    parcel_point: true,
    parcel_point_days: 3,
    redelivery_active: false,
    redelivery_days: 3,
    attempts: 1
  });
  const [pasteUrl, setPasteUrl] = useState('');

  const countries = [
    'United Kingdom', 'Germany', 'Netherlands', 'Denmark', 'France', 
    'Belgium', 'Italy', 'Spain', 'Poland', 'Sweden', 'Norway',
    'Austria', 'Switzerland', 'Ireland', 'Portugal', 'Czech Republic',
    'Finland', 'Greece', 'Hungary', 'Romania', 'United States', 'Canada'
  ];

  const postDeliveryEvents = ['None', 'Survey Email', 'Review Request', 'Thank You Email'];

  useEffect(() => {
    if (token) {
      setIsLoggedIn(true);
      fetchDashboardData();
    }
  }, [token]);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, shipmentsRes, storesRes] = await Promise.all([
        fetch(`${API_URL}/api/shipments/stats/dashboard`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/shipments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/shopify/stores`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (statsRes.ok) {
        const stats = await statsRes.json();
        setDashboardStats(stats);
      }

      if (shipmentsRes.ok) {
        const data = await shipmentsRes.json();
        setShipments(data.shipments || []);
      }

      if (storesRes.ok) {
        const data = await storesRes.json();
        setStores(data.stores || []);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setIsLoggedIn(true);
      } else {
        alert('Login failed: ' + data.message);
      }
    } catch (error) {
      alert('Login failed: ' + error.message);
    }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setIsLoggedIn(false);
    setCurrentPage('dashboard');
  };

  const extractDomainFromUrl = (url) => {
    // Extract domain from Shopify admin URL like https://admin.shopify.com/store/your-store/...
    const match = url.match(/admin\.shopify\.com\/store\/([^\/]+)/);
    if (match) {
      return `${match[1]}.myshopify.com`;
    }
    // Also handle direct myshopify.com URLs
    const directMatch = url.match(/([^\/]+\.myshopify\.com)/);
    if (directMatch) {
      return directMatch[1];
    }
    return '';
  };

  const handleConvertUrl = () => {
    const domain = extractDomainFromUrl(pasteUrl);
    if (domain) {
      setStoreForm({ ...storeForm, domain });
      setPasteUrl('');
    } else {
      alert('Could not extract domain from URL. Please enter it manually.');
    }
  };

  const resetStoreForm = () => {
    setStoreForm({
      domain: '',
      api_token: '',
      delivery_days: 7,
      send_offset: 0,
      country_origin: 'United Kingdom',
      transit_country: '',
      post_delivery_event: 'None',
      sorting_days: 3,
      parcel_point: true,
      parcel_point_days: 3,
      redelivery_active: false,
      redelivery_days: 3,
      attempts: 1
    });
    setEditingStore(null);
  };

  const handleAddStore = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = editingStore 
        ? `${API_URL}/api/shopify/stores/${editingStore.id}`
        : `${API_URL}/api/shopify/stores`;
      
      const response = await fetch(url, {
        method: editingStore ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(storeForm)
      });

      if (response.ok) {
        fetchDashboardData();
        setShowAddStore(false);
        resetStoreForm();
      } else {
        const data = await response.json();
        alert('Failed to save store: ' + data.message);
      }
    } catch (error) {
      alert('Failed to save store: ' + error.message);
    }
    setLoading(false);
  };

  const handleEditStore = (store) => {
    setStoreForm({
      domain: store.domain || '',
      api_token: store.api_token || '',
      delivery_days: store.delivery_days || 7,
      send_offset: store.send_offset || 0,
      country_origin: store.country_origin || 'United Kingdom',
      transit_country: store.transit_country || '',
      post_delivery_event: store.post_delivery_event || 'None',
      sorting_days: store.sorting_days || 3,
      parcel_point: store.parcel_point !== false,
      parcel_point_days: store.parcel_point_days || 3,
      redelivery_active: store.redelivery_active || false,
      redelivery_days: store.redelivery_days || 3,
      attempts: store.attempts || 1
    });
    setEditingStore(store);
    setShowAddStore(true);
  };

  const handleDeleteStore = async (storeId) => {
    if (!window.confirm('Are you sure you want to delete this store?')) return;
    
    try {
      const response = await fetch(`${API_URL}/api/shopify/stores/${storeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchDashboardData();
      } else {
        alert('Failed to delete store');
      }
    } catch (error) {
      alert('Failed to delete store: ' + error.message);
    }
  };

  const toggleStoreStatus = async (store) => {
    try {
      const newStatus = store.status === 'active' ? 'inactive' : 'active';
      const response = await fetch(`${API_URL}/api/shopify/stores/${store.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error('Failed to toggle store status:', error);
    }
  };

  // Login Screen
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>📦 Trackisto</h1>
          <p>Admin Dashboard</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <p className="hint">Default: admin / admin123</p>
        </div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <h2>📦 Trackisto</h2>
        </div>
        <div className="nav-title">Navigation</div>
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
            📦 Manual Entry
          </li>
          <li 
            className={currentPage === 'missing' ? 'active' : ''}
            onClick={() => setCurrentPage('missing')}
          >
            ⏳ Missing Entries
          </li>
          <li 
            className={currentPage === 'shopify' ? 'active' : ''}
            onClick={() => setCurrentPage('shopify')}
          >
            🛒 Shopify Settings
          </li>
        </ul>
        <div className="nav-bottom">
          <div className="nav-item" onClick={() => setCurrentPage('api')}>
            📖 API Guide
          </div>
          <div className="user-info">
            Logged in as <strong>admin</strong>
            <button className="logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      <main className="main-content">
        {currentPage === 'dashboard' && (
          <div className="dashboard">
            <h1>Dashboard Overview</h1>
            <div className="stats-grid">
              <div className="stat-card blue">
                <h3>TOTAL SHIPMENTS</h3>
                <p className="stat-number">{dashboardStats.total}</p>
              </div>
              <div className="stat-card green">
                <h3>TODAY'S SHIPMENTS</h3>
                <p className="stat-number">{dashboardStats.today}</p>
              </div>
              <div className="stat-card orange">
                <h3>PENDING ORDERS</h3>
                <p className="stat-number">{dashboardStats.pending}</p>
              </div>
            </div>

            <div className="recent-shipments">
              <h2>Recent Shipments</h2>
              <table>
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
                  {shipments.slice(0, 10).map(shipment => (
                    <tr key={shipment.id}>
                      <td>{shipment.tracking_number}</td>
                      <td>{shipment.customer_name}</td>
                      <td>{shipment.country}</td>
                      <td><span className={`status ${shipment.status}`}>{shipment.status}</span></td>
                      <td>{new Date(shipment.created_at).toLocaleDateString()}</td>
                      <td>
                        <button className="btn-small">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {currentPage === 'shopify' && (
          <div className="shopify-settings">
            <h1>Shopify Settings</h1>
            <p className="description">
              Connect your Shopify store to Trackisto by entering your domain and Admin API token. 
              This allows the system to auto-import and fulfill your orders with generated tracking numbers.
            </p>
            <p className="validation-note">All credentials are validated live when this page loads.</p>

            {/* URL Converter */}
            <div className="url-converter">
              <p>📋 Need help? <a href="#" onClick={(e) => { e.preventDefault(); alert('1. Go to your Shopify Admin\n2. Go to Settings > Apps and sales channels > Develop apps\n3. Create an app and configure Admin API scopes\n4. Install the app and copy the Admin API access token'); }}>Click here for setup instructions</a></p>
              <label>Paste Shopify Admin URL (auto-convert)</label>
              <div className="converter-row">
                <input
                  type="text"
                  placeholder="https://admin.shopify.com/store/your-store/......."
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                />
                <button onClick={handleConvertUrl}>Convert</button>
              </div>
              <small>It will extract the correct <code>your-store.myshopify.com</code> domain automatically.</small>
            </div>

            {/* Add Store Button / Form */}
            {!showAddStore ? (
              <button className="btn-add-store" onClick={() => setShowAddStore(true)}>
                + Add Shopify Store
              </button>
            ) : (
              <div className="store-form-container">
                <button className="btn-cancel" onClick={() => { setShowAddStore(false); resetStoreForm(); }}>
                  ✕ Cancel
                </button>
                
                <form onSubmit={handleAddStore} className="store-form">
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Shopify Domain</label>
                      <input
                        type="text"
                        placeholder="your-store.myshopify.com"
                        value={storeForm.domain}
                        onChange={(e) => setStoreForm({ ...storeForm, domain: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Admin API Token</label>
                      <input
                        type="text"
                        placeholder="shpat_..."
                        value={storeForm.api_token}
                        onChange={(e) => setStoreForm({ ...storeForm, api_token: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Delivery Days</label>
                      <input
                        type="number"
                        value={storeForm.delivery_days}
                        onChange={(e) => setStoreForm({ ...storeForm, delivery_days: parseInt(e.target.value) })}
                        min="1"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Send Offset (Days)</label>
                      <input
                        type="number"
                        value={storeForm.send_offset}
                        onChange={(e) => setStoreForm({ ...storeForm, send_offset: parseInt(e.target.value) })}
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Country of Origin</label>
                      <select
                        value={storeForm.country_origin}
                        onChange={(e) => setStoreForm({ ...storeForm, country_origin: e.target.value })}
                        required
                      >
                        <option value="">Select Country...</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Transit Country</label>
                      <select
                        value={storeForm.transit_country}
                        onChange={(e) => setStoreForm({ ...storeForm, transit_country: e.target.value })}
                      >
                        <option value="">Select Country...</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Post Delivery Event</label>
                      <select
                        value={storeForm.post_delivery_event}
                        onChange={(e) => setStoreForm({ ...storeForm, post_delivery_event: e.target.value })}
                      >
                        {postDeliveryEvents.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Sorting Days</label>
                      <input
                        type="number"
                        value={storeForm.sorting_days}
                        onChange={(e) => setStoreForm({ ...storeForm, sorting_days: parseInt(e.target.value) })}
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Parcel Point</label>
                      <select
                        value={storeForm.parcel_point ? 'Yes' : 'No'}
                        onChange={(e) => setStoreForm({ ...storeForm, parcel_point: e.target.value === 'Yes' })}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Parcel Point Days</label>
                      <input
                        type="number"
                        value={storeForm.parcel_point_days}
                        onChange={(e) => setStoreForm({ ...storeForm, parcel_point_days: parseInt(e.target.value) })}
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Redelivery Active</label>
                      <select
                        value={storeForm.redelivery_active ? 'Yes' : 'No'}
                        onChange={(e) => setStoreForm({ ...storeForm, redelivery_active: e.target.value === 'Yes' })}
                      >
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Redelivery Days</label>
                      <input
                        type="number"
                        value={storeForm.redelivery_days}
                        onChange={(e) => setStoreForm({ ...storeForm, redelivery_days: parseInt(e.target.value) })}
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Attempts</label>
                      <input
                        type="number"
                        value={storeForm.attempts}
                        onChange={(e) => setStoreForm({ ...storeForm, attempts: parseInt(e.target.value) })}
                        min="1"
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn-submit" disabled={loading}>
                    {loading ? 'Saving...' : (editingStore ? 'Update Store' : 'Add Store')}
                  </button>
                </form>
              </div>
            )}

            {/* Connected Stores Table */}
            <div className="stores-table">
              <h2>Connected Stores</h2>
              {stores.length === 0 ? (
                <p className="no-stores">No stores connected yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Domain</th>
                      <th>Days</th>
                      <th>Offset</th>
                      <th>Redelivery Active</th>
                      <th>Redelivery Days</th>
                      <th>Attempts</th>
                      <th>Parcel Point</th>
                      <th>Parcel Point Days</th>
                      <th>Sorting Days</th>
                      <th>Country of Origin</th>
                      <th>Transit Country</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map(store => (
                      <tr key={store.id}>
                        <td>
                          <span 
                            className={`status-indicator ${store.status === 'active' ? 'active' : 'inactive'}`}
                            onClick={() => toggleStoreStatus(store)}
                            title={store.status === 'active' ? 'Active - Click to deactivate' : 'Inactive - Click to activate'}
                          >
                            {store.status === 'active' ? '✓' : '✕'}
                          </span>
                        </td>
                        <td>{store.domain}</td>
                        <td>{store.delivery_days}</td>
                        <td>{store.send_offset || 0}</td>
                        <td>{store.redelivery_active ? 'Yes' : 'No'}</td>
                        <td>{store.redelivery_days || 3}</td>
                        <td>{store.attempts || 1}</td>
                        <td>{store.parcel_point ? 'Yes' : 'No'}</td>
                        <td>{store.parcel_point_days || 3}</td>
                        <td>{store.sorting_days || 3}</td>
                        <td>{store.country_origin}</td>
                        <td>{store.transit_country || '-'}</td>
                        <td>
                          <button className="btn-edit" onClick={() => handleEditStore(store)}>Edit</button>
                          <button className="btn-delete" onClick={() => handleDeleteStore(store.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {currentPage === 'shipments' && (
          <div className="shipments">
            <h1>Manual Entry</h1>
            <p>Create shipments manually here.</p>
            {/* Manual entry form would go here */}
          </div>
        )}

        {currentPage === 'missing' && (
          <div className="missing">
            <h1>Missing Entries</h1>
            <p>Shipments that need attention.</p>
          </div>
        )}

        {currentPage === 'api' && (
          <div className="api-guide">
            <h1>API Guide</h1>
            <p>Documentation for the Trackisto API.</p>
            <h3>Base URL</h3>
            <code>{API_URL}</code>
            <h3>Endpoints</h3>
            <ul>
              <li><strong>GET /api/tracking/:trackingNumber</strong> - Get tracking info</li>
              <li><strong>POST /api/shopify/webhook/order-created</strong> - Shopify webhook</li>
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;