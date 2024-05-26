// Packages
const express = require('express');
const router = express.Router();

// Middlewre
const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const sheetsController = require('../../../../controllers/v2/google/sheets/sheets.controller');

// Routes
router.post('/create-leads', auth, sheetsController.createLeads);
router.post('/update-leads', auth, sheetsController.updateLeads);
router.post('/preview-leads', auth, sheetsController.previewLeads);
router.post('/link-leads', auth, sheetsController.linkLeads);
router.post('/resync-leads', auth, sheetsController.resyncLeads);
router.post('/headers', auth, sheetsController.fetchHeaders);

module.exports = router;
