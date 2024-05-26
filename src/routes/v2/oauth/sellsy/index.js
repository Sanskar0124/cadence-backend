// Packages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const sellsyController = require('../../../../controllers/v2/oauth/sellsy.controllers');

// Routes
router.get('/redirect', sellsyController.redirectToSellsy);
router.get('/authorize', auth, sellsyController.authorizeSellsy);
router.get('/signout', auth, sellsyController.signOutFromSellsy);

module.exports = router;
