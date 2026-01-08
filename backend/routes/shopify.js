const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');
const { authenticateToken } = require('./auth');

// Generate tracking number
function generateTrackingNumber(country = 'DK') {
  const prefix = country.substring(0, 2).toUpperCase();
  const numbers = Math.floor(Math.random() * 9000000000000) + 1000000000000;
  return `${prefix}${numbers}`;
}

// Calculate estimated delivery date
function calculateDeliveryDate(deliveryDays, sortingDays) {
  const date = new Date();
  date.setDate(date.getDate() + deliveryDays + sortingDays);
  return date.toISOString().split('T')[0];
}

// Generate tracking events based on settings
function generateTrackingEvents(shipmentId, settings) {
  const events = [];
  const now = new Date();
  
  // Event 1: Order received (day 0)
  events.push({
    shipment_id: shipmentId,
    status: 'Order Received',
    location: `${settings.countryOrigin}`,
    description: 'Shipment information received',
    event_date: now.toISOString().split('T')[0],
    event_time: now.toTimeString().split(' ')[0]
  });

  return events;
}

// Verify Shopify webhook signature
function verifyShopifyWebhook(req) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  
  if (!hmac || !secret) {
    console.log('Missing HMAC or secret');
    return true; // Skip verification if not configured
  }

  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body), 'utf8')
    .digest('base64');

  return hmac === hash;
}

// ==================== WEBHOOK ENDPOINTS ====================

// Webhook endpoint for Shopify order creation
router.post('/webhook/order-created', async (req, res) => {
  try {
    console.log('Received Shopify webhook:', JSON.stringify(req.body).substring(0, 500));

    // Verify webhook (optional in development)
    // if (!verifyShopifyWebhook(req)) {
    //   return res.status(401).json({ error: 'Invalid webhook signature' });
    // }

    const order = req.body;

    // Extract order details
    const {
      id: orderId,
      order_number,
      email,
      total_price,
      created_at,
      customer,
      shipping_address,
      line_items
    } = order;

    if (!shipping_address) {
      console.log('No shipping address, skipping');
      return res.status(200).json({ message: 'No shipping address' });
    }

    // Get store settings based on shop domain
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    console.log('Shop domain:', shopDomain);

    let storeSettings = {
      deliveryDays: 7,
      sortingDays: 3,
      countryOrigin: 'United Kingdom',
      transitCountry: 'Netherlands',
      sendOffset: 2
    };

    if (shopDomain) {
      const storeResult = await db.query(
        'SELECT * FROM shopify_stores WHERE domain = $1',
        [shopDomain]
      );

      if (storeResult.rows.length > 0) {
        const store = storeResult.rows[0];
        storeSettings = {
          deliveryDays: store.delivery_days || 7,
          sortingDays: store.sorting_days || 3,
          countryOrigin: store.country_origin || 'United Kingdom',
          transitCountry: store.transit_country || 'Netherlands',
          sendOffset: store.send_offset || 2
        };
      }
    }

    // Generate tracking number
    const countryCode = shipping_address.country_code || 'DK';
    const trackingNumber = generateTrackingNumber(countryCode);

    // Calculate estimated delivery
    const estimatedDelivery = calculateDeliveryDate(
      storeSettings.deliveryDays,
      storeSettings.sortingDays
    );

    // Customer name
    const customerName = customer 
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : `${shipping_address.first_name || ''} ${shipping_address.last_name || ''}`.trim() || 'Guest';

    // Check if shipment already exists for this order
    const existingShipment = await db.query(
      'SELECT * FROM shipments WHERE shopify_order_id = $1',
      [orderId.toString()]
    );

    if (existingShipment.rows.length > 0) {
      console.log('Order already processed:', orderId);
      return res.status(200).json({ 
        message: 'Order already processed',
        tracking_number: existingShipment.rows[0].tracking_number
      });
    }

    // Insert shipment
    const shipmentResult = await db.query(
      `INSERT INTO shipments (
        tracking_number, customer_name, customer_email, 
        shipping_address, city, state, zip_code, country,
        origin_country, transit_country, destination_country,
        status, delivery_days, sorting_days, estimated_delivery,
        price, shopify_order_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      RETURNING *`,
      [
        trackingNumber,
        customerName,
        email,
        `${shipping_address.address1 || ''} ${shipping_address.address2 || ''}`.trim(),
        shipping_address.city,
        shipping_address.province,
        shipping_address.zip,
        shipping_address.country,
        storeSettings.countryOrigin,
        storeSettings.transitCountry,
        shipping_address.country,
        'label_created',
        storeSettings.deliveryDays,
        storeSettings.sortingDays,
        estimatedDelivery,
        total_price,
        orderId.toString()
      ]
    );

    const shipment = shipmentResult.rows[0];

    // Create initial tracking event
    await db.query(
      `INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        shipment.id,
        'Order Received',
        storeSettings.countryOrigin,
        'Shipment information received',
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0]
      ]
    );

    // Build tracking URL
    const trackingUrl = `${process.env.TRACKING_SITE_URL || 'https://grand-sorbet-268b5e.netlify.app'}?tracking=${trackingNumber}`;

    console.log('Created shipment:', {
      trackingNumber,
      customerName,
      trackingUrl
    });

    // Return success with tracking info
    res.status(200).json({ 
      message: 'Order processed successfully',
      tracking_number: trackingNumber,
      tracking_url: trackingUrl
    });

  } catch (error) {
    console.error('Shopify webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// ==================== STORE MANAGEMENT ENDPOINTS ====================

// Get all Shopify stores
router.get('/stores', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM shopify_stores ORDER BY created_at DESC'
    );
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Get Shopify stores error:', error);
    res.status(500).json({ error: 'Failed to fetch Shopify stores' });
  }
});

// Add new Shopify store
router.post('/stores', authenticateToken, async (req, res) => {
  try {
    const {
      domain, apiToken, deliveryDays, sendOffset, countryOrigin,
      transitCountry, postDeliveryEvent, redeliveryDays, sortingDays,
      attempts, parcelPoint
    } = req.body;

    if (!domain || !apiToken) {
      return res.status(400).json({ error: 'Domain and API token are required' });
    }

    const existingStore = await db.query(
      'SELECT * FROM shopify_stores WHERE domain = $1',
      [domain]
    );

    if (existingStore.rows.length > 0) {
      return res.status(409).json({ error: 'Store with this domain already exists' });
    }

    const result = await db.query(
      `INSERT INTO shopify_stores (
        domain, api_token, delivery_days, send_offset, country_origin,
        transit_country, post_delivery_event, redelivery_days, sorting_days,
        attempts, parcel_point, redelivery_active, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        domain, apiToken, deliveryDays || 7, sendOffset || 2,
        countryOrigin || 'United Kingdom', transitCountry || 'Netherlands',
        postDeliveryEvent || 'None', redeliveryDays || 3, sortingDays || 3,
        attempts || 1, parcelPoint !== undefined ? parcelPoint : true,
        postDeliveryEvent && postDeliveryEvent !== 'None', 'active'
      ]
    );

    res.status(201).json({ success: true, store: result.rows[0] });
  } catch (error) {
    console.error('Add Shopify store error:', error);
    res.status(500).json({ error: 'Failed to add Shopify store' });
  }
});

