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

// OAuth Step 1: Redirect to Shopify
router.get('/auth', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ message: 'Shop parameter required' });
  
  const scopes = 'read_orders,write_orders,read_fulfillments,write_fulfillments,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_products,read_locations';
  const redirectUri = `${BACKEND_URL}/api/shopify/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;
  
  res.redirect(authUrl);
});

// OAuth Step 2: Handle callback
router.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;
  
  if (!code || !shop) {
    return res.redirect(`${FRONTEND_URL}/?error=missing_params`);
  }
  
  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code: code
      })
    });
    
    const data = await response.json();
    
    if (!data.access_token) {
      console.error('OAuth error:', data);
      return res.redirect(`${FRONTEND_URL}/?error=oauth_failed`);
    }
    
    const existingStore = await db.query('SELECT id FROM shopify_stores WHERE domain = $1', [shop]);
    
    if (existingStore.rows.length > 0) {
      await db.query('UPDATE shopify_stores SET api_token = $1, status = $2 WHERE domain = $3', 
        [data.access_token, 'active', shop]);
    } else {
      await db.query(
        `INSERT INTO shopify_stores (domain, api_token, delivery_days, send_offset, fulfillment_time, country_origin, status, created_at)
         VALUES ($1, $2, 7, 0, '10:00', 'United Kingdom', 'active', NOW())`,
        [shop, data.access_token]
      );
    }
    
    res.redirect(`${FRONTEND_URL}/?success=store_connected&shop=${shop}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/?error=server_error`);
  }
});

// Get all stores
router.get('/stores', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, domain, delivery_days, send_offset, fulfillment_time, country_origin, transit_country, 
              post_delivery_event, sorting_days, parcel_point, parcel_point_days, redelivery_active, 
              redelivery_days, attempts, status, created_at 
       FROM shopify_stores ORDER BY created_at DESC`
    );
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ message: 'Failed to fetch stores' });
  }
});

// Update store settings
router.put('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { delivery_days, send_offset, fulfillment_time, country_origin, transit_country, post_delivery_event, 
            sorting_days, parcel_point, parcel_point_days, redelivery_active, redelivery_days, attempts } = req.body;

    const result = await db.query(
      `UPDATE shopify_stores SET delivery_days = $1, send_offset = $2, fulfillment_time = $3, country_origin = $4,
              transit_country = $5, post_delivery_event = $6, sorting_days = $7, parcel_point = $8, 
              parcel_point_days = $9, redelivery_active = $10, redelivery_days = $11, attempts = $12
       WHERE id = $13 RETURNING *`,
      [delivery_days, send_offset, fulfillment_time, country_origin, transit_country, post_delivery_event,
       sorting_days, parcel_point, parcel_point_days, redelivery_active, redelivery_days, attempts, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ message: 'Store not found' });
    res.json({ store: result.rows[0], message: 'Store updated successfully' });
  } catch (error) {
    console.error('Error updating store:', error);
    res.status(500).json({ message: 'Failed to update store' });
  }
});

// Update store status
router.put('/stores/:id/status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const result = await db.query('UPDATE shopify_stores SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Store not found' });
    res.json({ store: result.rows[0], message: 'Status updated' });
  } catch (error) {
    console.error('Error updating store status:', error);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

// Delete store
router.delete('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM shopify_stores WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Store not found' });
    res.json({ message: 'Store deleted successfully' });
  } catch (error) {
    console.error('Error deleting store:', error);
    res.status(500).json({ message: 'Failed to delete store' });
  }
});

// Auto-fulfill functions
async function fetchUnfulfilledOrders(store) {
  const response = await fetch(
    `https://${store.domain}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled`,
    { headers: { 'X-Shopify-Access-Token': store.api_token, 'Content-Type': 'application/json' } }
  );
  if (!response.ok) throw new Error(`Failed to fetch orders: ${response.status}`);
  const data = await response.json();
  return data.orders || [];
}

