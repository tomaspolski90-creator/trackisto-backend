// Express Shipment Routes - 100% ISOLATED FROM STANDARD SYSTEM
// Uses dedicated tables: express_shipments and express_tracking_events
// Does NOT touch the existing shipments or tracking_events tables
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('./auth');

// ============================================
// COUNTRY DATA
// ============================================

const ORIGIN_CITIES = {
  'United Kingdom': 'London', 'Germany': 'Berlin', 'France': 'Paris',
  'Netherlands': 'Amsterdam', 'Belgium': 'Brussels', 'Denmark': 'Copenhagen',
  'Sweden': 'Stockholm', 'Norway': 'Oslo', 'Finland': 'Helsinki',
  'Spain': 'Madrid', 'Portugal': 'Lisbon', 'Italy': 'Milan',
  'Austria': 'Vienna', 'Switzerland': 'Zurich', 'Poland': 'Warsaw',
  'Czech Republic': 'Prague', 'Hungary': 'Budapest', 'Romania': 'Bucharest',
  'Greece': 'Athens', 'Ireland': 'Dublin', 'Luxembourg': 'Luxembourg',
  'United States': 'New York', 'Canada': 'Toronto', 'Australia': 'Sydney',
  'Japan': 'Tokyo', 'China': 'Shanghai'
};

const AIRPORT_CODES = {
  'United Kingdom': 'LHR', 'Germany': 'FRA', 'France': 'CDG',
  'Netherlands': 'AMS', 'Belgium': 'BRU', 'Denmark': 'CPH',
  'Sweden': 'ARN', 'Norway': 'OSL', 'Finland': 'HEL',
  'Spain': 'MAD', 'Portugal': 'LIS', 'Italy': 'MXP',
  'Austria': 'VIE', 'Switzerland': 'ZRH', 'Poland': 'WAW',
  'Czech Republic': 'PRG', 'Hungary': 'BUD', 'Romania': 'OTP',
  'Greece': 'ATH', 'Ireland': 'DUB', 'Luxembourg': 'LUX',
  'United States': 'JFK', 'Canada': 'YYZ', 'Australia': 'SYD',
  'Japan': 'NRT', 'China': 'PVG'
};

const TIMEZONE_OFFSETS = {
  'United Kingdom': 1, 'Ireland': 1, 'Portugal': 1, 'Iceland': 0,
  'France': 2, 'Germany': 2, 'Netherlands': 2, 'Belgium': 2, 'Luxembourg': 2,
  'Italy': 2, 'Spain': 2, 'Denmark': 2, 'Sweden': 2, 'Norway': 2,
  'Austria': 2, 'Switzerland': 2, 'Poland': 2, 'Czech Republic': 2,
  'Hungary': 2, 'Croatia': 2, 'Slovakia': 2, 'Slovenia': 2,
  'Romania': 3, 'Bulgaria': 3, 'Greece': 3, 'Finland': 3,
  'United States': -4, 'Canada': -4, 'Australia': 10,
  'Japan': 9, 'China': 8
};

// ============================================
// FLIGHT HOURS - direct flight calculation
// ============================================

