// Packages
const express = require('express');
const router = express.Router();

// Middlewares
//const { auth } = require('../../../../middlewares/auth.middlewares');
const {
  externalAuth,
} = require('../../../../middlewares/external.middlewares');

// Controllers
const contactCreationController = require('../../../../controllers/v1/sales/salesforce-integrations/contact.controllers');

router.post('/', externalAuth, contactCreationController.createContacts);
router.get(
  '/:id',
  externalAuth,
  contactCreationController.getContactsBySalesforceContactId
);
router.put('/', externalAuth, contactCreationController.updateContacts);
router.delete('/', externalAuth, contactCreationController.deleteContacts);

router.post(
  '/link',
  externalAuth,
  contactCreationController.linkContactsWithCadence
);
router.put(
  '/status',
  externalAuth,
  contactCreationController.updateContactToCadenceStatus
);
router.put(
  '/owner-update',
  externalAuth,
  contactCreationController.updateContactOwnerId
);

module.exports = router;
