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
  let domain = store.domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return `https://${domain}/wp-json/wc/v3/${endpoint}`;
}

function getAuthHeaders(store) {
  const credentials = Buffer.from(`${store.client_id}:${store.client_secret}`).toString('base64');
  return {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Trackisto/1.0 (WooCommerce Integration)',
    'Accept': 'application/json'
  };
}

// ============================================
// FIX 1: Understøtter nu flere statusser via kommasepareret string
// FIX: Henter ALLE sider (WooCommerce paginerer med max 100 per side)
// ============================================
async function fetchWooCommerceOrders(store, status = 'processing') {
  try {
    const baseUrl = buildWooCommerceUrl(store, 'orders');
    let allOrders = [];
    let page = 1;
    const perPage = 100;

    console.log(`[WooCommerce] Fetching orders from ${store.domain} with status: ${status}`);

    while (true) {
      const fullUrl = `${baseUrl}?status=${status}&per_page=${perPage}&page=${page}`;

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: getAuthHeaders(store)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WooCommerce] Error fetching orders: ${response.status} - ${errorText.substring(0, 500)}`);
        return allOrders; // Return what we have so far
      }

      const responseText = await response.text();

      if (responseText.trim().startsWith('<')) {
        console.error(`[WooCommerce] Received HTML instead of JSON from ${store.domain}`);
        return allOrders;
      }

      try {
        const orders = JSON.parse(responseText);
        if (orders.length === 0) break; // No more pages
        allOrders = [...allOrders, ...orders];
        if (orders.length < perPage) break; // Last page
        page++;
      } catch (parseError) {
        console.error(`[WooCommerce] JSON parse error: ${parseError.message}`);
        return allOrders;
      }
    }

    console.log(`[WooCommerce] Found ${allOrders.length} orders with status ${status}`);
    return allOrders;
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
      headers: getAuthHeaders(store),
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

    // Parse the response BEFORE making the notes request
    const orderData = await response.json();

    const noteUrl = buildWooCommerceUrl(store, `orders/${orderId}/notes`);
    await fetch(noteUrl, {
      method: 'POST',
      headers: getAuthHeaders(store),
      body: JSON.stringify({
        note: `Order shipped! Tracking number: ${trackingNumber}\nTrack your order: ${trackingUrl}`,
        customer_note: true
      })
    });

    console.log(`[WooCommerce] Updated order ${orderId} with tracking ${trackingNumber}`);
    return orderData;
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
    
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    
    const existingStore = await db.query('SELECT id FROM shopify_stores WHERE domain = $1', [domain]);
    if (existingStore.rows.length > 0) {
      return res.status(400).json({ error: 'Store with this domain already exists' });
    }
    
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

    // Get all skipped order IDs
    let skippedOrderIdsSet = new Set();
    try {
      const skippedResult = await db.query("SELECT order_id FROM skipped_orders WHERE store_type = 'woocommerce'");
      skippedOrderIdsSet = new Set(skippedResult.rows.map(r => r.order_id));
    } catch (e) { /* table might not exist yet */ }

    // PERF FIX: Pre-fetch ALL existing shipment order IDs in ONE query (was N+1 per order)
    const shipmentOrderIdsResult = await db.query(
      "SELECT shopify_order_id FROM shipments WHERE shopify_order_id IS NOT NULL"
    );
    const existingShipmentOrderIds = new Set(shipmentOrderIdsResult.rows.map(r => r.shopify_order_id));

    for (const store of stores) {
      // Henter OGSÅ completed orders, ikke kun processing
      const orders = await fetchWooCommerceOrders(store, 'processing,completed');

      for (const order of orders) {
        const orderIdStr = order.id.toString();
        // Skip orders that have been manually skipped
        if (skippedOrderIdsSet.has(orderIdStr)) {
          continue;
        }

        const hasShipment = existingShipmentOrderIds.has(orderIdStr);
        
        // Map WooCommerce status til Trackisto fulfillment status
        let fulfillmentStatus;
        if (hasShipment) {
          fulfillmentStatus = 'fulfilled'; // Allerede i vores system
        } else if (order.status === 'completed') {
          fulfillmentStatus = 'completed_not_synced'; // Completed i WC men mangler shipment
        } else {
          fulfillmentStatus = 'unfulfilled'; // Processing, klar til fulfill
        }
        
        allOrders.push({
          id: order.id,
          order_number: order.number || order.id,
          customer_name: `${order.shipping?.first_name || order.billing?.first_name || ''} ${order.shipping?.last_name || order.billing?.last_name || ''}`.trim() || 'Unknown',
          country: order.shipping?.country || order.billing?.country || 'Unknown',
          total_price: order.total,
          currency: order.currency,
          created_at: order.date_created,
          fulfillment_status: fulfillmentStatus,
          wc_status: order.status, // Original WooCommerce status
          store_domain: store.domain,
          store_id: store.id,
          store_type: 'woocommerce',
          has_shipment: hasShipment
        });
      }
    }
    
    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`[WooCommerce] Total orders: ${allOrders.length}`);
    res.json({ orders: allOrders });
  } catch (error) {
    console.error('[WooCommerce] Error:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

// ============================================
// FIX 3: NY ENDPOINT - Sync completed WooCommerce orders
// som mangler shipment records i Trackisto
// ============================================
router.post('/sync-completed', authMiddleware, async (req, res) => {
  console.log('[WooCommerce Sync] Syncing completed orders...');
  
  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND store_type = 'woocommerce' AND is_connected = true",
      ['active']
    );
    
    let syncedCount = 0;
    let errors = [];
    
    for (const store of storesResult.rows) {
      console.log(`[WooCommerce Sync] Processing store: ${store.domain}`);
      
      // Hent COMPLETED orders fra WooCommerce
      const completedOrders = await fetchWooCommerceOrders(store, 'completed');
      console.log(`[WooCommerce Sync] Found ${completedOrders.length} completed orders in WC`);
      
      for (const order of completedOrders) {
        // Tjek om vi allerede har et shipment record
        const existing = await db.query(
          'SELECT id FROM shipments WHERE shopify_order_id = $1',
          [order.id.toString()]
        );
        
        if (existing.rows.length > 0) {
          continue; // Allerede synkroniseret
        }
        
        // Ordren er completed i WC men mangler shipment record - opret det nu
        const address = order.shipping?.address_1 ? order.shipping : order.billing;
        if (!address || !address.first_name) {
          console.log(`[WooCommerce Sync] Skipping order ${order.id} - no address`);
          continue;
        }
        
        try {
          // Tjek om ordren allerede har tracking info fra WC meta_data
          const existingTracking = order.meta_data?.find(m => m.key === '_tracking_number');
          const countryCode = (address.country || 'XX').toUpperCase();
          const trackingNumber = existingTracking?.value || (countryCode + Date.now() + Math.floor(Math.random() * 1000));
          
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
            store.country_origin || 'United Kingdom',
            `Synced from WooCommerce completed order #${order.id}`
          ]);
          
          console.log(`[WooCommerce Sync] Created shipment for completed order ${order.id} → ${trackingNumber}`);
          syncedCount++;
        } catch (orderError) {
          console.error(`[WooCommerce Sync] Error syncing order ${order.id}:`, orderError);
          errors.push({ order_id: order.id, error: orderError.message });
        }
      }
    }
    
    console.log(`[WooCommerce Sync] Completed. Synced ${syncedCount} orders.`);
    res.json({
      success: true,
      message: `Synced ${syncedCount} completed WooCommerce orders`,
      synced: syncedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[WooCommerce Sync] Error:', error);
    res.status(500).json({ error: 'Failed to sync completed orders', details: error.message });
  }
});