function getFlightHours(from, to) {
  if (from === to) return 1;
  const we = ['United Kingdom','Ireland','France','Belgium','Netherlands','Germany','Denmark','Luxembourg'];
  const se = ['Spain','Portugal','Italy','Greece','Malta','Cyprus'];
  const ee = ['Poland','Czech Republic','Slovakia','Hungary','Romania','Bulgaria','Slovenia','Croatia'];
  const ne = ['Sweden','Norway','Finland','Iceland'];
  const ce = ['Austria','Switzerland'];
  const am = ['United States','Canada','Brazil','Mexico'];
  const as = ['China','Japan','South Korea','India','Singapore'];
  const oc = ['Australia','New Zealand'];
  const reg = (c) => {
    if (we.includes(c)) return 'we';
    if (se.includes(c)) return 's';
    if (ee.includes(c)) return 'e';
    if (ne.includes(c)) return 'n';
    if (ce.includes(c)) return 'c';
    if (am.includes(c)) return 'm';
    if (as.includes(c)) return 'a';
    if (oc.includes(c)) return 'o';
    return 'we';
  };
  const r1 = reg(from), r2 = reg(to);
  if (r1 === r2) return 2;
  const eu = ['we','s','e','n','c'];
  if (eu.includes(r1) && eu.includes(r2)) return 3;
  if ((eu.includes(r1) && r2 === 'm') || (eu.includes(r2) && r1 === 'm')) return 9;
  if ((eu.includes(r1) && r2 === 'a') || (eu.includes(r2) && r1 === 'a')) return 11;
  if ((eu.includes(r1) && r2 === 'o') || (eu.includes(r2) && r1 === 'o')) return 18;
  return 6;
}

// ============================================
// EVENT SCHEDULE BUILDER
// ============================================

