// routes/reports.js - Safety Reports API endpoints
const express = require('express');
const router = express.Router();
const SafetyReport = require('../models/SafetyReport');
const { authenticateToken } = require('../middleware/auth');

// Create a new safety report
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      reportType,
      location,
      description,
      timeOfIncident,
      severity,
      isAnonymous
    } = req.body;

    // Validation
    if (!reportType || !location || !description) {
      return res.status(400).json({ 
        error: 'Report type, location, and description are required' 
      });
    }

    const report = new SafetyReport({
      userId: req.user.userId,
      reportType,
      location: {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        address: location.address,
        landmark: location.landmark
      },
      description,
      timeOfIncident: timeOfIncident || new Date(),
      severity: severity || 'medium',
      isAnonymous: isAnonymous || false
    });

    await report.save();

    // Emit real-time notification to nearby users
    const io = req.app.get('io');
    io.emit('new-safety-report', {
      reportId: report._id,
      reportType: report.reportType,
      location: report.location,
      severity: report.severity,
      timestamp: report.createdAt
    });

    res.status(201).json({
      success: true,
      message: 'Safety report submitted successfully',
      reportId: report._id
    });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// Get nearby safety reports
router.get('/nearby', authenticateToken, async (req, res) => {
  try {
    const { lat, lng, radius = 5000 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const reports = await SafetyReport.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(radius)
        }
      },
      status: { $in: ['verified', 'pending'] }
    })
    .populate('userId', 'firstName lastName')
    .sort({ timeOfIncident: -1 })
    .limit(50);

    // Hide user info if anonymous
    const processedReports = reports.map(report => {
      const reportObj = report.toObject();
      if (report.isAnonymous) {
        delete reportObj.userId;
      }
      return reportObj;
    });

    res.json({
      success: true,
      count: processedReports.length,
      reports: processedReports
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Get report by ID
router.get('/:reportId', authenticateToken, async (req, res) => {
  try {
    const report = await SafetyReport.findById(req.params.reportId)
      .populate('userId', 'firstName lastName profilePicture')
      .populate('comments.userId', 'firstName lastName');

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Hide user info if anonymous and requester is not the author
    if (report.isAnonymous && report.userId._id.toString() !== req.user.userId) {
      report.userId = null;
    }

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Get user's own reports
router.get('/user/my-reports', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const reports = await SafetyReport.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await SafetyReport.countDocuments({ userId: req.user.userId });

    res.json({
      reports,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Vote on a report (helpful/not helpful)
router.post('/:reportId/vote', authenticateToken, async (req, res) => {
  try {
    const { vote } = req.body; // 'helpful' or 'not-helpful'
    const reportId = req.params.reportId;
    const userId = req.user.userId;

    if (!['helpful', 'not-helpful'].includes(vote)) {
      return res.status(400).json({ error: 'Invalid vote type' });
    }

    const report = await SafetyReport.findById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Check if user already voted
    const existingVote = report.votes.users.find(
      v => v.userId.toString() === userId
    );

    if (existingVote) {
      // Update existing vote
      if (existingVote.vote === 'helpful' && vote === 'not-helpful') {
        report.votes.helpful -= 1;
      } else if (existingVote.vote === 'not-helpful' && vote === 'helpful') {
        report.votes.helpful += 1;
      }
      existingVote.vote = vote;
    } else {
      // Add new vote
      report.votes.users.push({ userId, vote });
      if (vote === 'helpful') {
        report.votes.helpful += 1;
      }
    }

    await report.save();

    res.json({
      success: true,
      message: 'Vote recorded',
      helpfulCount: report.votes.helpful
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// Add comment to report
router.post('/:reportId/comment', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const report = await SafetyReport.findById(req.params.reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    report.comments.push({
      userId: req.user.userId,
      text: text.trim()
    });

    await report.save();

    res.json({
      success: true,
      message: 'Comment added successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update report (author only)
router.patch('/:reportId', authenticateToken, async (req, res) => {
  try {
    const report = await SafetyReport.findOne({
      _id: req.params.reportId,
      userId: req.user.userId
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found or unauthorized' });
    }

    const allowedUpdates = ['description', 'severity', 'status'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) {
      return res.status(400).json({ error: 'Invalid updates' });
    }

    updates.forEach(update => report[update] = req.body[update]);
    await report.save();

    res.json({
      success: true,
      message: 'Report updated successfully',
      report
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report (author only)
router.delete('/:reportId', authenticateToken, async (req, res) => {
  try {
    const report = await SafetyReport.findOneAndDelete({
      _id: req.params.reportId,
      userId: req.user.userId
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found or unauthorized' });
    }

    res.json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Get report statistics for an area
router.get('/stats/area', authenticateToken, async (req, res) => {
  try {
    const { lat, lng, radius = 5000 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const reports = await SafetyReport.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(radius)
        }
      },
      status: { $in: ['verified', 'pending'] },
      timeOfIncident: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    // Calculate statistics
    const stats = {
      total: reports.length,
      byType: {},
      bySeverity: {},
      avgSafetyScore: 0
    };

    reports.forEach(report => {
      // Count by type
      stats.byType[report.reportType] = (stats.byType[report.reportType] || 0) + 1;
      
      // Count by severity
      stats.bySeverity[report.severity] = (stats.bySeverity[report.severity] || 0) + 1;
    });

    // Calculate area safety score (0-10, where 10 is safest)
    const severityWeights = { low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };
    let totalImpact = 0;
    
    reports.forEach(report => {
      totalImpact += severityWeights[report.severity];
    });

    // Normalize to 0-10 scale (fewer/less severe reports = higher score)
    stats.avgSafetyScore = Math.max(0, Math.min(10, 10 - (totalImpact / 5)));

    res.json({
      success: true,
      stats,
      radius: parseInt(radius),
      location: { lat: parseFloat(lat), lng: parseFloat(lng) }
    });
  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({ error: 'Failed to calculate statistics' });
  }
});

module.exports = router;
