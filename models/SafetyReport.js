// models/SafetyReport.js - Safety report model for community reporting
const mongoose = require('mongoose');

const safetyReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportType: {
    type: String,
    required: [true, 'Report type is required'],
    enum: [
      'Poor Street Lighting',
      'Harassment',
      'Road Hazard',
      'Lack of Police Presence',
      'Suspicious Activity',
      'Theft/Robbery',
      'Unsafe Area',
      'Other'
    ]
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    },
    address: {
      type: String,
      required: true
    },
    landmark: String
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  timeOfIncident: {
    type: Date,
    required: true,
    default: Date.now
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  images: [{
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'verified', 'resolved', 'dismissed'],
    default: 'pending'
  },
  verification: {
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verifiedAt: Date,
    verificationNotes: String
  },
  votes: {
    helpful: {
      type: Number,
      default: 0
    },
    users: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      vote: {
        type: String,
        enum: ['helpful', 'not-helpful']
      }
    }]
  },
  comments: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: {
      type: String,
      maxlength: 500
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  visibility: {
    type: String,
    enum: ['public', 'verified-only', 'private'],
    default: 'public'
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  affectedArea: {
    radius: {
      type: Number, // in meters
      default: 500
    }
  },
  resolved: {
    isResolved: {
      type: Boolean,
      default: false
    },
    resolvedAt: Date,
    resolvedBy: String,
    resolutionNotes: String
  }
}, {
  timestamps: true
});

// Create geospatial index for location-based queries
safetyReportSchema.index({ location: '2dsphere' });
safetyReportSchema.index({ reportType: 1, status: 1 });
safetyReportSchema.index({ timeOfIncident: -1 });
safetyReportSchema.index({ userId: 1 });

// Calculate safety score impact based on report
safetyReportSchema.methods.calculateSafetyImpact = function() {
  const severityWeights = {
    'low': -0.5,
    'medium': -1.5,
    'high': -3.0,
    'critical': -5.0
  };
  
  const typeWeights = {
    'Poor Street Lighting': 1.0,
    'Harassment': 2.5,
    'Road Hazard': 1.5,
    'Lack of Police Presence': 1.8,
    'Suspicious Activity': 2.0,
    'Theft/Robbery': 3.0,
    'Unsafe Area': 2.5,
    'Other': 1.0
  };
  
  return severityWeights[this.severity] * typeWeights[this.reportType];
};

// Get reports near a location
safetyReportSchema.statics.findNearby = function(coordinates, maxDistance = 5000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    status: { $in: ['verified', 'pending'] }
  }).sort({ timeOfIncident: -1 });
};

module.exports = mongoose.model('SafetyReport', safetyReportSchema);
