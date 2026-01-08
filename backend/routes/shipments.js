// Shipment Routes
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('./auth');

// Generate tracking number
function generateTrackingNumber(country) {
  const countryCode = country === 'Denmark' ? 'DK' : 
                      country === 'United Kingdom' ? 'GB' : 
                      country === 'Germany' ? 'DE' :
                      country === 'Netherlands' ? 'NL' : 'US';
  const randomNum = Math.floor(Math.random() * 10000000000000);
  return `${countryCode}${randomNum}`;
}

// Get all shipments with pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let query = `
      SELECT s.*, 
             COUNT(*) OVER() AS total_count
      FROM shipments s
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (s.tracking_number ILIKE $${paramCount} OR s.customer_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (status) {
      query += ` AND s.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` ORDER BY s.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      shipments: result.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages
      }
    });

  } catch (error) {
    console.error('Get shipments error:', error);
    res.status(500).json({ error: 'Failed to fetch shipments' });
  }
});

// Get shipment by tracking number
router.get('/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    const shipmentResult = await db.query(
      'SELECT * FROM shipments WHERE tracking_number = $1',
      [trackingNumber]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const shipment = shipmentResult.rows[0];

    // Get tracking events
    const eventsResult = await db.query(
      `SELECT * FROM tracking_events 
       WHERE shipment_id = $1 
       ORDER BY event_date DESC, event_time DESC`,
      [shipment.id]
    );

    res.json({
      shipment,
      events: eventsResult.rows
    });

  } catch (error) {
    console.error('Get shipment error:', error);
    res.status(500).json({ error: 'Failed to fetch shipment' });
  }
});

// Create new shipment
router.post('/', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    const {
      customerName,
      customerEmail,
      shippingAddress,
      city,
      state,
      zipCode,
      country,
      destinationCountry,
      originCountry,
      transitCountry,
      deliveryDays,
      sortingDays,
      price,
      orderNumber,
      postDeliveryEvent,
      redeliveryDays,
      attempts
    } = req.body;

    // Generate tracking number
    const trackingNumber = generateTrackingNumber(destinationCountry);

    // Insert shipment
    const shipmentResult = await client.query(
      `INSERT INTO shipments (
        tracking_number, customer_name, customer_email, shipping_address,
        city, state, zip_code, country, destination_country, origin_country,
        transit_country, delivery_days, sorting_days, price, order_number,
        post_delivery_event, redelivery_days, attempts, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *`,
      [
        trackingNumber, customerName, customerEmail, shippingAddress,
        city, state, zipCode, country, destinationCountry, originCountry,
        transitCountry, deliveryDays, sortingDays || 3, price, orderNumber,
        postDeliveryEvent || 'None', redeliveryDays || 3, attempts || 1, 'label_created'
      ]
    );

    const shipment = shipmentResult.rows[0];

    // Create initial tracking event
    await client.query(
      `INSERT INTO tracking_events (
        shipment_id, status, location, event_date, event_time, description, completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        shipment.id,
        'Label Created',
        `${city || 'Processing Center'}, ${originCountry || country}`,
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0],
        'Shipping label created',
        true
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      shipment,
      trackingNumber
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create shipment error:', error);
    res.status(500).json({ error: 'Failed to create shipment' });
  } finally {
    client.release();
  }
});

// Update shipment status
router.patch('/:id/status', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { status, location, description } = req.body;

    // Update shipment status
    const shipmentResult = await client.query(
      'UPDATE shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (shipmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Add tracking event
    await client.query(
      `INSERT INTO tracking_events (
        shipment_id, status, location, event_date, event_time, description, completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        status,
        location || 'In Transit',
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0],
        description || `Status updated to ${status}`,
        true
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      shipment: shipmentResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update shipment status error:', error);
    res.status(500).json({ error: 'Failed to update shipment status' });
  } finally {
    client.release();
  }
});

// Delete shipment
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM shipments WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    res.json({
      success: true,
      message: 'Shipment deleted successfully'
    });

  } catch (error) {
    console.error('Delete shipment error:', error);
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
});

// Get dashboard statistics
router.get('/stats/dashboard', authenticateToken, async (req, res) => {
  try {
    const totalResult = await db.query('SELECT COUNT(*) as total FROM shipments');
    const todayResult = await db.query(
      'SELECT COUNT(*) as today FROM shipments WHERE DATE(created_at) = CURRENT_DATE'
    );
    const pendingResult = await db.query(
      'SELECT COUNT(*) as pending FROM pending_shipments WHERE fulfillment_status = $1',
      ['unfulfilled']
    );

    res.json({
      totalShipments: parseInt(totalResult.rows[0].total),
      todayShipments: parseInt(todayResult.rows[0].today),
      pendingOrders: parseInt(pendingResult.rows[0].pending)
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get pending shipments
router.get('/pending/list', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM pending_shipments ORDER BY created_at DESC'
    );

    res.json({
      pendingShipments: result.rows
    });

  } catch (error) {
    console.error('Get pending shipments error:', error);
    res.status(500).json({ error: 'Failed to fetch pending shipments' });
  }
});

module.exports = router;