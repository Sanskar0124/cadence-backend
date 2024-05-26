// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const CalendlyController = require('../../../../controllers/v2/oauth/calendly.controllers');

// Routes
router.get('/redirect', auth, CalendlyController.redirectToCalendly);
router.get('/authorize', auth, CalendlyController.authorizeCalendly);
router.get('/signout', auth, CalendlyController.signOutFromCalendly);

module.exports = router;
