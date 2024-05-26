// * Packages
const express = require('express');
const router = express();

// * Middleware
const { auth } = require('../../../middlewares/auth.middlewares');

// * Controllers
const aiController = require('../../../controllers/v2/ai/ai.controller');

// * Routes
router.post('/email-template', auth, aiController.generateEmail);

module.exports = router;
