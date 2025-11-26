// server.js - Main entry point for the Safety Route Navigator Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const routeRoutes = require('./routes/routes');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const emergencyRoutes = require('./routes/emergency');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:8080",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:8080",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/safety-route-navigator', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✓ MongoDB Connected Successfully'))
.catch((err) => console.error('✗ MongoDB Connection Error:', err));

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/emergency', emergencyRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// WebSocket for real-time emergency alerts
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-region', (region) => {
    socket.join(region);
    console.log(`Client ${socket.id} joined region: ${region}`);
  });

  socket.on('emergency-alert', (data) => {
    // Broadcast emergency to all clients in the same region
    io.to(data.region).emit('emergency-broadcast', {
      type: 'emergency',
      location: data.location,
      timestamp: new Date().toISOString(),
      userId: data.userId
    });
  });

  socket.on('safety-update', (data) => {
    // Broadcast safety updates to region
    io.to(data.region).emit('safety-notification', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, io };
