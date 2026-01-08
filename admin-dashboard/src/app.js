import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://trackisto-backend.onrender.com';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [shipments, setShipments] = useState([]);
  const [stats, setStats] = useState({ totalShipments: 0, todayShipments: 0, pendingOrders: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) {
      setIsLoggedIn(true);
      fetchDashboardData();
    }
  }, [token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        username,
        password
      });
      
      const { token: newToken } = response.data;
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setIsLoggedIn(true);
      fetchDashboardData();
    } catch (error) {
      alert('Login failed: ' + (error.response?.data?.error || 'Invalid credentials'));
    }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setIsLoggedIn(false);
    setUsername('');
    setPassword('');
  };

  const fetchDashboardData = async () => {
    try {
      const [shipmentsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/shipments`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_URL}/api/shipments/stats/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      
      setShipments(shipmentsRes.data.shipments || []);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  const handleCreateShipment = async (formData) => {
    try {
      const response = await axios.post(`${API_URL}/api/shipments`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      alert(`Shipment created! Tracking number: ${response.data.trackingNumber}`);
      fetchDashboardData();
      setCurrentPage('dashboard');
    } catch (error) {
      alert('Error creating shipment: ' + (error.response?.data?.error || 'Unknown error'));
    }
  };

  const handleDeleteShipment = async (id) => {
    if (window.confirm('Are you sure you want to delete this shipment?')) {
      try {
        await axios.delete(`${API_URL}/api/shipments/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        alert('Shipment deleted successfully');
        fetchDashboardData();
      } catch (error) {
        alert('Error deleting shipment: ' + (error.response?.data?.error || 'Unknown error'));
      }
    }
  };

  if (!isLoggedIn) {
    return <LoginPage username={username} setUsername={setUsername} password={password} setPassword={setPassword} handleLogin={handleLogin} loading={loading} />;
  }

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand">
          <h1>📦 Trackisto Admin</h1>
        </div>
        <div className="navbar-user">
          <span>Logged in as: <strong>admin</strong></span>
          <button onClick={handleLogout} className="btn btn-danger">Logout</button>
        </div>
      </nav>

      <div className="main-container">
        <aside className="sidebar">
          <button className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => setCurrentPage('dashboard')}>
            📊 Dashboard
          </button>
          <button className={currentPage === 'manual-entry' ? 'active' : ''} onClick={() => setCurrentPage('manual-entry')}>
            ✏️ Manual Entry
          </button>
          <button className={currentPage === 'shopify' ? 'active' : ''} onClick={() => setCurrentPage('shopify')}>
            🛍️ Shopify Settings
          </button>
          <button className={currentPage === 'api-guide' ? 'active' : ''} onClick={() => setCurrentPage('api-guide')}>
            📖 API Guide
          </button>
        </aside>

        <main className="content">
          {currentPage === 'dashboard' && (
            <Dashboard stats={stats} shipments={shipments} onDelete={handleDeleteShipment} />
          )}
          {currentPage === 'manual-entry' && (
            <ManualEntry onCreate={handleCreateShipment} />
          )}
          {currentPage === 'shopify' && (
            <ShopifySettings />
          )}
          {currentPage === 'api-guide' && (
            <APIGuide setCurrentPage={setCurrentPage} />
          )}
        </main>
      </div>
    </div>
  );
}

function LoginPage({ username, setUsername, password, setPassword, handleLogin, loading }) {
  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>📦 Trackisto</h1>
          <p>Admin Dashboard</p>
        </div>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="admin123"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p className="login-hint">Default: admin / admin123</p>
      </div>
    </div>
  );
}

