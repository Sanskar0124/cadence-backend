// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const TemplateController = require('../../../../controllers/v2/sales/department/template.controller');

// Imports
router.post('/', [auth], TemplateController.createTemplate);

router.get('/', [auth], TemplateController.getAllTemplates);

router.get('/get-leads', [auth], TemplateController.getLeadsForTemplate);

router.get('/import', [auth], TemplateController.getAllTemplatesForImport);

router.get('/get-users', [auth], TemplateController.getShareUsers);

router.post('/share', [auth], TemplateController.shareTemplate);

router.post('/duplicate', [auth], TemplateController.duplicateTemplate);

router.delete('/:templateId', [auth], TemplateController.deleteTemplate);

router.get('/count', [auth], TemplateController.getAllTemplatesCount);

router.patch('/', [auth], TemplateController.updateTemplate);

module.exports = router;
