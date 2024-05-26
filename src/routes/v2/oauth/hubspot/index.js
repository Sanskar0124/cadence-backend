// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const hubspotController = require('../../../../controllers/v2/oauth/hubspot.controllers');

// Routes
router.get('/redirect', auth, hubspotController.redirectToHubspot);
router.get('/authorize', auth, hubspotController.authorizeHubspot);
router.get('/signout', auth, hubspotController.signOutFromHubspot);

module.exports = router;