// ============================================
// FETCH AND FULFILL
// ============================================
router.post('/fetch-and-fulfill', authMiddleware, async (req, res) => {
  console.log('[WooCommerce Fetch-Fulfill] Starting...');
  const { orderIds } = req.body;
  
  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND store_type = 'woocommerce' AND is_connected = true",
      ['active']
    );
    
    let fulfilledCount = 0;
    let errors = [];
    
    // Get skipped order IDs
    let skippedOrderIds = [];
    try {
      const skippedResult = await db.query("SELECT order_id FROM skipped_orders WHERE store_type = 'woocommerce'");
      skippedOrderIds = skippedResult.rows.map(r => r.order_id);
    } catch (e) { /* table might not exist yet */ }
    
    for (const store of storesResult.rows) {
      console.log(`[WooCommerce Fetch-Fulfill] Processing store: ${store.domain}`);
      
      // ============================================
      // FIX 4: Henter OGSÅ completed orders der mangler shipment records
      // Så ordrer der blev completed men ikke synkroniseret, kan indhentes
      // ============================================
      const allOrders = await fetchWooCommerceOrders(store, 'processing,completed');
      
      const orders = orderIds && orderIds.length > 0
        ? allOrders.filter(o => orderIds.includes(o.id))
        : allOrders;
      
      console.log(`[WooCommerce Fetch-Fulfill] Found ${orders.length} orders to process`);
      
      for (const order of orders) {
        // Skip manually skipped orders
        if (skippedOrderIds.includes(order.id.toString())) {
          console.log(`[WooCommerce Fetch-Fulfill] Skipping order ${order.id} - manually skipped`);
          continue;
        }
        
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
          const countryCode = (address.country || 'XX').toUpperCase();
          const trackingNumber = countryCode + Date.now() + Math.floor(Math.random() * 1000);
          const trackingUrl = `https://rvslogistics.com/?tracking=${trackingNumber}`;
          
          console.log(`[WooCommerce Fetch-Fulfill] Fulfilling order ${order.id} with tracking ${trackingNumber} (country: ${countryCode}, wc_status: ${order.status})`);
          
          // ============================================
          // FIX 5: OMVENDT RÆKKEFØLGE
          // Opret shipment record FØRST, derefter opdater WooCommerce
          // Hvis DB-insert fejler, er ordren stadig "processing" i WC
          // og kan forsøges igen
          // ============================================
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
            store.country_origin || 'United Kingdom',
            `Label created in ${store.country_origin || 'United Kingdom'}`
          ]);
          
          // Nu opdater WooCommerce EFTER DB-insert lykkedes
          // Kun hvis ordren ikke allerede er completed i WC
          if (order.status !== 'completed') {
            try {
              await updateWooCommerceOrder(store, order.id, trackingNumber, trackingUrl);
            } catch (wcError) {
              // WC-opdatering fejlede, men shipment-record ER oprettet
              // Log fejlen men marker IKKE som fejlet - ordren er gemt lokalt
              console.warn(`[WooCommerce Fetch-Fulfill] WC update failed for order ${order.id}, but shipment was created locally: ${wcError.message}`);
            }
          } else {
            console.log(`[WooCommerce Fetch-Fulfill] Order ${order.id} already completed in WC, skipping WC update`);
          }
          
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
    
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    
    const store = { domain, client_id, client_secret };
    const url = buildWooCommerceUrl(store, 'system_status');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(store)
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

// ============================================
// AUTO-FULFILLMENT (called by cron)
// ============================================
function getDanishTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
}

