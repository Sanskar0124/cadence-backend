// Packages
const express = require('express');
const router = express.Router();

// Controllers
const pipedriveController = require('../../../controllers/v2/webhooks/pipedrive.controllers');

// Person routes
router.post('/person', pipedriveController.updatePipedrivePerson);

// Organization routes
router.post('/organization', pipedriveController.updatePipedriveOrganization);

// Deal routes
router.post('/deal', pipedriveController.updatePipedriveDeal);

module.exports = router;
