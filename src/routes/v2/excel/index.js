// Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Middlewre
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const excelController = require('../../../controllers/v2/excel/excel.controllers.js');

// Routes
router.post(
  '/preview-leads',
  auth,
  upload.single('file'),
  excelController.previewLeads
);

router.post('/create-leads', auth, excelController.createLeads);
router.post('/link-leads', auth, excelController.linkLeads);
router.post(
  '/extract-columns',
  auth,
  upload.single('file'),
  excelController.extractColumns
);

module.exports = router;
