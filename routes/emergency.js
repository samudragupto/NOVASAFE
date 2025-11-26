// routes/emergency.js - Emergency services API endpoints
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// Trigger SOS emergency alert
router.post('/sos', authenticateToken, async (req, res) => {
  try {
    const { location, message } = req.body;

    if (!location || !location.lat || !location.lng) {
      return res.status(400).json({ error: 'Location is required for SOS' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prepare emergency alert data
    const alertData = {
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`,
      userPhone: user.phone,
      location: {
        lat: location.lat,
        lng: location.lng,
        address: location.address || 'Address not available'
      },
      message: message || 'Emergency SOS triggered',
      timestamp: new Date().toISOString()
    };

    // Send alerts to emergency contacts
    if (user.emergencyContacts && user.emergencyContacts.length > 0) {
      // In production, implement actual SMS/Call services here
      // Using Twilio or similar service
      console.log('Sending emergency alerts to:', user.emergencyContacts);
      
      // Example Twilio implementation:
      // const twilio = require('twilio');
      // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      // 
      // for (const contact of user.emergencyContacts) {
      //   await client.messages.create({
      //     body: `EMERGENCY ALERT: ${user.firstName} ${user.lastName} needs help! Location: ${location.address}. View live location: [LINK]`,
      //     from: process.env.TWILIO_PHONE_NUMBER,
      //     to: contact.phone
      //   });
      // }
    }

    // Broadcast to nearby users via WebSocket
    const io = req.app.get('io');
    io.emit('emergency-alert', {
      type: 'sos',
      location: alertData.location,
      severity: 'critical',
      timestamp: alertData.timestamp
    });

    // Log the emergency event
    console.log('SOS ALERT TRIGGERED:', alertData);

    res.json({
      success: true,
      message: 'Emergency alert sent successfully',
      alertsSent: user.emergencyContacts?.length || 0
    });
  } catch (error) {
    console.error('SOS error:', error);
    res.status(500).json({ error: 'Failed to send emergency alert' });
  }
});

// Share live location
router.post('/share-location', authenticateToken, async (req, res) => {
  try {
    const { location, contacts, duration = 3600 } = req.body; // duration in seconds

    if (!location || !location.lat || !location.lng) {
      return res.status(400).json({ error: 'Location is required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create shareable location link
    const shareToken = require('crypto').randomBytes(32).toString('hex');
    const shareLink = `${process.env.CLIENT_URL}/track/${shareToken}`;

    // Store location share info (in production, use Redis or MongoDB)
    // This is a simplified version
    const locationShare = {
      userId: user._id,
      token: shareToken,
      location,
      startTime: new Date(),
      expiresAt: new Date(Date.now() + duration * 1000),
      contacts: contacts || user.emergencyContacts?.map(c => c.phone) || []
    };

    console.log('Location sharing started:', locationShare);

    // Send location link to specified contacts
    // In production, implement SMS service
    console.log('Sharing location with:', locationShare.contacts);

    res.json({
      success: true,
      message: 'Location sharing enabled',
      shareLink,
      expiresIn: duration
    });
  } catch (error) {
    console.error('Location sharing error:', error);
    res.status(500).json({ error: 'Failed to share location' });
  }
});

// Get emergency contacts
router.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('emergencyContacts');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      contacts: user.emergencyContacts || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch emergency contacts' });
  }
});

// Add emergency contact
router.post('/contacts', authenticateToken, async (req, res) => {
  try {
    const { name, phone, relationship } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already exists
    const exists = user.emergencyContacts.some(c => c.phone === phone);
    if (exists) {
      return res.status(409).json({ error: 'Contact already exists' });
    }

    user.emergencyContacts.push({
      name,
      phone,
      relationship: relationship || 'other'
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Emergency contact added successfully',
      contacts: user.emergencyContacts
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add emergency contact' });
  }
});

// Update emergency contact
router.patch('/contacts/:contactId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contact = user.emergencyContacts.id(req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const { name, phone, relationship } = req.body;
    if (name) contact.name = name;
    if (phone) contact.phone = phone;
    if (relationship) contact.relationship = relationship;

    await user.save();

    res.json({
      success: true,
      message: 'Contact updated successfully',
      contact
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Delete emergency contact
router.delete('/contacts/:contactId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.emergencyContacts.pull(req.params.contactId);
    await user.save();

    res.json({
      success: true,
      message: 'Contact deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Get nearby police stations/hospitals
router.get('/nearby-services', authenticateToken, async (req, res) => {
  try {
    const { lat, lng, type = 'police' } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Location is required' });
    }

    // In production, use Google Places API
    const axios = require('axios');
    
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
      params: {
        location: `${lat},${lng}`,
        radius: 5000,
        type: type === 'police' ? 'police' : 'hospital',
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    const services = response.data.results.map(place => ({
      name: place.name,
      address: place.vicinity,
      location: place.geometry.location,
      rating: place.rating,
      isOpen: place.opening_hours?.open_now
    }));

    res.json({
      success: true,
      services
    });
  } catch (error) {
    console.error('Nearby services error:', error);
    res.status(500).json({ error: 'Failed to fetch nearby services' });
  }
});

module.exports = router;
