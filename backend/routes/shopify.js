const express = require('express');
const router = express.Router();
const db = require('../config/database');
const crypto = require('crypto');

const BACKEND_URL = process.env.BACKEND_URL || 'https://trackisto-backend.onrender.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://playful-bombolone-e5db3c.netlify.app';

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  next();
};

// ============================================
// OAUTH FLOW - MED PER-STORE CREDENTIALS
// ============================================

router.get('/auth/:storeId', async (req, res) => {
  const { storeId } = req.params;
  
  try {
    const storeResult = await db.query(
      'SELECT id, domain, client_id, client_secret FROM shopify_stores WHERE id = $1',
      [storeId]
    );
    
    if (storeResult.rows.length === 0) {
      return res.status(404).send('Store not found');
    }
    
    const store = storeResult.rows[0];
    
    if (!store.client_id || !store.client_secret) {
      return res.status(400).send('Store missing Client ID or Client Secret. Please add credentials first.');
    }
    
    if (!store.domain) {
      return res.status(400).send('Store missing domain');
    }
    
    const scopes = 'read_orders,write_orders,read_fulfillments,write_fulfillments,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_products,read_locations';
    const redirectUri = `${BACKEND_URL}/api/shopify/callback`;
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const state = Buffer.from(JSON.stringify({ storeId: store.id, nonce })).toString('base64');
    
    const authUrl = `https://${store.domain}/admin/oauth/authorize?client_id=${store.client_id}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    console.log(`[OAuth] Starting auth for store ${storeId} (${store.domain})`);
    res.redirect(authUrl);
  } catch (error) {
    console.error('[OAuth] Error starting auth:', error);
    res.status(500).send('Server error during OAuth start');
  }
});

router.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;
  
  console.log('[OAuth Callback] Received:', { code: code ? 'yes' : 'no', shop, state: state ? 'yes' : 'no' });
  
  if (!code) {
    return res.redirect(`${FRONTEND_URL}/?error=missing_code`);
  }
  
  try {
    let storeId = null;
    let store = null;
    
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        storeId = stateData.storeId;
        console.log('[OAuth Callback] Decoded storeId from state:', storeId);
      } catch (e) {
        console.log('[OAuth Callback] Could not decode state, using shop parameter');
      }
    }
    
    if (storeId) {
      const storeResult = await db.query(
        'SELECT * FROM shopify_stores WHERE id = $1',
        [storeId]
      );
      if (storeResult.rows.length > 0) {
        store = storeResult.rows[0];
      }
    }
    
    if (!store && shop) {
      const storeResult = await db.query(
        'SELECT * FROM shopify_stores WHERE domain = $1',
        [shop]
      );
      if (storeResult.rows.length > 0) {
        store = storeResult.rows[0];
      }
    }
    
    if (!store) {
      console.error('[OAuth Callback] Store not found');
      return res.redirect(`${FRONTEND_URL}/?error=store_not_found`);
    }
    
    if (!store.client_id || !store.client_secret) {
      console.error('[OAuth Callback] Store missing credentials');
      return res.redirect(`${FRONTEND_URL}/?error=missing_credentials`);
    }
    
    console.log(`[OAuth Callback] Exchanging code for token for store ${store.domain}`);
    const response = await fetch(`https://${store.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: store.client_id,
        client_secret: store.client_secret,
        code
      })
    });
    
    const data = await response.json();
    
    if (!data.access_token) {
      console.error('[OAuth Callback] Failed to get access token:', data);
      return res.redirect(`${FRONTEND_URL}/?error=oauth_failed`);
    }
    
    await db.query(
      'UPDATE shopify_stores SET api_token = $1, is_connected = true, status = $2 WHERE id = $3',
      [data.access_token, 'active', store.id]
    );
    
    console.log(`[OAuth Callback] Store ${store.id} (${store.domain}) connected successfully!`);
    res.redirect(`${FRONTEND_URL}/?success=store_connected&shop=${store.domain}`);
  } catch (error) {
    console.error('[OAuth Callback] Error:', error);
    res.redirect(`${FRONTEND_URL}/?error=server_error`);
  }
});

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
        (client_id IS NOT NULL AND client_id != '' AND client_secret IS NOT NULL AND client_secret != '') as has_credentials,
        (api_token IS NOT NULL AND api_token != '') as has_token
      FROM shopify_stores 
      WHERE (store_type = 'shopify' OR store_type IS NULL)
      ORDER BY created_at DESC
    `);
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

router.post('/stores', authMiddleware, async (req, res) => {
  try {
    const { 
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
    
    const existingStore = await db.query('SELECT id FROM shopify_stores WHERE domain = $1', [domain]);
    if (existingStore.rows.length > 0) {
      return res.status(400).json({ error: 'Store with this domain already exists' });
    }
    
    const result = await db.query(`
      INSERT INTO shopify_stores (
        store_name, domain, client_id, client_secret, store_type,
        delivery_days, send_offset, fulfillment_time,
        country_origin, transit_country, sorting_days, 
        parcel_point, parcel_point_days,
        redelivery_active, redelivery_days, attempts, 
        post_delivery_event, status, is_connected, created_at
      ) VALUES ($1, $2, $3, $4, 'shopify', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'inactive', false, NOW())
      RETURNING id
    `, [
      store_name, domain, client_id, client_secret,
      delivery_days, send_offset, fulfillment_time,
      country_origin, transit_country, sorting_days,
      parcel_point, parcel_point_days,
      redelivery_active, redelivery_days, attempts,
      post_delivery_event
    ]);
    
    res.json({ 
      success: true, 
      id: result.rows[0].id,
      message: client_id && client_secret 
        ? 'Store created! Click "Connect to Shopify" to complete setup.' 
        : 'Store created! Add Client ID and Secret, then connect to Shopify.'
    });
  } catch (error) {
    console.error('Error adding store:', error);
    res.status(500).json({ error: 'Failed to add store', message: error.message });
  }
});

router.put('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
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
    
    const currentStore = existing.rows[0];
    
    let resetConnection = false;
    if ((client_id && client_id !== currentStore.client_id) || 
        (client_secret && client_secret !== currentStore.client_secret)) {
      resetConnection = true;
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
    
    if (resetConnection) {
      updateFields.push(`is_connected = false`);
      updateFields.push(`api_token = NULL`);
    }
    
    params.push(id);
    
    await db.query(
      `UPDATE shopify_stores SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
      params
    );
    
    res.json({ 
      success: true,
      message: resetConnection 
        ? 'Store updated. Credentials changed - please reconnect to Shopify.' 
        : 'Store updated successfully'
    });
  } catch (error) {
    console.error('Error updating store:', error);
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
    console.log('[Pending Orders] Fetching unfulfilled orders...');
    
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND is_connected = true AND api_token IS NOT NULL AND (store_type = 'shopify' OR store_type IS NULL)",
      ['active']
    );
    const stores = storesResult.rows;
    console.log(`[Pending Orders] Found ${stores.length} connected Shopify stores`);
    
    let allOrders = [];

    for (const store of stores) {
      try {
        const response = await fetch(`https://${store.domain}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&limit=50`, {
          headers: { 'X-Shopify-Access-Token': store.api_token }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`[Pending Orders] Store ${store.domain}: Found ${data.orders?.length || 0} unfulfilled orders`);
          
          const mappedOrders = (data.orders || []).map(order => ({
            id: order.id,
            order_number: order.order_number,
            customer_name: order.shipping_address ? `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() : 'Unknown',
            country: order.shipping_address?.country || 'Unknown',
            total_price: order.total_price,
            currency: order.currency,
            created_at: order.created_at,
            fulfillment_status: order.fulfillment_status || 'unfulfilled',
            store_domain: store.domain,
            store_id: store.id
          }));
          allOrders = [...allOrders, ...mappedOrders];
        } else {
          console.error(`[Pending Orders] Error fetching from ${store.domain}:`, response.status);
        }
      } catch (err) {
        console.error(`[Pending Orders] Error fetching from ${store.domain}:`, err.message);
      }
    }

    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`[Pending Orders] Total unfulfilled orders: ${allOrders.length}`);
    res.json({ orders: allOrders });
  } catch (error) {
    console.error('[Pending Orders] Error:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

// ============================================
// FULFILLED ORDERS
// ============================================
router.get('/fulfilled-orders', authMiddleware, async (req, res) => {
  try {
    console.log('[Fulfilled Orders] Fetching fulfilled orders from Shopify...');
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND is_connected = true AND api_token IS NOT NULL AND (store_type = 'shopify' OR store_type IS NULL)",
      ['active']
    );
    const stores = storesResult.rows;
    let allOrders = [];

    for (const store of stores) {
      try {
        const response = await fetch(`https://${store.domain}/admin/api/2024-01/orders.json?status=any&fulfillment_status=shipped&limit=50`, {
          headers: { 'X-Shopify-Access-Token': store.api_token }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`[Fulfilled Orders] Store ${store.domain}: Found ${data.orders?.length || 0} fulfilled orders`);
          
          const mappedOrders = (data.orders || []).map(order => ({
            id: order.id,
            order_number: order.order_number,
            customer_name: order.shipping_address ? `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() : 'Unknown',
            country: order.shipping_address?.country || 'Unknown',
            total_price: order.total_price,
            currency: order.currency,
            created_at: order.created_at,
            fulfillment_status: order.fulfillment_status || 'fulfilled',
            store_domain: store.domain,
            tracking_number: order.fulfillments?.[0]?.tracking_number || null
          }));
          allOrders = [...allOrders, ...mappedOrders];
        } else {
          console.error(`[Fulfilled Orders] Error fetching from ${store.domain}:`, response.status);
        }
      } catch (err) {
        console.error(`[Fulfilled Orders] Error fetching from ${store.domain}:`, err.message);
      }
    }

    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`[Fulfilled Orders] Total fulfilled orders: ${allOrders.length}`);
    res.json({ orders: allOrders });
  } catch (error) {
    console.error('[Fulfilled Orders] Error:', error);
    res.status(500).json({ error: 'Failed to fetch fulfilled orders' });
  }
});

// ============================================
// MANUEL FULFILL
// ============================================
router.post('/fetch-and-fulfill', authMiddleware, async (req, res) => {
  console.log('[Fetch-Fulfill] Manual trigger started...');
  const { orderIds } = req.body;
  
  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND is_connected = true AND api_token IS NOT NULL AND (store_type = 'shopify' OR store_type IS NULL)",
      ['active']
    );
    let fulfilledCount = 0;
    let errors = [];

    for (const store of storesResult.rows) {
      console.log(`[Fetch-Fulfill] Processing store: ${store.domain}`);
      const allOrders = await fetchUnfulfilledOrders(store);
      
      const orders = orderIds && orderIds.length > 0
        ? allOrders.filter(o => orderIds.includes(o.id))
        : allOrders;
      
      console.log(`[Fetch-Fulfill] Found ${orders.length} orders to process`);

      for (const order of orders) {
        if (!order.shipping_address) {
          console.log(`[Fetch-Fulfill] Skipping order ${order.id} - no shipping address`);
          continue;
        }

        const existing = await db.query('SELECT id FROM shipments WHERE shopify_order_id = $1', [order.id.toString()]);
        if (existing.rows.length > 0) {
          console.log(`[Fetch-Fulfill] Skipping order ${order.id} - already processed`);
          continue;
        }

        try {
          const trackingNumber = generateTrackingNumber();
          console.log(`[Fetch-Fulfill] Fulfilling order ${order.id} with tracking ${trackingNumber}`);
          
          await fulfillOrderInShopify(store, order, trackingNumber);
          
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
            `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim(),
            order.email || order.contact_email || '',
            `${order.shipping_address.address1 || ''} ${order.shipping_address.address2 || ''}`.trim(),
            order.shipping_address.city || '',
            order.shipping_address.province || '',
            order.shipping_address.zip || '',
            order.shipping_address.country || '',
            store.country_origin || 'United Kingdom',
            order.shipping_address.country || '',
            'label_created',
            store.delivery_days || 7,
            store.sorting_days || 3,
            new Date(Date.now() + (store.delivery_days || 7) * 24 * 60 * 60 * 1000),
            parseFloat(order.total_price) || 0,
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
            `Shipment information received. Label created in ${store.country_origin || 'United Kingdom'}.`
          ]);

          console.log(`[Fetch-Fulfill] Saved shipment ${trackingNumber}`);
          fulfilledCount++;
        } catch (orderError) {
          console.error(`[Fetch-Fulfill] Error processing order ${order.id}:`, orderError);
          errors.push({ order_id: order.id, error: orderError.message });
        }
      }
    }

    console.log(`[Fetch-Fulfill] Completed. Fulfilled ${fulfilledCount} orders.`);
    res.json({ 
      success: true, 
      message: `Fulfilled ${fulfilledCount} orders`, 
      fulfilled: fulfilledCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[Fetch-Fulfill] Error:', error);
    res.status(500).json({ error: 'Failed to process orders', details: error.message });
  }
});

// ============================================
// AUTO UPDATE TRACKING EVENTS - FIXED VERSION
// ============================================
async function updateTrackingEvents() {
  console.log('[Auto-Events] Starting automatic tracking events update...');
  
  try {
    const shipmentsResult = await db.query(`
      SELECT s.*, 
             ss.country_origin, 
             ss.transit_country, 
             ss.delivery_days as store_delivery_days,
             ss.sorting_days as store_sorting_days,
             ss.parcel_point,
             ss.parcel_point_days,
             ss.redelivery_active,
             ss.redelivery_days,
             ss.attempts
      FROM shipments s
      LEFT JOIN shopify_stores ss ON s.shopify_store_id = ss.id
      WHERE s.status != 'delivered'
      ORDER BY s.created_at ASC
    `);
    
    const shipments = shipmentsResult.rows;
    console.log(`[Auto-Events] Found ${shipments.length} active shipments to check`);
    
    for (const shipment of shipments) {
      await updateShipmentEvents(shipment);
    }
    
    console.log('[Auto-Events] Completed tracking events update');
  } catch (error) {
    console.error('[Auto-Events] Error:', error);
  }
}

async function updateShipmentEvents(shipment) {
  const createdAt = new Date(shipment.created_at);
  const now = new Date();
  const daysSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
  
  const eventsResult = await db.query(
    'SELECT status FROM tracking_events WHERE shipment_id = $1',
    [shipment.id]
  );
  const existingStatuses = eventsResult.rows.map(e => e.status);
  
  const originCountry = shipment.origin_country || shipment.country_origin || 'United Kingdom';
  const transitCountry = shipment.transit_country || 'Netherlands';
  const destinationCountry = shipment.destination_country || shipment.country || 'Denmark';
  const deliveryDays = shipment.delivery_days || shipment.store_delivery_days || 7;
  const parcelPoint = shipment.parcel_point === true || shipment.parcel_point === 'Yes';
  
  const getCountryCode = (country) => {
    const codes = {
      'United Kingdom': 'UK', 'Germany': 'DE', 'Denmark': 'DK', 'Netherlands': 'NL',
      'France': 'FR', 'Sweden': 'SE', 'Norway': 'NO', 'Belgium': 'BE', 'Italy': 'IT',
      'Spain': 'ES', 'Poland': 'PL', 'Austria': 'AT', 'Switzerland': 'CH'
    };
    return codes[country] || country.substring(0, 2).toUpperCase();
  };
  
  const originCode = getCountryCode(originCountry);
  
  const totalEvents = 18;
  const dayStep = Math.max(0.5, deliveryDays / totalEvents);
  
  // Event schedule with PRIORITY for status determination
  // Higher priority number = more advanced in delivery process
  const eventSchedule = [
    { day: 0, status: 'Label Created', priority: 1,
      location: `${originCountry}`, 
      description: `Shipment information received. Label created in ${originCountry}.` },
    
    { day: Math.floor(dayStep * 1), status: 'Package Received', priority: 2,
      location: `Origin Facility, ${originCountry} (${originCode})`, 
      description: `Parcel received and scanned at origin facility (${originCode}).` },
    
    { day: Math.floor(dayStep * 2), status: 'Processed at Origin Hub', priority: 3,
      location: `${originCountry} Origin Hub`, 
      description: `Processed through ${originCountry} Origin Hub (sorting & outbound preparation).` },
    
    { day: Math.floor(dayStep * 3), status: 'Departed Origin Facility', priority: 4,
      location: `${originCountry} (${originCode}) Origin Hub`, 
      description: `Departed ${originCountry} (${originCode}) Origin Hub — linehaul to Export Hub.` },
    
    { day: Math.floor(dayStep * 4), status: 'In Transit to Export', priority: 5,
      location: `${originCountry}`, 
      description: `In transit by road to Export Hub (${originCode}).` },
    
    { day: Math.floor(dayStep * 5), status: 'Arrived at Export Hub', priority: 6,
      location: `Export Hub (${originCode})`, 
      description: `Arrived at Export Hub (${originCode}) — export processing initiated.` },
    
    { day: Math.floor(dayStep * 6), status: 'Export Documentation Check', priority: 7,
      location: `Export Hub (${originCode})`, 
      description: `Export documentation verification and security screening completed.` },
    
    { day: Math.floor(dayStep * 7), status: 'Departed Export Hub', priority: 8,
      location: `Export Hub (${originCode})`, 
      description: `Departed (${originCode}) — cross-border linehaul to port facility.` },
    
    { day: Math.floor(dayStep * 8), status: 'Awaiting Vessel / Linehaul Queue', priority: 9,
      location: `Port Facility`, 
      description: `Awaiting departure slot at port facility (road/ferry routing).` },
    
    { day: Math.floor(dayStep * 9), status: 'In Transit International', priority: 10,
      location: `${transitCountry}`, 
      description: `In transit — cross-channel movement (non-air route).` },
    
    { day: Math.floor(dayStep * 10), status: 'Arrived in ' + destinationCountry, priority: 11,
      location: `${destinationCountry} Import Facility`, 
      description: `Arrived at ${destinationCountry} Import Facility — inbound scan completed.` },
    
    { day: Math.floor(dayStep * 11), status: 'Customs Hold', priority: 12,
      location: `Customs, ${destinationCountry}`, 
      description: `Held for customs review in ${destinationCountry} (routine clearance).` },
    
    { day: Math.floor(dayStep * 12), status: 'Customs Processing', priority: 13,
      location: `Customs, ${destinationCountry}`, 
      description: `Customs processing underway — additional checks may apply.` },
    
    { day: Math.floor(dayStep * 13), status: 'Cleared Customs', priority: 14,
      location: `Customs, ${destinationCountry}`, 
      description: `Cleared customs in ${destinationCountry} — released to carrier network.` },
    
    { day: Math.floor(dayStep * 14), status: 'Handed to Local Carrier', priority: 15,
      location: `${destinationCountry}`, 
      description: `Handed over to ${destinationCountry} domestic carrier for final-mile delivery.` },
    
    { day: Math.floor(dayStep * 15), status: 'In Transit Local', priority: 16,
      location: `${destinationCountry}`, 
      description: `In transit to destination region sorting facility (${destinationCountry}).` },
    
    { day: Math.floor(dayStep * 16), status: 'Arrived at Local Depot', priority: 17,
      location: `${shipment.city || 'Local Depot'}, ${destinationCountry}`, 
      description: `Arrived at local delivery depot — delivery planning in progress.` },
    
    { day: Math.floor(dayStep * 17), status: 'Out for Delivery', priority: 18,
      location: `${shipment.city || 'Local'}, ${destinationCountry}`, 
      description: `Out for delivery in destination area (${destinationCountry}).` }
  ];
  
  if (parcelPoint) {
    eventSchedule.push({
      day: Math.floor(dayStep * 18),
      status: 'Available at Parcel Point',
      priority: 19,
      location: `Parcel Point, ${shipment.city || destinationCountry}`,
      description: `Package available for pickup at local parcel point.`
    });
  }
  
  // Track the highest priority event added
  let highestPriority = 0;
  let highestPriorityEvent = null;
  
  // First, find the highest priority existing event
  for (const event of eventSchedule) {
    if (existingStatuses.includes(event.status)) {
      if (event.priority > highestPriority) {
        highestPriority = event.priority;
        highestPriorityEvent = event;
      }
    }
  }
  
  // Process each event and add new ones
  for (const event of eventSchedule) {
    if (daysSinceCreation >= event.day && !existingStatuses.includes(event.status)) {
      const eventDate = new Date(createdAt);
      eventDate.setDate(eventDate.getDate() + event.day);
      
      // Generate time that's LATER than previous events on same day
      // Base time increases with priority
      const baseHour = 6 + Math.floor(event.priority * 0.7);
      const hour = Math.min(20, baseHour + Math.floor(Math.random() * 2));
      const minute = Math.floor(Math.random() * 60);
      const eventTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      
      await db.query(`
        INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [shipment.id, event.status, event.location, event.description, eventDate.toISOString().split('T')[0], eventTime]);
      
      console.log(`[Auto-Events] Added "${event.status}" (priority ${event.priority}) for shipment ${shipment.tracking_number}`);
      
      // Update highest priority if this event is higher
      if (event.priority > highestPriority) {
        highestPriority = event.priority;
        highestPriorityEvent = event;
      }
    }
  }
  
  // NOW update shipment status based on HIGHEST PRIORITY event
  if (highestPriorityEvent) {
    let newStatus = 'label_created';
    
    if (highestPriority >= 18) {
      // Out for Delivery or Available at Parcel Point
      newStatus = 'out_for_delivery';
    } else if (highestPriority >= 15) {
      // Handed to Local Carrier, In Transit Local, Arrived at Local Depot
      newStatus = 'in_transit';
    } else if (highestPriority >= 12) {
      // Customs Hold, Processing, Cleared
      newStatus = 'in_transit';
    } else if (highestPriority >= 4) {
      // Departed Origin through Arrived in destination
      newStatus = 'in_transit';
    } else if (highestPriority >= 2) {
      // Package Received, Processed at Origin Hub
      newStatus = 'label_created';
    }
    
    await db.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, shipment.id]);
    console.log(`[Auto-Events] Updated shipment ${shipment.tracking_number} status to: ${newStatus} (based on priority ${highestPriority})`);
  }
}

router.post('/update-tracking-events', authMiddleware, async (req, res) => {
  try {
    await updateTrackingEvents();
    res.json({ success: true, message: 'Tracking events updated' });
  } catch (error) {
    console.error('[Update Events] Error:', error);
    res.status(500).json({ error: 'Failed to update tracking events' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function fetchUnfulfilledOrders(store) {
  try {
    const response = await fetch(`https://${store.domain}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&limit=50`, {
      headers: { 'X-Shopify-Access-Token': store.api_token }
    });
    if (!response.ok) {
      console.error(`Error fetching orders: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.orders || [];
  } catch (error) {
    console.error('Error in fetchUnfulfilledOrders:', error);
    return [];
  }
}

async function fulfillOrderInShopify(store, order, trackingNumber) {
  const foRes = await fetch(`https://${store.domain}/admin/api/2024-01/orders/${order.id}/fulfillment_orders.json`, {
    headers: { 'X-Shopify-Access-Token': store.api_token }
  });
  const foData = await foRes.json();
  
  const fo = foData.fulfillment_orders?.find(f => f.status === 'open') || foData.fulfillment_orders?.[0];
  
  if (!fo) {
    throw new Error('No fulfillment order found');
  }

  const fulfillResponse = await fetch(`https://${store.domain}/admin/api/2024-01/fulfillments.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': store.api_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: [{
          fulfillment_order_id: fo.id,
          fulfillment_order_line_items: fo.line_items.map(li => ({ id: li.id, quantity: li.fulfillable_quantity }))
        }],
        tracking_info: {
          number: trackingNumber,
          url: `https://rvslogistics.com/?tracking=${trackingNumber}`,
          company: 'RVS Logistics'
        },
        notify_customer: true
      }
    })
  });

  if (!fulfillResponse.ok) {
    const errorData = await fulfillResponse.json();
    throw new Error(`Shopify fulfillment failed: ${JSON.stringify(errorData)}`);
  }

  return await fulfillResponse.json();
}

