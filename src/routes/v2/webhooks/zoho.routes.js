// Packages
const express = require('express');
const router = express.Router();

// Controllers
const zohoController = require('../../../controllers/v2/webhooks/zoho.controllers');

// lead routes
router.post('/contact', zohoController.updateZohoContact);
router.post('/lead', zohoController.updateZohoLead);

// account routes
router.post('/account', zohoController.updateZohoAccount);

module.exports = router;
