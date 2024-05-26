// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const dynamicsController = require('../../../../controllers/v2/oauth/dynamics.controllers');

// Routes
router.get('/redirect', auth, dynamicsController.redirectToDynamics);
router.get('/authorize', auth, dynamicsController.authorizeDynamics);
router.get('/signout', auth, dynamicsController.signOutFromDynamics);

module.exports = router;
