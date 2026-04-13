// Refund Routes - Mark orders as refunded with automatic timing
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('./auth');

// POST /api/refund/create - Mark order as refunded (button in admin)
// Flow: refund event shows NOW, return-to-sender shows tomorrow at 10:04
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { tracking_number } = req.body;
    if (!tracking_number) {
      return res.status(400).json({ error: 'tracking_number is required' });
    }

    // Verify order exists
    const shipmentResult = await db.query(
      'SELECT id, tracking_number, customer_name FROM shipments WHERE tracking_number = $1',
      [tracking_number]
    );
    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const shipment = shipmentResult.rows[0];

    // Calculate times:
    // refund_time = NOW (customer sees "Order Refunded" immediately)
    // return_time = tomorrow at 10:04 (customer sees "Return to Sender" tomorrow morning)
    const refundTime = new Date();
    const returnTime = new Date(refundTime);
    returnTime.setDate(returnTime.getDate() + 1);
    returnTime.setHours(10, 4, 0, 0);

    // Insert or update refund record
    await db.query(
      `INSERT INTO refund_orders (tracking_number, refund_time, return_time)
       VALUES ($1, $2, $3)
       ON CONFLICT (tracking_number) DO UPDATE SET
         refund_time = EXCLUDED.refund_time,
         return_time = EXCLUDED.return_time`,
      [tracking_number, refundTime, returnTime]
    );

    // Set shipment status to 'delivered' to skip auto-update and safety net
    await db.query(
      `UPDATE shipments SET status = 'delivered', updated_at = NOW() WHERE tracking_number = $1`,
      [tracking_number]
    );

    // Delete any existing damaged event (in case safety net already created one)
    await db.query(
      `DELETE FROM tracking_events
       WHERE shipment_id = $1
       AND status = 'Shipment Damaged – Inspection Hold'`,
      [shipment.id]
    );

    console.log('[Refund] Created refund for ' + tracking_number + ' (' + shipment.customer_name + ')');

    res.json({
      success: true,
      tracking_number,
      customer_name: shipment.customer_name,
      refund_time: refundTime.toISOString(),
      return_time: returnTime.toISOString(),
      message: 'Refund flow activated. "Order Refunded" visible NOW. "Return to Sender" appears tomorrow at 10:04.'
    });
  } catch (err) {
    console.error('[Refund] Error:', err);
    res.status(500).json({ error: 'Failed to create refund', details: err.message });
  }
});

// DELETE /api/refund/:tracking_number - Cancel refund (restore order)
router.delete('/:tracking_number', authenticateToken, async (req, res) => {
  try {
    const { tracking_number } = req.params;
    await db.query('DELETE FROM refund_orders WHERE tracking_number = $1', [tracking_number]);
    await db.query(
      `UPDATE shipments SET status = 'in_transit', updated_at = NOW() WHERE tracking_number = $1`,
      [tracking_number]
    );
    res.json({ success: true, message: 'Refund cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel refund' });
  }
});

// GET /api/refund/list - List all refunded orders
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.tracking_number, r.refund_time, r.return_time, s.customer_name
      FROM refund_orders r
      LEFT JOIN shipments s ON s.tracking_number = r.tracking_number
      ORDER BY r.refund_time DESC
    `);
    res.json({ refunds: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch refund list' });
  }
});

module.exports = router;
