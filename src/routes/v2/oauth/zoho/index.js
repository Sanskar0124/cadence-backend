// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const zohoController = require('../../../../controllers/v2/oauth/zoho.controllers');

// Routes
router.get('/redirect', auth, zohoController.redirectToZoho);
router.get('/authorize', auth, zohoController.authorizeZoho);
router.get('/signout', auth, zohoController.signOutFromZoho);
router.post('/data-center', auth, zohoController.selectDataCenter);

module.exports = router;