// Count only Monday–Friday business days between two dates
function countBusinessDays(fromDate, toDate) {
  let count = 0;
  const current = new Date(fromDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (current < end) {
    const day = current.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

async function processWooCommerceAutoFulfillment() {
  console.log('[WooCommerce Auto-Fulfill] Starting auto-fulfillment check...');
  const danishTime = getDanishTime();
  const currentHour = danishTime.getHours();
  const currentMinute = danishTime.getMinutes();
  const currentDayOfWeek = danishTime.getDay(); // 0=Sun, 6=Sat
  const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

  // Never run auto-fulfillment on weekends
  if (currentDayOfWeek === 0 || currentDayOfWeek === 6) {
    console.log(`[WooCommerce Auto-Fulfill] Skipping — today is a weekend (day ${currentDayOfWeek})`);
    return;
  }
  
  console.log(`[WooCommerce Auto-Fulfill] Danish time: ${currentTimeStr}`);

  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND store_type = 'woocommerce' AND is_connected = true",
      ['active']
    );
    
    console.log(`[WooCommerce Auto-Fulfill] Found ${storesResult.rows.length} connected WooCommerce stores`);

    // Get skipped order IDs
    let autoSkippedIds = [];
    try {
      const skRes = await db.query("SELECT order_id FROM skipped_orders WHERE store_type = 'woocommerce'");
      autoSkippedIds = skRes.rows.map(r => r.order_id);
    } catch (e) { /* table might not exist yet */ }

    for (const store of storesResult.rows) {
      const fulfillmentTime = store.fulfillment_time || '16:00';
      const [targetHour, targetMinute] = fulfillmentTime.split(':').map(Number);
      
      const targetMinutes = targetHour * 60 + targetMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const diff = Math.abs(targetMinutes - currentMinutes);
      
      if (diff <= 15) {
        console.log(`[WooCommerce Auto-Fulfill] Processing store ${store.domain} (target: ${fulfillmentTime})`);
        
        // ============================================
        // FIX 6: Henter OGSÅ completed orders der mangler shipment records
        // ============================================
        const orders = await fetchWooCommerceOrders(store, 'processing,completed');
        console.log(`[WooCommerce Auto-Fulfill] Found ${orders.length} orders (processing + completed)`);

        for (const order of orders) {
          // Skip manually skipped orders
          if (autoSkippedIds.includes(order.id.toString())) {
            continue;
          }
          
          const existing = await db.query(
            'SELECT id FROM shipments WHERE shopify_order_id = $1',
            [order.id.toString()]
          );
          
          if (existing.rows.length > 0) {
            continue; // Already processed
          }

          const sendOffset = store.send_offset || 0;
          if (sendOffset > 0) {
            const orderDate = new Date(order.date_created);
            const now = getDanishTime();
            const businessDaysSinceOrder = countBusinessDays(orderDate, now);
            if (businessDaysSinceOrder < sendOffset) {
              console.log(`[WooCommerce Auto-Fulfill] Skipping order ${order.id} - send offset not reached (${businessDaysSinceOrder}/${sendOffset} business days)`);
              continue;
            }
          }

          const address = order.shipping?.address_1 ? order.shipping : order.billing;
          
          if (!address || !address.first_name) {
            console.log(`[WooCommerce Auto-Fulfill] Skipping order ${order.id} - no address`);
            continue;
          }

          try {
            const countryCode = (address.country || 'XX').toUpperCase();
            const trackingNumber = countryCode + Date.now() + Math.floor(Math.random() * 1000);
            const trackingUrl = `https://rvslogistics.com/?tracking=${trackingNumber}`;
            
            console.log(`[WooCommerce Auto-Fulfill] Fulfilling order ${order.id} with tracking ${trackingNumber} (wc_status: ${order.status})`);
            
            // ============================================
            // FIX 7: DB-INSERT FØRST, derefter WooCommerce update
            // ============================================
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
              store.country_origin || 'United Kingdom',
              `Label created in ${store.country_origin || 'United Kingdom'}`
            ]);
            
            // WooCommerce update EFTER DB-insert - kun hvis ikke allerede completed
            if (order.status !== 'completed') {
              try {
                await updateWooCommerceOrder(store, order.id, trackingNumber, trackingUrl);
              } catch (wcError) {
                console.warn(`[WooCommerce Auto-Fulfill] WC update failed for order ${order.id}, but shipment was saved locally: ${wcError.message}`);
              }
            }
            
            console.log(`[WooCommerce Auto-Fulfill] Saved shipment ${trackingNumber}`);
          } catch (orderError) {
            console.error(`[WooCommerce Auto-Fulfill] Error processing order ${order.id}:`, orderError);
          }
        }
      } else {
        console.log(`[WooCommerce Auto-Fulfill] Skipping store ${store.domain} - not within fulfillment window (current: ${currentTimeStr}, target: ${fulfillmentTime})`);
      }
    }
  } catch (error) {
    console.error('[WooCommerce Auto-Fulfill] Error:', error);
  }
}