function Dashboard({ stats, shipments, onDelete }) {
  return (
    <div className="dashboard">
      <h2>Dashboard Overview</h2>
      
      <div className="stats-grid">
        <div className="stat-card blue">
          <h3>Total Shipments</h3>
          <p className="stat-number">{stats.totalShipments}</p>
        </div>
        <div className="stat-card green">
          <h3>Today's Shipments</h3>
          <p className="stat-number">{stats.todayShipments}</p>
        </div>
        <div className="stat-card yellow">
          <h3>Pending Orders</h3>
          <p className="stat-number">{stats.pendingOrders}</p>
        </div>
      </div>

      <div className="shipments-section">
        <h3>Recent Shipments</h3>
        <table className="shipments-table">
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
            {shipments.map((shipment) => (
              <tr key={shipment.id}>
                <td><code>{shipment.tracking_number}</code></td>
                <td>{shipment.customer_name}</td>
                <td>{shipment.country}</td>
                <td>
                  <span className={`status-badge ${shipment.status}`}>
                    {shipment.status}
                  </span>
                </td>
                <td>{new Date(shipment.created_at).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => onDelete(shipment.id)} className="btn btn-small btn-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualEntry({ onCreate }) {
  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    shippingAddress: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'United Kingdom',
    destinationCountry: 'United Kingdom',
    originCountry: 'United Kingdom',
    transitCountry: 'Netherlands',
    deliveryDays: '7',
    sortingDays: '3',
    price: '',
    postDeliveryEvent: 'None',
    redeliveryDays: '3',
    attempts: '1'
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(formData);
  };

  return (
    <div className="manual-entry">
      <h2>Manual Parcel Entry</h2>
      <p>Create a new shipment manually. A tracking number will be generated automatically.</p>
      
      <form onSubmit={handleSubmit} className="entry-form">
        <div className="form-section">
          <h3>Customer Details</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name *</label>
              <input type="text" name="customerName" value={formData.customerName} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Email Address *</label>
              <input type="email" name="customerEmail" value={formData.customerEmail} onChange={handleChange} required />
            </div>
          </div>
          <div className="form-group">
            <label>Shipping Address *</label>
            <textarea name="shippingAddress" value={formData.shippingAddress} onChange={handleChange} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>City *</label>
              <input type="text" name="city" value={formData.city} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>State</label>
              <input type="text" name="state" value={formData.state} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>ZIP Code *</label>
              <input type="text" name="zipCode" value={formData.zipCode} onChange={handleChange} required />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Delivery Information</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Destination Country *</label>
              <select name="destinationCountry" value={formData.destinationCountry} onChange={handleChange}>
                <option>United Kingdom</option>
                <option>Denmark</option>
                <option>Germany</option>
                <option>Netherlands</option>
                <option>United States</option>
              </select>
            </div>
            <div className="form-group">
              <label>Delivery Days *</label>
              <input type="number" name="deliveryDays" value={formData.deliveryDays} onChange={handleChange} required />
            </div>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-large">
          Generate Tracking Number
        </button>
      </form>
    </div>
  );
}

function ShopifySettings() {
  const [stores, setStores] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    domain: '',
    apiToken: '',
    deliveryDays: '7',
    sendOffset: '2',
    countryOrigin: 'United Kingdom',
    transitCountry: 'Netherlands',
    postDeliveryEvent: 'None',
    redeliveryDays: '3',
    sortingDays: '3',
    attempts: '1',
    parcelPoint: true
  });

  useEffect(() => {
    fetchStores();
  }, []);

  const fetchStores = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/shopify/stores`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setStores(response.data.stores || []);
    } catch (error) {
      console.error('Error fetching stores:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/shopify/stores`, formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      alert('Shopify store added successfully!');
      setShowAddForm(false);
      setFormData({
        domain: '',
        apiToken: '',
        deliveryDays: '7',
        sendOffset: '2',
        countryOrigin: 'United Kingdom',
        transitCountry: 'Netherlands',
        postDeliveryEvent: 'None',
        redeliveryDays: '3',
        sortingDays: '3',
        attempts: '1',
        parcelPoint: true
      });
      fetchStores();
    } catch (error) {
      alert('Error adding store: ' + (error.response?.data?.error || 'Unknown error'));
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this store?')) {
      try {
        await axios.delete(`${API_URL}/api/shopify/stores/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        alert('Store deleted successfully');
        fetchStores();
      } catch (error) {
        alert('Error deleting store: ' + (error.response?.data?.error || 'Unknown error'));
      }
    }
  };

  return (
    <div className="shopify-settings">
      <h2>Shopify Settings</h2>
      <p style={{marginBottom: '10px'}}>Connect your Shopify store to Trackisto by entering your domain and admin API token. This allows the system to auto-create parcels.</p>
      <p style={{color: '#999', fontSize: '14px', marginBottom: '20px'}}>All credentials are validated live when this page loads.</p>

      <button onClick={() => setShowAddForm(!showAddForm)} className="btn btn-primary" style={{marginBottom: '20px'}}>
        {showAddForm ? '❌ Cancel' : '➕ Add Shopify Store'}
      </button>

      {showAddForm && (
        <form onSubmit={handleSubmit} className="entry-form" style={{marginBottom: '30px', background: '#f8f9fa', padding: '30px', borderRadius: '8px'}}>
          
          <div className="form-section">
            <div className="form-row">
              <div className="form-group">
                <label>Shopify Domain</label>
                <input 
                  type="text" 
                  value={formData.domain}
                  onChange={(e) => setFormData({...formData, domain: e.target.value})}
                  placeholder="your-store.myshopify.com"
                  required 
                />
              </div>
              <div className="form-group">
                <label>Admin API Token</label>
                <input 
                  type="text" 
                  value={formData.apiToken}
                  onChange={(e) => setFormData({...formData, apiToken: e.target.value})}
                  placeholder="shpat_..."
                  required 
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Delivery Days</label>
                <input 
                  type="number" 
                  value={formData.deliveryDays}
                  onChange={(e) => setFormData({...formData, deliveryDays: e.target.value})}
                  min="1"
                />
              </div>
              <div className="form-group">
                <label>Send Offset (Days)</label>
                <input 
                  type="number" 
                  value={formData.sendOffset}
                  onChange={(e) => setFormData({...formData, sendOffset: e.target.value})}
                  min="0"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Country of Origin</label>
                <select 
                  value={formData.countryOrigin}
                  onChange={(e) => setFormData({...formData, countryOrigin: e.target.value})}
                >
                  <option>United Kingdom</option>
                  <option>Denmark</option>
                  <option>Germany</option>
                  <option>Netherlands</option>
                  <option>United States</option>
                </select>
              </div>
              <div className="form-group">
                <label>Transit Country</label>
                <select 
                  value={formData.transitCountry}
                  onChange={(e) => setFormData({...formData, transitCountry: e.target.value})}
                >
                  <option>Netherlands</option>
                  <option>Germany</option>
                  <option>Belgium</option>
                  <option>United Kingdom</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Post Delivery Event</label>
              <select 
                value={formData.postDeliveryEvent}
                onChange={(e) => setFormData({...formData, postDeliveryEvent: e.target.value})}
              >
                <option>None</option>
                <option>Redelivery</option>
                <option>Return to Sender</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Redelivery Days</label>
                <input 
                  type="number" 
                  value={formData.redeliveryDays}
                  onChange={(e) => setFormData({...formData, redeliveryDays: e.target.value})}
                  min="1"
                />
              </div>
              <div className="form-group">
                <label>Redelivery Attempts</label>
                <input 
                  type="number" 
                  value={formData.attempts}
                  onChange={(e) => setFormData({...formData, attempts: e.target.value})}
                  min="1"
                  max="5"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Sorting Days</label>
              <input 
                type="number" 
                value={formData.sortingDays}
                onChange={(e) => setFormData({...formData, sortingDays: e.target.value})}
                min="0"
              />
            </div>

            <div className="form-group">
              <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <input 
                  type="checkbox" 
                  checked={formData.parcelPoint}
                  onChange={(e) => setFormData({...formData, parcelPoint: e.target.checked})}
                  style={{width: 'auto'}}
                />
                Enable Parcel Point Delivery
              </label>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-large">Add Settings</button>
        </form>
      )}

      <div className="shopify-stores">
        <h3>Connected Stores</h3>
        {stores.length === 0 ? (
          <div className="info-box">
            <p>No Shopify stores connected yet.</p>
            <p>Click "Add Shopify Store" to get started.</p>
          </div>
        ) : (
          <table className="shipments-table">
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
                <th>Sorting Days</th>
                <th>Country of Origin</th>
                <th>Transit Country</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id}>
                  <td style={{textAlign: 'center'}}>
                    {store.status === 'active' ? (
                      <span style={{color: '#22c55e', fontSize: '20px', fontWeight: 'bold'}}>✓</span>
                    ) : (
                      <span style={{color: '#ef4444', fontSize: '20px', fontWeight: 'bold'}}>✕</span>
                    )}
                  </td>
                  <td><code>{store.domain}</code></td>
                  <td>{store.delivery_days}</td>
                  <td>{store.send_offset}</td>
                  <td>{store.redelivery_active ? 'Yes' : 'No'}</td>
                  <td>{store.redelivery_days}</td>
                  <td>{store.attempts}</td>
                  <td>{store.parcel_point ? 'Yes' : 'No'}</td>
                  <td>{store.sorting_days}</td>
                  <td>{store.country_origin}</td>
                  <td>{store.transit_country}</td>
                  <td>
                    <button onClick={() => handleDelete(store.id)} className="btn btn-small btn-danger">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="info-box" style={{marginTop: '30px'}}>
        <h4>📚 How to Get Shopify API Credentials</h4>
        <p>Need help? Click the "API Guide" button in the sidebar for detailed step-by-step instructions.</p>
      </div>
    </div>
  );
}

function APIGuide({ setCurrentPage }) {
  return (
    <div className="api-guide" style={{maxWidth: '900px', margin: '0 auto'}}>
      <button onClick={() => setCurrentPage('shopify')} className="btn" style={{marginBottom: '20px'}}>
        ← Back to Shopify Settings
      </button>

      <div style={{background: 'white', padding: '40px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
        <h1 style={{fontSize: '32px', marginBottom: '10px'}}>How to Create a Shopify API Token</h1>
        <p style={{color: '#666', marginBottom: '30px'}}>Follow these 7 steps to generate your Shopify Admin API token and connect your store to Trackisto.</p>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 1: Open App Development</h2>
          <p style={{marginBottom: '12px'}}>Go to admin.shopify.com and login, then search for <strong>App development</strong> in your Shopify Admin settings, and click it.</p>
          <div style={{padding: '20px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '20px'}}>
            <input type="text" value="app development" readOnly style={{width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '4px'}} />
          </div>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 2: Click "Create an App"</h2>
          <p>Once inside App Development, click the <strong>Create an app</strong> button.</p>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 3: Name the App</h2>
          <p>Give your app a name like <em>"tracking"</em> and proceed.</p>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 4: Go to Admin API Configuration</h2>
          <p>Click <strong>Configure Admin API scopes</strong> to begin selecting access permissions.</p>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 5: Select Required API Scopes</h2>
          <p style={{marginBottom: '12px'}}>Enable all of the following Admin API scopes:</p>
          <ul style={{marginLeft: '20px', lineHeight: '1.8'}}>
            <li><code>read_orders</code></li>
            <li><code>write_orders</code></li>
            <li><code>read_fulfillments</code></li>
            <li><code>write_fulfillments</code></li>
            <li><code>read_products</code></li>
            <li><code>read_locations</code></li>
            <li style={{color: '#0066cc', fontWeight: '600'}}><code>write_assigned_fulfillment_orders</code></li>
            <li><code>read_assigned_fulfillment_orders</code></li>
            <li style={{color: '#0066cc', fontWeight: '600'}}><code>write_merchant_managed_fulfillment_orders</code></li>
            <li><code>read_merchant_managed_fulfillment_orders</code></li>
          </ul>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 6: Install the App</h2>
          <p>Click <strong>Install app</strong> to finalize and authorize your custom app.</p>
        </div>

        <div style={{marginBottom: '40px'}}>
          <h2 style={{fontSize: '24px', marginBottom: '16px'}}>Step 7: Copy the Admin API Token</h2>
          <p style={{marginBottom: '12px'}}>Reveal and copy your <strong>Admin API token</strong> (you can only view it once!). Paste this token into the Trackisto Shopify Settings page.</p>
          
          <div style={{padding: '20px', background: '#fff9e6', border: '1px solid #ffd966', borderRadius: '8px', marginTop: '16px'}}>
            <p style={{fontSize: '14px', color: '#856404', margin: 0}}>
              ⚠️ To protect your data, you'll only be able to reveal your Admin API token once. Copy and save your Admin API access token in a secure place.
            </p>
          </div>

          <div style={{padding: '20px', background: '#f8f9fa', borderRadius: '8px', marginTop: '16px'}}>
            <p style={{fontSize: '14px', color: '#666', marginBottom: '8px'}}>Admin API access token</p>
            <code style={{fontSize: '13px', color: '#333'}}>shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code>
            <p style={{fontSize: '12px', color: '#999', marginTop: '8px'}}>Created May 7, 2025 at 15:27 UTC</p>
          </div>

          <div style={{padding: '16px', background: '#e3f2fd', borderRadius: '8px', marginTop: '16px'}}>
            <p style={{fontSize: '14px', color: '#0d47a1', margin: 0}}>
              🔐 This token is sensitive. Only reveal and use it securely inside your Trackisto admin panel.
            </p>
          </div>
        </div>

        <div style={{padding: '20px', background: '#f0f0f0', borderRadius: '8px'}}>
          <h3 style={{fontSize: '18px', marginBottom: '12px'}}>📚 Additional Resources</h3>
          <p style={{marginBottom: '8px'}}>
            <a href="https://help.shopify.com/en/manual/apps/app-types/custom-apps" target="_blank" rel="noopener noreferrer" style={{color: '#0066cc'}}>
              Shopify Custom Apps Documentation
            </a>
          </p>
          <p>
            <a href="https://shopify.dev/api" target="_blank" rel="noopener noreferrer" style={{color: '#0066cc'}}>
              Shopify API Reference
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;