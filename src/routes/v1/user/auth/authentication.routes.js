// Packages
const express = require('express');
const router = express();

// Controllers
const userControllers = require('../../../../controllers/v1/user/authentication/signin.controllers');

// Routes
// router.post('/signup', userControllers.registerUser);
// router.post('/login', userControllers.loginUser);

module.exports = router;
