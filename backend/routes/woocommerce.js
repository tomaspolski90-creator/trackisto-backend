const express = require('express');
const router = express.Router();
const db = require('../config/database');

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  next();
};

// ============================================
// WOOCOMMERCE API HELPER FUNCTIONS
// ============================================

function buildWooCommerceUrl(store, endpoint) {
  // Clean the domain - remove any protocol and trailing slashes
  let domain = store.domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  
  const baseUrl = `https://${domain}/wp-json/wc/v3/${endpoint}`;
  const url = new URL(baseUrl);
  url.searchParams.append('consumer_key', store.client_id);
  url.searchParams.append('consumer_secret', store.client_secret);
  return url.toString();
}

async function fetchWooCommerceOrders(store, status = 'processing') {
  try {
    const url = buildWooCommerceUrl(store, 'orders');
    const fullUrl = `${url}&status=${status}&per_page=50`;
    
    console.log(`[WooCommerce] Fetching orders from ${store.domain} with status: ${status}`);
    console.log(`[WooCommerce] Full URL: ${fullUrl.replace(/consumer_secret=[^&]+/, 'consumer_secret=***')}`);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WooCommerce] Error fetching orders: ${response.status} - ${errorText.substring(0, 200)}`);
      return [];
    }
    
    const orders = await response.json();
    console.log(`[WooCommerce] Found ${orders.length} orders with status ${status}`);
    return orders;
  } catch (error) {
    console.error(`[WooCommerce] Error fetching orders from ${store.domain}:`, error.message);
    return [];
  }
}

async function updateWooCommerceOrder(store, orderId, trackingNumber, trackingUrl) {
  try {
    const url = buildWooCommerceUrl(store, `orders/${orderId}`);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'completed',
        meta_data: [
          { key: '_tracking_number', value: trackingNumber },
          { key: '_tracking_url', value: trackingUrl }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update order: ${response.status} - ${errorText}`);
    }
    
    // Add order note with tracking info
    const noteUrl = buildWooCommerceUrl(store, `orders/${orderId}/notes`);
    await fetch(noteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: `Order shipped! Tracking number: ${trackingNumber}\nTrack your order: ${trackingUrl}`,
        customer_note: true
      })
    });
    
    console.log(`[WooCommerce] Updated order ${orderId} with tracking ${trackingNumber}`);
    return await response.json();
  } catch (error) {
    console.error(`[WooCommerce] Error updating order ${orderId}:`, error.message);
    throw error;
  }
}

// ============================================
// STORE MANAGEMENT
// ============================================

