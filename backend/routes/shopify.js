const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Middleware to verify token (simplified)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  // In production, verify JWT token here
  next();
};

// Get all stores
router.get('/stores', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, domain, api_token, delivery_days, send_offset, country_origin, 
              transit_country, post_delivery_event, sorting_days, parcel_point,
              parcel_point_days, redelivery_active, redelivery_days, attempts, 
              status, created_at 
       FROM shopify_stores 
       ORDER BY created_at DESC`
    );
    res.json({ stores: result.rows });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ message: 'Failed to fetch stores' });
  }
});

// Add new store
router.post('/stores', authMiddleware, async (req, res) => {
  try {
    const {
      domain,
      api_token,
      delivery_days = 7,
      send_offset = 0,
      country_origin = 'United Kingdom',
      transit_country = '',
      post_delivery_event = 'None',
      sorting_days = 3,
      parcel_point = true,
      parcel_point_days = 3,
      redelivery_active = false,
      redelivery_days = 3,
      attempts = 1
    } = req.body;

    if (!domain || !api_token) {
      return res.status(400).json({ message: 'Domain and API token are required' });
    }

    const result = await db.query(
      `INSERT INTO shopify_stores 
       (domain, api_token, delivery_days, send_offset, country_origin, transit_country,
        post_delivery_event, sorting_days, parcel_point, parcel_point_days,
        redelivery_active, redelivery_days, attempts, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', NOW())
       RETURNING *`,
      [domain, api_token, delivery_days, send_offset, country_origin, transit_country,
       post_delivery_event, sorting_days, parcel_point, parcel_point_days,
       redelivery_active, redelivery_days, attempts]
    );

    res.status(201).json({ store: result.rows[0], message: 'Store added successfully' });
  } catch (error) {
    console.error('Error adding store:', error);
    res.status(500).json({ message: 'Failed to add store' });
  }
});

// Update store
router.put('/stores/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      domain,
      api_token,
      delivery_days,
      send_offset,
      country_origin,
      transit_country,
      post_delivery_event,
      sorting_days,
      parcel_point,
      parcel_point_days,
      redelivery_active,
      redelivery_days,
      attempts
    } = req.body;

    const result = await db.query(
      `UPDATE shopify_stores 
       SET domain = $1, api_token = $2, delivery_days = $3, send_offset = $4,
           country_origin = $5, transit_country = $6, post_delivery_event = $7,
           sorting_days = $8, parcel_point = $9, parcel_point_days = $10,
           redelivery_active = $11, redelivery_days = $12, attempts = $13
       WHERE id = $14
       RETURNING *`,
      [domain, api_token, delivery_days, send_offset, country_origin, transit_country,
       post_delivery_event, sorting_days, parcel_point, parcel_point_days,
       redelivery_active, redelivery_days, attempts, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

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

    const result = await db.query(
      'UPDATE shopify_stores SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

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
    const result = await db.query(
      'DELETE FROM shopify_stores WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    res.json({ message: 'Store deleted successfully' });
  } catch (error) {
    console.error('Error deleting store:', error);
    res.status(500).json({ message: 'Failed to delete store' });
  }
});

// Webhook for order created
router.post('/webhook/order-created', async (req, res) => {
  try {
    console.log('Received Shopify webhook');
    const order = req.body;
    
    // Get store settings based on the shop domain
    const shopDomain = req.headers['x-shopify-shop-domain'];
    let storeSettings = {
      delivery_days: 7,
      country_origin: 'United Kingdom',
      transit_country: '',
      sorting_days: 3
    };

    if (shopDomain) {
      const storeResult = await db.query(
        'SELECT * FROM shopify_stores WHERE domain = $1 AND status = $2',
        [shopDomain, 'active']
      );
      if (storeResult.rows.length > 0) {
        storeSettings = storeResult.rows[0];
      }
    }

    // Generate tracking number
    const trackingNumber = 'DK' + Date.now() + Math.floor(Math.random() * 1000);
    
    // Calculate estimated delivery
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + (storeSettings.delivery_days || 7));

    // Get shipping address
    const shippingAddress = order.shipping_address || {};
    
    // Create shipment
    const result = await db.query(
      `INSERT INTO shipments 
       (tracking_number, customer_name, customer_email, shipping_address, city, 
        state, zip_code, country, origin_country, transit_country, destination_country,
        status, delivery_days, sorting_days, estimated_delivery, price, 
        shopify_order_id, shopify_store_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
       RETURNING *`,
      [
        trackingNumber,
        `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 'Unknown',
        order.email || '',
        `${shippingAddress.address1 || ''} ${shippingAddress.address2 || ''}`.trim(),
        shippingAddress.city || '',
        shippingAddress.province || '',
        shippingAddress.zip || '',
        shippingAddress.country || 'Unknown',
        storeSettings.country_origin || 'United Kingdom',
        storeSettings.transit_country || '',
        shippingAddress.country || 'Unknown',
        'label_created',
        storeSettings.delivery_days || 7,
        storeSettings.sorting_days || 3,
        estimatedDelivery,
        order.total_price || 0,
        order.id?.toString() || '',
        storeSettings.id || null
      ]
    );

    console.log('Created shipment:', result.rows[0].tracking_number);

    // Create initial tracking event
    await db.query(
      `INSERT INTO tracking_events 
       (shipment_id, status, location, description, event_date, event_time, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        result.rows[0].id,
        'label_created',
        storeSettings.country_origin || 'United Kingdom',
        'Shipping label created, package awaiting pickup',
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0]
      ]
    );

    res.status(200).json({ success: true, tracking_number: trackingNumber });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

module.exports = router;