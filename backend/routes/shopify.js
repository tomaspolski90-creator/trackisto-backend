const express = require('express');
const router = express.Router();
const db = require('../config/database');
const crypto = require('crypto');

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const BACKEND_URL = 'https://trackisto-backend.onrender.com';
const FRONTEND_URL = 'https://playful-bombolone-e5db3c.netlify.app';

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  next();
};

// OAuth Step 1
router.get('/auth', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ message: 'Shop parameter required' });
  const scopes = 'read_orders,write_orders,read_fulfillments,write_fulfillments,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_products,read_locations';
  const redirectUri = `${BACKEND_URL}/api/shopify/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;
  res.redirect(authUrl);
});

// OAuth Step 2
router.get('/callback', async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.redirect(`${FRONTEND_URL}/?error=missing_params`);
  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code })
    });
    const data = await response.json();
    if (!data.access_token) return res.redirect(`${FRONTEND_URL}/?error=oauth_failed`);

    const existingStore = await db.query('SELECT id FROM shopify_stores WHERE domain = $1', [shop]);
    if (existingStore.rows.length > 0) {
      await db.query('UPDATE shopify_stores SET api_token = $1, status = $2 WHERE domain = $3', [data.access_token, 'active', shop]);
    } else {
      await db.query(`INSERT INTO shopify_stores (domain, api_token, delivery_days, send_offset, fulfillment_time, country_origin, status, created_at) VALUES ($1, $2, 7, 0, '16:00', 'United Kingdom', 'active', NOW())`, [shop, data.access_token]);
    }
    res.redirect(`${FRONTEND_URL}/?success=store_connected&shop=${shop}`);
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect(`${FRONTEND_URL}/?error=server_error`);
  }
});

// Get stores
router.get('/stores', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`SELECT id, domain, delivery_days, send_offset, fulfillment_time, country_origin, transit_country, sorting_days, parcel_point, redelivery_active, redelivery_days, attempts, status, created_at FROM shopify_stores ORDER BY created_at DESC`);
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// Update store settings
router.put('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { delivery_days, send_offset, fulfillment_time, country_origin, transit_country, sorting_days, parcel_point, redelivery_active, redelivery_days, attempts, status } = req.body;
    
    await db.query(`
      UPDATE shopify_stores 
      SET delivery_days = $1, send_offset = $2, fulfillment_time = $3, country_origin = $4, 
          transit_country = $5, sorting_days = $6, parcel_point = $7, redelivery_active = $8, 
          redelivery_days = $9, attempts = $10, status = $11
      WHERE id = $12
    `, [delivery_days, send_offset, fulfillment_time, country_origin, transit_country, sorting_days, parcel_point, redelivery_active, redelivery_days, attempts, status, id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating store:', error);
    res.status(500).json({ error: 'Failed to update store' });
  }
});

// Delete store
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

// ========== PENDING ORDERS (KUN UNFULFILLED) ==========
router.get('/pending-orders', authMiddleware, async (req, res) => {
  try {
    console.log('[Pending Orders] Fetching unfulfilled orders...');
    const storesResult = await db.query('SELECT * FROM shopify_stores WHERE status = $1', ['active']);
    const stores = storesResult.rows;
    let allOrders = [];

    for (const store of stores) {
      // ÆNDRET: Kun hent unfulfilled ordrer
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
          store_domain: store.domain
        }));
        allOrders = [...allOrders, ...mappedOrders];
      } else {
        console.error(`[Pending Orders] Error fetching from ${store.domain}:`, response.status);
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

// ========== FULFILLED ORDERS (NY ENDPOINT) ==========
router.get('/fulfilled-orders', authMiddleware, async (req, res) => {
  try {
    console.log('[Fulfilled Orders] Fetching fulfilled orders from Shopify...');
    const storesResult = await db.query('SELECT * FROM shopify_stores WHERE status = $1', ['active']);
    const stores = storesResult.rows;
    let allOrders = [];

    for (const store of stores) {
      // Hent fulfilled ordrer fra Shopify
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
          // Prøv at hente tracking nummer fra fulfillments
          tracking_number: order.fulfillments?.[0]?.tracking_number || null
        }));
        allOrders = [...allOrders, ...mappedOrders];
      } else {
        console.error(`[Fulfilled Orders] Error fetching from ${store.domain}:`, response.status);
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

// ========== MANUEL FULFILL ==========
router.post('/fetch-and-fulfill', authMiddleware, async (req, res) => {
  console.log('[Fetch-Fulfill] Manual trigger started...');
  try {
    const storesResult = await db.query('SELECT * FROM shopify_stores WHERE status = $1', ['active']);
    let fulfilledCount = 0;
    let errors = [];

    for (const store of storesResult.rows) {
      console.log(`[Fetch-Fulfill] Processing store: ${store.domain}`);
      const orders = await fetchUnfulfilledOrders(store);
      console.log(`[Fetch-Fulfill] Found ${orders.length} unfulfilled orders`);

      for (const order of orders) {
        if (!order.shipping_address) {
          console.log(`[Fetch-Fulfill] Skipping order ${order.id} - no shipping address`);
          continue;
        }

        // Tjek om vi allerede har oprettet shipment for denne ordre
        const existing = await db.query('SELECT id FROM shipments WHERE shopify_order_id = $1', [order.id.toString()]);
        if (existing.rows.length > 0) {
          console.log(`[Fetch-Fulfill] Skipping order ${order.id} - already processed`);
          continue;
        }

        try {
          const trackingNumber = generateTrackingNumber();
          console.log(`[Fetch-Fulfill] Fulfilling order ${order.id} with tracking ${trackingNumber}`);
          
          await fulfillOrderInShopify(store, order, trackingNumber);
          
          // Gem shipment i database
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

          // Opret initial tracking event
          await db.query(`
            INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_TIME, NOW())
          `, [
            shipmentResult.rows[0].id,
            'label_created',
            store.country_origin || 'United Kingdom',
            'Shipping label has been created'
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

// ========== HELPER FUNCTIONS ==========

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
  // Get fulfillment orders
  const foRes = await fetch(`https://${store.domain}/admin/api/2024-01/orders/${order.id}/fulfillment_orders.json`, {
    headers: { 'X-Shopify-Access-Token': store.api_token }
  });
  const foData = await foRes.json();
  
  const fo = foData.fulfillment_orders?.find(f => f.status === 'open') || foData.fulfillment_orders?.[0];
  
  if (!fo) {
    throw new Error('No fulfillment order found');
  }

  // Create fulfillment
  const fulfillResponse = await fetch(`https://${store.domain}/admin/api/2024-01/fulfillments.json`, {
    method: 'POST',
    headers: { 
      'X-Shopify-Access-Token': store.api_token, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: [{
          fulfillment_order_id: fo.id,
          fulfillment_order_line_items: fo.line_items.map(li => ({
            id: li.id,
            quantity: li.fulfillable_quantity
          }))
        }],
        tracking_info: {
          number: trackingNumber,
          url: `https://grand-sorbet-268b5e.netlify.app/?tracking=${trackingNumber}`,
          company: 'Trackisto'
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

  try {
    const storesResult = await db.query('SELECT * FROM shopify_stores WHERE status = $1', ['active']);
    
    for (const store of storesResult.rows) {
      const fulfillmentTime = store.fulfillment_time || '16:00';
      const [targetHour, targetMinute] = fulfillmentTime.split(':').map(Number);
      
      // Tjek om vi er indenfor 30 minutters vindue
      const targetMinutes = targetHour * 60 + targetMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const diff = Math.abs(targetMinutes - currentMinutes);
      
      if (diff <= 15) { // Indenfor 15 minutter af target time
        console.log(`[Auto-Fulfill] Processing store ${store.domain} (target: ${fulfillmentTime})`);
        // Her kunne vi kalde fulfill logik automatisk
      }
    }
  } catch (error) {
    console.error('[Auto-Fulfill] Error:', error);
  }
}

router.processAutoFulfillment = processAutoFulfillment;
module.exports = router;