router.get('/stores', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, store_name, domain, delivery_days, send_offset, fulfillment_time,
        country_origin, transit_country, post_delivery_event, sorting_days,
        parcel_point, parcel_point_days, redelivery_active, redelivery_days,
        attempts, status, created_at,
        client_id, client_secret,
        COALESCE(is_connected, false) as is_connected,
        (client_id IS NOT NULL AND client_id != '' AND client_secret IS NOT NULL AND client_secret != '') as has_credentials
      FROM shopify_stores 
      WHERE store_type = 'woocommerce'
      ORDER BY created_at DESC
    `);
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Error fetching WooCommerce stores:', error);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

router.post('/stores', authMiddleware, async (req, res) => {
  try {
    let { 
      store_name, domain, client_id, client_secret,
      delivery_days = 7, send_offset = 0, fulfillment_time = '16:00',
      country_origin = 'United Kingdom', transit_country = '',
      sorting_days = 3, parcel_point = true, parcel_point_days = 3,
      redelivery_active = false, redelivery_days = 3, attempts = 1, 
      post_delivery_event = 'None'
    } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    // Clean the domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    
    const existingStore = await db.query('SELECT id FROM shopify_stores WHERE domain = $1', [domain]);
    if (existingStore.rows.length > 0) {
      return res.status(400).json({ error: 'Store with this domain already exists' });
    }
    
    // WooCommerce connects automatically when credentials are provided
    const isConnected = client_id && client_secret ? true : false;
    const initialStatus = isConnected ? 'active' : 'inactive';
    
    const result = await db.query(`
      INSERT INTO shopify_stores (
        store_name, domain, client_id, client_secret, store_type,
        delivery_days, send_offset, fulfillment_time,
        country_origin, transit_country, sorting_days, 
        parcel_point, parcel_point_days,
        redelivery_active, redelivery_days, attempts, 
        post_delivery_event, status, is_connected, created_at
      ) VALUES ($1, $2, $3, $4, 'woocommerce', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      RETURNING id
    `, [
      store_name, domain, client_id, client_secret,
      delivery_days, send_offset, fulfillment_time,
      country_origin, transit_country, sorting_days,
      parcel_point, parcel_point_days,
      redelivery_active, redelivery_days, attempts,
      post_delivery_event, initialStatus, isConnected
    ]);
    
    res.json({ 
      success: true, 
      id: result.rows[0].id,
      message: isConnected 
        ? 'WooCommerce store connected successfully!' 
        : 'Store created! Add Consumer Key and Secret to connect.'
    });
  } catch (error) {
    console.error('Error adding WooCommerce store:', error);
    res.status(500).json({ error: 'Failed to add store', message: error.message });
  }
});

router.put('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let { 
      store_name, domain, client_id, client_secret,
      delivery_days, send_offset, fulfillment_time, 
      country_origin, transit_country, sorting_days, 
      parcel_point, parcel_point_days, redelivery_active, 
      redelivery_days, attempts, post_delivery_event 
    } = req.body;
    
    const existing = await db.query('SELECT * FROM shopify_stores WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // Clean the domain if provided
    if (domain) {
      domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    }
    
    let updateFields = [];
    let params = [];
    let paramCount = 1;
    
    if (store_name !== undefined) { updateFields.push(`store_name = $${paramCount++}`); params.push(store_name); }
    if (domain !== undefined) { updateFields.push(`domain = $${paramCount++}`); params.push(domain); }
    if (client_id !== undefined) { updateFields.push(`client_id = $${paramCount++}`); params.push(client_id); }
    if (client_secret !== undefined) { updateFields.push(`client_secret = $${paramCount++}`); params.push(client_secret); }
    if (delivery_days !== undefined) { updateFields.push(`delivery_days = $${paramCount++}`); params.push(delivery_days); }
    if (send_offset !== undefined) { updateFields.push(`send_offset = $${paramCount++}`); params.push(send_offset); }
    if (fulfillment_time !== undefined) { updateFields.push(`fulfillment_time = $${paramCount++}`); params.push(fulfillment_time); }
    if (country_origin !== undefined) { updateFields.push(`country_origin = $${paramCount++}`); params.push(country_origin); }
    if (transit_country !== undefined) { updateFields.push(`transit_country = $${paramCount++}`); params.push(transit_country); }
    if (sorting_days !== undefined) { updateFields.push(`sorting_days = $${paramCount++}`); params.push(sorting_days); }
    if (parcel_point !== undefined) { updateFields.push(`parcel_point = $${paramCount++}`); params.push(parcel_point); }
    if (parcel_point_days !== undefined) { updateFields.push(`parcel_point_days = $${paramCount++}`); params.push(parcel_point_days); }
    if (redelivery_active !== undefined) { updateFields.push(`redelivery_active = $${paramCount++}`); params.push(redelivery_active); }
    if (redelivery_days !== undefined) { updateFields.push(`redelivery_days = $${paramCount++}`); params.push(redelivery_days); }
    if (attempts !== undefined) { updateFields.push(`attempts = $${paramCount++}`); params.push(attempts); }
    if (post_delivery_event !== undefined) { updateFields.push(`post_delivery_event = $${paramCount++}`); params.push(post_delivery_event); }
    
    // Auto-connect if credentials are provided
    if (client_id && client_secret) {
      updateFields.push(`is_connected = true`);
      updateFields.push(`status = 'active'`);
    }
    
    params.push(id);
    
    await db.query(
      `UPDATE shopify_stores SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
      params
    );
    
    res.json({ 
      success: true, 
      message: client_id && client_secret ? 'WooCommerce store connected!' : 'Store updated successfully' 
    });
  } catch (error) {
    console.error('Error updating WooCommerce store:', error);
    res.status(500).json({ error: 'Failed to update store' });
  }
});

router.put('/stores/:id/status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db.query('UPDATE shopify_stores SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating store status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.delete('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM shopify_stores WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting store:', error);
    res.status(500).json({ error: 'Failed to delete store' });
  }
});

