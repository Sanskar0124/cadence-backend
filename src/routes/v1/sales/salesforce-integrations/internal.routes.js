// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { devAuth } = require('../../../../middlewares/dev.middlewares');

// Controllers
const leadCreationController = require('../../../../controllers/v1/sales/salesforce-integrations/lead.controllers');
const contactCreationController = require('../../../../controllers/v1/sales/salesforce-integrations/contact.controllers');
const userControllers = require('../../../../controllers/v2/user/user.controllers');

router.post('/lead', devAuth, leadCreationController.createLeads);
router.post(
  '/lead/cadence-member',
  devAuth,
  leadCreationController.createLeadCadenceMember
);

router.post('/contact', devAuth, contactCreationController.createContacts);
router.post(
  '/contact/cadence-member',
  devAuth,
  leadCreationController.createLeadCadenceMember
);

// * Fetch owners
router.get('/owners', devAuth, userControllers.getUsers);

module.exports = router;
