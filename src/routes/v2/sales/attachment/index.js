// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const attachmentsController = require('../../../../controllers/v2/sales/attachments/attachments.controllers');

// Routes

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.EMAIL_TEMPLATES
    ),
  ],
  attachmentsController.getAttachmentById
);

router.delete(
  '/:attachment_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.EMAIL_TEMPLATES
    ),
  ],
  attachmentsController.deleteAttachmentOnRemove
);

router.get(
  '/download/:attachment_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.EMAIL_TEMPLATES
    ),
  ],
  attachmentsController.downloadAttachment
);

module.exports = router;
