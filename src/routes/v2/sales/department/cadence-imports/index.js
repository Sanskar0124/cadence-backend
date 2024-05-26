// * Packages
const express = require('express');
const router = express.Router();

// Route imports
const salesforceImportRoutes = require('./salesforce-imports.routes');
const pipedriveImportRoutes = require('./pipedrive-imports.routes');
const hubspotImportRoutes = require('./hubspot-imports.routes');
const sellsyImportRoutes = require('./sellsy-imports.routes');
const zohoImportRoutes = require('./zoho-imports.routes');
const bullhornImportRoutes = require('./bullhorn-imports.routes');
const dynamicsImportRoutes = require('./dynamics-imports.routes');

// * Routes
router.use('/salesforce', salesforceImportRoutes);
router.use('/pipedrive', pipedriveImportRoutes);
router.use('/hubspot', hubspotImportRoutes);
router.use('/sellsy', sellsyImportRoutes);
router.use('/zoho', zohoImportRoutes);
router.use('/bullhorn', bullhornImportRoutes);
router.use('/dynamics', dynamicsImportRoutes);

module.exports = router;
