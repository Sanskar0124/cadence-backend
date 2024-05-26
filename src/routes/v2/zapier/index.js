// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const authMiddleware = require('../../../../../Cadence-Brain/src/middlewares/auth.middlewares');

// Controllers
const zapierControllers = require('../../../controllers/v2/zapier/zapier.controllers');

//Routes
router.post(
  '/create-lead',
  [authMiddleware.auth],
  zapierControllers.zapierCreateLead
);

module.exports = router;
