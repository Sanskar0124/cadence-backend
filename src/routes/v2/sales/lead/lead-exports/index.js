// * Packages
const express = require('express');
const router = express.Router();

// Route imports
const salesforceExportRoutes = require('./salesforce-exports.routes');
const pipedriveExportRoutes = require('./pipedrive-exports.routes');
const hubspotExportRoutes = require('./hubspot-exports.routes');
const zohoExportRoutes = require('./zoho-exports.routes');
const sellsyExportRoutes = require('./sellsy-exports.routes');
const bullhornExportRoutes = require('./bullhorn-exports.routes');

// * Routes
router.use('/salesforce', salesforceExportRoutes);
router.use('/pipedrive', pipedriveExportRoutes);
router.use('/hubspot', hubspotExportRoutes);
router.use('/zoho', zohoExportRoutes);
router.use('/sellsy', sellsyExportRoutes);
router.use('/bullhorn', bullhornExportRoutes);

module.exports = router;
