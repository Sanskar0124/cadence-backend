// Pacakages
const express = require('express');
const router = express();

const pipedriveRoutes = require('./pipedrive');
const hubspotRoutes = require('./hubspot');
const calendlyRoutes = require('./calendly');
const sellsyRoutes = require('./sellsy');
const zohoRoutes = require('./zoho');
const bullhornRoutes = require('./bullhorn');
const ringoverRoutes = require('./ringover');
const dynamicsRoutes = require('./dynamics');

router.use('/pipedrive', pipedriveRoutes);
router.use('/hubspot', hubspotRoutes);
router.use('/calendly', calendlyRoutes);
router.use('/sellsy', sellsyRoutes);
router.use('/zoho', zohoRoutes);
router.use('/bullhorn', bullhornRoutes);
router.use('/ringover', ringoverRoutes);
router.use('/dynamics', dynamicsRoutes);

module.exports = router;