async function fulfillOrderInShopify(store, order, trackingNumber) {
  // Get fulfillment orders
  const fulfillmentOrdersRes = await fetch(
    `https://${store.domain}/admin/api/2024-01/orders/${order.id}/fulfillment_orders.json`,
    { headers: { 'X-Shopify-Access-Token': store.api_token, 'Content-Type': 'application/json' } }
  );
  
  if (!fulfillmentOrdersRes.ok) {
    const errorText = await fulfillmentOrdersRes.text();
    console.log('[Auto-Fulfill] Fulfillment orders response:', errorText);
    throw new Error('Failed to get fulfillment orders');
  }
  
  const fulfillmentOrdersData = await fulfillmentOrdersRes.json();
  console.log('[Auto-Fulfill] Fulfillment orders:', JSON.stringify(fulfillmentOrdersData));
  
  const fulfillmentOrder = fulfillmentOrdersData.fulfillment_orders?.find(fo => fo.status === 'open');
  const foToUse = fulfillmentOrder || fulfillmentOrdersData.fulfillment_orders?.[0];
  
  if (!foToUse) throw new Error('No fulfillment order found');

  // Create fulfillment
  const fulfillmentRes = await fetch(
    `https://${store.domain}/admin/api/2024-01/fulfillments.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': store.api_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fulfillment: {
          line_items_by_fulfillment_order: [{ 
            fulfillment_order_id: foToUse.id,
            fulfillment_order_line_items: foToUse.line_items.map(li => ({
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
    }
  );
  
  if (!fulfillmentRes.ok) {
    const errorData = await fulfillmentRes.json();
    console.log('[Auto-Fulfill] Fulfillment error:', JSON.stringify(errorData));
    throw new Error(`Failed to fulfill: ${JSON.stringify(errorData)}`);
  }
  return await fulfillmentRes.json();
}

function generateTrackingNumber() {
  return 'DK' + Date.now() + Math.floor(Math.random() * 1000);
}

// Helper function to get Danish time
function getDanishTime() {
  const now = new Date();
  const danishTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }));
  return danishTime;
}

async function processAutoFulfillment() {
  console.log('[Auto-Fulfill] Starting check...');
  try {
    const storesResult = await db.query('SELECT * FROM shopify_stores WHERE status = $1', ['active']);
    const stores = storesResult.rows;
    console.log(`[Auto-Fulfill] Found ${stores.length} active stores`);
    
    // Use Danish timezone
    const danishTime = getDanishTime();
    const currentHour = danishTime.getHours();
    const currentMinute = danishTime.getMinutes();
    console.log(`[Auto-Fulfill] Current Danish time: ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);
    
    for (const store of stores) {
      try {
        const fulfillTime = store.fulfillment_time || '10:00';
        const [fulfillHour, fulfillMin] = fulfillTime.split(':').map(Number);
        const fulfillMinutes = fulfillHour * 60 + fulfillMin;
        const currentMinutes = currentHour * 60 + currentMinute;
        
        if (Math.abs(currentMinutes - fulfillMinutes) > 30) {
          console.log(`[Auto-Fulfill] Skipping ${store.domain} - not fulfillment time (${fulfillTime}), current: ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);
          continue;
        }
        
        console.log(`[Auto-Fulfill] Processing store: ${store.domain}`);
        const orders = await fetchUnfulfilledOrders(store);
        console.log(`[Auto-Fulfill] Found ${orders.length} unfulfilled orders`);
        
        const sendOffsetDays = store.send_offset || 0;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - sendOffsetDays);
        
        for (const order of orders) {
          try {
            const orderDate = new Date(order.created_at);
            if (orderDate > cutoffDate) continue;
            
            // Skip orders without shipping address
            if (!order.shipping_address || !order.shipping_address.first_name) {
              console.log(`[Auto-Fulfill] Skipping order ${order.id} - no shipping address`);
              continue;
            }
            
            const existingShipment = await db.query('SELECT id FROM shipments WHERE shopify_order_id = $1', [order.id.toString()]);
            if (existingShipment.rows.length > 0) continue;
            
            const trackingNumber = generateTrackingNumber();
            await fulfillOrderInShopify(store, order, trackingNumber);
            console.log(`[Auto-Fulfill] Fulfilled order ${order.id} with tracking ${trackingNumber}`);
            
            const estimatedDelivery = new Date();
            estimatedDelivery.setDate(estimatedDelivery.getDate() + (store.delivery_days || 7));
            const shippingAddress = order.shipping_address || {};
            
            const shipmentResult = await db.query(
              `INSERT INTO shipments (tracking_number, customer_name, customer_email, shipping_address, city, state, zip_code, country, origin_country, transit_country, destination_country, status, delivery_days, sorting_days, estimated_delivery, price, shopify_order_id, shopify_store_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()) RETURNING *`,
              [trackingNumber, `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 'Unknown', order.email || '', `${shippingAddress.address1 || ''} ${shippingAddress.address2 || ''}`.trim(), shippingAddress.city || '', shippingAddress.province || '', shippingAddress.zip || '', shippingAddress.country || 'Unknown', store.country_origin || 'United Kingdom', store.transit_country || '', shippingAddress.country || 'Unknown', 'label_created', store.delivery_days || 7, store.sorting_days || 3, estimatedDelivery, order.total_price || 0, order.id.toString(), store.id]
            );
            
            await db.query(
              `INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [shipmentResult.rows[0].id, 'label_created', store.country_origin || 'United Kingdom', 'Shipping label created', new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]]
            );
            console.log(`[Auto-Fulfill] Saved shipment ${trackingNumber}`);
          } catch (orderError) {
            console.error(`[Auto-Fulfill] Error processing order ${order.id}:`, orderError.message);
          }
        }
      } catch (storeError) {
        console.error(`[Auto-Fulfill] Error processing store ${store.domain}:`, storeError.message);
      }
    }
    console.log('[Auto-Fulfill] Completed');
  } catch (error) {
    console.error('[Auto-Fulfill] Fatal error:', error);
  }
}

router.post('/auto-fulfill', authMiddleware, async (req, res) => {
  try {
    await processAutoFulfillment();
    res.json({ message: 'Auto-fulfillment triggered successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to trigger auto-fulfillment' });
  }
});

router.processAutoFulfillment = processAutoFulfillment;

module.exports = router;
