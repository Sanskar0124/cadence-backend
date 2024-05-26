// Packages
const express = require('express');
const router = express.Router();

// Middlewares
//const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  externalAuth,
} = require('../../../../middlewares/external.middlewares');

// Controllers
const cadenceController = require('../../../../controllers/v1/sales/salesforce-integrations/cadence.controllers');

router.get('/', externalAuth, cadenceController.getCadences);
router.get('/:id', externalAuth, cadenceController.getCadenceUsers);

module.exports = router;
