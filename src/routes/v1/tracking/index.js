// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const LinkStoreController = require('../../../controllers/v1/tracking');

// Routes
router.post('/getShortenedLink', auth, LinkStoreController.getShortenedLink);

module.exports = router;
