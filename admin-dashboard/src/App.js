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
  const [fulfilledPage, setFulfilledPage] = useState(1);
  const [fulfilledPageSize, setFulfilledPageSize] = useState(50);
  const [fulfilledPagination, setFulfilledPagination] = useState({ totalPages: 1, totalCount: 0 });
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [manualForm, setManualForm] = useState({
    customer_name: '', customer_email: '', shipping_address: '', city: '', state: '', zip_code: '',
    country: '', delivery_days: 7, country_origin: '', transit_country: '', sorting_days: 3,
    post_delivery_event: 'Redelivery', redelivery_days: 3, attempts: 1
  });
  const [generatedTracking, setGeneratedTracking] = useState(null);
  const [selectedOrders, setSelectedOrders] = useState([]);

  // Express Shipping state
  const [expressForm, setExpressForm] = useState({
    customer_name: '', customer_email: '', shipping_address: '',
    city: '', state: '', zip_code: '',
    destination_country: '', origin_country: '', delivery_days: 7
  });
  const [expressGenerated, setExpressGenerated] = useState(null);
  const [expressLoading, setExpressLoading] = useState(false);
  const [expressShipments, setExpressShipments] = useState([]);
  const [expressShipmentsLoading, setExpressShipmentsLoading] = useState(false);

  const fetchExpressShipments = async () => {
    setExpressShipmentsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/express/shipments?limit=500`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setExpressShipments(data.shipments || []);
      }
    } catch (err) { console.error('Error fetching express shipments:', err); }
    setExpressShipmentsLoading(false);
  };

  const handleCreateExpress = async (e) => {
    e.preventDefault();
    setExpressLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/express/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(expressForm)
      });
      const data = await response.json();
      if (response.ok) {
        setExpressGenerated(data);
        setExpressForm({
          customer_name: '', customer_email: '', shipping_address: '',
          city: '', state: '', zip_code: '',
          destination_country: '', origin_country: '', delivery_days: 7
        });
        fetchExpressShipments();
      } else {
        alert('Error: ' + (data.error || 'Failed to create express shipment'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
    setExpressLoading(false);
  };

  // Refund handler - triggers refund flow with automatic timing
  const handleRefund = async (trackingNumber, customerName) => {
    if (!window.confirm(`Start refund flow for ${customerName} (${trackingNumber})?\n\n• "Order Refunded" will show immediately\n• "Return to Sender" will appear tomorrow at 10:04\n\nThe WooCommerce order is NOT changed - this only affects the tracking page.`)) {
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/refund/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: trackingNumber })
      });
      const data = await response.json();
      if (response.ok) {
        alert(`✓ Refund activated for ${customerName}\n\nTracking URL:\nhttps://rvslogistics.com/?tracking=${trackingNumber}`);
        fetchFulfilledOrders();
      } else {
        alert('Error: ' + (data.error || 'Failed to create refund'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

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

  // Helper function to get store info by ID
  const getStoreInfo = (storeId) => {
    const allStores = [...stores, ...wooStores];
    const store = allStores.find(s => s.id === storeId);
    if (!store) return { name: 'Manual', type: 'manual', displayName: '✏️ Manual' };
    
    // Check if it's a WooCommerce store
    const isWoo = wooStores.some(s => s.id === storeId);
    const storeName = store.store_name || store.domain;
    const typeIcon = isWoo ? '🌐' : '🛒';
    
    return {
      name: storeName,
      type: isWoo ? 'woocommerce' : 'shopify',
      displayName: `${typeIcon} ${storeName}`
    };
  };

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
      // Fetch from both Shopify and WooCommerce
      const [shopifyRes, wooRes] = await Promise.all([
        fetch(`${API_URL}/api/shopify/pending-orders${storeFilter !== 'all' ? `?store=${storeFilter}` : ''}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/woocommerce/pending-orders`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      
      let allOrders = [];
      if (shopifyRes.ok) {
        const data = await shopifyRes.json();
        allOrders = [...allOrders, ...(data.orders || []).map(o => ({...o, store_type: 'shopify', store_name: o.store_name || o.store_domain}))];
      }
      if (wooRes.ok) {
        const data = await wooRes.json();
        // FIX: Filtrer fulfilled orders fra - vis kun ordrer der IKKE allerede har shipment
        const wooOrders = (data.orders || [])
          .filter(o => !o.has_shipment)
          .map(o => ({...o, store_type: 'woocommerce', store_name: o.store_name || o.store_domain}));
        allOrders = [...allOrders, ...wooOrders];
      }
      
      allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setPendingOrders(allOrders);
      setDashboardStats(prev => ({ ...prev, pending: allOrders.length }));
    } catch (error) { console.error('Error fetching pending orders:', error); }
    setPendingLoading(false);
  };

  const fetchFulfilledOrders = async (storeFilter = selectedStore, page = fulfilledPage, limit = fulfilledPageSize) => {
    setPendingLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/shipments?page=${page}&limit=${limit}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        let orders = data.shipments || [];
        if (storeFilter !== 'all') {
          const store = [...stores, ...wooStores].find(s => s.domain === storeFilter);
          if (store) orders = orders.filter(o => o.shopify_store_id === store.id);
        }
        setFulfilledOrders(orders);
        setFulfilledPagination(data.pagination || { totalPages: 1, totalCount: orders.length });
      }
    } catch (error) { console.error('Error fetching fulfilled orders:', error); }
    setPendingLoading(false);
  };

  // FIX: Ny funktion til at synkronisere completed WC-ordrer der mangler shipment records
  const syncCompletedOrders = async () => {
    if (!window.confirm('This will sync all completed WooCommerce orders that are missing shipment records. Continue?')) return;
    setPendingLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/woocommerce/sync-completed`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        alert(`✅ ${data.message}`);
        fetchDashboardData();
        fetchPendingOrders();
        fetchFulfilledOrders();
      } else {
        const data = await response.json();
        alert('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) { alert('Sync error: ' + error.message); }
    setPendingLoading(false);
  };

  const fetchAndFulfillOrders = async () => {
    const ordersToFulfill = selectedOrders.length > 0 ? selectedOrders : filteredPendingOrders;
    const orderCount = ordersToFulfill.length;
    
    if (orderCount === 0) {
      alert('No orders selected. Please select orders to fulfill.');
      return;
    }
    
    const confirmMsg = selectedOrders.length > 0 
      ? `This will fulfill ${orderCount} selected order(s) and send tracking emails. Continue?`
      : `This will fulfill ALL ${orderCount} pending order(s) and send tracking emails. Continue?`;
    
    if (!window.confirm(confirmMsg)) return;
    setPendingLoading(true);
    
    try {
      // Group orders by store type
      const shopifyOrders = ordersToFulfill.filter(o => o.store_type === 'shopify');
      const wooOrders = ordersToFulfill.filter(o => o.store_type === 'woocommerce');
      
      let totalFulfilled = 0;
      let messages = [];
      
      // Fulfill Shopify orders
      if (shopifyOrders.length > 0) {
        const shopifyRes = await fetch(`${API_URL}/api/shopify/fetch-and-fulfill`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ orderIds: shopifyOrders.map(o => o.id) })
        });
        if (shopifyRes.ok) {
          const data = await shopifyRes.json();
          totalFulfilled += data.fulfilled || 0;
          if (data.fulfilled > 0) messages.push(`Shopify: ${data.fulfilled}`);
        }
      }
      
      // Fulfill WooCommerce orders
      if (wooOrders.length > 0) {
        const wooRes = await fetch(`${API_URL}/api/woocommerce/fetch-and-fulfill`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ orderIds: wooOrders.map(o => o.id) })
        });
        if (wooRes.ok) {
          const data = await wooRes.json();
          totalFulfilled += data.fulfilled || 0;
          if (data.fulfilled > 0) messages.push(`WooCommerce: ${data.fulfilled}`);
        }
      }
      
      alert(`✅ Fulfilled ${totalFulfilled} orders${messages.length > 0 ? ' (' + messages.join(', ') + ')' : ''}`);
      setSelectedOrders([]);
      fetchDashboardData();
      fetchPendingOrders();
    } catch (error) { alert('Error: ' + error.message); }
    setPendingLoading(false);
  };

  const toggleOrderSelection = (order) => {
    const orderKey = `${order.store_type}-${order.id}`;
    setSelectedOrders(prev => {
      if (prev.find(o => `${o.store_type}-${o.id}` === orderKey)) {
        return prev.filter(o => `${o.store_type}-${o.id}` !== orderKey);
      } else {
        return [...prev, order];
      }
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.length === filteredPendingOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders([...filteredPendingOrders]);
    }
  };

  const skipOrder = async (order) => {
    if (!window.confirm(`Skip order #${order.order_number} from ${order.customer_name}?\n\nThis order will NOT be fulfilled and the customer will NOT receive tracking.`)) return;
    try {
      const response = await fetch(`${API_URL}/api/woocommerce/skip-order`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, customer_name: order.customer_name, store_type: order.store_type || 'woocommerce' })
      });
      if (response.ok) {
        setPendingOrders(prev => prev.filter(o => !(o.id === order.id && o.store_type === order.store_type)));
        setSelectedOrders(prev => prev.filter(o => !(o.id === order.id && o.store_type === order.store_type)));
        alert(`✅ Order #${order.order_number} skipped - customer will not receive tracking.`);
      } else {
        const data = await response.json();
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) { alert('Error: ' + error.message); }
  };

  const isOrderSelected = (order) => {
    return selectedOrders.some(o => `${o.store_type}-${o.id}` === `${order.store_type}-${order.id}`);
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
    if (token) {
      // Verify token is still valid before loading dashboard
      fetch(`${API_URL}/api/auth/verify`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => {
          if (res.ok) {
            setIsLoggedIn(true);
            fetchDashboardData();
          } else {
            // Token expired or invalid — force re-login
            localStorage.removeItem('token');
            setToken(null);
            setIsLoggedIn(false);
          }
        })
        .catch(() => {
          setIsLoggedIn(true);
          fetchDashboardData();
        });
    }
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
    return '';
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
        if (data.message) alert(`✅ ${data.message}`);
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
        if (data.message) alert(`✅ ${data.message}`);
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
      store_name: store.store_name || '', 
      domain: store.domain || '', 
      client_id: store.client_id || '',
      client_secret: store.client_secret || '',
      delivery_days: store.delivery_days || 7, 
      send_offset: store.send_offset || 0,
      fulfillment_time: store.fulfillment_time || '10:00',
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

  const handleEditWooStore = (store) => {
    setWooStoreForm({
      store_name: store.store_name || '', 
      domain: store.domain || '', 
      client_id: store.client_id || '',
      client_secret: store.client_secret || '',
      delivery_days: store.delivery_days || 7, 
      send_offset: store.send_offset || 0,
      fulfillment_time: store.fulfillment_time || '10:00',
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

  // Connect to Shopify - åbner OAuth flow
  const handleConnectToShopify = (store) => {
    if (!store.client_id || !store.client_secret) {
      alert('Please add Client ID and Client Secret first.\n\nEdit the store to add your Shopify App credentials.');
      return;
    }
    // Åbn OAuth flow i nyt vindue
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

  // Get only connected stores for dropdown (both Shopify and WooCommerce)
  const connectedStores = [...stores.filter(s => s.is_connected), ...wooStores.filter(s => s.is_connected)];

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
          <li className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => navigateTo('dashboard')}>📊 Dashboard</li>
          <li className={currentPage === 'shipments' ? 'active' : ''} onClick={() => navigateTo('shipments')}>📦 Manual Entry</li>
          <li className={currentPage === 'express' ? 'active' : ''} onClick={() => navigateTo('express')} style={{background: currentPage === 'express' ? 'linear-gradient(135deg, #f59e0b 0%, #d4af37 100%)' : ''}}>✈ Express Shipping</li>
          <li className={currentPage === 'missing' ? 'active' : ''} onClick={() => navigateTo('missing')}>⏳ Missing Entries</li>
          <li className={currentPage === 'shopify' ? 'active' : ''} onClick={() => navigateTo('shopify')}>🛒 Shopify Settings</li>
          <li className={currentPage === 'wordpress' ? 'active' : ''} onClick={() => navigateTo('wordpress')}>🌐 WordPress Settings</li>
        </ul>
        <div className="nav-bottom">
          <div className="nav-item" onClick={() => navigateTo('api')}>📖 Setup Guide</div>
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
              <button className={`tab-btn ${dashboardTab === 'express' ? 'active' : ''}`} onClick={() => { setDashboardTab('express'); if (expressShipments.length === 0) fetchExpressShipments(); }} style={dashboardTab === 'express' ? {background:'linear-gradient(135deg,#f59e0b 0%,#d4af37 100%)',color:'white',border:'none'} : {}}>✈ Express Shipments</button>
              
              <div className="store-filter">
                <select value={selectedStore} onChange={(e) => handleStoreFilterChange(e.target.value)}>
                  <option value="all">All Stores</option>
                  {connectedStores.map(store => (
                    <option key={store.id} value={store.domain}>
                      {store.store_name || store.domain}
                    </option>
                  ))}
                </select>
              </div>

              {(dashboardTab === 'fulfilled' || dashboardTab === 'recent') && (
                <div className="search-bar-inline">
                  <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="search-input-inline" />
                  {searchQuery && <button className="search-clear-inline" onClick={() => setSearchQuery('')}>✕</button>}
                </div>
              )}
              
              <button className="refresh-btn" onClick={() => { fetchPendingOrders(); fetchFulfilledOrders(); setSelectedOrders([]); }} disabled={pendingLoading}>🔄 Refresh</button>
              <button className="refresh-btn" onClick={syncCompletedOrders} disabled={pendingLoading} title="Sync completed WooCommerce orders missing from Trackisto">🔗 Sync WC</button>
              {dashboardTab === 'pending' && (
                <button className="fetch-btn" onClick={fetchAndFulfillOrders} disabled={pendingLoading}>
                  <span className="fetch-icon">⬇</span>
                  {pendingLoading ? 'Processing...' : selectedOrders.length > 0 ? `Fulfill ${selectedOrders.length} Selected` : 'Fetch All Pending'}
                </button>
              )}
            </div>

            {dashboardTab === 'recent' && (
              <div className="recent-shipments">
                <table>
                  <thead><tr><th>ORDER #</th><th>TRACKING #</th><th>CUSTOMER</th><th>COUNTRY</th><th>STORE</th><th>STATUS</th><th>CREATED</th><th>DELIVERY DATE</th><th>ACTIONS</th></tr></thead>
                  <tbody>
                    {filteredShipments.slice(0, 10).map(s => {
                      const storeInfo = getStoreInfo(s.shopify_store_id);
                      const deliveryDate = s.created_at && s.delivery_days
                        ? new Date(new Date(s.created_at).getTime() + s.delivery_days * 24 * 60 * 60 * 1000).toLocaleDateString()
                        : '-';
                      return (
                        <tr key={s.id}>
                          <td>{s.shopify_order_id ? `#${s.shopify_order_id}` : '-'}</td>
                          <td>{s.tracking_number}</td>
                          <td>{s.customer_name}</td>
                          <td>{s.country}</td>
                          <td>
                            <span className={`store-badge ${storeInfo.type}`}>
                              {storeInfo.displayName}
                            </span>
                          </td>
                          <td><span className={`status ${s.status}`}>{s.status}</span></td>
                          <td>{new Date(s.created_at).toLocaleDateString()}</td>
                          <td>{deliveryDate}</td>
                          <td style={{display:'flex',gap:'4px'}}>
                            <button className="btn-small" onClick={() => window.open(`https://rvslogistics.com/?tracking=${s.tracking_number}`, '_blank')}>View</button>
                            <button className="btn-small" style={{background:'#dc3545',color:'white',border:'none'}} onClick={() => handleRefund(s.tracking_number, s.customer_name)}>Refund</button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredShipments.length === 0 && (<tr><td colSpan="9" className="no-data">No shipments found</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}

            {dashboardTab === 'pending' && (
              <div className="pending-shipments">
                {pendingLoading ? (<div className="loading-state">Loading pending orders...</div>) : (
                  <>
                    {filteredPendingOrders.length > 0 && (
                      <div className="selection-info">
                        <span>{selectedOrders.length} of {filteredPendingOrders.length} selected</span>
                        {selectedOrders.length > 0 && (
                          <button className="btn-clear-selection" onClick={() => setSelectedOrders([])}>Clear selection</button>
                        )}
                      </div>
                    )}
                    <table>
                      <thead>
                        <tr>
                          <th className="checkbox-col">
                            <input 
                              type="checkbox" 
                              checked={filteredPendingOrders.length > 0 && selectedOrders.length === filteredPendingOrders.length}
                              onChange={toggleSelectAll}
                              title="Select all"
                            />
                          </th>
                          <th>ORDER #</th><th>CUSTOMER</th><th>COUNTRY</th><th>AMOUNT</th><th>STORE</th><th>ORDER DATE</th><th>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPendingOrders.map(order => (
                          <tr key={`${order.store_type}-${order.id}`} className={isOrderSelected(order) ? 'selected-row' : ''}>
                            <td className="checkbox-col">
                              <input 
                                type="checkbox" 
                                checked={isOrderSelected(order)}
                                onChange={() => toggleOrderSelection(order)}
                              />
                            </td>
                            <td>#{order.order_number}</td>
                            <td>{order.customer_name}</td>
                            <td>{order.country}</td>
                            <td>{order.currency} {parseFloat(order.total_price).toFixed(2)}</td>
                            <td><span className={`store-badge ${order.store_type}`}>{order.store_type === 'woocommerce' ? '🌐' : '🛒'} {order.store_name || order.store_domain}</span>{order.wc_status === 'completed' && <span className="status completed" style={{marginLeft: '4px', fontSize: '10px'}}>WC:completed</span>}</td>
                            <td>{new Date(order.created_at).toLocaleDateString()}</td>
                            <td><button className="btn-small btn-delete" onClick={() => skipOrder(order)} title="Skip - customer will not get tracking">⛔ Skip</button></td>
                          </tr>
                        ))}
                        {filteredPendingOrders.length === 0 && (<tr><td colSpan="8" className="no-data">🎉 No pending orders - all orders are fulfilled!</td></tr>)}
                      </tbody>
                    </table>
                  </>
                )}
                <div className="pending-info"><p>Pending Shipments (Page 1 of 1)</p></div>
              </div>
            )}

            {dashboardTab === 'fulfilled' && (
              <div className="pending-shipments">
                {pendingLoading ? (<div className="loading-state">Loading fulfilled orders...</div>) : (
                  <table>
                    <thead><tr><th>ORDER #</th><th>TRACKING #</th><th>CUSTOMER</th><th>COUNTRY</th><th>STORE</th><th>STATUS</th><th>CREATED</th><th>DELIVERY DATE</th><th>ACTIONS</th></tr></thead>
                    <tbody>
                      {filteredFulfilledOrders.map(order => {
                        const storeInfo = getStoreInfo(order.shopify_store_id);
                        const deliveryDate = order.created_at && order.delivery_days
                          ? new Date(new Date(order.created_at).getTime() + order.delivery_days * 24 * 60 * 60 * 1000).toLocaleDateString()
                          : '-';
                        return (
                          <tr key={order.id}>
                            <td>{order.shopify_order_id ? `#${order.shopify_order_id}` : '-'}</td>
                            <td>{order.tracking_number || '-'}</td>
                            <td>{order.customer_name}</td>
                            <td>{order.country}</td>
                            <td>
                              <span className={`store-badge ${storeInfo.type}`}>
                                {storeInfo.displayName}
                              </span>
                            </td>
                            <td><span className={`status ${order.status || 'in_transit'}`}>{order.status || 'in_transit'}</span></td>
                            <td>{new Date(order.created_at).toLocaleDateString()}</td>
                            <td>{deliveryDate}</td>
                            <td>
                              {order.tracking_number ? (
                                <div style={{display:'flex',gap:'4px'}}>
                                  <button className="btn-small" onClick={() => window.open(`https://rvslogistics.com/?tracking=${order.tracking_number}`, '_blank')}>View</button>
                                  <button className="btn-small" style={{background:'#dc3545',color:'white',border:'none'}} onClick={() => handleRefund(order.tracking_number, order.customer_name)}>Refund</button>
                                </div>
                              ) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredFulfilledOrders.length === 0 && (<tr><td colSpan="9" className="no-data">{searchQuery ? 'No results found' : 'No fulfilled orders found. Click "Refresh" to load.'}</td></tr>)}
                    </tbody>
                  </table>
                )}
                <div className="pending-info"><p>Fulfilled Shipments ({fulfilledPagination.totalCount} results)</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                    {fulfilledPagination.totalPages > 1 && (
                      <>
                        <button
                          className="btn-small"
                          onClick={() => { const p = fulfilledPage - 1; setFulfilledPage(p); fetchFulfilledOrders(selectedStore, p); }}
                          disabled={fulfilledPage <= 1}
                        >← Previous</button>
                        <span style={{ fontSize: '14px', color: '#555' }}>Page {fulfilledPage} of {fulfilledPagination.totalPages}</span>
                        <button
                          className="btn-small"
                          onClick={() => { const p = fulfilledPage + 1; setFulfilledPage(p); fetchFulfilledOrders(selectedStore, p); }}
                          disabled={fulfilledPage >= fulfilledPagination.totalPages}
                        >Next →</button>
                      </>
                    )}
                    <span style={{ fontSize: '14px', color: '#555', marginLeft: '12px' }}>Show</span>
                    <select
                      value={fulfilledPageSize}
                      onChange={(e) => { const size = parseInt(e.target.value); setFulfilledPageSize(size); setFulfilledPage(1); fetchFulfilledOrders(selectedStore, 1, size); }}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '14px' }}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                      <option value={500}>500</option>
                    </select>
                    <span style={{ fontSize: '14px', color: '#555' }}>per page</span>
                  </div>
                </div>
              </div>
            )}

            {dashboardTab === 'express' && (
              <div className="pending-shipments">
                {expressShipmentsLoading ? (
                  <div className="loading-state">Loading express shipments...</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>TRACKING #</th>
                        <th>CUSTOMER</th>
                        <th>ROUTE</th>
                        <th>DELIVERY DAYS</th>
                        <th>STATUS</th>
                        <th>CREATED</th>
                        <th>DELIVERY DATE</th>
                        <th>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expressShipments.map(s => {
                        const deliveryDate = s.created_at && s.delivery_days
                          ? new Date(new Date(s.created_at).getTime() + s.delivery_days * 24 * 60 * 60 * 1000).toLocaleDateString()
                          : '-';
                        return (
                          <tr key={s.id} style={{background:'linear-gradient(90deg, #fffbeb 0%, #fff 30%)'}}>
                            <td style={{fontFamily:'monospace',fontSize:'13px'}}>{s.tracking_number}</td>
                            <td>{s.customer_name}</td>
                            <td><span style={{fontSize:'13px'}}>{s.origin_country} → {s.destination_country}</span></td>
                            <td><span style={{display:'inline-flex',alignItems:'center',gap:'4px',background:'linear-gradient(135deg,#f59e0b 0%,#d4af37 100%)',color:'white',padding:'4px 10px',borderRadius:'12px',fontSize:'11px',fontWeight:'700'}}>✈ {s.delivery_days} DAYS</span></td>
                            <td><span className={`status ${s.status || 'in_transit'}`}>{s.status || 'in_transit'}</span></td>
                            <td>{new Date(s.created_at).toLocaleDateString()}</td>
                            <td><strong>{deliveryDate}</strong></td>
                            <td><button className="btn-small" onClick={() => window.open(`https://rvslogistics.com/express.html?tracking=${s.tracking_number}`, '_blank')}>View</button></td>
                          </tr>
                        );
                      })}
                      {expressShipments.length === 0 && (
                        <tr><td colSpan="8" className="no-data">No express shipments yet. Create one from the Express Shipping menu.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
                <div className="pending-info">
                  <p>Express Shipments ({expressShipments.length} results)</p>
                </div>
              </div>
            )}
          </div>
        )}

        {currentPage === 'shopify' && (
          <div className="shopify-settings">
            <h1>🛒 Shopify Settings</h1>
            <p className="description">Connect your Shopify stores to Trackisto. Each store needs its own Shopify App with Client ID and Secret.</p>

            <div className="url-converter">
              <p>📋 <strong>Quick Tip:</strong> Paste your Shopify Admin URL to auto-fill the domain</p>
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
                  <h3 style={{marginBottom: '20px', color: '#2c3e50'}}>{editingStore ? 'Edit Store' : 'Add New Store'}</h3>
                  
                  <div style={{background: '#f0f4ff', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #667eea'}}>
                    <h4 style={{marginBottom: '15px', color: '#667eea'}}>🔑 Shopify App Credentials</h4>
                    <p style={{fontSize: '14px', color: '#666', marginBottom: '15px'}}>
                      Get these from: <strong>Shopify Partner Dashboard → Apps → Your App → Client credentials</strong>
                    </p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Store Name</label>
                        <input type="text" placeholder="My Store" value={storeForm.store_name} onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })} />
                        <small className="field-hint">Display name (shown in dropdown)</small>
                      </div>
                      <div className="form-group">
                        <label>Shopify Domain *</label>
                        <input type="text" placeholder="your-store.myshopify.com" value={storeForm.domain} onChange={(e) => setStoreForm({ ...storeForm, domain: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Client ID *</label>
                        <input type="text" placeholder="b9dcbb77774968045304..." value={storeForm.client_id} onChange={(e) => setStoreForm({ ...storeForm, client_id: e.target.value })} />
                        <small className="field-hint">From Shopify App → Client credentials</small>
                      </div>
                      <div className="form-group">
                        <label>Client Secret *</label>
                        <input type="password" placeholder="shpss_..." value={storeForm.client_secret} onChange={(e) => setStoreForm({ ...storeForm, client_secret: e.target.value })} />
                        <small className="field-hint">From Shopify App → Client credentials</small>
                      </div>
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={storeForm.delivery_days} onChange={(e) => setStoreForm({ ...storeForm, delivery_days: parseInt(e.target.value) })} min="1" required /></div>
                    <div className="form-group"><label>Send Offset (Days)</label><input type="number" value={storeForm.send_offset} onChange={(e) => setStoreForm({ ...storeForm, send_offset: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Fulfillment Time</label><select value={storeForm.fulfillment_time} onChange={(e) => setStoreForm({ ...storeForm, fulfillment_time: e.target.value })}>{timeOptions.map(t => <option key={t} value={t}>{t}</option>)}</select><small className="field-hint">Daily fulfillment time (Danish time)</small></div>
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
              {stores.length === 0 ? <p className="no-stores">No stores added yet. Click "+ Add Shopify Store" to get started.</p> : (
                <table>
                  <thead><tr><th>Status</th><th>Store Name</th><th>Domain</th><th>Connection</th><th>Days</th><th>Fulfill Time</th><th>Actions</th></tr></thead>
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
                        <td>{store.store_name || '-'}</td>
                        <td>{store.domain}</td>
                        <td>
                          {store.is_connected ? (
                            <span className="connection-status connected">✓ Connected</span>
                          ) : store.has_credentials ? (
                            <button className="btn-connect" onClick={() => handleConnectToShopify(store)}>
                              🔗 Connect to Shopify
                            </button>
                          ) : (
                            <span className="connection-status not-configured">⚠️ Need credentials</span>
                          )}
                        </td>
                        <td>{store.delivery_days}</td>
                        <td>{store.fulfillment_time || '16:00'}</td>
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
            <h1>🌐 WordPress / WooCommerce Settings</h1>
            <p className="description">Connect your WooCommerce stores to Trackisto. WooCommerce connects automatically when you add your API credentials.</p>

            {!showAddWooStore ? (
              <button className="btn-add-woo-store" onClick={() => setShowAddWooStore(true)}>+ Add WooCommerce Store</button>
            ) : (
              <div className="store-form-container">
                <button className="btn-cancel" onClick={() => { setShowAddWooStore(false); resetWooStoreForm(); }}>✕ Cancel</button>
                <form onSubmit={handleAddWooStore} className="store-form">
                  <h3 style={{marginBottom: '20px', color: '#2c3e50'}}>{editingWooStore ? 'Edit Store' : 'Add New WooCommerce Store'}</h3>
                  
                  <div style={{background: '#f3f0f7', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #7f54b3'}}>
                    <h4 style={{marginBottom: '15px', color: '#7f54b3'}}>🔑 WooCommerce API Credentials</h4>
                    <p style={{fontSize: '14px', color: '#666', marginBottom: '15px'}}>
                      Get these from: <strong>WooCommerce → Settings → Advanced → REST API → Add key</strong>
                    </p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Store Name</label>
                        <input type="text" placeholder="My WooCommerce Store" value={wooStoreForm.store_name} onChange={(e) => setWooStoreForm({ ...wooStoreForm, store_name: e.target.value })} />
                        <small className="field-hint">Display name (shown in dropdown)</small>
                      </div>
                      <div className="form-group">
                        <label>Website URL *</label>
                        <input type="text" placeholder="yoursite.com" value={wooStoreForm.domain} onChange={(e) => setWooStoreForm({ ...wooStoreForm, domain: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Consumer Key *</label>
                        <input type="text" placeholder="ck_..." value={wooStoreForm.client_id} onChange={(e) => setWooStoreForm({ ...wooStoreForm, client_id: e.target.value })} />
                        <small className="field-hint">From WooCommerce → REST API</small>
                      </div>
                      <div className="form-group">
                        <label>Consumer Secret *</label>
                        <input type="password" placeholder="cs_..." value={wooStoreForm.client_secret} onChange={(e) => setWooStoreForm({ ...wooStoreForm, client_secret: e.target.value })} />
                        <small className="field-hint">From WooCommerce → REST API</small>
                      </div>
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group"><label>Delivery Days</label><input type="number" value={wooStoreForm.delivery_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, delivery_days: parseInt(e.target.value) })} min="1" required /></div>
                    <div className="form-group"><label>Send Offset (Days)</label><input type="number" value={wooStoreForm.send_offset} onChange={(e) => setWooStoreForm({ ...wooStoreForm, send_offset: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Fulfillment Time</label><select value={wooStoreForm.fulfillment_time} onChange={(e) => setWooStoreForm({ ...wooStoreForm, fulfillment_time: e.target.value })}>{timeOptions.map(t => <option key={t} value={t}>{t}</option>)}</select><small className="field-hint">Daily fulfillment time (Danish time)</small></div>
                    <div className="form-group"><label>Country of Origin</label><select value={wooStoreForm.country_origin} onChange={(e) => setWooStoreForm({ ...wooStoreForm, country_origin: e.target.value })} required><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Transit Country</label><select value={wooStoreForm.transit_country} onChange={(e) => setWooStoreForm({ ...wooStoreForm, transit_country: e.target.value })}><option value="">Select...</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="form-group"><label>Post Delivery Event</label><select value={wooStoreForm.post_delivery_event} onChange={(e) => setWooStoreForm({ ...wooStoreForm, post_delivery_event: e.target.value })}>{postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div className="form-group"><label>Sorting Days</label><input type="number" value={wooStoreForm.sorting_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, sorting_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Parcel Point</label><select value={wooStoreForm.parcel_point ? 'Yes' : 'No'} onChange={(e) => setWooStoreForm({ ...wooStoreForm, parcel_point: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></div>
                    <div className="form-group"><label>Parcel Point Days</label><input type="number" value={wooStoreForm.parcel_point_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, parcel_point_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Redelivery Active</label><select value={wooStoreForm.redelivery_active ? 'Yes' : 'No'} onChange={(e) => setWooStoreForm({ ...wooStoreForm, redelivery_active: e.target.value === 'Yes' })}><option>No</option><option>Yes</option></select></div>
                    <div className="form-group"><label>Redelivery Days</label><input type="number" value={wooStoreForm.redelivery_days} onChange={(e) => setWooStoreForm({ ...wooStoreForm, redelivery_days: parseInt(e.target.value) })} min="0" /></div>
                    <div className="form-group"><label>Attempts</label><input type="number" value={wooStoreForm.attempts} onChange={(e) => setWooStoreForm({ ...wooStoreForm, attempts: parseInt(e.target.value) })} min="1" /></div>
                  </div>
                  <button type="submit" className="btn-submit-woo" disabled={loading}>{loading ? 'Saving...' : (editingWooStore ? 'Update Store' : 'Add Store')}</button>
                </form>
              </div>
            )}

            <div className="stores-table">
              <h2>Connected WooCommerce Stores</h2>
              {wooStores.length === 0 ? <p className="no-stores">No WooCommerce stores added yet. Click "+ Add WooCommerce Store" to get started.</p> : (
                <table>
                  <thead><tr><th>Status</th><th>Store Name</th><th>Domain</th><th>Connection</th><th>Days</th><th>Fulfill Time</th><th>Actions</th></tr></thead>
                  <tbody>
                    {wooStores.map(store => (
                      <tr key={store.id}>
                        <td>
                          <span 
                            className={`status-indicator ${store.status === 'active' ? 'active' : 'inactive'}`} 
                            onClick={() => toggleStoreStatus(store, true)}
                            title={store.status === 'active' ? 'Active - Click to deactivate' : 'Inactive - Click to activate'}
                          >
                            {store.status === 'active' ? '✓' : '✕'}
                          </span>
                        </td>
                        <td>{store.store_name || '-'}</td>
                        <td>{store.domain}</td>
                        <td>
                          {store.is_connected ? (
                            <span className="connection-status connected">✓ Connected</span>
                          ) : (
                            <span className="connection-status not-configured">⚠️ Need credentials</span>
                          )}
                        </td>
                        <td>{store.delivery_days}</td>
                        <td>{store.fulfillment_time || '16:00'}</td>
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
                <p>A tracking number is automatically generated using the customer's country code and a unique 13-digit identifier.</p>
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
                  <div className="form-group" style={{maxWidth: '250px'}}><label>Sorting Days</label><input type="number" value={manualForm.sorting_days} onChange={(e) => setManualForm({...manualForm, sorting_days: parseInt(e.target.value)})} min="0" /></div>
                </div>

                <div className="form-section">
                  <h3 className="section-title">Post Delivery Settings</h3>
                  <div className="form-group" style={{maxWidth: '250px'}}><label>Post Delivery Event</label><select value={manualForm.post_delivery_event} onChange={(e) => setManualForm({...manualForm, post_delivery_event: e.target.value})}>{postDeliveryEvents.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  <div className="form-row">
                    <div className="form-group"><label>Redelivery Days</label><input type="number" value={manualForm.redelivery_days} onChange={(e) => setManualForm({...manualForm, redelivery_days: parseInt(e.target.value)})} min="0" /></div>
                    <div className="form-group"><label>Attempts</label><input type="number" value={manualForm.attempts} onChange={(e) => setManualForm({...manualForm, attempts: parseInt(e.target.value)})} min="1" /></div>
                  </div>
                </div>

                <button type="submit" className="btn-generate" disabled={loading}>{loading ? 'Generating...' : 'Generate Tracking'}</button>
              </form>
            </div>
          </div>
        )}

        {currentPage === 'express' && (
          <div style={{padding:'40px',maxWidth:'900px',margin:'0 auto'}}>
            <div style={{background:'#fff',borderRadius:'12px',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',padding:'40px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'16px',marginBottom:'8px'}}>
                <div style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'56px',height:'56px',background:'linear-gradient(135deg,#f59e0b 0%,#d4af37 100%)',borderRadius:'14px',color:'white',fontSize:'28px',boxShadow:'0 4px 12px rgba(245,158,11,0.3)'}}>✈</div>
                <h1 style={{margin:0,fontSize:'28px',fontWeight:'700',color:'#0d234b'}}>Create Express Shipment</h1>
              </div>
              <p style={{color:'#6b7280',fontSize:'14px',marginBottom:'24px',marginLeft:'72px'}}>Premium priority air delivery service</p>

              {expressGenerated && (
                <div style={{background:'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)',border:'2px solid #f59e0b',borderRadius:'12px',padding:'20px',marginBottom:'24px'}}>
                  <h3 style={{color:'#92400e',marginBottom:'12px',marginTop:0}}>✈ Express Shipment Created!</h3>
                  <p style={{margin:'6px 0'}}><strong>Tracking Number:</strong> <code style={{background:'#fff',padding:'4px 8px',borderRadius:'4px',color:'#0d234b'}}>{expressGenerated.tracking_number}</code></p>
                  <p style={{margin:'6px 0'}}><strong>Customer:</strong> {expressGenerated.shipment.customer_name}</p>
                  <p style={{margin:'6px 0'}}><strong>Route:</strong> {expressGenerated.shipment.origin_country} → {expressGenerated.shipment.destination_country}</p>
                  <p style={{margin:'6px 0'}}><strong>Delivery Days:</strong> {expressGenerated.shipment.delivery_days} days</p>
                  <p style={{margin:'6px 0'}}><strong>Customer Tracking Link:</strong></p>
                  <p style={{margin:'4px 0'}}><a href={`https://rvslogistics.com/express.html?tracking=${expressGenerated.tracking_number}`} target="_blank" rel="noopener noreferrer" style={{color:'#0d234b',fontWeight:'600',wordBreak:'break-all'}}>{`https://rvslogistics.com/express.html?tracking=${expressGenerated.tracking_number}`}</a></p>
                  <div style={{marginTop:'14px',display:'flex',gap:'8px'}}>
                    <button style={{background:'#29ABE2',color:'white',border:'none',padding:'10px 18px',borderRadius:'6px',cursor:'pointer',fontWeight:'600'}} onClick={() => navigator.clipboard.writeText(`https://rvslogistics.com/express.html?tracking=${expressGenerated.tracking_number}`)}>📋 Copy Link</button>
                    <button style={{background:'#f59e0b',color:'white',border:'none',padding:'10px 18px',borderRadius:'6px',cursor:'pointer',fontWeight:'600'}} onClick={() => setExpressGenerated(null)}>+ Create Another</button>
                  </div>
                </div>
              )}

              <div style={{background:'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)',borderLeft:'4px solid #f59e0b',padding:'16px 20px',borderRadius:'8px',marginBottom:'24px'}}>
                <p style={{fontSize:'13px',color:'#78350f',margin:'6px 0'}}><strong style={{color:'#92400e'}}>Express Air Service:</strong> Direct flight delivery with priority handling</p>
                <p style={{fontSize:'13px',color:'#78350f',margin:'6px 0'}}><strong style={{color:'#92400e'}}>Delivery options:</strong> 2 to 10 days (always realistic for the route)</p>
                <p style={{fontSize:'13px',color:'#78350f',margin:'6px 0'}}><strong style={{color:'#92400e'}}>Tracking events:</strong> 7-14 events scaling with delivery time</p>
              </div>

              <form onSubmit={handleCreateExpress}>
                <h3 style={{color:'#29ABE2',fontSize:'14px',fontWeight:'700',marginBottom:'14px',paddingBottom:'8px',borderBottom:'1px solid #e5e7eb',marginTop:0}}>Customer Details</h3>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'12px'}}>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Full Name *</label>
                    <input type="text" required value={expressForm.customer_name} onChange={(e) => setExpressForm({...expressForm, customer_name: e.target.value})} placeholder="Marie Dubois" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box'}} />
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Email Address</label>
                    <input type="email" value={expressForm.customer_email} onChange={(e) => setExpressForm({...expressForm, customer_email: e.target.value})} placeholder="customer@example.com" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box'}} />
                  </div>
                </div>

                <div style={{marginBottom:'12px'}}>
                  <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Shipping Address</label>
                  <textarea rows="2" value={expressForm.shipping_address} onChange={(e) => setExpressForm({...expressForm, shipping_address: e.target.value})} placeholder="42 Avenue Victor Hugo" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box',resize:'vertical'}} />
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'12px'}}>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>City</label>
                    <input type="text" value={expressForm.city} onChange={(e) => setExpressForm({...expressForm, city: e.target.value})} placeholder="Paris" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box'}} />
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>State / Region</label>
                    <input type="text" value={expressForm.state} onChange={(e) => setExpressForm({...expressForm, state: e.target.value})} placeholder="Île-de-France" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box'}} />
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>ZIP / Postal Code</label>
                    <input type="text" value={expressForm.zip_code} onChange={(e) => setExpressForm({...expressForm, zip_code: e.target.value})} placeholder="75008" style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box'}} />
                  </div>
                </div>

                <h3 style={{color:'#29ABE2',fontSize:'14px',fontWeight:'700',marginTop:'28px',marginBottom:'14px',paddingBottom:'8px',borderBottom:'1px solid #e5e7eb'}}>Express Air Delivery Info</h3>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'12px'}}>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Country of Origin *</label>
                    <select required value={expressForm.origin_country} onChange={(e) => setExpressForm({...expressForm, origin_country: e.target.value})} style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box',background:'#fff'}}>
                      <option value="">Select Country...</option>
                      <option>United Kingdom</option><option>Germany</option><option>France</option><option>Netherlands</option><option>Belgium</option><option>Denmark</option><option>Sweden</option><option>Norway</option><option>Finland</option><option>Spain</option><option>Portugal</option><option>Italy</option><option>Austria</option><option>Switzerland</option><option>Poland</option><option>Czech Republic</option><option>Hungary</option><option>Romania</option><option>Greece</option><option>Ireland</option><option>United States</option><option>Canada</option><option>Australia</option><option>Japan</option><option>China</option>
                    </select>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Destination Country *</label>
                    <select required value={expressForm.destination_country} onChange={(e) => setExpressForm({...expressForm, destination_country: e.target.value})} style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box',background:'#fff'}}>
                      <option value="">Select Country...</option>
                      <option>United Kingdom</option><option>Germany</option><option>France</option><option>Netherlands</option><option>Belgium</option><option>Denmark</option><option>Sweden</option><option>Norway</option><option>Finland</option><option>Spain</option><option>Portugal</option><option>Italy</option><option>Austria</option><option>Switzerland</option><option>Poland</option><option>Czech Republic</option><option>Hungary</option><option>Romania</option><option>Greece</option><option>Ireland</option><option>United States</option><option>Canada</option><option>Australia</option><option>Japan</option><option>China</option>
                    </select>
                  </div>
                </div>

                <div style={{marginBottom:'12px'}}>
                  <label style={{display:'block',fontSize:'13px',color:'#374151',marginBottom:'6px',fontWeight:'500'}}>Express Delivery Days *</label>
                  <select required value={expressForm.delivery_days} onChange={(e) => setExpressForm({...expressForm, delivery_days: parseInt(e.target.value)})} style={{width:'100%',padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',boxSizing:'border-box',background:'#fff'}}>
                    <option value={2}>2 days (Premium Express)</option>
                    <option value={3}>3 days (Express Standard)</option>
                    <option value={4}>4 days</option>
                    <option value={5}>5 days</option>
                    <option value={6}>6 days</option>
                    <option value={7}>7 days</option>
                    <option value={8}>8 days</option>
                    <option value={9}>9 days</option>
                    <option value={10}>10 days (Maximum)</option>
                  </select>
                </div>

                <button type="submit" disabled={expressLoading} style={{width:'100%',padding:'16px',background:'linear-gradient(135deg,#f59e0b 0%,#d4af37 100%)',color:'white',border:'none',borderRadius:'8px',fontSize:'16px',fontWeight:'700',cursor:expressLoading?'not-allowed':'pointer',boxShadow:'0 4px 12px rgba(245,158,11,0.3)',marginTop:'24px',letterSpacing:'0.5px',opacity:expressLoading?0.6:1}}>
                  {expressLoading ? 'Creating Express Shipment...' : '✈ GENERATE EXPRESS TRACKING'}
                </button>
              </form>
            </div>
          </div>
        )}

        {currentPage === 'missing' && (
          <div className="missing">
            <h1>Missing Entries</h1>
            <p>Shipments that need attention will appear here.</p>
            <div className="empty-state"><span className="empty-icon">📭</span><p>No missing entries at this time.</p></div>
          </div>
        )}

        {currentPage === 'api' && (
          <div className="api-guide">
            <h1>🔧 Multi-Store Setup Guide</h1>
            <p>Follow these steps to connect your stores to Trackisto.</p>
            
            <h2 style={{marginTop: '30px', color: '#667eea'}}>🛒 Shopify Setup</h2>
            
            <h3>Step 1: Create a Shopify App</h3>
            <p>For <strong>each store</strong> you want to connect, create a Shopify App:</p>
            <ol>
              <li>Go to <a href="https://partners.shopify.com" target="_blank" rel="noopener noreferrer">partners.shopify.com</a></li>
              <li>Click <strong>Apps</strong> → <strong>Create app</strong> → <strong>Create app manually</strong></li>
              <li>Name it (e.g., "Trackisto - Store Name")</li>
            </ol>

            <h3>Step 2: Configure App URLs</h3>
            <p>In <strong>Configuration</strong>:</p>
            <ul>
              <li><strong>App URL:</strong> <code>https://trackisto-backend.onrender.com</code></li>
              <li><strong>Redirect URL:</strong> <code>https://trackisto-backend.onrender.com/api/shopify/callback</code></li>
              <li><strong>Embed in admin:</strong> ❌ OFF</li>
            </ul>

            <h3>Step 3: Add Access Scopes</h3>
            <p>Copy this into the Scopes field:</p>
            <div style={{background: '#f0f0f0', padding: '10px', borderRadius: '5px', fontFamily: 'monospace', fontSize: '11px', overflowX: 'auto', marginBottom: '15px'}}>
              read_orders,write_orders,read_fulfillments,write_fulfillments,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_products,read_locations
            </div>

            <h3>Step 4: Release & Get Credentials</h3>
            <ol>
              <li>Click <strong>Release</strong></li>
              <li>Go to <strong>Client credentials</strong></li>
              <li>Copy <strong>Client ID</strong> and <strong>Client Secret</strong></li>
            </ol>

            <h3>Step 5: Add Store in Trackisto</h3>
            <ol>
              <li>Go to <strong>🛒 Shopify Settings</strong></li>
              <li>Click <strong>+ Add Shopify Store</strong></li>
              <li>Enter domain, Client ID, Client Secret</li>
              <li>Click <strong>Add Store</strong></li>
              <li>Click <strong>🔗 Connect to Shopify</strong></li>
            </ol>

            <h2 style={{marginTop: '40px', color: '#7f54b3'}}>🌐 WooCommerce Setup</h2>
            
            <h3>Step 1: Generate API Keys</h3>
            <ol>
              <li>Go to your WordPress admin</li>
              <li>Navigate to <strong>WooCommerce → Settings → Advanced → REST API</strong></li>
              <li>Click <strong>Add key</strong></li>
              <li>Set Description: <code>Trackisto</code></li>
              <li>Set Permissions: <strong>Read/Write</strong></li>
              <li>Click <strong>Generate API key</strong></li>
              <li>Copy <strong>Consumer Key</strong> and <strong>Consumer Secret</strong></li>
            </ol>

            <h3>Step 2: Add Store in Trackisto</h3>
            <ol>
              <li>Go to <strong>🌐 WordPress Settings</strong></li>
              <li>Click <strong>+ Add WooCommerce Store</strong></li>
              <li>Enter your website URL, Consumer Key, Consumer Secret</li>
              <li>Click <strong>Add Store</strong></li>
              <li>Store connects automatically! ✓</li>
            </ol>

            <div className="warning-box">
              <strong>⚠️ Important:</strong> WooCommerce requires HTTPS (SSL certificate). Make sure your site has SSL enabled.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
