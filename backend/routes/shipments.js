// Shipment Routes
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('./auth');

// Country codes mapping
const countryCodes = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Andorra': 'AD', 'Angola': 'AO',
  'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU', 'Austria': 'AT', 'Azerbaijan': 'AZ',
  'Bahamas': 'BS', 'Bahrain': 'BH', 'Bangladesh': 'BD', 'Belarus': 'BY', 'Belgium': 'BE',
  'Bolivia': 'BO', 'Bosnia and Herzegovina': 'BA', 'Brazil': 'BR', 'Bulgaria': 'BG',
  'Cambodia': 'KH', 'Canada': 'CA', 'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO',
  'Costa Rica': 'CR', 'Croatia': 'HR', 'Cuba': 'CU', 'Cyprus': 'CY', 'Czech Republic': 'CZ',
  'Denmark': 'DK', 'Dominican Republic': 'DO', 'Ecuador': 'EC', 'Egypt': 'EG', 'Estonia': 'EE',
  'Ethiopia': 'ET', 'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE',
  'Ghana': 'GH', 'Greece': 'GR', 'Guatemala': 'GT', 'Honduras': 'HN', 'Hong Kong': 'HK',
  'Hungary': 'HU', 'Iceland': 'IS', 'India': 'IN', 'Indonesia': 'ID', 'Iran': 'IR',
  'Iraq': 'IQ', 'Ireland': 'IE', 'Israel': 'IL', 'Italy': 'IT', 'Jamaica': 'JM',
  'Japan': 'JP', 'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kuwait': 'KW',
  'Latvia': 'LV', 'Lebanon': 'LB', 'Libya': 'LY', 'Lithuania': 'LT', 'Luxembourg': 'LU',
  'Malaysia': 'MY', 'Maldives': 'MV', 'Malta': 'MT', 'Mexico': 'MX', 'Moldova': 'MD',
  'Monaco': 'MC', 'Mongolia': 'MN', 'Montenegro': 'ME', 'Morocco': 'MA', 'Nepal': 'NP',
  'Netherlands': 'NL', 'New Zealand': 'NZ', 'Nigeria': 'NG', 'North Macedonia': 'MK',
  'Norway': 'NO', 'Oman': 'OM', 'Pakistan': 'PK', 'Panama': 'PA', 'Paraguay': 'PY',
  'Peru': 'PE', 'Philippines': 'PH', 'Poland': 'PL', 'Portugal': 'PT', 'Qatar': 'QA',
  'Romania': 'RO', 'Russia': 'RU', 'Saudi Arabia': 'SA', 'Serbia': 'RS', 'Singapore': 'SG',
  'Slovakia': 'SK', 'Slovenia': 'SI', 'South Africa': 'ZA', 'South Korea': 'KR', 'Spain': 'ES',
  'Sri Lanka': 'LK', 'Sweden': 'SE', 'Switzerland': 'CH', 'Taiwan': 'TW', 'Thailand': 'TH',
  'Tunisia': 'TN', 'Turkey': 'TR', 'Ukraine': 'UA', 'United Arab Emirates': 'AE',
  'United Kingdom': 'GB', 'United States': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ',
  'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE', 'Zambia': 'ZM', 'Zimbabwe': 'ZW'
};

// Generate tracking number
function generateTrackingNumber(country) {
  const countryCode = countryCodes[country] || 'XX';
  return countryCode + Date.now() + Math.floor(Math.random() * 1000);
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

// Get dashboard statistics - MUST BE BEFORE /:trackingNumber route
router.get('/stats/dashboard', authenticateToken, async (req, res) => {
  try {
    const totalResult = await db.query('SELECT COUNT(*) as total FROM shipments');
    const todayResult = await db.query(
      'SELECT COUNT(*) as today FROM shipments WHERE DATE(created_at) = CURRENT_DATE'
    );
    
    // Just return 0 for pending since we don't have that table
    res.json({
      total: parseInt(totalResult.rows[0].total),
      today: parseInt(todayResult.rows[0].today),
      pending: 0
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get pending shipments - MUST BE BEFORE /:trackingNumber route
router.get('/pending/list', authenticateToken, async (req, res) => {
  try {
    // Return empty array since we don't have pending_shipments table
    res.json({
      pendingShipments: []
    });

  } catch (error) {
    console.error('Get pending shipments error:', error);
    res.status(500).json({ error: 'Failed to fetch pending shipments' });
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
  try {
    const {
      tracking_number,
      customer_name,
      customer_email,
      shipping_address,
      city,
      state,
      zip_code,
      country,
      destination_country,
      origin_country,
      transit_country,
      delivery_days,
      sorting_days,
      estimated_delivery,
      status
    } = req.body;

    // Use provided tracking number or generate one
    const finalTrackingNumber = tracking_number || generateTrackingNumber(country || destination_country);

    // Calculate estimated delivery if not provided
    const estDelivery = estimated_delivery || new Date(Date.now() + (delivery_days || 7) * 24 * 60 * 60 * 1000).toISOString();

    // Insert shipment
    const shipmentResult = await db.query(
      `INSERT INTO shipments (
        tracking_number, customer_name, customer_email, shipping_address,
        city, state, zip_code, country, destination_country, origin_country,
        transit_country, delivery_days, sorting_days, estimated_delivery, status,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *`,
      [
        finalTrackingNumber,
        customer_name || 'Unknown',
        customer_email || '',
        shipping_address || '',
        city || '',
        state || '',
        zip_code || '',
        country || destination_country || 'Unknown',
        destination_country || country || 'Unknown',
        origin_country || '',
        transit_country || '',
        delivery_days || 7,
        sorting_days || 3,
        estDelivery,
        status || 'label_created'
      ]
    );

    const shipment = shipmentResult.rows[0];

    // Create initial tracking event
    await db.query(
      `INSERT INTO tracking_events (
        shipment_id, status, location, event_date, event_time, description, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        shipment.id,
        'label_created',
        origin_country || country || 'Processing Center',
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0],
        'Shipping label created'
      ]
    );

    res.status(201).json({
      success: true,
      shipment,
      trackingNumber: finalTrackingNumber
    });

  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ error: 'Failed to create shipment', message: error.message });
  }
});

// Update shipment status
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, location, description } = req.body;

    // Update shipment status
    const shipmentResult = await db.query(
      'UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Add tracking event
    await db.query(
      `INSERT INTO tracking_events (
        shipment_id, status, location, event_date, event_time, description, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        id,
        status,
        location || 'In Transit',
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().split(' ')[0],
        description || `Status updated to ${status}`
      ]
    );

    res.json({
      success: true,
      shipment: shipmentResult.rows[0]
    });

  } catch (error) {
    console.error('Update shipment status error:', error);
    res.status(500).json({ error: 'Failed to update shipment status' });
  }
});

// Delete shipment
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete tracking events first
    await db.query('DELETE FROM tracking_events WHERE shipment_id = $1', [id]);

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

module.exports = router;
