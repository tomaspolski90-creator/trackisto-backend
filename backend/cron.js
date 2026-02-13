// cron.js - Scheduled tasks for Trackisto
const shopifyRoutes = require('./routes/shopify');
const woocommerceRoutes = require('./routes/woocommerce');

const CRON_INTERVAL = 30 * 60 * 1000; // 30 minutes

async function runAutoFulfillment() {
  console.log('[Cron] Running auto-fulfillment for all store types...');
  
  try {
    await shopifyRoutes.processAutoFulfillment();
    console.log('[Cron] Shopify auto-fulfillment completed');
  } catch (err) {
    console.error('[Cron] Shopify auto-fulfillment error:', err.message);
  }
  
  try {
    console.log('[Cron] Starting WooCommerce auto-fulfillment...');
    await woocommerceRoutes.processWooCommerceAutoFulfillment();
    console.log('[Cron] WooCommerce auto-fulfillment completed');
  } catch (err) {
    console.error('[Cron] WooCommerce auto-fulfillment error:', err.message);
  }
}

function startCronJobs() {
  console.log('[Cron] Starting scheduled tasks...');
  
  setTimeout(() => {
    console.log('[Cron] Running initial auto-fulfillment check...');
    runAutoFulfillment();
  }, 10000);
  
  setInterval(() => {
    console.log('[Cron] Running scheduled auto-fulfillment...');
    runAutoFulfillment();
  }, CRON_INTERVAL);
  
  console.log('[Cron] Auto-fulfillment scheduled to run every 30 minutes (Shopify + WooCommerce)');
}

module.exports = { startCronJobs };