// ============================================
// PENDING ORDERS
// ============================================
router.get('/pending-orders', authMiddleware, async (req, res) => {
  try {
    console.log('[WooCommerce] Fetching pending orders...');
    
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND store_type = 'woocommerce' AND is_connected = true",
      ['active']
    );
    const stores = storesResult.rows;
    console.log(`[WooCommerce] Found ${stores.length} connected stores`);
    
    let allOrders = [];
    
    for (const store of stores) {
      const orders = await fetchWooCommerceOrders(store, 'processing');
      
      const mappedOrders = orders.map(order => ({
        id: order.id,
        order_number: order.number || order.id,
        customer_name: `${order.shipping?.first_name || order.billing?.first_name || ''} ${order.shipping?.last_name || order.billing?.last_name || ''}`.trim() || 'Unknown',
        country: order.shipping?.country || order.billing?.country || 'Unknown',
        total_price: order.total,
        currency: order.currency,
        created_at: order.date_created,
        fulfillment_status: 'unfulfilled',
        store_domain: store.domain,
        store_id: store.id,
        store_type: 'woocommerce'
      }));
      
      allOrders = [...allOrders, ...mappedOrders];
    }
    
    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`[WooCommerce] Total pending orders: ${allOrders.length}`);
    res.json({ orders: allOrders });
  } catch (error) {
    console.error('[WooCommerce] Error:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

// ============================================
// FETCH AND FULFILL
// ============================================
router.post('/fetch-and-fulfill', authMiddleware, async (req, res) => {
  console.log('[WooCommerce Fetch-Fulfill] Starting...');
  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND store_type = 'woocommerce' AND is_connected = true",
      ['active']
    );
    
    let fulfilledCount = 0;
    let errors = [];
    
    for (const store of storesResult.rows) {
      console.log(`[WooCommerce Fetch-Fulfill] Processing store: ${store.domain}`);
      const orders = await fetchWooCommerceOrders(store, 'processing');
      console.log(`[WooCommerce Fetch-Fulfill] Found ${orders.length} pending orders`);
      
      for (const order of orders) {
        const existing = await db.query(
          'SELECT id FROM shipments WHERE shopify_order_id = $1',
          [order.id.toString()]
        );
        
        if (existing.rows.length > 0) {
          console.log(`[WooCommerce Fetch-Fulfill] Skipping order ${order.id} - already processed`);
          continue;
        }
        
        const address = order.shipping?.address_1 ? order.shipping : order.billing;
        
        if (!address || !address.first_name) {
          console.log(`[WooCommerce Fetch-Fulfill] Skipping order ${order.id} - no address`);
          continue;
        }
        
        try {
          const trackingNumber = 'DK' + Date.now() + Math.floor(Math.random() * 1000);
          const trackingUrl = `https://rvslogistics.com/?tracking=${trackingNumber}`;
          
          console.log(`[WooCommerce Fetch-Fulfill] Fulfilling order ${order.id} with tracking ${trackingNumber}`);
          
          await updateWooCommerceOrder(store, order.id, trackingNumber, trackingUrl);
          
          const shipmentResult = await db.query(`
            INSERT INTO shipments (
              tracking_number, customer_name, customer_email, shipping_address,
              city, state, zip_code, country, origin_country, destination_country,
              status, delivery_days, sorting_days, estimated_delivery, price,
              shopify_order_id, shopify_store_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
            RETURNING id
          `, [
            trackingNumber,
            `${address.first_name || ''} ${address.last_name || ''}`.trim(),
            order.billing?.email || '',
            `${address.address_1 || ''} ${address.address_2 || ''}`.trim(),
            address.city || '',
            address.state || '',
            address.postcode || '',
            address.country || '',
            store.country_origin || 'United Kingdom',
            address.country || '',
            'label_created',
            store.delivery_days || 7,
            store.sorting_days || 3,
            new Date(Date.now() + (store.delivery_days || 7) * 24 * 60 * 60 * 1000),
            parseFloat(order.total) || 0,
            order.id.toString(),
            store.id
          ]);
          
          await db.query(`
            INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_TIME, NOW())
          `, [
            shipmentResult.rows[0].id,
            'Label Created',
            `${store.country_origin || 'United Kingdom'}, ${store.country_origin || 'United Kingdom'}`,
            `Label created in ${store.country_origin || 'United Kingdom'}`
          ]);
          
          console.log(`[WooCommerce Fetch-Fulfill] Saved shipment ${trackingNumber}`);
          fulfilledCount++;
        } catch (orderError) {
          console.error(`[WooCommerce Fetch-Fulfill] Error processing order ${order.id}:`, orderError);
          errors.push({ order_id: order.id, error: orderError.message });
        }
      }
    }
    
    console.log(`[WooCommerce Fetch-Fulfill] Completed. Fulfilled ${fulfilledCount} orders.`);
    res.json({
      success: true,
      message: `Fulfilled ${fulfilledCount} WooCommerce orders`,
      fulfilled: fulfilledCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[WooCommerce Fetch-Fulfill] Error:', error);
    res.status(500).json({ error: 'Failed to process orders', details: error.message });
  }
});

// Test connection
router.post('/test-connection', authMiddleware, async (req, res) => {
  try {
    let { domain, client_id, client_secret } = req.body;
    
    if (!domain || !client_id || !client_secret) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Clean the domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    
    const store = { domain, client_id, client_secret };
    const url = buildWooCommerceUrl(store, 'system_status');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      res.json({ 
        success: true, 
        message: 'Connection successful!',
        store_name: data.environment?.site_title || domain
      });
    } else {
      res.status(400).json({ success: false, error: `Connection failed: ${response.status}` });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
