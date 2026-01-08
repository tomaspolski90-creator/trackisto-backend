// Backend Server - Main Entry Point
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const authRoutes = require('./routes/auth');
const shipmentRoutes = require('./routes/shipments');
const trackingRoutes = require('./routes/tracking');
const shopifyRoutes = require('./routes/shopify');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/shopify', shopifyRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Parcel Loop API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      shipments: '/api/shipments',
      tracking: '/api/tracking',
      shopify: '/api/shopify'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📦 Parcel Loop API is ready!`);
  console.log(`🔗 http://localhost:${PORT}`);
});

module.exports = app;