// ============================================
// SKIPPED ORDERS MANAGEMENT
// ============================================

// Skip an order (prevent it from being fulfilled)
router.post('/skip-order', authMiddleware, async (req, res) => {
  try {
    const { order_id, customer_name, store_type } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id is required' });
    
    await db.query(
      'INSERT INTO skipped_orders (order_id, store_type, customer_name) VALUES ($1, $2, $3) ON CONFLICT (order_id, store_type) DO NOTHING',
      [order_id.toString(), store_type || 'woocommerce', customer_name || '']
    );
    
    console.log(`[Skipped Orders] Skipped order ${order_id} (${customer_name})`);
    res.json({ success: true, message: `Order ${order_id} skipped` });
  } catch (error) {
    console.error('[Skipped Orders] Error:', error);
    res.status(500).json({ error: 'Failed to skip order' });
  }
});

// Unskip an order
router.post('/unskip-order', authMiddleware, async (req, res) => {
  try {
    const { order_id, store_type } = req.body;
    await db.query(
      'DELETE FROM skipped_orders WHERE order_id = $1 AND store_type = $2',
      [order_id.toString(), store_type || 'woocommerce']
    );
    console.log(`[Skipped Orders] Unskipped order ${order_id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Skipped Orders] Error:', error);
    res.status(500).json({ error: 'Failed to unskip order' });
  }
});

// Get all skipped orders
router.get('/skipped-orders', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM skipped_orders ORDER BY created_at DESC');
    res.json({ skippedOrders: result.rows });
  } catch (error) {
    console.error('[Skipped Orders] Error:', error);
    res.status(500).json({ error: 'Failed to fetch skipped orders' });
  }
});

router.processWooCommerceAutoFulfillment = processWooCommerceAutoFulfillment;
module.exports = router;
