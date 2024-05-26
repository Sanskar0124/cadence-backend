// Packages
const express = require('express');
const router = express.Router();

// Middleware
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const bugReportController = require('../../../controllers/v2/bug-reports/');

// Routes
router.post('/frontend-crash', auth, bugReportController.reportFrontendBug);

module.exports = router;
