// Pacakages
const express = require('express');
const router = express();

// Routes
const pipedriveRoutes = require('./pipedrive.routes');
const hubspotRoutes = require('./hubspot.routes');
const calendlyRoutes = require('./calendly.routes');
const zohoRoutes = require('./zoho.routes');
const sellsyRoutes = require('./sellsy.routes');

// moved to webhook service
//router.use('/pipedrive', pipedriveRoutes);
router.use('/hubspot', hubspotRoutes);
router.use('/calendly', calendlyRoutes);
router.use('/zoho', zohoRoutes);
router.use('/sellsy', sellsyRoutes);

module.exports = router;