function generateTrackingNumber() {
  return 'DK' + Date.now() + Math.floor(Math.random() * 1000);
}

function getDanishTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
}

async function processAutoFulfillment() {
  console.log('[Auto-Fulfill] Starting auto-fulfillment check...');
  const danishTime = getDanishTime();
  const currentHour = danishTime.getHours();
  const currentMinute = danishTime.getMinutes();
  const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
  
  console.log(`[Auto-Fulfill] Danish time: ${currentTimeStr}`);

  await updateTrackingEvents();

  try {
    const storesResult = await db.query(
      "SELECT * FROM shopify_stores WHERE status = $1 AND is_connected = true AND api_token IS NOT NULL AND (store_type = 'shopify' OR store_type IS NULL)",
      ['active']
    );
    
    for (const store of storesResult.rows) {
      const fulfillmentTime = store.fulfillment_time || '16:00';
      const [targetHour, targetMinute] = fulfillmentTime.split(':').map(Number);
      
      const targetMinutes = targetHour * 60 + targetMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const diff = Math.abs(targetMinutes - currentMinutes);
      
      if (diff <= 15) {
        console.log(`[Auto-Fulfill] Processing store ${store.domain} (target: ${fulfillmentTime})`);
      }
    }
  } catch (error) {
    console.error('[Auto-Fulfill] Error:', error);
  }
}

router.processAutoFulfillment = processAutoFulfillment;
router.updateTrackingEvents = updateTrackingEvents;
module.exports = router;
