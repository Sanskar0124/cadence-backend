// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const sellsyController = require('../../../controllers/v2/webhooks/sellsy.controllers');

// update sellsy contact
router.post('/update', sellsyController.updateSellsyContact);

module.exports = router;
