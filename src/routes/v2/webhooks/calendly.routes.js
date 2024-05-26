// Packages
const express = require('express');
const router = express.Router();

const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const calendlyController = require('../../../controllers/v2/webhooks/calendly.controllers');

// Internal Routes
router.get('/event-types', auth, calendlyController.fetchCalendlyEventsTypes);
router.post('/set-url', auth, calendlyController.setCalendlySchedulingUrl);

// External routes
router.post('/updateEvents', calendlyController.updateEvent);

module.exports = router;
