// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const linkedinController = require('../../../controllers/v2/linkedin/linkedin.controllers');

router.post(
  '/conn-request',
  [auth],
  linkedinController.sendLinkedinConnRequest
);

router.post('/message', [auth], linkedinController.sendLinkedinMessage);
router.get(
  '/view-profile/:lead_id',
  [auth],
  linkedinController.viewLinkedinProfile
);

module.exports = router;
