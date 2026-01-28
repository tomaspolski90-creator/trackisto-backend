import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://trackisto-backend.onrender.com';

const getPageFromHash = () => {
  const hash = window.location.hash.replace('#', '');
  const validPages = ['dashboard', 'shipments', 'missing', 'shopify', 'wordpress', 'api'];
  return validPages.includes(hash) ? hash : 'dashboard';
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('token'));
  const [currentPage, setCurrentPage] = useState(getPageFromHash());
  const [shipments, setShipments] = useState([]);
  const [stores, setStores] = useState([]);
  const [wooStores, setWooStores] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({ total: 0, today: 0, pending: 0 });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [showAddWooStore, setShowAddWooStore] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [editingWooStore, setEditingWooStore] = useState(null);
  
  const [storeForm, setStoreForm] = useState({
    store_name: '', domain: '', client_id: '', client_secret: '',
    delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
    country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
    sorting_days: 3, parcel_point: true, parcel_point_days: 3,
    redelivery_active: false, redelivery_days: 3, attempts: 1
  });
  
  const [wooStoreForm, setWooStoreForm] = useState({
    store_name: '', domain: '', client_id: '', client_secret: '',
    delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
    country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
    sorting_days: 3, parcel_point: true, parcel_point_days: 3,
    redelivery_active: false, redelivery_days: 3, attempts: 1
  });
  
  const [pasteUrl, setPasteUrl] = useState('');
  const [dashboardTab, setDashboardTab] = useState('recent');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [fulfilledOrders, setFulfilledOrders] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [manualForm, setManualForm] = useState({
    customer_name: '', customer_email: '', shipping_address: '', city: '', state: '', zip_code: '',
    country: '', delivery_days: 7, country_origin: '', transit_country: '', sorting_days: 3,
    post_delivery_event: 'Redelivery', redelivery_days: 3, attempts: 1
  });
  const [generatedTracking, setGeneratedTracking] = useState(null);

  const navigateTo = (page) => {
    setCurrentPage(page);
    window.location.hash = page;
  };

  const countries = [
    'Denmark', 'United Kingdom', 'Germany', 'Netherlands', 'France', 'Belgium', 'Italy', 'Spain',
    'Poland', 'Sweden', 'Norway', 'Austria', 'Switzerland', 'Ireland', 'Portugal', 'Czech Republic',
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
      const [statsRes, shipmentsRes, storesRes, wooStoresRes] = await Promise.all([
        fetch(`${API_URL}/api/shipments/stats/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/shipments`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/shopify/stores`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/woocommerce/stores`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (statsRes.ok) setDashboardStats(await statsRes.json());
      if (shipmentsRes.ok) { const data = await shipmentsRes.json(); setShipments(data.shipments || []); }
      if (storesRes.ok) { const data = await storesRes.json(); setStores(data.stores || []); }
      if (wooStoresRes.ok) { const data = await wooStoresRes.json(); setWooStores(data.stores || []); }
    } catch (error) { console.error('Error fetching dashboard data:', error); }
  }, [token]);

  const fetchPendingOrders = async (storeFilter = selectedStore) => {
    setPendingLoading(true);
    try {
      const [shopifyRes, wooRes] = await Promise.all([
        fetch(`${API_URL}/api/shopify/pending-orders`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/woocommerce/pending-orders`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      
      let allOrders = [];
      if (shopifyRes.ok) {
        const data = await shopifyRes.json();
        allOrders = [...allOrders, ...(data.orders || []).map(o => ({...o, store_type: 'shopify'}))];
      }
      if (wooRes.ok) {
        const data = await wooRes.json();
        allOrders = [...allOrders, ...(data.orders || []).map(o => ({...o, store_type: 'woocommerce'}))];
      }
      
      allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setPendingOrders(allOrders);
      setDashboardStats(prev => ({ ...prev, pending: allOrders.length }));
    } catch (error) { console.error('Error fetching pending orders:', error); }
    setPendingLoading(false);
  };

  const fetchFulfilledOrders = async (storeFilter = selectedStore) => {
    setPendingLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/shipments`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        let orders = data.shipments || [];
        if (storeFilter !== 'all') {
          const store = [...stores, ...wooStores].find(s => s.domain === storeFilter);
          if (store) orders = orders.filter(o => o.shopify_store_id === store.id);
        }
        setFulfilledOrders(orders);
      }
    } catch (error) { console.error('Error fetching fulfilled orders:', error); }
    setPendingLoading(false);
  };

  const fetchAndFulfillOrders = async () => {
    if (!window.confirm('This will fulfill ALL pending orders and send tracking emails to customers. Continue?')) return;
    setPendingLoading(true);
    try {
      const [shopifyRes, wooRes] = await Promise.all([
        fetch(`${API_URL}/api/shopify/fetch-and-fulfill`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/woocommerce/fetch-and-fulfill`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      
      let totalFulfilled = 0;
      let messages = [];
      
      if (shopifyRes.ok) {
        const data = await shopifyRes.json();
        totalFulfilled += data.fulfilled || 0;
        if (data.fulfilled > 0) messages.push(`Shopify: ${data.fulfilled}`);
      }
      if (wooRes.ok) {
        const data = await wooRes.json();
        totalFulfilled += data.fulfilled || 0;
        if (data.fulfilled > 0) messages.push(`WooCommerce: ${data.fulfilled}`);
      }
      
      alert(`Fulfilled ${totalFulfilled} orders${messages.length > 0 ? ' (' + messages.join(', ') + ')' : ''}`);
      fetchDashboardData();
      fetchPendingOrders();
    } catch (error) { alert('Error: ' + error.message); }
    setPendingLoading(false);
  };

  const filteredPendingOrders = selectedStore === 'all' 
    ? pendingOrders 
    : pendingOrders.filter(order => order.store_domain === selectedStore);

  const filteredFulfilledOrders = fulfilledOrders.filter(order => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.tracking_number?.toLowerCase().includes(query) ||
      order.customer_name?.toLowerCase().includes(query) ||
      order.country?.toLowerCase().includes(query)
    );
  });

  const filteredShipments = (selectedStore === 'all'
    ? shipments
    : shipments.filter(s => {
        const store = [...stores, ...wooStores].find(st => st.id === s.shopify_store_id);
        return store?.domain === selectedStore;
      })
  ).filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      s.tracking_number?.toLowerCase().includes(query) ||
      s.customer_name?.toLowerCase().includes(query) ||
      s.country?.toLowerCase().includes(query)
    );
  });

  useEffect(() => {
    if (token) { setIsLoggedIn(true); fetchDashboardData(); }
  }, [token, fetchDashboardData]);

  useEffect(() => {
    const handleHashChange = () => setCurrentPage(getPageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
    localStorage.removeItem('token'); setToken(null); setIsLoggedIn(false); navigateTo('dashboard');
  };

  const extractDomainFromUrl = (url) => {
    const match = url.match(/admin\.shopify\.com\/store\/([^/]+)/);
    if (match) return `${match[1]}.myshopify.com`;
    const directMatch = url.match(/([^/]+\.myshopify\.com)/);
    if (directMatch) return directMatch[1];
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return '';
    }
  };

  const handleConvertUrl = () => {
    const domain = extractDomainFromUrl(pasteUrl);
    if (domain) { setStoreForm({ ...storeForm, domain }); setPasteUrl(''); }
    else { alert('Could not extract domain from URL.'); }
  };

  const resetStoreForm = () => {
    setStoreForm({
      store_name: '', domain: '', client_id: '', client_secret: '',
      delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
      country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
      sorting_days: 3, parcel_point: true, parcel_point_days: 3,
      redelivery_active: false, redelivery_days: 3, attempts: 1
    });
    setEditingStore(null);
  };

  const resetWooStoreForm = () => {
    setWooStoreForm({
      store_name: '', domain: '', client_id: '', client_secret: '',
      delivery_days: 7, send_offset: 0, fulfillment_time: '10:00',
      country_origin: 'United Kingdom', transit_country: '', post_delivery_event: 'None',
      sorting_days: 3, parcel_point: true, parcel_point_days: 3,
      redelivery_active: false, redelivery_days: 3, attempts: 1
    });
    setEditingWooStore(null);
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
      if (response.ok) { 
        const data = await response.json();
        if (data.message) alert(data.message);
        fetchDashboardData(); 
        setShowAddStore(false); 
        resetStoreForm(); 
      }
      else { const data = await response.json(); alert('Failed to save store: ' + (data.error || data.message)); }
    } catch (error) { alert('Failed to save store: ' + error.message); }
    setLoading(false);
  };

  const handleAddWooStore = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = editingWooStore ? `${API_URL}/api/woocommerce/stores/${editingWooStore.id}` : `${API_URL}/api/woocommerce/stores`;
      const response = await fetch(url, {
        method: editingWooStore ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(wooStoreForm)
      });
      if (response.ok) { 
        const data = await response.json();
        if (data.message) alert(data.message);
        fetchDashboardData(); 
        setShowAddWooStore(false); 
        resetWooStoreForm(); 
      }
      else { const data = await response.json(); alert('Failed to save store: ' + (data.error || data.message)); }
    } catch (error) { alert('Failed to save store: ' + error.message); }
    setLoading(false);
  };

  const handleEditStore = (store) => {
    setStoreForm({
      store_name: store.store_name || '', domain: store.domain || '', 
      client_id: store.client_id || '', client_secret: store.client_secret || '',
      delivery_days: store.delivery_days || 7, send_offset: store.send_offset || 0,
      fulfillment_time: store.fulfillment_time || '10:00',
      country_origin: store.country_origin || 'United Kingdom',
      transit_country: store.transit_country || '', post_delivery_event: store.post_delivery_event || 'None',
      sorting_days: store.sorting_days || 3, parcel_point: store.parcel_point !== false,
      parcel_point_days: store.parcel_point_days || 3, redelivery_active: store.redelivery_active || false,
      redelivery_days: store.redelivery_days || 3, attempts: store.attempts || 1
    });
    setEditingStore(store); 
    setShowAddStore(true);
  };

  const handleEditWooStore = (store) => {
    setWooStoreForm({
      store_name: store.store_name || '', domain: store.domain || '', 
      client_id: store.client_id || '', client_secret: store.client_secret || '',
      delivery_days: store.delivery_days || 7, send_offset: store.send_offset || 0,
      fulfillment_time: store.fulfillment_time || '10:00',
      country_origin: store.country_origin || 'United Kingdom',
      transit_country: store.transit_country || '', post_delivery_event: store.post_delivery_event || 'None',
      sorting_days: store.sorting_days || 3, parcel_point: store.parcel_point !== false,
      parcel_point_days: store.parcel_point_days || 3, redelivery_active: store.redelivery_active || false,
      redelivery_days: store.redelivery_days || 3, attempts: store.attempts || 1
    });
    setEditingWooStore(store); 
    setShowAddWooStore(true);
  };

  const handleDeleteStore = async (storeId) => {
    if (!window.confirm('Are you sure you want to delete this store?')) return;
    try {
      const response = await fetch(`${API_URL}/api/shopify/stores/${storeId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) fetchDashboardData();
      else alert('Failed to delete store');
    } catch (error) { alert('Failed to delete store: ' + error.message); }
  };

  const handleDeleteWooStore = async (storeId) => {
    if (!window.confirm('Are you sure you want to delete this store?')) return;
    try {
      const response = await fetch(`${API_URL}/api/woocommerce/stores/${storeId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) fetchDashboardData();
      else alert('Failed to delete store');
    } catch (error) { alert('Failed to delete store: ' + error.message); }
  };

  const toggleStoreStatus = async (store, isWoo = false) => {
    try {
      const newStatus = store.status === 'active' ? 'inactive' : 'active';
      const endpoint = isWoo ? 'woocommerce' : 'shopify';
      const response = await fetch(`${API_URL}/api/${endpoint}/stores/${store.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) fetchDashboardData();
    } catch (error) { console.error('Failed to toggle store status:', error); }
  };

  const handleConnectToShopify = (store) => {
    if (!store.client_id || !store.client_secret) {
      alert('Please add Client ID and Client Secret first.\n\nEdit the store to add your Shopify App credentials.');
      return;
    }
    const installUrl = `${API_URL}/api/shopify/auth/${store.id}`;
    window.open(installUrl, '_blank');
  };

  const generateTrackingNumber = (country) => {
    const countryCode = country === 'Denmark' ? 'DK' : country === 'United Kingdom' ? 'UK' :
      country === 'Germany' ? 'DE' : country === 'Netherlands' ? 'NL' : country === 'France' ? 'FR' :
      country === 'Sweden' ? 'SE' : country === 'Norway' ? 'NO' : country === 'United States' ? 'US' : 'XX';
    return countryCode + Date.now() + Math.floor(Math.random() * 1000);
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const trackingNumber = generateTrackingNumber(manualForm.country);
      const estimatedDelivery = new Date();
      estimatedDelivery.setDate(estimatedDelivery.getDate() + manualForm.delivery_days);

      const shipmentData = {
        tracking_number: trackingNumber, customer_name: manualForm.customer_name,
        customer_email: manualForm.customer_email, shipping_address: manualForm.shipping_address,
        city: manualForm.city, state: manualForm.state, zip_code: manualForm.zip_code,
        country: manualForm.country, origin_country: manualForm.country_origin,
        transit_country: manualForm.transit_country, destination_country: manualForm.country,
        status: 'label_created', delivery_days: manualForm.delivery_days,
        sorting_days: manualForm.sorting_days, estimated_delivery: estimatedDelivery.toISOString()
      };

      const response = await fetch(`${API_URL}/api/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(shipmentData)
      });

      if (response.ok) {
        setGeneratedTracking({
          tracking_number: trackingNumber, customer_name: manualForm.customer_name,
          country: manualForm.country, estimated_delivery: estimatedDelivery
        });
        setManualForm({
          customer_name: '', customer_email: '', shipping_address: '', city: '', state: '', zip_code: '',
          country: '', delivery_days: 7, country_origin: '', transit_country: '', sorting_days: 3,
          post_delivery_event: 'Redelivery', redelivery_days: 3, attempts: 1
        });
        fetchDashboardData();
      } else {
        const data = await response.json();
        alert('Failed to create shipment: ' + data.message);
      }
    } catch (error) { alert('Failed to create shipment: ' + error.message); }
    setLoading(false);
  };

  const copyTrackingNumber = () => {
    if (generatedTracking) {
      navigator.clipboard.writeText(generatedTracking.tracking_number);
      alert('Tracking number copied!');
    }
  };

  const handleStoreFilterChange = (storeDomain) => {
    setSelectedStore(storeDomain);
    if (dashboardTab === 'pending') fetchPendingOrders(storeDomain);
    if (dashboardTab === 'fulfilled') fetchFulfilledOrders(storeDomain);
  };

  const connectedStores = [...stores.filter(s => s.is_connected), ...wooStores.filter(s => s.is_connected)];

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>Trackisto</h1>
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
        <div className="logo"><h2>Trackisto</h2></div>
        <div className="nav-title">Navigation</div>
        <ul className="nav-menu">
          <li className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => navigateTo('dashboard')}>Dashboard</li>
          <li className={currentPage === 'shipments' ? 'active' : ''} onClick={() => navigateTo('shipments')}>Manual Entry</li>
          <li className={currentPage === 'missing' ? 'active' : ''} onClick={() => navigateTo('missing')}>Missing Entries</li>
          <li className={currentPage === 'shopify' ? 'active' : ''} onClick={() => navigateTo('shopify')}>Shopify Settings</li>
          <li className={currentPage === 'wordpress' ? 'active' : ''} onClick={() => navigateTo('wordpress')}>WordPress Settings</li>
        </ul>
        <div className="nav-bottom">
          <div className="nav-item" onClick={() => navigateTo('api')}>Setup Guide</div>
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
              <div className="stat-card orange"><h3>PENDING ORDERS</h3><p className="stat-number">{filteredPendingOrders.length}</p></div>
            </div>
            
            <div className="dashboard-tabs">
              <button className={`tab-btn ${dashboardTab === 'recent' ? 'active' : ''}`} onClick={() => setDashboardTab('recent')}>Recent Shipments</button>
              <button className={`tab-btn ${dashboardTab === 'pending' ? 'active' : ''}`} onClick={() => { setDashboardTab('pending'); if (pendingOrders.length === 0) fetchPendingOrders(); }}>Pending Shipments</button>
              <button className={`tab-btn ${dashboardTab === 'fulfilled' ? 'active' : ''}`} onClick={() => { setDashboardTab('fulfilled'); if (fulfilledOrders.length === 0) fetchFulfilledOrders(); }}>Fulfilled Shipments</button>
              
              <div className="store-filter">
                <select value={selectedStore} onChange={(e) => handleStoreFilterChange(e.target.value)}>
                  <option value="all">All Stores</option>
                  {connectedStores.map(store => (
                    <option key={store.id} value={store.domain}>{store.store_name || store.domain}</option>
                  ))}
                </select>
              </div>

              {(dashboardTab === 'fulfilled' || dashboardTab === 'recent') && (
                <div className="search-bar-inline">
                  <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="search-input-inline" />
                  {searchQuery && <button className="search-clear-inline" onClick={() => setSearchQuery('')}>x</button>}
                </div>
              )}
              
              <button className="refresh-btn" onClick={() => { fetchPendingOrders(); fetchFulfilledOrders(); }} disabled={pendingLoading}>Refresh</button>
              {dashboardTab === 'pending' && (
                <button className="fetch-btn" onClick={fetchAndFulfillOrders} disabled={pendingLoading}>
                  {pendingLoading ? 'Processing...' : 'Fetch Pending Parcels'}
                </button>
              )}
            </div>

            {dashboardTab === 'recent' && (
              <div className="recent-shipments">
                <table>
                  <thead><tr><th>TRACKING #</th><th>CUSTOMER</th><th>COUNTRY</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead>
                  <tbody>
                    {filteredShipments.slice(0, 10).map(s => (
                      <tr key={s.id}>
                        <td>{s.tracking_number}</td><td>{s.customer_name}</td><td>{s.country}</td>
                        <td><span className={`status ${s.status}`}>{s.status}</span></td>
                        <td>{new Date(s.created_at).toLocaleDateString()}</td>
                        <td><button className="btn-small" onClick={() => window.open(`https://rvslogistics.com/?tracking=${s.tracking_number}`, '_blank')}>View</button></td>
                      </tr>
                    ))}
                    {filteredShipments.length === 0 && (<tr><td colSpan="6" className="no-data">No shipments found</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}

            {dashboardTab === 'pending' && (
              <div className="pending-shipments">
                {pendingLoading ? (<div className="loading-state">Loading pending orders...</div>) : (
                  <table>
                    <thead><tr><th>ORDER #</th><th>CUSTOMER</th><th>COUNTRY</th><th>AMOUNT</th><th>STORE</th><th>ORDER DATE</th></tr></thead>
                    <tbody>
                      {filteredPendingOrders.map(order => (
                        <tr key={`${order.store_type}-${order.id}`}>
                          <td>#{order.order_number}</td>
                          <td>{order.customer_name}</td>
                          <td>{order.country}</td>
                          <td>{order.currency} {parseFloat(order.total_price).toFixed(2)}</td>
                          <td><span className={`store-badge ${order.store_type}`}>{order.store_type === 'woocommerce' ? 'WC' : 'Shopify'}</span></td>
                          <td>{new Date(order.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                      {filteredPendingOrders.length === 0 && (<tr><td colSpan="6" className="no-data">No pending orders - all orders are fulfilled!</td></tr>)}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {dashboardTab === 'fulfilled' && (
              <div className="pending-shipments">
                {pendingLoading ? (<div className="loading-state">Loading fulfilled orders...</div>) : (
                  <table>
                    <thead><tr><th>TRACKING #</th><th>CUSTOMER</th><th>COUNTRY</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead>
                    <tbody>
                      {filteredFulfilledOrders.map(order => (
                        <tr key={order.id}>
                          <td>{order.tracking_number || '-'}</td>
                          <td>{order.customer_name}</td>
                          <td>{order.country}</td>
                          <td><span className={`status ${order.status || 'in_transit'}`}>{order.status || 'in_transit'}</span></td>
                          <td>{new Date(order.created_at).toLocaleDateString()}</td>
                          <td>{order.tracking_number ? <button className="btn-small" onClick={() => window.open(`https://rvslogistics.com/?tracking=${order.tracking_number}`, '_blank')}>View</button> : '-'}</td>
                        </tr>
                      ))}
                      {filteredFulfilledOrders.length === 0 && (<tr><td colSpan="6" className="no-data">{searchQuery ? 'No results found' : 'No fulfilled orders found.'}</td></tr>)}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {currentPage === 'shopify' && (
          <div className="shopify-settings">
            <h1>Shopify Settings</h1>
            <p className="description">Connect your Shopify stores to Trackisto.</p>

            <div className="url-converter">
              <p><strong>Quick Tip:</strong> Paste your Shopify Admin URL to auto-fill the domain</p>
              <div className="converter-row">
                <input type="text" placeholder="https://admin.shopify.com/store/your-store/..." value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} />
                <button onClick={handleConvertUrl}>Convert</button>
              </div>
            </div>

            {!showAddStore ? (
              <button className="btn-add-store" onClick={() => setShowAddStore(true)}>+ Add Shopify Store</button>
            ) : (
              <div className="store-form-container">
                <button className="btn-cancel" onClick={() => { setShowAddStore(false); resetStoreForm(); }}>Cancel</button>
                <form onSubmit={handleAddStore} className="store-form">
                  <h3 style={{marginBottom: '20px'}}>{editingStore ? 'Edit Store' : 'Add Shopify Store'}</h3>
                  
                  <div style={{background: '#f0f7e6', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #96bf48'}}>
                    <h4 style={{marginBottom: '15px', color: '#5c8a2f'}}>Shopify App Credentials</h4>
                    <p style={{fontSize: '14px', color: '#666', marginBottom: '15px'}}>Get these from: <strong>Shopify Partner Dashboard - Apps - Your App - Client credentials</strong></p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Store Name</label>
                        <input type="text" placeholder="My Store" value={storeForm.store_name} onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Shopify Domain *</label>
                        <input type="text" placeholder="your-store.myshopify.com" value={storeForm.domain} onChange={(e) => setStoreForm({ ...storeForm, domain: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Client ID *</label>
                        <input type="text" placeholder="Client ID" value={storeForm.client_id} onChange={(e) => setStoreForm({ ...storeForm, client_id: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Client Secret *</label>
                        <input type="password" placeholder="shpss_..." value={storeForm.client_secret} onChange={(e) => setStoreForm({ ...storeForm, client_secret: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={storeForm.delivery_days} onChange={(e) => setStoreForm({ ...storeForm, delivery_days: parseInt(e.target.value) })} min="1" required /></div>
                    <div className="form-group"><label>Send Offset (Days)</label><input type="number" value={storeForm.send_offset} onChange={(e) => setStoreForm({ ...storeForm, send_offset: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Fulfillment Time</label><select value={storeForm.fulfillment_time} onChange={(e) => setStoreForm({ ...storeForm, fulfillment_time: e.target.value })}>{timeOptions.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                    <div className="form-group"><label>Country of Origin</label><select value={storeForm.country_origin} onChange={(e) => setStoreForm({ ...storeForm, country_origin: e.target.value })} required><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Transit Country</label><select value={storeForm.transit_country} onChange={(e) => setStoreForm({ ...storeForm, transit_country: e.target.value })}><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Post Delivery Event</label><select value={storeForm.post_delivery_event} onChange={(e) => setStoreForm({ ...storeForm, post_delivery_event: e.target.value })}>{postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div className="form-group"><label>Sorting Days</label><input type="number" value={storeForm.sorting_days} onChange={(e) => setStoreForm({ ...storeForm, sorting_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Parcel Point</label><select value={storeForm.parcel_point ? 'Yes' : 'No'} onChange={(e) => setStoreForm({ ...storeForm, parcel_point: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></div>
                  </div>
                  <button type="submit" className="btn-submit" disabled={loading}>{loading ? 'Saving...' : (editingStore ? 'Update Store' : 'Add Store')}</button>
                </form>
              </div>
            )}

            <div className="stores-table">
              <h2>Connected Shopify Stores</h2>
              {stores.length === 0 ? <p className="no-stores">No Shopify stores added yet.</p> : (
                <table>
                  <thead><tr><th>Status</th><th>Store Name</th><th>Domain</th><th>Connection</th><th>Days</th><th>Actions</th></tr></thead>
                  <tbody>
                    {stores.map(store => (
                      <tr key={store.id}>
                        <td>
                          <span className={`status-indicator ${store.status === 'active' ? 'active' : 'inactive'}`} onClick={() => toggleStoreStatus(store)}>
                            {store.status === 'active' ? 'V' : 'X'}
                          </span>
                        </td>
                        <td>{store.store_name || '-'}</td>
                        <td>{store.domain}</td>
                        <td>
                          {store.is_connected ? (
                            <span className="connection-status connected">Connected</span>
                          ) : store.has_credentials ? (
                            <button className="btn-connect" onClick={() => handleConnectToShopify(store)}>Connect to Shopify</button>
                          ) : (
                            <span className="connection-status not-configured">Need credentials</span>
                          )}
                        </td>
                        <td>{store.delivery_days}</td>
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

        {currentPage === 'wordpress' && (
          <div className="shopify-settings">
            <h1>WordPress / WooCommerce Settings</h1>
            <p className="description">Connect your WooCommerce stores to Trackisto.</p>

            {!showAddWooStore ? (
              <button className="btn-add-woo-store" onClick={() => setShowAddWooStore(true)}>+ Add WooCommerce Store</button>
            ) : (
              <div className="store-form-container">
                <button className="btn-cancel" onClick={() => { setShowAddWooStore(false); resetWooStoreForm(); }}>Cancel</button>
                <form onSubmit={handleAddWooStore} className="store-form">
                  <h3 style={{marginBottom: '20px'}}>{editingWooStore ? 'Edit Store' : 'Add WooCommerce Store'}</h3>
                  
                  <div style={{background: '#f3f0f7', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #7f54b3'}}>
                    <h4 style={{marginBottom: '15px', color: '#7f54b3'}}>WooCommerce API Credentials</h4>
                    <p style={{fontSize: '14px', color: '#666', marginBottom: '15px'}}>Get these from: <strong>WooCommerce - Settings - Advanced - REST API</strong></p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Store Name</label>
                        <input type="text" placeholder="My WooCommerce Store" value={wooStoreForm.store_name} onChange={(e) => setWooStoreForm({ ...wooStoreForm, store_name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Website URL *</label>
                        <input type="text" placeholder="yoursite.com" value={wooStoreForm.domain} onChange={(e) => setWooStoreForm({ ...wooStoreForm, domain: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Consumer Key *</label>
                        <input type="text" placeholder="ck_..." value={wooStoreForm.client_id} onChange={(e) => setWooStoreForm({ ...wooStoreForm, client_id: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Consumer Secret *</label>
                        <input type="password" placeholder="cs_..." value={wooStoreForm.client_secret} onChange={(e) => setWooStoreForm({ ...wooStoreForm, client_secret: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={wooStoreForm.delivery_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, delivery_days: parseInt(e.target.value) })} min="1" required /></div>
                    <div className="form-group"><label>Send Offset (Days)</label><input type="number" value={wooStoreForm.send_offset} onChange={(e) => setWooStoreForm({ ...wooStoreForm, send_offset: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Fulfillment Time</label><select value={wooStoreForm.fulfillment_time} onChange={(e) => setWooStoreForm({ ...wooStoreForm, fulfillment_time: e.target.value })}>{timeOptions.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                    <div className="form-group"><label>Country of Origin</label><select value={wooStoreForm.country_origin} onChange={(e) => setWooStoreForm({ ...wooStoreForm, country_origin: e.target.value })} required><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Transit Country</label><select value={wooStoreForm.transit_country} onChange={(e) => setWooStoreForm({ ...wooStoreForm, transit_country: e.target.value })}><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Post Delivery Event</label><select value={wooStoreForm.post_delivery_event} onChange={(e) => setWooStoreForm({ ...wooStoreForm, post_delivery_event: e.target.value })}>{postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div className="form-group"><label>Sorting Days</label><input type="number" value={wooStoreForm.sorting_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, sorting_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Parcel Point</label><select value={wooStoreForm.parcel_point ? 'Yes' : 'No'} onChange={(e) => setWooStoreForm({ ...wooStoreForm, parcel_point: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></div>
                  </div>
                  <button type="submit" className="btn-submit-woo" disabled={loading}>{loading ? 'Saving...' : (editingWooStore ? 'Update Store' : 'Add Store')}</button>
                </form>
              </div>
            )}

            <div className="stores-table">
              <h2>Connected WooCommerce Stores</h2>
              {wooStores.length === 0 ? <p className="no-stores">No WooCommerce stores added yet.</p> : (
                <table>
                  <thead><tr><th>Status</th><th>Store Name</th><th>Domain</th><th>Connection</th><th>Days</th><th>Actions</th></tr></thead>
                  <tbody>
                    {wooStores.map(store => (
                      <tr key={store.id}>
                        <td>
                          <span className={`status-indicator ${store.status === 'active' ? 'active' : 'inactive'}`} onClick={() => toggleStoreStatus(store, true)}>
                            {store.status === 'active' ? 'V' : 'X'}
                          </span>
                        </td>
                        <td>{store.store_name || '-'}</td>
                        <td>{store.domain}</td>
                        <td>
                          {store.is_connected ? (
                            <span className="connection-status connected">Connected</span>
                          ) : (
                            <span className="connection-status not-configured">Need credentials</span>
                          )}
                        </td>
                        <td>{store.delivery_days}</td>
                        <td>
                          <button className="btn-edit" onClick={() => handleEditWooStore(store)}>Edit</button>
                          <button className="btn-delete" onClick={() => handleDeleteWooStore(store.id)}>Del</button>
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
          <div className="manual-entry">
            <h1>Manual Parcel Entry</h1>
            <div className="manual-entry-container">
              <div className="manual-entry-info">
                <p>This panel lets you manually register a parcel directly into the system.</p>
              </div>

              {generatedTracking && (
                <div className="success-box">
                  <h3>Tracking Created Successfully!</h3>
                  <div className="tracking-result">
                    <p><strong>Tracking Number:</strong> {generatedTracking.tracking_number}</p>
                    <p><strong>Customer:</strong> {generatedTracking.customer_name}</p>
                    <p><strong>Destination:</strong> {generatedTracking.country}</p>
                    <button className="btn-copy" onClick={copyTrackingNumber}>Copy Tracking Number</button>
                  </div>
                </div>
              )}

              <form onSubmit={handleManualSubmit} className="manual-form">
                <div className="form-section">
                  <h3 className="section-title">Customer Details</h3>
                  <div className="form-row">
                    <div className="form-group"><label>Full Name</label><input type="text" value={manualForm.customer_name} onChange={(e) => setManualForm({...manualForm, customer_name: e.target.value})} required /></div>
                    <div className="form-group"><label>Email Address</label><input type="email" value={manualForm.customer_email} onChange={(e) => setManualForm({...manualForm, customer_email: e.target.value})} /></div>
                  </div>
                  <div className="form-group full-width"><label>Shipping Address</label><textarea value={manualForm.shipping_address} onChange={(e) => setManualForm({...manualForm, shipping_address: e.target.value})} rows="2" /></div>
                  <div className="form-row three-col">
                    <div className="form-group"><label>City</label><input type="text" value={manualForm.city} onChange={(e) => setManualForm({...manualForm, city: e.target.value})} /></div>
                    <div className="form-group"><label>State / Region</label><input type="text" value={manualForm.state} onChange={(e) => setManualForm({...manualForm, state: e.target.value})} /></div>
                    <div className="form-group"><label>ZIP / Postal Code</label><input type="text" value={manualForm.zip_code} onChange={(e) => setManualForm({...manualForm, zip_code: e.target.value})} /></div>
                  </div>
                </div>

                <div className="form-section">
                  <h3 className="section-title">Delivery Info</h3>
                  <div className="form-row">
                    <div className="form-group"><label>Destination Country</label><select value={manualForm.country} onChange={(e) => setManualForm({...manualForm, country: e.target.value})} required><option value="">Select Country...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={manualForm.delivery_days} onChange={(e) => setManualForm({...manualForm, delivery_days: parseInt(e.target.value)})} min="1" /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Country of Origin</label><select value={manualForm.country_origin} onChange={(e) => setManualForm({...manualForm, country_origin: e.target.value})}><option value="">Select Country...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Transit Country</label><select value={manualForm.transit_country} onChange={(e) => setManualForm({...manualForm, transit_country: e.target.value})}><option value="">Select Country...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                  </div>
                </div>

                <button type="submit" className="btn-generate" disabled={loading}>{loading ? 'Generating...' : 'Generate Tracking'}</button>
              </form>
            </div>
          </div>
        )}

        {currentPage === 'missing' && (
          <div className="missing">
            <h1>Missing Entries</h1>
            <p>Shipments that need attention will appear here.</p>
            <div className="empty-state"><span className="empty-icon">No entries</span></div>
          </div>
        )}

        {currentPage === 'api' && (
          <div className="api-guide">
            <h1>Setup Guide</h1>
            
            <h2 style={{marginTop: '30px', color: '#5c8a2f'}}>Shopify Setup</h2>
            <ol>
              <li>Go to partners.shopify.com</li>
              <li>Create an app manually</li>
              <li>Set App URL: https://trackisto-backend.onrender.com</li>
              <li>Set Redirect URL: https://trackisto-backend.onrender.com/api/shopify/callback</li>
              <li>Copy Client ID and Client Secret</li>
              <li>Add store in Trackisto and click Connect to Shopify</li>
            </ol>

            <h2 style={{marginTop: '30px', color: '#7f54b3'}}>WooCommerce Setup</h2>
            <ol>
              <li>Go to your WordPress admin</li>
              <li>Navigate to WooCommerce - Settings - Advanced - REST API</li>
              <li>Click Add key</li>
              <li>Set Description: Trackisto, Permissions: Read/Write</li>
              <li>Click Generate API key</li>
              <li>Copy Consumer Key and Consumer Secret</li>
              <li>Add store in Trackisto WordPress Settings</li>
            </ol>

            <div className="warning-box">
              <strong>Note:</strong> WooCommerce requires HTTPS. Make sure your site has SSL enabled.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