function buildExpressSchedule(originCountry, destinationCountry, destinationCity, deliveryDays) {
  const flightHours = getFlightHours(originCountry, destinationCountry);
  const originCity = ORIGIN_CITIES[originCountry] || originCountry;
  const originAirport = AIRPORT_CODES[originCountry] || 'XXX';
  const destAirport = AIRPORT_CODES[destinationCountry] || 'XXX';

  const allEvents = [
    {
      priority: 1, minDD: 0, minH: 0, maxH: 0, tMin: 0, tMax: 23, strict: false, tight: false,
      name: 'Express Order Confirmed',
      location: 'RVS Logistics Express, ' + originCountry,
      description: 'Express delivery service activated. Shipment registered for priority air freight.'
    },
    {
      priority: 2, minDD: 0, minH: 1, maxH: 0, tMin: 9, tMax: 18, strict: false, tight: false,
      name: 'Priority Pickup Completed',
      location: originCity + ', ' + originCountry,
      description: 'Shipment picked up by Express courier and en route to express sorting facility.'
    },
    {
      priority: 3, minDD: 4, minH: 2, maxH: 0, tMin: 6, tMax: 22, strict: false, tight: false,
      name: 'Express Sort Completed',
      location: originCity + ' Express Facility, ' + originCountry,
      description: 'Shipment sorted at express facility and prepared for transport to airport.'
    },
    {
      priority: 4, minDD: 6, minH: 2, maxH: 0, tMin: 5, tMax: 23, strict: false, tight: false,
      name: 'Arrived at Origin Airport',
      location: originAirport + ' Cargo Terminal, ' + originCountry,
      description: 'Shipment arrived at origin airport cargo terminal for export processing.'
    },
    {
      priority: 5, minDD: 8, minH: 1, maxH: 3, tMin: 4, tMax: 23, strict: false, tight: true,
      name: 'Loaded onto Aircraft',
      location: originAirport + ' Cargo Terminal, ' + originCountry,
      description: 'Shipment loaded onto aircraft, awaiting departure clearance.'
    },
    {
      priority: 6, minDD: 0, minH: 2, maxH: 6, tMin: 4, tMax: 23, strict: false, tight: true,
      name: 'Departed Origin Airport',
      location: originAirport + ', ' + originCountry,
      description: 'Aircraft departed origin airport. Express international air transit in progress.'
    },
    {
      priority: 7, minDD: 0, minH: flightHours, maxH: flightHours + 2, tMin: 0, tMax: 23, strict: false, tight: true,
      name: 'Arrived at Destination Airport',
      location: destAirport + ' Cargo Terminal, ' + destinationCountry,
      description: 'Aircraft landed at destination airport. Shipment offloaded and moved to customs facility.'
    },
    {
      priority: 8, minDD: 6, minH: 1, maxH: 0, tMin: 8, tMax: 17, strict: false, tight: false,
      name: 'Customs Documentation Verified',
      location: 'Customs, ' + destinationCountry,
      description: 'Customs documentation has been verified. Shipment ready for inspection.'
    },
    {
      priority: 9, minDD: 8, minH: 1, maxH: 0, tMin: 8, tMax: 17, strict: false, tight: false,
      name: 'Customs Inspection Completed',
      location: 'Customs, ' + destinationCountry,
      description: 'Customs inspection completed successfully. Awaiting final clearance.'
    },
    {
      priority: 10, minDD: 0, minH: 1, maxH: 0, tMin: 8, tMax: 17, strict: false, tight: false,
      name: 'Express Customs Cleared',
      location: 'Customs, ' + destinationCountry,
      description: 'Shipment has been cleared by customs and released for delivery.'
    },
    {
      priority: 11, minDD: 4, minH: 1, maxH: 0, tMin: 7, tMax: 18, strict: false, tight: false,
      name: 'Handed to Local Express Carrier',
      location: destinationCity + ', ' + destinationCountry,
      description: 'Shipment handed over to local express carrier for final-mile delivery.'
    },
    {
      priority: 12, minDD: 8, minH: 1, maxH: 0, tMin: 7, tMax: 18, strict: false, tight: false,
      name: 'At Destination Express Hub',
      location: destinationCity + ' Express Hub, ' + destinationCountry,
      description: 'Shipment arrived at local express hub. Out for delivery scheduled.'
    },
    {
      priority: 13, minDD: 0, minH: 4, maxH: 0, tMin: 7, tMax: 11, strict: true, tight: false,
      name: 'Out for Express Delivery',
      location: destinationCity + ', ' + destinationCountry,
      description: 'Shipment is out for express delivery to recipient address.'
    },
    {
      priority: 14, minDD: 0, minH: 2, maxH: 6, tMin: 9, tMax: 18, strict: false, tight: true,
      name: 'Express Delivered',
      location: destinationCity + ', ' + destinationCountry,
      description: 'Shipment has been delivered successfully.'
    }
  ];

  let events = allEvents.filter(e => deliveryDays >= e.minDD).map((e, i) => ({ ...e, mult: i }));

  // Dynamic minH for Departed
  const dep = events.find(e => e.priority === 6);
  const hasLoaded = events.some(e => e.priority === 5);
  const hasOriginAirport = events.some(e => e.priority === 4);
  const hasSort = events.some(e => e.priority === 3);
  if (dep) {
    if (hasLoaded) { dep.minH = 1; dep.maxH = 2; dep.tight = true; }
    else if (hasOriginAirport) { dep.minH = 2; dep.maxH = 6; dep.tight = true; }
    else if (hasSort) { dep.minH = 3; dep.maxH = 8; dep.tight = false; }
    else { dep.minH = 5; dep.maxH = 0; dep.tight = false; }
  }

  // Dynamic minH for Customs Cleared
  const cleared = events.find(e => e.priority === 10);
  const hasInspection = events.some(e => e.priority === 9);
  const hasDocVerified = events.some(e => e.priority === 8);
  if (cleared) {
    if (hasInspection) cleared.minH = 1;
    else if (hasDocVerified) cleared.minH = 2;
    else cleared.minH = 3;
  }

  return { events, flightHours, originCity, originAirport, destAirport };
}

// ============================================
// AUTO-UPDATE - processes ONLY express_shipments table
// ============================================

async function updateExpressEvents() {
  console.log('[Express Auto-Update] Starting...');
  try {
    const result = await db.query(
      "SELECT * FROM express_shipments WHERE status != 'delivered' ORDER BY created_at ASC"
    );
    const shipments = result.rows;
    console.log('[Express Auto-Update] Processing ' + shipments.length + ' express shipments');
    for (const shipment of shipments) {
      await processExpressShipment(shipment);
    }
    console.log('[Express Auto-Update] Completed');
  } catch (err) {
    console.error('[Express Auto-Update] Error:', err);
  }
}

