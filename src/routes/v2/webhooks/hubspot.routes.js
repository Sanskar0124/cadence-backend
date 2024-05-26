const express = require('express');
const router = express.Router();

// Controllers
const hubspotController = require('../../../controllers/v2/webhooks/hubspot.controllers');

// update routes
router.post('/update', hubspotController.updateHubspot);

// create contact route
router.post('/workflow', hubspotController.addHubspotContactsViaWorkflow);

module.exports = router;
