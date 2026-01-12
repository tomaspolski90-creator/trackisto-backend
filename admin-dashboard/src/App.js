import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://trackisto-backend.onrender.com';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [shipments, setShipments] = useState([]);
  const [stores, setStores] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({ total: 0, today: 0, pending: 0 });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [storeForm, setStoreForm] = useState({
    domain: '', api_token: '', delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
    country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
    sorting_days: 3, parcel_point: true, parcel_point_days: 3,
    redelivery_active: false, redelivery_days: 3, attempts: 1
  });
  const [pasteUrl, setPasteUrl] = useState('');
  
  // Dashboard tabs and pending orders
  const [dashboardTab, setDashboardTab] = useState('recent');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  
  // Manual Entry Form State
  const [manualForm, setManualForm] = useState({
    customer_name: '',
    customer_email: '',
    shipping_address: '',
    city: '',
    state: '',
    zip_code: '',
    country: '',
    delivery_days: 7,
    country_origin: '',
    transit_country: '',
    sorting_days: 3,
    post_delivery_event: 'Redelivery',
    redelivery_days: 3,
    attempts: 1
  });
  const [generatedTracking, setGeneratedTracking] = useState(null);

  const countries = [
    'Denmark', 'United Kingdom', 'Germany', 'Netherlands', 'France', 
    'Belgium', 'Italy', 'Spain', 'Poland', 'Sweden', 'Norway',
    'Austria', 'Switzerland', 'Ireland', 'Portugal', 'Czech Republic',
    'Finland', 'Greece', 'Hungary', 'Romania', 'United States', 'Canada'
  ];

  const postDeliveryEvents = ['None', 'Redelivery', 'Parcel Point', 'Return to Sender'];

  const timeOptions = [];
  for (let h = 6; h <= 22; h++) {
    timeOptions.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 22) timeOptions.push(`${h.toString().padStart(2, '0')}:30`);
  }

  const fetchDashboardData = useCallback(async () => {
    try {
      const [statsRes, shipmentsRes, storesRes] = await Promise.all([
        fetch(`${API_URL}/api/shipments/stats/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/shipments`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/shopify/stores`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (statsRes.ok) setDashboardStats(await statsRes.json());
      if (shipmentsRes.ok) { const data = await shipmentsRes.json(); setShipments(data.shipments || []); }
      if (storesRes.ok) { const data = await storesRes.json(); setStores(data.stores || []); }
    } catch (error) { console.error('Error fetching dashboard data:', error); }
  }, [token]);

  // Fetch pending orders from Shopify
  const fetchPendingOrders = async () => {
    setPendingLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/shopify/pending-orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPendingOrders(data.orders || []);
        // Update pending count in stats
        setDashboardStats(prev => ({ ...prev, pending: data.orders?.length || 0 }));
      }
    } catch (error) {
      console.error('Error fetching pending orders:', error);
    }
    setPendingLoading(false);
  };

  useEffect(() => {
    if (token) { setIsLoggedIn(true); fetchDashboardData(); }
  }, [token, fetchDashboardData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await response.json();
      if (response.ok) { localStorage.setItem('token', data.token); setToken(data.token); setIsLoggedIn(true); }
      else { alert('Login failed: ' + data.message); }
    } catch (error) { alert('Login failed: ' + error.message); }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); setToken(null); setIsLoggedIn(false); setCurrentPage('dashboard');
  };

  const extractDomainFromUrl = (url) => {
    const match = url.match(/admin\.shopify\.com\/store\/([^/]+)/);
    if (match) return `${match[1]}.myshopify.com`;
    const directMatch = url.match(/([^/]+\.myshopify\.com)/);
    if (directMatch) return directMatch[1];
    return '';
  };

  const handleConvertUrl = () => {
    const domain = extractDomainFromUrl(pasteUrl);
    if (domain) { setStoreForm({ ...storeForm, domain }); setPasteUrl(''); }
    else { alert('Could not extract domain from URL.'); }
  };

  const resetStoreForm = () => {
    setStoreForm({
      domain: '', api_token: '', delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
      country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
      sorting_days: 3, parcel_point: true, parcel_point_days: 3,
      redelivery_active: false, redelivery_days: 3, attempts: 1
    });
    setEditingStore(null);
  };

  const handleAddStore = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = editingStore ? `${API_URL}/api/shopify/stores/${editingStore.id}` : `${API_URL}/api/shopify/stores`;
      const response = await fetch(url, {
        method: editingStore ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(storeForm)
      });
      if (response.ok) { fetchDashboardData(); setShowAddStore(false); resetStoreForm(); }
      else { const data = await response.json(); alert('Failed to save store: ' + data.message); }
    } catch (error) { alert('Failed to save store: ' + error.message); }
    setLoading(false);
  };

  const handleEditStore = (store) => {
    setStoreForm({
      domain: store.domain || '', api_token: store.api_token || '',
      delivery_days: store.delivery_days || 7, send_offset: store.send_offset || 0,
      fulfillment_time: store.fulfillment_time || '10:00',
      country_origin: store.country_origin || 'United Kingdom',
      transit_country: store.transit_country || '', post_delivery_event: store.post_delivery_event || 'None',
      sorting_days: store.sorting_days || 3, parcel_point: store.parcel_point !== false,
      parcel_point_days: store.parcel_point_days || 3, redelivery_active: store.redelivery_active || false,
      redelivery_days: store.redelivery_days || 3, attempts: store.attempts || 1
    });
    setEditingStore(store); setShowAddStore(true);
  };

  const handleDeleteStore = async (storeId) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      const response = await fetch(`${API_URL}/api/shopify/stores/${storeId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) fetchDashboardData();
      else alert('Failed to delete store');
    } catch (error) { alert('Failed to delete store: ' + error.message); }
  };

  const toggleStoreStatus = async (store) => {
    try {
      const newStatus = store.status === 'active' ? 'inactive' : 'active';
      const response = await fetch(`${API_URL}/api/shopify/stores/${store.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) fetchDashboardData();
    } catch (error) { console.error('Failed to toggle store status:', error); }
  };

  // Generate tracking number based on country
  const generateTrackingNumber = (country) => {
    const countryCode = country === 'Denmark' ? 'DK' : 
                        country === 'United Kingdom' ? 'UK' :
                        country === 'Germany' ? 'DE' :
                        country === 'Netherlands' ? 'NL' :
                        country === 'France' ? 'FR' :
                        country === 'Sweden' ? 'SE' :
                        country === 'Norway' ? 'NO' :
                        country === 'United States' ? 'US' : 'XX';
    return countryCode + Date.now() + Math.floor(Math.random() * 1000);
  };

  // Handle Manual Entry Submit
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const trackingNumber = generateTrackingNumber(manualForm.country);
      const estimatedDelivery = new Date();
      estimatedDelivery.setDate(estimatedDelivery.getDate() + manualForm.delivery_days);

      const shipmentData = {
        tracking_number: trackingNumber,
        customer_name: manualForm.customer_name,
        customer_email: manualForm.customer_email,
        shipping_address: manualForm.shipping_address,
        city: manualForm.city,
        state: manualForm.state,
        zip_code: manualForm.zip_code,
        country: manualForm.country,
        origin_country: manualForm.country_origin,
        transit_country: manualForm.transit_country,
        destination_country: manualForm.country,
        status: 'label_created',
        delivery_days: manualForm.delivery_days,
        sorting_days: manualForm.sorting_days,
        estimated_delivery: estimatedDelivery.toISOString()
      };

      const response = await fetch(`${API_URL}/api/shipments`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(shipmentData)
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedTracking({
          tracking_number: trackingNumber,
          customer_name: manualForm.customer_name,
          country: manualForm.country,
          estimated_delivery: estimatedDelivery
        });
        
        // Reset form
        setManualForm({
          customer_name: '',
          customer_email: '',
          shipping_address: '',
          city: '',
          state: '',
          zip_code: '',
          country: '',
          delivery_days: 7,
          country_origin: '',
          transit_country: '',
          sorting_days: 3,
          post_delivery_event: 'Redelivery',
          redelivery_days: 3,
          attempts: 1
        });
        
        fetchDashboardData();
      } else {
        const data = await response.json();
        alert('Failed to create shipment: ' + data.message);
      }
    } catch (error) {
      alert('Failed to create shipment: ' + error.message);
    }
    setLoading(false);
  };

  const copyTrackingNumber = () => {
    if (generatedTracking) {
      navigator.clipboard.writeText(generatedTracking.tracking_number);
      alert('Tracking number copied!');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>📦 Trackisto</h1>
          <p>Admin Dashboard</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
            </div>
            <button type="submit" disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
          </form>
          <p className="hint">Default: admin / admin123</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo"><h2>📦 Trackisto</h2></div>
        <div className="nav-title">Navigation</div>
        <ul className="nav-menu">
          <li className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => setCurrentPage('dashboard')}>📊 Dashboard</li>
          <li className={currentPage === 'shipments' ? 'active' : ''} onClick={() => setCurrentPage('shipments')}>📦 Manual Entry</li>
          <li className={currentPage === 'missing' ? 'active' : ''} onClick={() => setCurrentPage('missing')}>⏳ Missing Entries</li>
          <li className={currentPage === 'shopify' ? 'active' : ''} onClick={() => setCurrentPage('shopify')}>🛒 Shopify Settings</li>
        </ul>
        <div className="nav-bottom">
          <div className="nav-item" onClick={() => setCurrentPage('api')}>📖 API Guide</div>
          <div className="user-info">Logged in as <strong>admin</strong><button className="logout-btn" onClick={handleLogout}>Logout</button></div>
        </div>
      </nav>

      <main className="main-content">
        {currentPage === 'dashboard' && (
          <div className="dashboard">
            <h1>Dashboard Overview</h1>
            <div className="stats-grid">
              <div className="stat-card blue"><h3>TOTAL SHIPMENTS</h3><p className="stat-number">{dashboardStats.total}</p></div>
              <div className="stat-card green"><h3>TODAY'S SHIPMENTS</h3><p className="stat-number">{dashboardStats.today}</p></div>
              <div className="stat-card orange"><h3>PENDING ORDERS</h3><p className="stat-number">{pendingOrders.length}</p></div>
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
                onClick={() => { setDashboardTab('pending'); if (pendingOrders.length === 0) fetchPendingOrders(); }}
              >
                Pending Shipments
              </button>
              <button 
                className="fetch-btn"
                onClick={fetchPendingOrders}
                disabled={pendingLoading}
              >
                <span className="fetch-icon">⬇</span>
                {pendingLoading ? 'Fetching...' : 'Fetch Pending Parcels'}
              </button>
            </div>

            {/* Recent Shipments Tab */}
            {dashboardTab === 'recent' && (
              <div className="recent-shipments">
                <table>
                  <thead><tr><th>TRACKING #</th><th>CUSTOMER</th><th>COUNTRY</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead>
                  <tbody>
                    {shipments.slice(0, 10).map(s => (
                      <tr key={s.id}>
                        <td>{s.tracking_number}</td><td>{s.customer_name}</td><td>{s.country}</td>
                        <td><span className={`status ${s.status}`}>{s.status}</span></td>
                        <td>{new Date(s.created_at).toLocaleDateString()}</td>
                        <td><button className="btn-small">View</button></td>
                      </tr>
                    ))}
                    {shipments.length === 0 && (
                      <tr><td colSpan="6" className="no-data">No shipments yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pending Shipments Tab */}
            {dashboardTab === 'pending' && (
              <div className="pending-shipments">
                {pendingLoading ? (
                  <div className="loading-state">Loading pending orders...</div>
                ) : (
                  <table>
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
                      {pendingOrders.map(order => (
                        <tr key={order.id}>
                          <td>#{order.order_number}</td>
                          <td>{order.customer_name}</td>
                          <td>{order.country}</td>
                          <td>{order.currency} {parseFloat(order.total_price).toFixed(2)}</td>
                          <td>{new Date(order.created_at).toLocaleDateString()}</td>
                          <td>
                            <span className={`fulfillment-status ${order.fulfillment_status}`}>
                              {order.fulfillment_status || 'unfulfilled'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {pendingOrders.length === 0 && (
                        <tr><td colSpan="6" className="no-data">No pending orders. Click "Fetch Pending Parcels" to load.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
                <div className="pending-info">
                  <p>Pending Shipments (Page 1 of 1)</p>
                </div>
              </div>
            )}
          </div>
        )}

        {currentPage === 'shopify' && (
          <div className="shopify-settings">
            <h1>Shopify Settings</h1>
            <p className="description">Connect your Shopify store to Trackisto. Orders will be auto-fulfilled at your specified time.</p>

            <div className="url-converter">
              <p>📋 Need help? <button className="link-btn" onClick={() => alert('1. Go to Shopify Admin\n2. Settings → Apps → Develop apps\n3. Create app with Admin API scopes\n4. Install and copy access token')}>Click here for setup instructions</button></p>
              <label>Paste Shopify Admin URL (auto-convert)</label>
              <div className="converter-row">
                <input type="text" placeholder="https://admin.shopify.com/store/your-store/..." value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} />
                <button onClick={handleConvertUrl}>Convert</button>
              </div>
            </div>

            {!showAddStore ? (
              <button className="btn-add-store" onClick={() => setShowAddStore(true)}>+ Add Shopify Store</button>
            ) : (
              <div className="store-form-container">
                <button className="btn-cancel" onClick={() => { setShowAddStore(false); resetStoreForm(); }}>✕ Cancel</button>
                <form onSubmit={handleAddStore} className="store-form">
                  <div className="form-grid">
                    <div className="form-group"><label>Shopify Domain</label><input type="text" placeholder="your-store.myshopify.com" value={storeForm.domain} onChange={(e) => setStoreForm({ ...storeForm, domain: e.target.value })} required /></div>
                    <div className="form-group"><label>Admin API Token</label><input type="text" placeholder="shpat_..." value={storeForm.api_token} onChange={(e) => setStoreForm({ ...storeForm, api_token: e.target.value })} required /></div>
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={storeForm.delivery_days} onChange={(e) => setStoreForm({ ...storeForm, delivery_days: parseInt(e.target.value) })} min="1" required /></div>
                    <div className="form-group"><label>Send Offset (Days)</label><input type="number" value={storeForm.send_offset} onChange={(e) => setStoreForm({ ...storeForm, send_offset: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Fulfillment Time</label><select value={storeForm.fulfillment_time} onChange={(e) => setStoreForm({ ...storeForm, fulfillment_time: e.target.value })}>{timeOptions.map(t => <option key={t} value={t}>{t}</option>)}</select><small className="field-hint">Orders fulfilled at this time daily (Danish time)</small></div>
                    <div className="form-group"><label>Country of Origin</label><select value={storeForm.country_origin} onChange={(e) => setStoreForm({ ...storeForm, country_origin: e.target.value })} required><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Transit Country</label><select value={storeForm.transit_country} onChange={(e) => setStoreForm({ ...storeForm, transit_country: e.target.value })}><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Post Delivery Event</label><select value={storeForm.post_delivery_event} onChange={(e) => setStoreForm({ ...storeForm, post_delivery_event: e.target.value })}>{postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div className="form-group"><label>Sorting Days</label><input type="number" value={storeForm.sorting_days} onChange={(e) => setStoreForm({ ...storeForm, sorting_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Parcel Point</label><select value={storeForm.parcel_point ? 'Yes' : 'No'} onChange={(e) => setStoreForm({ ...storeForm, parcel_point: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></div>
                    <div className="form-group"><label>Parcel Point Days</label><input type="number" value={storeForm.parcel_point_days} onChange={(e) => setStoreForm({ ...storeForm, parcel_point_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Redelivery Active</label><select value={storeForm.redelivery_active ? 'Yes' : 'No'} onChange={(e) => setStoreForm({ ...storeForm, redelivery_active: e.target.value === 'Yes' })}><option>No</option><option>Yes</option></select></div>
                    <div className="form-group"><label>Redelivery Days</label><input type="number" value={storeForm.redelivery_days} onChange={(e) => setStoreForm({ ...storeForm, redelivery_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Attempts</label><input type="number" value={storeForm.attempts} onChange={(e) => setStoreForm({ ...storeForm, attempts: parseInt(e.target.value) })} min="1" /></div>
                  </div>
                  <button type="submit" className="btn-submit" disabled={loading}>{loading ? 'Saving...' : (editingStore ? 'Update Store' : 'Add Store')}</button>
                </form>
              </div>
            )}

            <div className="stores-table">
              <h2>Connected Stores</h2>
              {stores.length === 0 ? <p className="no-stores">No stores connected yet.</p> : (
                <table>
                  <thead><tr><th>Status</th><th>Domain</th><th>Days</th><th>Offset</th><th>Fulfill Time</th><th>Origin</th><th>Transit</th><th>Actions</th></tr></thead>
                  <tbody>
                    {stores.map(store => (
                      <tr key={store.id}>
                        <td><span className={`status-indicator ${store.status === 'active' ? 'active' : 'inactive'}`} onClick={() => toggleStoreStatus(store)}>{store.status === 'active' ? '✓' : '✕'}</span></td>
                        <td>{store.domain}</td><td>{store.delivery_days}</td><td>{store.send_offset || 0}</td><td>{store.fulfillment_time || '10:00'}</td>
                        <td>{store.country_origin}</td><td>{store.transit_country || '-'}</td>
                        <td><button className="btn-edit" onClick={() => handleEditStore(store)}>Edit</button><button className="btn-delete" onClick={() => handleDeleteStore(store.id)}>Del</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {currentPage === 'shipments' && (
          <div className="manual-entry">
            <h1>Manual Parcel Entry</h1>
            
            <div className="manual-entry-container">
              <div className="manual-entry-info">
                <p>This panel lets you manually register a parcel directly into the system.</p>
                <p>A tracking number is automatically generated using the customer's country code and a unique 13-digit identifier, following the same logic used for automated Shopify imports.</p>
              </div>

              {generatedTracking && (
                <div className="success-box">
                  <h3>✅ Tracking Created Successfully!</h3>
                  <div className="tracking-result">
                    <p><strong>Tracking Number:</strong> {generatedTracking.tracking_number}</p>
                    <p><strong>Customer:</strong> {generatedTracking.customer_name}</p>
                    <p><strong>Destination:</strong> {generatedTracking.country}</p>
                    <p><strong>Est. Delivery:</strong> {generatedTracking.estimated_delivery.toLocaleDateString()}</p>
                    <button className="btn-copy" onClick={copyTrackingNumber}>📋 Copy Tracking Number</button>
                  </div>
                </div>
              )}

              <form onSubmit={handleManualSubmit} className="manual-form">
                <div className="form-section">
                  <h3 className="section-title">Customer Details</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Full Name</label>
                      <input 
                        type="text" 
                        value={manualForm.customer_name} 
                        onChange={(e) => setManualForm({...manualForm, customer_name: e.target.value})}
                        required 
                      />
                    </div>
                    <div className="form-group">
                      <label>Email Address</label>
                      <input 
                        type="email" 
                        value={manualForm.customer_email} 
                        onChange={(e) => setManualForm({...manualForm, customer_email: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="form-group full-width">
                    <label>Shipping Address</label>
                    <textarea 
                      value={manualForm.shipping_address} 
                      onChange={(e) => setManualForm({...manualForm, shipping_address: e.target.value})}
                      rows="2"
                    />
                  </div>
                  <div className="form-row three-col">
                    <div className="form-group">
                      <label>City</label>
                      <input 
                        type="text" 
                        value={manualForm.city} 
                        onChange={(e) => setManualForm({...manualForm, city: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>State / Region</label>
                      <input 
                        type="text" 
                        value={manualForm.state} 
                        onChange={(e) => setManualForm({...manualForm, state: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>ZIP / Postal Code</label>
                      <input 
                        type="text" 
                        value={manualForm.zip_code} 
                        onChange={(e) => setManualForm({...manualForm, zip_code: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-section">
                  <h3 className="section-title">Delivery Info</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Destination Country <span className="hint">(Customer's country)</span></label>
                      <select 
                        value={manualForm.country} 
                        onChange={(e) => setManualForm({...manualForm, country: e.target.value})}
                        required
                      >
                        <option value="">Select Country...</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Delivery Days <span className="hint">(Estimated transit time)</span></label>
                      <input 
                        type="number" 
                        value={manualForm.delivery_days} 
                        onChange={(e) => setManualForm({...manualForm, delivery_days: parseInt(e.target.value)})}
                        min="1"
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Country of Origin <span className="hint">(Where parcel ships from)</span></label>
                      <select 
                        value={manualForm.country_origin} 
                        onChange={(e) => setManualForm({...manualForm, country_origin: e.target.value})}
                      >
                        <option value="">Select Country...</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Transit Country <span className="hint">(Optional stopover country)</span></label>
                      <select 
                        value={manualForm.transit_country} 
                        onChange={(e) => setManualForm({...manualForm, transit_country: e.target.value})}
                      >
                        <option value="">Select Country...</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group" style={{maxWidth: '250px'}}>
                    <label>Sorting Days <span className="hint">(Days at sorting facility)</span></label>
                    <input 
                      type="number" 
                      value={manualForm.sorting_days} 
                      onChange={(e) => setManualForm({...manualForm, sorting_days: parseInt(e.target.value)})}
                      min="0"
                    />
                  </div>
                </div>

                <div className="form-section">
                  <h3 className="section-title">Post Delivery Settings</h3>
                  <div className="form-group" style={{maxWidth: '250px'}}>
                    <label>Post Delivery Event <span className="hint">(What happens after failed delivery)</span></label>
                    <select 
                      value={manualForm.post_delivery_event} 
                      onChange={(e) => setManualForm({...manualForm, post_delivery_event: e.target.value})}
                    >
                      {postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Redelivery Days <span className="hint">(Days before redelivery attempt)</span></label>
                      <input 
                        type="number" 
                        value={manualForm.redelivery_days} 
                        onChange={(e) => setManualForm({...manualForm, redelivery_days: parseInt(e.target.value)})}
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Attempts <span className="hint">(Max delivery attempts)</span></label>
                      <input 
                        type="number" 
                        value={manualForm.attempts} 
                        onChange={(e) => setManualForm({...manualForm, attempts: parseInt(e.target.value)})}
                        min="1"
                      />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn-generate" disabled={loading}>
                  {loading ? 'Generating...' : 'Generate Tracking'}
                </button>
              </form>
            </div>
          </div>
        )}

        {currentPage === 'missing' && (
          <div className="missing">
            <h1>Missing Entries</h1>
            <p>Shipments that need attention will appear here.</p>
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>No missing entries at this time.</p>
            </div>
          </div>
        )}

        {currentPage === 'api' && (
          <div className="api-guide">
            <h1>How to Create a Shopify API Token</h1>
            <p>Follow these 7 steps to generate your Shopify Admin API token and connect your store to Trackisto.</p>
            
            <h3>Step 1: Open App Development</h3>
            <p>Go to admin.shopify.com and login, then search for <strong>App development</strong> in your Shopify Admin settings, and click it.</p>
            
            <h3>Step 2: Click "Create an App"</h3>
            <p>Once inside App Development, click the <strong>Create an app</strong> button.</p>
            
            <h3>Step 3: Name the App</h3>
            <p>Give your app a name like "tracking" and proceed.</p>
            
            <h3>Step 4: Go to Admin API Configuration</h3>
            <p>Click <strong>Configure Admin API scopes</strong> to begin selecting access permissions.</p>
            
            <h3>Step 5: Select Required API Scopes</h3>
            <p>Enable all of the following Admin API scopes:</p>
            <ul>
              <li>read_orders</li>
              <li>write_orders</li>
              <li>read_fulfillments</li>
              <li>write_fulfillments</li>
              <li>read_products</li>
              <li>read_locations</li>
              <li>write_assigned_fulfillment_orders</li>
              <li>read_assigned_fulfillment_orders</li>
              <li>read_merchant_managed_fulfillment_orders</li>
              <li>write_merchant_managed_fulfillment_orders</li>
            </ul>
            
            <h3>Step 6: Install the App</h3>
            <p>Click <strong>Install app</strong> to finalize and authorize your custom app.</p>
            
            <h3>Step 7: Copy the Admin API Token</h3>
            <p>Reveal and copy your <strong>Admin API token</strong> (you can only view it once!). Paste this token into the Trackisto Shopify Settings page.</p>
            
            <div className="warning-box">⚠️ This token is sensitive. Only reveal and use it securely inside your Trackisto admin panel.</div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