async function processExpressShipment(shipment) {
  const dd = shipment.delivery_days || 7;
  const originCountry = shipment.origin_country || 'United Kingdom';
  const destinationCountry = shipment.destination_country || 'France';
  const destinationCity = shipment.city || ORIGIN_CITIES[destinationCountry] || destinationCountry;

  const { events } = buildExpressSchedule(originCountry, destinationCountry, destinationCity, dd);
  const dayStep = dd / (events.length - 1);

  // Get existing events from express_tracking_events
  const existingResult = await db.query(
    'SELECT status, event_date, event_time FROM express_tracking_events WHERE shipment_id = $1 ORDER BY event_date ASC, event_time ASC',
    [shipment.id]
  );
  const existing = existingResult.rows;

  const created = [];
  const createdAt = new Date(shipment.created_at);
  for (const row of existing) {
    const ev = events.find(e => e.name === row.status);
    if (ev) {
      const evDate = new Date(row.event_date);
      const dayDiff = Math.floor((evDate - createdAt) / (1000 * 60 * 60 * 24));
      const [h, m] = (row.event_time || '12:00').split(':').map(Number);
      created.push({ priority: ev.priority, day: dayDiff, hour: h, min: m });
    }
  }

  // Calculate "now" relative to createdAt
  const now = new Date();
  const customerOffset = TIMEZONE_OFFSETS[destinationCountry] !== undefined ? TIMEZONE_OFFSETS[destinationCountry] : 2;
  const nowCustomer = new Date(now.getTime() + (customerOffset * 60 * 60 * 1000));
  const createdAtCustomer = new Date(createdAt.getTime() + (customerOffset * 60 * 60 * 1000));
  const minutesSinceCreation = Math.floor((nowCustomer - createdAtCustomer) / (1000 * 60));
  if (minutesSinceCreation < 0) return;

  const runDay = Math.floor(minutesSinceCreation / (24 * 60));
  const runMinuteOfDay = minutesSinceCreation % (24 * 60);
  const runTotal = runDay * 24 * 60 + runMinuteOfDay;

  // Process events
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (created.find(c => c.priority === e.priority)) continue;

    // FORCE delivery events (OFD and Delivered) to land on exactly day deliveryDays
    // This ensures delivery happens on the promised day, not earlier
    let scheduledDay;
    if (e.priority === 13 || e.priority === 14) {
      scheduledDay = dd; // Force to deliveryDays
    } else {
      scheduledDay = Math.floor(dayStep * e.mult);
    }
    if (runDay < scheduledDay) break;

    const last = created[created.length - 1];
    if (!last) break; // Order Confirmed must exist

    const lastTotal = last.day * 24 * 60 + last.hour * 60 + last.min;
    let day, hour, min;

    if (e.priority === 13) {
      // Out for Express Delivery: force to day deliveryDays, morning
      day = dd;
      hour = 7 + Math.floor(Math.random() * 4); // 7-11
      min = Math.floor(Math.random() * 60);
    } else if (e.priority === 14) {
      // Express Delivered: force to day deliveryDays, after OFD
      day = dd;
      const ofdHour = last.hour;
      hour = ofdHour + 2 + Math.floor(Math.random() * 4); // 2-6 hours after OFD
      if (hour > 18) hour = 18;
      min = Math.floor(Math.random() * 60);
    } else if (e.tight) {
      const prevTotalH = last.day * 24 + last.hour;
      const range = (e.maxH || e.minH + 2) - e.minH + 1;
      const offsetH = e.minH + Math.floor(Math.random() * range);
      const totalH = prevTotalH + offsetH;
      day = Math.floor(totalH / 24);
      hour = totalH % 24;
      min = Math.floor(Math.random() * 60);
      if (day === last.day && hour === last.hour && min <= last.min) {
        min = last.min + 5;
        if (min >= 60) { hour++; min = 0; if (hour >= 24) { day++; hour = 0; } }
      }
      if (e.tMin > 0 && hour < e.tMin) { hour = e.tMin; min = Math.floor(Math.random() * 60); }
      if (e.tMax < 23 && hour > e.tMax) { day++; hour = e.tMin; min = Math.floor(Math.random() * 60); }
    } else {
      const chainMin = lastTotal + e.minH * 60;
      const latest = runTotal - 5;
      const scheduledDayStart = scheduledDay * 24 * 60;
      let earliest = Math.max(chainMin, latest - 65, scheduledDayStart);
      if (latest < earliest) break;

      let chosenTotal = earliest + Math.floor(Math.random() * (latest - earliest + 1));
      day = Math.floor(chosenTotal / (24 * 60));
      const timeOfDay = chosenTotal % (24 * 60);
      hour = Math.floor(timeOfDay / 60);
      min = timeOfDay % 60;

      if (e.tMax < 23 && hour > e.tMax) break;
      if (e.tMin > 0 && hour < e.tMin) {
        const newTotal = day * 24 * 60 + e.tMin * 60;
        if (newTotal > latest) break;
        chosenTotal = newTotal + Math.floor(Math.random() * Math.min(latest - newTotal, 30));
        day = Math.floor(chosenTotal / (24 * 60));
        const tod = chosenTotal % (24 * 60);
        hour = Math.floor(tod / 60);
        min = tod % 60;
      }
    }

    // CRITICAL: Verify event is in the past
    const evTotal = day * 24 * 60 + hour * 60 + min;
    if (evTotal >= runTotal) break;

    const evDate = new Date(createdAtCustomer.getTime() + day * 24 * 60 * 60 * 1000);
    const eventDateStr = evDate.toISOString().split('T')[0];
    const eventTimeStr = String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':00';

    await db.query(
      'INSERT INTO express_tracking_events (shipment_id, status, location, description, event_date, event_time, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [shipment.id, e.name, e.location, e.description, eventDateStr, eventTimeStr]
    );
    console.log('[Express] Created: ' + e.name + ' for ' + shipment.tracking_number + ' at ' + eventDateStr + ' ' + eventTimeStr);

    created.push({ priority: e.priority, day, hour, min });
  }

  // Update shipment status based on highest priority event
  const lastCreated = created[created.length - 1];
  if (lastCreated) {
    let newStatus = 'order_confirmed';
    if (lastCreated.priority === 14) newStatus = 'delivered';
    else if (lastCreated.priority === 13) newStatus = 'out_for_delivery';
    else if (lastCreated.priority >= 8) newStatus = 'customs';
    else if (lastCreated.priority >= 6) newStatus = 'in_transit';
    else if (lastCreated.priority >= 4) newStatus = 'at_origin_airport';
    else if (lastCreated.priority >= 2) newStatus = 'picked_up';
    await db.query("UPDATE express_shipments SET status = $1, updated_at = NOW() WHERE id = $2", [newStatus, shipment.id]);
  }
}

