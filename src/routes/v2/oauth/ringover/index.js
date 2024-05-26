// * Package Imports
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// * Controller Imports
const ringoverController = require('../../../../controllers/v2/oauth/ringover.controller');

// * Routes
router.get('/redirect', ringoverController.redirectToRingover);
router.get('/authorize', ringoverController.authorizeRingover);
router.post('/access-token', ringoverController.getAccessToken);
router.get('/signout', auth, ringoverController.signOutFromRingover);

module.exports = router;
