// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const userController = require('../../../../controllers/v1/ringover/user/user.controller');

// Routes
router.get('/', auth, userController.getInfo);

module.exports = router;
