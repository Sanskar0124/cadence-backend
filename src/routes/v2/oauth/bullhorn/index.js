// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const bullhornController = require('../../../../controllers/v2/oauth/bullhorn.controllers');

// Routes
router.get('/redirect', bullhornController.redirectToBullhorn);
router.get('/authorize', auth, bullhornController.authorizeBullhorn);
router.get('/signout', auth, bullhornController.signOutFromBullhorn);

module.exports = router;