// ============================================
// HELPER: generate tracking number
// ============================================

function generateTrackingNumber(country) {
  const codes = {
    'United Kingdom': 'GB', 'Germany': 'DE', 'France': 'FR', 'Netherlands': 'NL',
    'Belgium': 'BE', 'Denmark': 'DK', 'Sweden': 'SE', 'Norway': 'NO',
    'Finland': 'FI', 'Spain': 'ES', 'Portugal': 'PT', 'Italy': 'IT',
    'Austria': 'AT', 'Switzerland': 'CH', 'Poland': 'PL', 'Ireland': 'IE',
    'Greece': 'GR', 'United States': 'US', 'Canada': 'CA', 'Australia': 'AU',
    'Japan': 'JP', 'China': 'CN'
  };
  const code = codes[country] || 'XX';
  return code + 'EX' + Date.now() + Math.floor(Math.random() * 1000);
}

// ============================================
// ROUTES
// ============================================

// Create new express shipment (admin)
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const {
      customer_name, customer_email, shipping_address,
      city, state, zip_code, destination_country,
      origin_country, delivery_days
    } = req.body;

    if (!customer_name || !destination_country || !origin_country || !delivery_days) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const dd = parseInt(delivery_days);
    if (dd < 2 || dd > 15) {
      return res.status(400).json({ error: 'Delivery days must be between 2 and 15' });
    }

    const trackingNumber = generateTrackingNumber(destination_country);
    const estimatedDelivery = new Date(Date.now() + dd * 24 * 60 * 60 * 1000);

    const result = await db.query(
      `INSERT INTO express_shipments (
        tracking_number, customer_name, customer_email, shipping_address,
        city, state, zip_code, destination_country, origin_country,
        delivery_days, estimated_delivery, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *`,
      [
        trackingNumber, customer_name, customer_email || '', shipping_address || '',
        city || '', state || '', zip_code || '', destination_country,
        origin_country, dd, estimatedDelivery, 'order_confirmed'
      ]
    );

    const shipment = result.rows[0];

    // Immediately create the Order Confirmed event at exact creation time
    const { events } = buildExpressSchedule(origin_country, destination_country, city || destination_country, dd);
    const orderEv = events[0];
    const now = new Date();
    const customerOffset = TIMEZONE_OFFSETS[destination_country] !== undefined ? TIMEZONE_OFFSETS[destination_country] : 2;
    const nowCustomer = new Date(now.getTime() + customerOffset * 60 * 60 * 1000);
    const eventDate = nowCustomer.toISOString().split('T')[0];
    const eventTime = String(nowCustomer.getUTCHours()).padStart(2, '0') + ':' + String(nowCustomer.getUTCMinutes()).padStart(2, '0') + ':00';

    await db.query(
      'INSERT INTO express_tracking_events (shipment_id, status, location, description, event_date, event_time, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [shipment.id, orderEv.name, orderEv.location, orderEv.description, eventDate, eventTime]
    );

    res.status(201).json({
      success: true,
      tracking_number: trackingNumber,
      shipment
    });
  } catch (err) {
    console.error('[Express Create] Error:', err);
    res.status(500).json({ error: 'Failed to create express shipment', details: err.message });
  }
});

