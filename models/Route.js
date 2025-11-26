// models/Route.js - Route model for storing calculated safe routes
const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  origin: {
    address: {
      type: String,
      required: true
    },
    coordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    }
  },
  destination: {
    address: {
      type: String,
      required: true
    },
    coordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    }
  },
  waypoints: [{
    coordinates: {
      lat: Number,
      lng: Number
    },
    address: String
  }],
  routeData: {
    distance: {
      type: Number, // in meters
      required: true
    },
    duration: {
      type: Number, // in seconds
      required: true
    },
    polyline: {
      type: String,
      required: true
    },
    steps: [{
      instruction: String,
      distance: Number,
      duration: Number,
      startLocation: {
        lat: Number,
        lng: Number
      },
      endLocation: {
        lat: Number,
        lng: Number
      }
    }]
  },
  safetyScore: {
    overall: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
      default: 5.0
    },
    factors: {
      lighting: { type: Number, min: 0, max: 10, default: 5 },
      policePresence: { type: Number, min: 0, max: 10, default: 5 },
      crimeRate: { type: Number, min: 0, max: 10, default: 5 },
      pedestrianTraffic: { type: Number, min: 0, max: 10, default: 5 },
      roadCondition: { type: Number, min: 0, max: 10, default: 5 },
      communityReports: { type: Number, min: 0, max: 10, default: 5 }
    }
  },
  routeType: {
    type: String,
    enum: ['safest', 'fastest', 'balanced'],
    required: true
  },
  tags: [{
    type: String,
    enum: [
      'Well-Lit',
      'Police Patrolled',
      'Main Roads',
      'CCTV Coverage',
      'High Traffic',
      'Residential Area',
      'Commercial Area',
      'Public Transport Access'
    ]
  }],
  alternatives: [{
    routeType: String,
    distance: Number,
    duration: Number,
    safetyScore: Number,
    polyline: String
  }],
  weatherConditions: {
    temperature: Number,
    condition: String,
    visibility: String
  },
  timeOfDay: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night', 'late-night'],
    required: true
  },
  isSaved: {
    type: Boolean,
    default: false
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  completedAt: Date,
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    feltSafe: Boolean
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
routeSchema.index({ userId: 1, createdAt: -1 });
routeSchema.index({ 'origin.coordinates.lat': 1, 'origin.coordinates.lng': 1 });
routeSchema.index({ 'destination.coordinates.lat': 1, 'destination.coordinates.lng': 1 });
routeSchema.index({ safetyScore: -1 });

// Calculate overall safety score based on factors
routeSchema.methods.calculateSafetyScore = function() {
  const weights = {
    lighting: 0.20,
    policePresence: 0.20,
    crimeRate: 0.25,
    pedestrianTraffic: 0.15,
    roadCondition: 0.10,
    communityReports: 0.10
  };
  
  let score = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    score += this.safetyScore.factors[factor] * weight;
  }
  
  this.safetyScore.overall = Math.round(score * 10) / 10;
  return this.safetyScore.overall;
};

// Get time of day based on hour
routeSchema.statics.getTimeOfDay = function(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 24) return 'night';
  return 'late-night';
};

module.exports = mongoose.model('Route', routeSchema);