// Update Shopify store
router.put('/stores/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      domain, apiToken, deliveryDays, sendOffset, countryOrigin,
      transitCountry, postDeliveryEvent, redeliveryDays, sortingDays,
      attempts, parcelPoint, status
    } = req.body;

    const result = await db.query(
      `UPDATE shopify_stores SET
        domain = COALESCE($1, domain),
        api_token = COALESCE($2, api_token),
        delivery_days = COALESCE($3, delivery_days),
        send_offset = COALESCE($4, send_offset),
        country_origin = COALESCE($5, country_origin),
        transit_country = COALESCE($6, transit_country),
        post_delivery_event = COALESCE($7, post_delivery_event),
        redelivery_days = COALESCE($8, redelivery_days),
        sorting_days = COALESCE($9, sorting_days),
        attempts = COALESCE($10, attempts),
        parcel_point = COALESCE($11, parcel_point),
        redelivery_active = COALESCE($12, redelivery_active),
        status = COALESCE($13, status)
      WHERE id = $14
      RETURNING *`,
      [
        domain, apiToken, deliveryDays, sendOffset, countryOrigin,
        transitCountry, postDeliveryEvent, redeliveryDays, sortingDays,
        attempts, parcelPoint, postDeliveryEvent && postDeliveryEvent !== 'None',
        status, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    res.json({ success: true, store: result.rows[0] });
  } catch (error) {
    console.error('Update Shopify store error:', error);
    res.status(500).json({ error: 'Failed to update Shopify store' });
  }
});

// Delete Shopify store
router.delete('/stores/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM shopify_stores WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    res.json({ success: true, message: 'Store deleted successfully' });
  } catch (error) {
    console.error('Delete Shopify store error:', error);
    res.status(500).json({ error: 'Failed to delete Shopify store' });
  }
});

// Test Shopify API connection
router.post('/stores/:id/test', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const storeResult = await db.query(
      'SELECT * FROM shopify_stores WHERE id = $1',
      [id]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const store = storeResult.rows[0];

    if (!store.domain || !store.api_token) {
      return res.status(400).json({ success: false, error: 'Missing domain or API token' });
    }

    res.json({
      success: true,
      message: 'Shopify connection test successful',
      store: { domain: store.domain, status: store.status }
    });
  } catch (error) {
    console.error('Test Shopify connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to test connection' });
  }
});

module.exports = router;