// Customer Tracking Routes (Public - No Auth Required)
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Track shipment by tracking number (Public endpoint)
router.get('/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    // Get shipment details
    const shipmentResult = await db.query(
      `SELECT 
        tracking_number, customer_name, shipping_address, city, state, zip_code, 
        country, destination_country, delivery_days, status, created_at
       FROM shipments 
       WHERE tracking_number = $1`,
      [trackingNumber]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Tracking number not found',
        message: 'Please check your tracking number and try again.'
      });
    }

    const shipment = shipmentResult.rows[0];

    // Get tracking events
    const eventsResult = await db.query(
      `SELECT status, location, event_date, event_time, description, completed
       FROM tracking_events 
       WHERE shipment_id = (SELECT id FROM shipments WHERE tracking_number = $1)
       ORDER BY event_date DESC, event_time DESC`,
      [trackingNumber]
    );

    // Calculate estimated delivery date
    const orderDate = new Date(shipment.created_at);
    const estimatedDelivery = new Date(orderDate);
    estimatedDelivery.setDate(estimatedDelivery.getDate() + shipment.delivery_days);

    res.json({
      trackingNumber: shipment.tracking_number,
      status: shipment.status,
      customer: {
        name: shipment.customer_name,
        address: shipment.shipping_address,
        city: shipment.city,
        state: shipment.state,
        zipCode: shipment.zip_code,
        country: shipment.country
      },
      delivery: {
        estimatedDate: estimatedDelivery.toISOString().split('T')[0],
        deliveryDays: shipment.delivery_days,
        destinationCountry: shipment.destination_country
      },
      timeline: eventsResult.rows.map(event => ({
        status: event.status,
        location: event.location,
        date: event.event_date,
        time: event.event_time,
        description: event.description,
        completed: event.completed
      })),
      createdAt: shipment.created_at
    });

  } catch (error) {
    console.error('Track shipment error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tracking information',
      message: 'Please try again later.'
    });
  }
});

// Bulk tracking - track multiple shipments at once
router.post('/bulk', async (req, res) => {
  try {
    const { trackingNumbers } = req.body;

    if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of tracking numbers' });
    }

    if (trackingNumbers.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 tracking numbers allowed per request' });
    }

    const results = await Promise.all(
      trackingNumbers.map(async (trackingNumber) => {
        try {
          const shipmentResult = await db.query(
            `SELECT tracking_number, customer_name, status, created_at, delivery_days
             FROM shipments 
             WHERE tracking_number = $1`,
            [trackingNumber]
          );

          if (shipmentResult.rows.length === 0) {
            return {
              trackingNumber,
              found: false,
              error: 'Not found'
            };
          }

          const shipment = shipmentResult.rows[0];
          return {
            trackingNumber: shipment.tracking_number,
            found: true,
            status: shipment.status,
            customerName: shipment.customer_name,
            createdAt: shipment.created_at
          };
        } catch (error) {
          return {
            trackingNumber,
            found: false,
            error: 'Error fetching data'
          };
        }
      })
    );

    res.json({
      results,
      total: results.length,
      found: results.filter(r => r.found).length
    });

  } catch (error) {
    console.error('Bulk tracking error:', error);
    res.status(500).json({ error: 'Failed to process bulk tracking request' });
  }
});

module.exports = router;
