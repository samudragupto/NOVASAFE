// routes/routes.js - Routes API endpoints
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Route = require('../models/Route');
const SafetyReport = require('../models/SafetyReport');
const { authenticateToken } = require('../middleware/auth');

// Calculate routes with safety scores
router.post('/calculate', authenticateToken, async (req, res) => {
  try {
    const { origin, destination, routePreference = 'safest' } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }

    // Call Google Maps Directions API
    const googleMapsResponse = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
      params: {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        alternatives: true,
        mode: 'driving',
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    if (googleMapsResponse.data.status !== 'OK') {
      return res.status(400).json({ 
        error: 'Unable to calculate route', 
        details: googleMapsResponse.data.status 
      });
    }

    const routes = googleMapsResponse.data.routes;
    
    // Process each route and calculate safety scores
    const processedRoutes = await Promise.all(routes.map(async (route, index) => {
      const leg = route.legs[0];
      
      // Calculate safety score based on nearby reports
      const safetyScore = await calculateRouteSafetyScore(route.overview_polyline.points);
      
      // Determine route type
      let routeType = 'balanced';
      if (index === 0 && safetyScore.overall >= 8) routeType = 'safest';
      if (leg.duration.value === Math.min(...routes.map(r => r.legs[0].duration.value))) routeType = 'fastest';
      
      // Get current time of day
      const hour = new Date().getHours();
      const timeOfDay = Route.getTimeOfDay(hour);
      
      // Create route document
      const routeDoc = new Route({
        userId: req.user.userId,
        origin: {
          address: leg.start_address,
          coordinates: {
            lat: leg.start_location.lat,
            lng: leg.start_location.lng
          }
        },
        destination: {
          address: leg.end_address,
          coordinates: {
            lat: leg.end_location.lat,
            lng: leg.end_location.lng
          }
        },
        routeData: {
          distance: leg.distance.value,
          duration: leg.duration.value,
          polyline: route.overview_polyline.points,
          steps: leg.steps.map(step => ({
            instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
            distance: step.distance.value,
            duration: step.duration.value,
            startLocation: step.start_location,
            endLocation: step.end_location
          }))
        },
        safetyScore,
        routeType,
        timeOfDay,
        tags: generateRouteTags(safetyScore)
      });
      
      await routeDoc.save();
      
      return {
        routeId: routeDoc._id,
        routeType,
        distance: {
          meters: leg.distance.value,
          text: leg.distance.text
        },
        duration: {
          seconds: leg.duration.value,
          text: leg.duration.text
        },
        safetyScore: safetyScore.overall,
        safetyFactors: safetyScore.factors,
        tags: routeDoc.tags,
        polyline: route.overview_polyline.points,
        steps: routeDoc.routeData.steps
      };
    }));

    // Sort routes by preference
    processedRoutes.sort((a, b) => {
      if (routePreference === 'safest') return b.safetyScore - a.safetyScore;
      if (routePreference === 'fastest') return a.duration.seconds - b.duration.seconds;
      // balanced: weighted combination
      const scoreA = a.safetyScore * 0.6 + (1 / a.duration.seconds) * 10000 * 0.4;
      const scoreB = b.safetyScore * 0.6 + (1 / b.duration.seconds) * 10000 * 0.4;
      return scoreB - scoreA;
    });

    res.json({
      success: true,
      routes: processedRoutes
    });

  } catch (error) {
    console.error('Route calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate routes' });
  }
});

// Get route by ID
router.get('/:routeId', authenticateToken, async (req, res) => {
  try {
    const route = await Route.findOne({
      _id: req.params.routeId,
      userId: req.user.userId
    });

    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }

    res.json(route);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

// Get user's route history
router.get('/history/all', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const routes = await Route.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-routeData.steps');

    const count = await Route.countDocuments({ userId: req.user.userId });

    res.json({
      routes,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch route history' });
  }
});

// Save a route as favorite
router.post('/:routeId/save', authenticateToken, async (req, res) => {
  try {
    const route = await Route.findOneAndUpdate(
      { _id: req.params.routeId, userId: req.user.userId },
      { isSaved: true },
      { new: true }
    );

    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }

    res.json({ success: true, message: 'Route saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save route' });
  }
});

// Submit route feedback
router.post('/:routeId/feedback', authenticateToken, async (req, res) => {
  try {
    const { rating, comment, feltSafe } = req.body;

    const route = await Route.findOneAndUpdate(
      { _id: req.params.routeId, userId: req.user.userId },
      { 
        feedback: { rating, comment, feltSafe },
        isCompleted: true,
        completedAt: new Date()
      },
      { new: true }
    );

    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }

    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Helper function to calculate route safety score
async function calculateRouteSafetyScore(polyline) {
  // Decode polyline and get points along the route
  const routePoints = decodePolyline(polyline);
  
  // Sample points along route (every 500m approximately)
  const samplePoints = routePoints.filter((_, index) => index % 10 === 0);
  
  let totalScore = 0;
  const factors = {
    lighting: 7,
    policePresence: 6,
    crimeRate: 7,
    pedestrianTraffic: 6,
    roadCondition: 7,
    communityReports: 8
  };

  // Check for nearby safety reports
  for (const point of samplePoints) {
    const nearbyReports = await SafetyReport.findNearby([point.lng, point.lat], 500);
    
    if (nearbyReports.length > 0) {
      // Reduce score based on report severity
      nearbyReports.forEach(report => {
        const impact = report.calculateSafetyImpact();
        factors.communityReports += impact / nearbyReports.length;
      });
    }
  }

  // Normalize factors to 0-10 range
  Object.keys(factors).forEach(key => {
    factors[key] = Math.max(0, Math.min(10, factors[key]));
  });

  // Calculate weighted average
  const weights = {
    lighting: 0.20,
    policePresence: 0.20,
    crimeRate: 0.25,
    pedestrianTraffic: 0.15,
    roadCondition: 0.10,
    communityReports: 0.10
  };

  for (const [factor, weight] of Object.entries(weights)) {
    totalScore += factors[factor] * weight;
  }

  return {
    overall: Math.round(totalScore * 10) / 10,
    factors
  };
}

// Helper function to generate route tags
function generateRouteTags(safetyScore) {
  const tags = [];
  
  if (safetyScore.factors.lighting >= 7) tags.push('Well-Lit');
  if (safetyScore.factors.policePresence >= 7) tags.push('Police Patrolled');
  if (safetyScore.factors.pedestrianTraffic >= 6) tags.push('High Traffic');
  if (safetyScore.factors.roadCondition >= 7) tags.push('Main Roads');
  
  return tags;
}

// Simple polyline decoder
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

module.exports = router;
