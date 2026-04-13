// Damaged Events Safety Net
// Runs every 30 minutes to ensure all orders with passed delivery date get damaged event
// This is a backup in case the main auto-update misses any orders
const db = require('./config/database');

async function ensureDamagedEventsForDueOrders() {
  console.log('[Safety Net] Checking for missed damaged events...');

  try {
    // Find all shipments where:
    // - Delivery date has passed or is today
    // - No damaged event exists yet
    // - Not a refund order (from refund_orders table)
    const result = await db.query(`
      SELECT s.id, s.tracking_number, s.customer_name, s.city,
             s.destination_country, s.created_at, s.delivery_days, s.status
      FROM shipments s
      WHERE (s.created_at::date + s.delivery_days * INTERVAL '1 day')::date <= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM tracking_events te
          WHERE te.shipment_id = s.id
          AND te.status = 'Shipment Damaged – Inspection Hold'
        )
        AND NOT EXISTS (
          SELECT 1 FROM refund_orders r
          WHERE r.tracking_number = s.tracking_number
        )
    `);

    const shipments = result.rows;
    if (shipments.length === 0) {
      console.log('[Safety Net] All orders already have damaged events. Nothing to do.');
      return;
    }

    console.log('[Safety Net] Found ' + shipments.length + ' shipments missing damaged event');

    let created = 0;
    for (const s of shipments) {
      try {
        // Calculate delivery date
        const eventDate = new Date(s.created_at);
        eventDate.setDate(eventDate.getDate() + s.delivery_days);

        // Only create if event date is today or in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        eventDate.setHours(0, 0, 0, 0);
        if (eventDate > today) {
          continue;
        }

        const city = s.city && s.city.trim() !== '' ? s.city : s.destination_country;
        const location = city + ', ' + s.destination_country;

        // Create damaged event
        await db.query(
          `INSERT INTO tracking_events (shipment_id, status, location, description, event_date, event_time, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            s.id,
            'Shipment Damaged – Inspection Hold',
            location,
            'During routine inspection at the local depot, the package was found to be damaged and cannot be dispatched for delivery. Please contact the sender for further assistance.',
            eventDate.toISOString().split('T')[0],
            '09:42:00'
          ]
        );

        // Update shipment status to exception
        await db.query(
          `UPDATE shipments SET status = 'exception', updated_at = NOW() WHERE id = $1`,
          [s.id]
        );

        created++;
        console.log('[Safety Net] Created damaged event for ' + s.tracking_number + ' (' + s.customer_name + ')');
      } catch (err) {
        console.error('[Safety Net] Error processing ' + s.tracking_number + ':', err.message);
      }
    }

    console.log('[Safety Net] Completed. Created ' + created + ' damaged events.');
  } catch (err) {
    console.error('[Safety Net] Error:', err.message);
  }
}

module.exports = { ensureDamagedEventsForDueOrders };
