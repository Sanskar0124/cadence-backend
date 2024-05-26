// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const salesforceController = require('../../../controllers/v1/salesforce/oauth');

// Routes
router.get('/redirect', [auth], salesforceController.redirectToSalesforce);
router.get('/authorize', [auth], salesforceController.authorizeSalesforce);
router.get('/signout', [auth], salesforceController.signOutFromSalesforce);

module.exports = router;
