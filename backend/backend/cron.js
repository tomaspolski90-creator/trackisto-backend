// cron.js - Scheduled tasks for Trackisto
const shopifyRoutes = require('./routes/shopify');

const CRON_INTERVAL = 30 * 60 * 1000; // 30 minutes

function startCronJobs() {
  console.log('[Cron] Starting scheduled tasks...');
  
  setTimeout(() => {
    console.log('[Cron] Running initial auto-fulfillment check...');
    shopifyRoutes.processAutoFulfillment();
  }, 10000);
  
  setInterval(() => {
    console.log('[Cron] Running scheduled auto-fulfillment...');
    shopifyRoutes.processAutoFulfillment();
  }, CRON_INTERVAL);
  
  console.log('[Cron] Auto-fulfillment scheduled to run every 30 minutes');
}

module.exports = { startCronJobs };