// Get all express shipments (admin)
router.get('/shipments', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT s.*, COUNT(*) OVER() AS total_count
       FROM express_shipments s
       ORDER BY s.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    res.json({
      shipments: result.rows,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) }
    });
  } catch (err) {
    console.error('[Express List] Error:', err);
    res.status(500).json({ error: 'Failed to fetch express shipments' });
  }
});

// PUBLIC: Track express shipment by tracking number
router.get('/track/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    const shipmentResult = await db.query(
      `SELECT * FROM express_shipments WHERE tracking_number = $1`,
      [trackingNumber]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Express tracking number not found' });
    }

    const shipment = shipmentResult.rows[0];

    const eventsResult = await db.query(
      `SELECT status, location, event_date, event_time, description
       FROM express_tracking_events
       WHERE shipment_id = $1
       ORDER BY event_date DESC, event_time DESC`,
      [shipment.id]
    );

    const orderDate = new Date(shipment.created_at);
    const estimatedDelivery = new Date(orderDate);
    estimatedDelivery.setDate(estimatedDelivery.getDate() + shipment.delivery_days);

    res.json({
      trackingNumber: shipment.tracking_number,
      status: shipment.status,
      serviceType: 'express',
      customer: {
        name: shipment.customer_name,
        address: shipment.shipping_address,
        city: shipment.city,
        state: shipment.state,
        zipCode: shipment.zip_code,
        country: shipment.destination_country
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
        description: event.description
      })),
      createdAt: shipment.created_at
    });
  } catch (err) {
    console.error('[Express Track] Error:', err);
    res.status(500).json({ error: 'Failed to fetch express tracking' });
  }
});

// Manual trigger for express auto-update (testing)
router.post('/update-events', authenticateToken, async (req, res) => {
  try {
    await updateExpressEvents();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
module.exports.updateExpressEvents = updateExpressEvents;
