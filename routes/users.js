// routes/users.js - User management API endpoints
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// Get user saved places
router.get('/saved-places', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('savedPlaces');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      places: user.savedPlaces || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch saved places' });
  }
});

// Add saved place
router.post('/saved-places', authenticateToken, async (req, res) => {
  try {
    const { name, address, coordinates, type } = req.body;

    if (!name || !address || !coordinates) {
      return res.status(400).json({ 
        error: 'Name, address, and coordinates are required' 
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.savedPlaces.push({
      name,
      address,
      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng
      },
      type: type || 'other'
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Place saved successfully',
      places: user.savedPlaces
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save place' });
  }
});

// Update saved place
router.patch('/saved-places/:placeId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const place = user.savedPlaces.id(req.params.placeId);
    if (!place) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const { name, address, coordinates, type } = req.body;
    if (name) place.name = name;
    if (address) place.address = address;
    if (coordinates) place.coordinates = coordinates;
    if (type) place.type = type;

    await user.save();

    res.json({
      success: true,
      message: 'Place updated successfully',
      place
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update place' });
  }
});

// Delete saved place
router.delete('/saved-places/:placeId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.savedPlaces.pull(req.params.placeId);
    await user.save();

    res.json({
      success: true,
      message: 'Place deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete place' });
  }
});

// Update user preferences
router.patch('/preferences', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { language, theme, notifications, routePreference } = req.body;

    if (language) user.preferences.language = language;
    if (theme) user.preferences.theme = theme;
    if (notifications) user.preferences.notifications = { 
      ...user.preferences.notifications, 
      ...notifications 
    };
    if (routePreference) user.preferences.routePreference = routePreference;

    await user.save();

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: user.preferences
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const Route = require('../models/Route');
    const SafetyReport = require('../models/SafetyReport');

    const [routeCount, reportCount, completedRoutes] = await Promise.all([
      Route.countDocuments({ userId: req.user.userId }),
      SafetyReport.countDocuments({ userId: req.user.userId }),
      Route.countDocuments({ userId: req.user.userId, isCompleted: true })
    ]);

    // Calculate average safety score of completed routes
    const routesWithFeedback = await Route.find({ 
      userId: req.user.userId, 
      isCompleted: true,
      'feedback.rating': { $exists: true }
    }).select('feedback safetyScore');

    const avgRating = routesWithFeedback.length > 0
      ? routesWithFeedback.reduce((sum, r) => sum + r.feedback.rating, 0) / routesWithFeedback.length
      : 0;

    const avgSafetyScore = routesWithFeedback.length > 0
      ? routesWithFeedback.reduce((sum, r) => sum + r.safetyScore.overall, 0) / routesWithFeedback.length
      : 0;

    res.json({
      success: true,
      stats: {
        totalRoutes: routeCount,
        completedRoutes,
        reportsSubmitted: reportCount,
        averageRating: Math.round(avgRating * 10) / 10,
        averageSafetyScore: Math.round(avgSafetyScore * 10) / 10
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
